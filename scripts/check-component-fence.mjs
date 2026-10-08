#!/usr/bin/env node
/**
 * 门禁：`Component` 围栏必须真的展开成「组件 / 用法」两页签。
 *
 * ## 抓的是什么
 *
 * `src/plugins/component-fence.ts` 把
 *
 *     ```Component [Alert.astro]
 *     <Alert …>…</Alert>
 *     ```
 *
 * 展开成 `<Tab>` 的「现场效果 / 组件语法」两栏。其中一处**坏了不会变红**：
 * **围栏被提前截断**。正文里含三反引号而外层也只写三反引号时，mdast 在第一个
 * 三反引号处闭合，正文缺一大截，剩下的以普通 markdown 身份漏进页面。
 * 另一处是**围栏根本没展开**（改坏了插件、或围栏信息写错被跳过）。
 *
 * 两条都是「看起来对、其实错」，所以判据落在**产物**上：「用法」代码块的正文
 * 必须与源文件里围栏正文**逐字相同**，且页面里「组件语法」页签的个数必须等于
 * 本页 Component 围栏的个数。
 *
 * 2026-10-04 之前还有第三条：把「源码」栏逐字读回来与磁盘文件比对，抓的是围栏
 * meta 配对错位。**「源码」栏已移除**，那条判据随之删除——错位的后果退化成
 * 「用法栏图注拿错」，已被上面的逐字判据覆盖。
 *
 * ## 源侧判据
 *
 * - `source=` 只允许出现在 `Component` 围栏上：旧写法（空围栏 + `source=`）退役后
 *   残留一个，插件不再填它，那个围栏就是一个**空代码块**，而构建是绿的。
 * - `[文件名]` 必须能推到一个存在且非空的文件（默认 `components/content/<文件名>`）。
 *   「源码」栏移除后它只剩图注作用，但**仍然要求文件存在**：图注指向一个不存在的
 *   组件在页面上看不出来，构建也不会红。
 * - 正文里的大写组件名必须包含文件名去扩展名。
 * - 围栏长度必须严格大于正文里最长的反引号串。
 * - 围栏必须闭合。
 *
 * ## 用法
 *
 *     node scripts/check-component-fence.mjs
 *
 * 退出码：0 = 通过；1 = 有问题；2 = 脚本自身跑不起来（缺 dist 等）
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { DIST, REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const ROOT = REPO_ROOT
const SRC = join(ROOT, 'src')
const CONTENT = join(SRC, 'content')

/** 源码默认目录，与插件里的同名常量一致 */
const DEFAULT_DIR = 'components/content'

/** 围栏语言，即插件的标记 */
const LANG = 'Component'

/** 「组件语法」页签的文字。改了 src/plugins/component-fence.ts 的 TABS 要同步改这里 */
const USAGE_TAB = '组件语法'

const FILENAME_RE = /\[([^\]]+)\]/
const SOURCE_RE = /(?:^|\s)source=(\S+)/
const JSX_TAG_RE = /<\/?\s*([A-Z][\w.-]*)/g

/** 判据用「产物里的出现次数」对「源里的出现次数」，不逐元素配对 */
function fail(problems) {
	for (const p of problems)
		console.error(`  FAIL  ${p}`)
	console.error(`\nRESULT: FAIL - ${problems.length} 处问题`)
	process.exit(1)
}

function fatal(message) {
	console.error(`ERROR: ${message}`)
	console.error('RESULT: ERROR - 门禁自己跑不起来，不算数')
	process.exit(2)
}

/**
 * 扫一个文件里的围栏。
 *
 * ⚠️ 闭合判定与 `plugins/prose.ts` 的 `scanFences()` 保持一致：同字符、
 * 长度不小于开启围栏、**且 info 为空**。围栏里那行带 info 的三反引号
 * （例如 Component 正文里的 ` ```math `）是**正文**，必须原样收进 body，
 * 不能当成别的围栏吞掉。
 */
function scanFences(source) {
	const lines = source.split(/\r?\n/)
	const out = []
	let open = null
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const m = /^\s*(`{3,}|~{3,})/.exec(line)
		if (!m) {
			if (open)
				open.body.push(line)
			continue
		}
		const fence = m[1]
		const info = line.slice(m[0].length).trim()
		if (open) {
			if (fence[0] === open.char && fence.length >= open.len && !info) {
				out.push({ ...open, body: open.body.join('\n') })
				open = null
			}
			else {
				open.body.push(line)
			}
			continue
		}
		open = { char: fence[0], len: fence.length, info, lang: info.split(/\s+/)[0] ?? '', body: [], line: i + 1 }
	}
	return { fences: out, unclosed: open }
}

/** 递归列出 *.mdx（原 `walkMdx` 的扩展名筛选已由共享遍历器的 `ext` 表达） */
function walkMdx(dir) {
	return walkFiles(dir, { ext: '.mdx' })
}

function longestBacktickRun(text) {
	let longest = 0
	for (const m of text.matchAll(/`+/g))
		longest = Math.max(longest, m[0].length)
	return longest
}

/**
 * 源文件 → 路由。
 *
 * 与 `content.config.ts` 的 `generateId()` 同一套规则：frontmatter `permalink`
 * 优先，其次相对路径去扩展名、去 `index`，最后按 `hidePostPrefix` 去 `posts/` 前缀。
 * `build.format: 'directory'` ⇒ 产物是 `dist/<route>/index.html`。
 */
function routeOf(file, source) {
	const permalink = /^permalink:\s*(\S+)\s*$/m.exec(source)?.[1]
	if (permalink)
		return permalink.replace(/^\/+|\/+$/g, '')
	let rel = file.replace(CONTENT, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.[^./]+$/, '')
	rel = rel.replace(/(^|\/)index$/, '$1').replace(/\/+$/, '')
	// hidePostPrefix 从 src/config/blog.ts 里读（那是 TS，node 直接 import 不了）
	const cfg = readFileSync(join(SRC, 'config/blog.ts'), 'utf8')
	const hide = /hidePostPrefix:\s*(true|false)/.exec(cfg)?.[1] === 'true'
	if (hide && rel.startsWith('posts/'))
		rel = rel.slice('posts/'.length)
	return rel
}

function normalizeText(s) {
	return s.replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&apos;': '\'', '&amp;': '&' }

function decode(s) {
	return s.replace(/&(?:lt|gt|quot|apos|#39|amp);/g, m => ENTITIES[m] ?? m)
}

/** 产物里每个代码块 figure：文件名、语言、正文 */
function figuresOf(html) {
	const out = []
	for (const m of html.matchAll(/<figure class="z-codeblock"[^>]*>([\s\S]*?)<\/figure>/g)) {
		const block = m[1]
		const caption = /<figcaption>([\s\S]*?)<\/figcaption>/.exec(block)?.[1] ?? ''
		const fileM = /<span class="filename">([\s\S]*?)<\/span>/.exec(caption)
		const langM = /<span class="language">([\s\S]*?)<\/span>/.exec(caption)
		const body = block.slice(block.indexOf('</figcaption>') + '</figcaption>'.length)
		out.push({
			filename: fileM ? decode(fileM[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : undefined,
			lang: langM ? langM[1].trim() : undefined,
			text: decode(body.replace(/<[^>]*>/g, '')),
		})
	}
	return out
}

// ── 源侧 ───────────────────────────────────────────────────────────────────
const problems = []
/** 每个含 Component 围栏的源文件 → 该文件的围栏列表（后面拿去对产物） */
const perFile = new Map()

for (const file of walkMdx(CONTENT)) {
	const source = readFileSync(file, 'utf8')
	const { fences, unclosed } = scanFences(source)
	if (unclosed)
		problems.push(`${file}:${unclosed.line} 围栏没有闭合（起始于第 ${unclosed.line} 行）`)

	const demos = []
	for (const fence of fences) {
		if (fence.lang !== LANG) {
			// 旧写法退役后残留：插件不再填它，那个围栏就是一个**空代码块**，而构建是绿的
			if (SOURCE_RE.test(fence.info))
				problems.push(`${file}:${fence.line} 还有非 Component 围栏带 source=（旧写法已退役）：${fence.info}`)
			continue
		}

		const filename = FILENAME_RE.exec(fence.info)?.[1]
		if (!filename) {
			problems.push(`${file}:${fence.line} Component 围栏缺 [文件名]：${fence.info || '(空)'}`)
			continue
		}

		const rel = SOURCE_RE.exec(fence.info)?.[1] ?? `${DEFAULT_DIR}/${filename}`
		const abs = join(SRC, rel)
		if (!abs.startsWith(SRC)) {
			problems.push(`${file}:${fence.line} source=${rel} 逃出 src/`)
			continue
		}
		let content
		try {
			content = readFileSync(abs, 'utf8')
		}
		catch {
			problems.push(`${file}:${fence.line} 读不到 ${rel}（[${filename}] 的默认路径是 ${DEFAULT_DIR}/<文件名>，不在那儿就补 source=）`)
			continue
		}
		if (!content.trim())
			problems.push(`${file}:${fence.line} ${rel} 是空文件`)

		const body = normalizeText(fence.body)
		if (!body)
			problems.push(`${file}:${fence.line} [${filename}] 围栏正文是空的`)

		const names = new Set([...body.matchAll(JSX_TAG_RE)].map(m => m[1]))
		if (names.size && !names.has(filename.replace(/\.[^.]+$/, '')))
			problems.push(`${file}:${fence.line} [${filename}] 与正文的组件（${[...names].join(' / ')}）对不上`)

		const run = longestBacktickRun(body)
		if (fence.len <= run)
			problems.push(`${file}:${fence.line} [${filename}] 围栏只有 ${fence.len} 个反引号，正文里有 ${run} 连的，正文会被截断`)

		demos.push({ line: fence.line, filename, rel, source: normalizeText(content), body })
	}
	if (demos.length)
		perFile.set(file, demos)
}

if (!perFile.size) {
	console.log('OK: src/content 下没有 Component 围栏')
	process.exit(0)
}
if (problems.length)
	fail(problems)

// ── 产物侧 ─────────────────────────────────────────────────────────────────
if (!statSync(DIST).isDirectory())
	fatal('dist/ 不存在，先 pnpm build')

for (const [file, demos] of perFile) {
	const source = readFileSync(file, 'utf8')
	const route = routeOf(file, source)
	const htmlPath = join(DIST, route, 'index.html')
	let html
	try {
		html = readFileSync(htmlPath, 'utf8')
	}
	catch {
		fail([`${file} 推导出路由 /${route}，但产物 ${htmlPath.slice(ROOT.length + 1)} 不存在`])
	}

	const figures = figuresOf(html)
	for (const demo of demos) {
		const label = `${file}:${demo.line} [${demo.filename}]`

		/*
		 * 「源码」栏已于 2026-10-04 移除，原来那条「图注文件名 + 逐字等于磁盘文件」
		 * 的判据随之失效——它本来抓的是**围栏 meta 配对错位**，而错位的后果
		 * 现在退化成「用法栏图注拿错」，由下面这条逐字判据一并覆盖。
		 *
		 * 剩下的唯一产物侧判据是「用法」代码块必须与围栏正文**逐字相同**。
		 * 它抓的是围栏被提前截断：正文里含三反引号而外层围栏也只写三反引号时，
		 * mdast 在第一个三反引号处闭合，正文缺一大截，剩下的以普通 markdown
		 * 身份漏进页面——构建照常绿。
		 */
		const usage = figures.filter(f => f.lang === 'mdx' && !f.filename && normalizeText(f.text) === demo.body)
		if (usage.length === 0)
			fail([`${label} 产物里找不到与围栏正文逐字相同的「${USAGE_TAB}」代码块`])
	}

	/*
	 * 数量对账：只有 Component 围栏会产出「用法」页签（手写 <Tab> 不会用这个名字），
	 * 所以它的个数必须等于本页 Component 围栏的个数。
	 *   少 = 有围栏没展开；多 = 别处混进了不该有的用法栏。
	 */
	/*
	 * `\\d` 而不是 `\d`：模板字符串里 `\d` 不是合法转义序列，JS 会把它吞成 `d`，
	 * 于是正则变成 `data-tab-select="d+"`，永远匹配不到——而且**门禁会报 0 个页签**
	 * 而不是报错，看起来像「围栏全没展开」。（这个坑与 shell 里 `$1` 被吃掉是同一族。）
	 */
	const usageTabs = (html.match(new RegExp(`data-tab-select="\\d+"[^>]*>${USAGE_TAB}<`, 'g')) || []).length
	const want = demos.length
	if (usageTabs !== want) {
		fail([`${file} 产物里有 ${usageTabs} 个「${USAGE_TAB}」页签，而本页有 ${want} 个 Component 围栏——${
			usageTabs < want ? '有围栏没展开成页签' : '多出来的用法页签来源不明'}`])
	}
}

const total = [...perFile.values()].reduce((n, d) => n + d.length, 0)
console.log(`OK: ${total} 个 Component 围栏（${perFile.size} 个文件）——都展开成「现场效果 / 组件语法」两页签，语法栏与围栏正文逐字一致。`)
process.exit(0)
