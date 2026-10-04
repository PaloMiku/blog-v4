#!/usr/bin/env node
/**
 * 边界门禁：站点只能依赖仓库内的文件与 package.json 里声明的依赖。
 *
 * ## 它的前提在 2026-10-03 换过一次
 *
 * 原本的判据是「`astro-site/` 不得引用 `astro-site/` 之外的任何东西」，因为迁移
 * 切换时会删掉整个 Nuxt 源码树（`app/` `content/` `server/` `shared/`
 * `nuxt.config.ts` `remark-plugins/` `modules/` `patches/`）。切换已经发生：
 * Astro 现在就长在仓库根，那棵树已经不存在了。
 *
 * 于是「不许引用 Nuxt 树」这条判据**自动成立**（引用一个不存在的文件，构建先炸），
 * 真正还剩下、且仍然会咬人的是下面五条：
 *
 *   1. 相对路径不得逃出仓库根。判据从「逃出站点根」改成「逃出仓库根」——量的是
 *      同一个东西（站点根现在是仓库根），但多挡住了「import 到隔壁项目」这种
 *      本地能跑、换台机器就断的情况。
 *   2. 不得引用 Nuxt 时代的运行时（`nuxt` / `#imports` / `h3` / `ofetch` …）
 *      与路径别名（`~/` `~~/` `@/`）。这些包已随源码树一起删除，现在引入它们
 *      只会得到一个装不上的 import。
 *   3. 站内路径必须真的存在。防止改 import 时打错路径——构建期才发现。
 *   4. 依赖必须在 package.json 里声明且已安装。
 *   5. **不得引用 `baseline/`**。这条是接管后新增的：`baseline/nuxt/` 是冻结的
 *      Nuxt 产物（未入库，且 Nuxt 源码树已删、再也无法重新冻结），是**测量锚点**，
 *      不是构建输入。任何指向它的 import 都会让构建依赖一个 CI 上不存在的目录。
 *      旧判据管不到它，因为那时 `baseline/` 还不存在。
 *
 * 这个脚本**必须真的会失败**——一个从没被看见失败过的检查不构成任何证据（见
 * `docs/astro-phase1-findings.md` §62.4）。改动本脚本后，请照下面「如何自证」
 * 一节临时制造一次越界 import，确认它变红，再还原。
 *
 * 用法：node scripts/check-self-contained.mjs
 * 退出码：0 = 通过；1 = 有越界/未声明引用；2 = 脚本自身出错
 *
 * ## 为什么是词法判定而不是真实模块解析
 *
 * `astro:content` / `virtual:astro-icon` 之类没有磁盘实体，
 * `import.meta.glob()` 的模式串指向一批文件而非单个文件。取而代之：
 * 相对路径一律做**词法归一化**（消掉 `.` 与 `..`）再判断是否越出仓库根。
 *
 * ## 为什么要扫两遍
 *
 * 第一遍扫描**剥掉注释**后的源码，消掉散文误报（这个仓库的注释里满是
 * 「为什么不直接 import { x } from '...'」这类反例说明）。
 * 第二遍扫描**原始文本**。两遍结果取并集：
 *   - 真实越界 import 两遍都命中，去重后仍是一条；
 *   - 注释里提到站外路径只会命中第二遍 —— 宁可误报也不漏报；
 *   - 剥注释时若被正则字面量里的引号带偏（经典的 /["']/ 陷阱）导致漏读，
 *     第二遍仍然会抓到。
 * 因此这个检查**不存在漏报路径**。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 参与扫描的目录 / 文件：构建期的模块图 + 开发脚本 */
const SCAN_TARGETS = ['src', 'scripts', 'astro.config.mjs']

/** 只读不扫的目录名（产物、缓存、快照、冻结基线） */
const SKIP_DIRS = new Set([
	'.astro',
	'.astro-compare',
	'.astro-shots',
	'.nuxt-shots',
	'node_modules',
	'dist',
	'content',
	'public',
	'baseline',
	'.git',
])

/** 视为「代码」的扩展名。刻意不含 .mdx：正文不是模块图的一部分，且代码块里会出现伪 import 文本 */
const CODE_EXTS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.tsx', '.astro', '.vue'])

/** 相对路径落地时依次尝试的后缀 */
const RESOLVE_EXTS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.tsx', '.astro', '.vue', '.json', '.css']

/** 构建期由框架 / 集成注入的虚拟模块前缀，本地没有实体 */
const VIRTUAL_PREFIXES = ['astro:', 'virtual:']

/** Nuxt 时代遗留的运行时 / 别名，接管后一律非法（那些包已随源码树删除） */
const FORBIDDEN_BARE = new Set([
	'#imports',
	'#app',
	'#build',
	'#components',
	'#nitro',
	'h3',
	'ofetch',
	'nuxt',
	'nuxt-edge',
	'unctx',
	'vue-demi',
])

/** Nuxt 风格的路径别名（`~/`、`~~/`、`@/`），astro-site 未配置 */
// eslint-disable-next-line regexp/no-unused-capturing-group -- 保持与迁移前的写法逐字一致，行为未变
const FORBIDDEN_ALIAS = /^(~{1,2}\/|@\/)/

/**
 * 抽取 import/export/require 的模块说明符。
 *
 * 覆盖 `from 'x'`、`import 'x'`、`import('x')`、`require('x')` 四种形态。
 *
 * ⚠️ 关键词前必须加 `(?<![\w$.-])` 负向后顾，**不能只靠 `\b`**。
 * 2026-10-02 实测踩中：`['collapse-enter-from', 'collapse-enter-active', …]`
 * 这种数组字面量里，`from` 前面紧挨着 `-`，`\b` 仍然成立，于是正则把
 * `from', 'collapse-enter-from` 之间的 `, ` 当成了模块说明符，
 * 报出一条 `undeclared ,` 的假违规。补上前顾后 `collapse-enter-from`
 * 不再命中，而真正的 `from 'x'`（前面是空白）照常命中。
 */
// 关键词前的 `(?<![\w$.-])` 已经排除了词字符，句首/空白处 `\b` 恒成立，故不再写 `\b`
const SPECIFIER_RE = /(?<![\w$.-])(?:from|import|require)\s*(?:\(\s*)?['"]([^'"\n]+)['"]\s*\)?/g

/**
 * 构建期的**运行时读文件**：这类越界 import 扫描抓不到。
 *
 * 2026-10-02 实测踩中：`src/components/widget/BlogTech.astro` 写着
 * `new URL('../../../../', import.meta.url)` 再 `readFileSync('package.json')`。
 * 组件在仓库里时它一路向上正好命中 Nuxt 根的 `package.json`，构建是绿的；
 * 把 astro-site 整个复制到 %TEMP% 单独构建时，它读的是 `%TEMP%\package.json`，
 * **构建直接 ENOENT 失败**。词法门禁全程报「0 越界引用」。
 *
 * 也就是说：只扫 import 说明符的自包含检查，对运行时读文件**完全失明**。
 * 这正是 `docs/astro-phase1-findings.md` §35 记过的 `import.meta.url` 少算一层
 * 那个老坑的第二次出现。
 *
 * 覆盖两种写法：
 *   new URL('<相对路径>', import.meta.url)
 *   readFileSync('<相对路径>') / existsSync / writeFileSync / statSync
 *
 * ⚠️ 这两个模式**必须**用 `new RegExp(string)` 而不是正则字面量：
 * 本文件上方的 `stripComments` 跟踪字符串状态机，但不识别正则字面量
 * （见它自己的注释）。若这里的模式里出现**裸的**引号字符，状态机会被带偏，
 * 导致后面整个文件的注释剥离出错——实测会把它自己的文档注释
 * 误判成一条 `undeclared` 违规。所以引号一律写成 `\x27` / `\x22` 转义。
 *
 * ⚠️ 捕获组必须在**引号之内**，即 `[引号](\\.[^引号]*)[引号]`。
 * 第一版把捕获组写在了前引号之前，于是整条规则**匹配不到任何东西**——
 * 而它报出来的结果是「0 越界引用」，看上去完全正常。
 * 是靠「注入真实缺陷后必须变红」这个负控才发现的：
 *   没有负控的门禁等于没有门禁（docs/astro-phase1-findings.md §62.4）。
 */
// eslint-disable-next-line prefer-regex-literals -- 见上方说明：字面量里的裸引号会打断 stripComments
const RUNTIME_URL_RE = new RegExp(
	'\\bnew\\s+URL\\s*\\(\\s*[\\x27\\x22](\\.[^\\x27\\x22\\n]*)[\\x27\\x22]\\s*,\\s*import\\.meta\\.url\\s*\\)',
	'g',
)
// eslint-disable-next-line prefer-regex-literals -- 同上
const RUNTIME_FS_RE = new RegExp(
	'\\b(?:readFileSync|existsSync|writeFileSync|readdirSync|statSync)\\s*\\(\\s*[\\x27\\x22](\\.[^\\x27\\x22\\n]*)[\\x27\\x22]',
	'g',
)

/**
 * 把注释替换成等长空白（保留换行，行号才不会错位）。
 *
 * 跟踪字符串与模板字面量，免得 `'https://…'` 里的 `//` 被当成行注释。
 * 正则字面量不做识别——若其内部含引号会把状态带偏，但第二遍原始扫描兜底。
 */
function stripComments(text) {
	let out = ''
	let i = 0
	const n = text.length
	// 'code' | 'line' | 'block' | 单引号 | 双引号 | 模板
	let state = 'code'
	while (i < n) {
		const c = text[i]
		const c2 = text[i + 1]
		if (state === 'code') {
			if (c === '/' && c2 === '/') {
				state = 'line'
				out += '  '
				i += 2
				continue
			}
			if (c === '/' && c2 === '*') {
				state = 'block'
				out += '  '
				i += 2
				continue
			}
			if (c === '\'')
				state = 'sq'
			else if (c === '"')
				state = 'dq'
			else if (c === '`')
				state = 'tpl'
			out += c
			i++
			continue
		}
		if (state === 'line') {
			if (c === '\n')
				state = 'code'
			out += c === '\n' ? '\n' : ' '
			i++
			continue
		}
		if (state === 'block') {
			if (c === '*' && c2 === '/') {
				state = 'code'
				out += '  '
				i += 2
				continue
			}
			out += c === '\n' ? '\n' : ' '
			i++
			continue
		}
		// 字符串 / 模板内部
		if (c === '\\') {
			out += '  '
			i += 2
			continue
		}
		if (state === 'sq' && c === '\'')
			state = 'code'
		else if (state === 'dq' && c === '"')
			state = 'code'
		else if (state === 'tpl' && c === '`')
			state = 'code'
		out += c
		i++
	}
	return out
}

function collectFiles(target, out = []) {
	const abs = path.resolve(SITE, target)
	if (!fs.existsSync(abs))
		return out

	if (fs.statSync(abs).isFile()) {
		if (CODE_EXTS.has(path.extname(abs)))
			out.push(abs)
		return out
	}

	for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name))
				continue
			collectFiles(path.join(target, entry.name), out)
		}
		else if (entry.isFile() && CODE_EXTS.has(path.extname(entry.name))) {
			out.push(path.resolve(SITE, target, entry.name))
		}
	}
	return out
}

function pkgNameOf(specifier) {
	const parts = specifier.split('/')
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function readDeclaredDeps() {
	const pkg = JSON.parse(fs.readFileSync(path.join(SITE, 'package.json'), 'utf8'))
	return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
}

/** 词法归一化：消掉 `.` 与 `..`，纯字符串运算，不碰文件系统 */
function normalizePath(from, specifier) {
	const segments = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)).split('/')
	const out = []
	for (const seg of segments) {
		if (seg === '.')
			continue
		if (seg === '..') {
			if (out.length === 0)
				return null // 一路弹到文件系统根之外
			out.pop()
			continue
		}
		out.push(seg)
	}
	return out.join('/')
}

const violations = []
const seen = new Set()

function report(file, line, kind, specifier, detail) {
	const key = `${file}|${kind}|${specifier}`
	if (seen.has(key))
		return
	seen.add(key)
	violations.push({ file, line, kind, specifier, detail })
}

/**
 * 判定一个相对路径是否越出站点根，越界则报一条 `runtime-escape`。
 *
 * 相对基准是该**源文件自身所在目录**：`new URL(x, import.meta.url)` 的
 * `import.meta.url` 就是模块自身的 URL。
 */
function checkRuntimeFileReads(rel, source) {
	const scan = (regex) => {
		for (const match of source.matchAll(regex)) {
			const specifier = match[1]
			const line = source.slice(0, match.index).split('\n').length
			const resolved = normalizePath(rel, specifier)
			if (resolved === null) {
				report(rel, line, 'runtime-escape', specifier, '运行时读文件的路径逃出文件系统根')
				continue
			}
			const abs = path.resolve(SITE, resolved)
			if (abs !== SITE && !abs.startsWith(SITE + path.sep))
				report(rel, line, 'runtime-escape', specifier, `构建期运行时读站点外的文件：${resolved}`)
		}
	}
	scan(RUNTIME_URL_RE)
	scan(RUNTIME_FS_RE)
}

function checkSource(rel, source, declared) {
	checkRuntimeFileReads(rel, source)

	for (const match of source.matchAll(SPECIFIER_RE)) {
		const specifier = match[1].trim()
		const line = source.slice(0, match.index).split('\n').length

		// import.meta.glob() 之类的模式串：指向一批文件，不做落地判定
		if (specifier.includes('*'))
			continue

		if (VIRTUAL_PREFIXES.some(p => specifier.startsWith(p)))
			continue

		// 站内以 / 开头的是 public 资源或 URL，交给 Astro 处理
		if (specifier.startsWith('/') || specifier.startsWith('#'))
			continue

		if (specifier.startsWith('node:'))
			continue

		if (FORBIDDEN_ALIAS.test(specifier)) {
			report(rel, line, 'nuxt-alias', specifier, 'Nuxt 路径别名在 Astro 侧未配置')
			continue
		}

		if (specifier.startsWith('.')) {
			const resolved = normalizePath(rel, specifier)
			if (resolved === null) {
				report(rel, line, 'escapes', specifier, '相对路径逃出文件系统根')
				continue
			}
			// 判据 5（接管后新增）：冻结基线是测量锚点，不是构建输入。
			// 它未入库，指向它的 import 会在 CI 上 ENOENT，而本地永远绿。
			if (resolved === 'baseline' || resolved.startsWith('baseline/')) {
				report(rel, line, 'baseline-as-input', specifier, `构建期引用了冻结基线 ${resolved}：它是未入库的测量锚点，不是依赖`)
				continue
			}
			const abs = path.resolve(SITE, resolved)
			const inside = abs === SITE || abs.startsWith(SITE + path.sep)
			if (!inside) {
				report(rel, line, 'escapes', specifier, `归一化后落在站点外：${resolved}`)
				continue
			}
			// 仍在站内也要确认真的存在，防止改写 import 时打错路径
			const exists = fs.existsSync(abs)
				|| RESOLVE_EXTS.some(ext => fs.existsSync(abs + ext))
				|| RESOLVE_EXTS.some(ext => fs.existsSync(path.join(abs, `index${ext}`)))
			if (!exists)
				report(rel, line, 'missing', specifier, `站内找不到 ${resolved}`)
			continue
		}

		if (FORBIDDEN_BARE.has(specifier)) {
			report(rel, line, 'nuxt-runtime', specifier, 'Nuxt 运行时依赖，源码树已随接管删除')
			continue
		}
		const pkg = pkgNameOf(specifier)
		if (!declared.has(pkg)) {
			report(rel, line, 'undeclared', specifier, `package.json 未声明 ${pkg}`)
			continue
		}
		if (!fs.existsSync(path.join(SITE, 'node_modules', pkg)))
			report(rel, line, 'not-installed', specifier, '已声明但未安装，请先 pnpm install')
	}
}

try {
	const declared = readDeclaredDeps()
	const files = []
	for (const target of SCAN_TARGETS)
		collectFiles(target, files)

	for (const file of files) {
		const rel = path.relative(SITE, file).split(path.sep).join('/')
		const raw = fs.readFileSync(file, 'utf8')
		// 第一遍：剥注释，消掉散文误报
		checkSource(rel, stripComments(raw), declared)
		// 第二遍：原始文本兜底，确保不存在漏报。
		// 本文件自身豁免——它的文档里必然要举例 `from 'x'` 这类写法，
		// 而它仍然完整走第一遍，真实的站外 import 照样会被抓到。
		if (path.resolve(file) !== path.resolve(SITE, 'scripts/check-self-contained.mjs'))
			checkSource(rel, raw, declared)
	}

	if (violations.length > 0) {
		console.error(`✗ 站点存在 ${violations.length} 处越界/未声明引用：\n`)
		for (const v of violations)
			console.error(`  ${v.file}:${v.line}  [${v.kind}]  ${v.specifier}\n      ${v.detail}`)
		console.error('\n边界要求：构建只能依赖仓库内的文件与 package.json 里声明的依赖。')
		console.error('baseline/ 是未入库的冻结测量锚点，任何构建期引用都是错的。')
		console.error('\n如何自证：把任意一个 import 临时改成站外路径，重跑本脚本应变红。')
		process.exit(1)
	}

	console.log('✓ 边界检查通过')
	console.log(`  扫描目标：${SCAN_TARGETS.join(', ')}`)
	console.log(`  扫描文件：${files.length} 个`)
	console.log('  越界/未声明引用：0')
}
catch (err) {
	console.error('✗ 边界检查脚本自身出错：', err)
	process.exit(2)
}
