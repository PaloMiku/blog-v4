/**
 * 收尾自查门禁：扫 Astro 源码树里的 stub / TODO / 已知的「延后移植」标记。
 *
 * ## 它在防什么失败模式
 *
 * **不让任何东西以「静默空白」的形式发布。** 迁移过程里最容易漏的不是崩溃，
 * 而是**一个照常编译、照常构建、页面上却没有内容的东西**：一个只剩壳的组件、
 * 一句没做完就提交的 TODO、一个写着「这个先留空」的分支。它们在构建日志、
 * 页高扫描、样式对比里全是绿的——缺陷长什么样就是「什么都看不出来」，
 * 只有在这里把标记原样打出来才看得见。
 *
 * 代价不对称：**一个标记只是注释，不值一分钱；一个渲染为空的东西不值一百万。**
 * 所以判据刻意分成两层——先把注释行剔掉（省掉纯注释命中），
 * 再把剩下的**代码行**命中判红。
 *
 * ## 判据（4 条，与 PowerShell 原件逐条对应）
 *
 * 1. `TODO/FIXME/XXX`
 * 2. `未移植|尚未迁入|待移植|属其他批次|后续批次`
 * 3. `暂不可用|留空|暂留空|待接|接回|留待`
 * 4. `\bstub\b`（原 .NET 正则里的 `(?i)`）
 *
 * 外加一条前置过滤：整行形如 `^\s*(//|*|/*|*)` 的行直接跳过——
 * 那是纯注释，不构成上面说的那种失败模式。
 *
 * ⚠️ **原 PowerShell 版从不退出非零**，它只把命中打出来，然后退出 0。
 * 按 CLAUDE.md 记的 findings 85.4/85.5（「报了 15 处不一致而退出 0」就属于
 * 「有分但不报红」那一族），那等于没有门禁。因此这里把
 * **任何一行代码级命中判为 exit 1**。
 * 换个角度说：既然门禁的立身之本是「不让静默空白发布」，
 * 一旦空白真的出现了还报绿，这道门禁是反着的。
 *
 * ⚠️ **大小写**：PowerShell 的 `-match` **默认忽略大小写**，所以原脚本里
 * 那四条其实是**全部**大小写不敏感的——第 4 条上那个显式的 `(?i)` 是冗余的
 * （作者的笔误）。JS 的 `regex.test()` 是大小写敏感的，所以第 1、4 条（唯一
 * 含 ASCII 字母的两条）显式带上 `i`，以保持原脚本的**实际行为**不变；
 * 第 2、3 条是纯中文、大小写本就不变，`i` 是空操作，故不写。
 * 整体往严的方向偏（多报）而不是往松的方向偏：判据宽松了等于偷偷删了检查。
 * 如果原意确实是「第 1~3 条大小写敏感」，那是一次需要显式确认的收紧，不在本次移植范围内。
 *
 * 扫描范围：`src/` 递归下全部 `*.astro` / `*.ts`，逐行判定。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// 路径从脚本自身位置解析，不跟进程 CWD。
// 原 PowerShell 版写的是 `Resolve-Path '.\src'`——它跟的是 CWD 而不是脚本位置，
// 在仓库根以外的目录里跑会扫到别的地方（或直接失败）。这里修掉。
const HERE = fileURLToPath(new URL('.', import.meta.url))
const SITE_ROOT = join(HERE, '..')
const SRC = join(SITE_ROOT, 'src')

/**
 * 判据表。数组而非对象，顺序即原 `[ordered]@{}` 的插入顺序，报告按此顺序输出。
 *
 * 逐条对应 PowerShell 原件：
 *   '(?m)\b(TODO|FIXME|XXX)\b' → \b 已是 ASCII 词边界，逐行匹配时 `(?m)` 无作用，
 *                               去掉它不改变任何一条命中的结果；捕获组没人读，改 `(?:`。
 *   '(?i)\bstub\b'             → `i` 由上面的统一 `i` 提供，语义相同。
 * 另两条是纯中文、大小写不变，`i` 对它们本就是空操作（eslint 会把这一点指出来）。
 */
const PATTERNS = [
	['TODO/FIXME/XXX', /\b(?:TODO|FIXME|XXX)\b/i],
	['unported marker', /未移植|尚未迁入|待移植|属其他批次|后续批次/],
	['deferred/left empty', /暂不可用|留空|暂留空|待接|接回|留待/],
	['stub keyword', /\bstub\b/i],
]

/**
 * 前置过滤：整行是注释（`//` 开头、`*` 开头、`/*` 开头）就跳过。
 *
 * 原件是 `^\s*(//|\*|/\*|\*)`——四个分支里 `\*` 写了两遍，重复分支不改变匹配集合。
 * 合并成 `//` 或单个 `/`、`*`，命中集合与原件逐字符等价。
 */
const COMMENT_LINE = /^\s*(?:\/\/|[/*])/

/** 递归列出 dir 下所有文件；排序只为让报告逐次可复现，不影响判据。 */
function walk(dir) {
	const out = []
	if (!existsSync(dir))
		return out
	for (const name of readdirSync(dir).sort()) {
		const p = join(dir, name)
		if (statSync(p).isDirectory())
			out.push(...walk(p))
		else
			out.push(p)
	}
	return out
}

/** 切行按 .NET `File.ReadAllLines` 的语义：`\r\n` / `\r` / `\n` 都算断行。 */
function readLines(file) {
	return readFileSync(file, 'utf8').split(/\r\n|\r|\n/)
}

// `Get-ChildItem -Recurse -File -Include *.astro,*.ts` 的等价物。
// PowerShell 的 `-Include` 在 Windows 上大小写不敏感，这里用 `/i` 保持一致。
// （原脚本没有 `-Force`，会跳过「隐藏属性」文件；Windows 上 src/ 里没有这类文件，
//   实测 `ls -a src` 无隐藏项，所以不模拟这一条。）
const files = walk(SRC).filter(p => /\.(?:astro|ts)$/i.test(p))

const rows = PATTERNS.map(([kind, re]) => {
	const hits = []
	for (const file of files) {
		const lines = readLines(file)
		for (let i = 0; i < lines.length; i++) {
			const t = lines[i]
			if (COMMENT_LINE.test(t))
				continue
			if (re.test(t))
				hits.push({ file: relative(SRC, file).replace(/\\/g, '/'), line: i + 1, text: t.trim().slice(0, 84) })
		}
	}
	return { kind, hits }
})

for (const r of rows) {
	console.log('')
	console.log(`=== ${r.kind} : ${r.hits.length} ===`)
	for (const h of r.hits.slice(0, 12))
		console.log(`  ${h.file}:${h.line}  ${h.text}`)
	if (r.hits.length > 12)
		console.log(`  ... +${r.hits.length - 12} more`)
}

console.log('')
console.log('=== 组件总量 ===')
for (const d of ['content', 'blog', 'widget', 'partial', 'post', 'popover']) {
	const p = join(SRC, 'components', d)
	// 原件是 `if (Test-Path $p)`——目录不存在就不打这一行。
	if (existsSync(p)) {
		const n = readdirSync(p).filter(n => /\.astro$/i.test(n) && statSync(join(p, n)).isFile()).length
		console.log(`  ${d.padEnd(10)}${n}`)
	}
}
// 这三行原件无条件打印，目录缺失时 `-ErrorAction SilentlyContinue` + `$null.Count` = 0。
for (const d of ['layouts', 'lib', 'loaders']) {
	const p = join(SRC, d)
	const n = existsSync(p) ? readdirSync(p).filter(n => statSync(join(p, n)).isFile()).length : 0
	console.log(`  ${d.padEnd(10)}${n}`)
}

const total = rows.reduce((s, r) => s + r.hits.length, 0)

console.log('')
if (total) {
	console.log(`RESULT: FAIL - ${total} 处未清理的占位/延后标记在 ${files.length} 个源码文件里`)
	console.log('  每一处都是「构建全绿、页面上什么都没有」的候选。逐条处理：')
	console.log('  补完实现、或者把标记从代码行里删掉（挪进注释不算处理完）。')
	process.exit(1)
}

console.log(`RESULT: PASS - ${PATTERNS.length} 类标记在 ${files.length} 个 .astro/.ts 文件里均为 0 命中`)
process.exit(0)
