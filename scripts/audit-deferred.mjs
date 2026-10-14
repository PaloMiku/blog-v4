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
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

// 路径从脚本自身位置解析，不跟进程 CWD。
// 原 PowerShell 版写的是 `Resolve-Path '.\src'`——它跟的是 CWD 而不是脚本位置，
// 在仓库根以外的目录里跑会扫到别的地方（或直接失败）。这里收敛到共享的
// REPO_ROOT，理由见 scripts/lib/paths.mjs 文件头。
const ROOT = REPO_ROOT
const SRC = join(ROOT, 'src')

/**
 * 判据表。数组而非对象，顺序即原 `[ordered]@{}` 的插入顺序，报告按此顺序输出。
 *
 * 逐条对应 PowerShell 原件：
 *   '(?m)\b(TODO|FIXME|XXX)\b' → \b 已是 ASCII 词边界，逐行匹配时 `(?m)` 无作用，
 *                               去掉它不改变任何一条命中的结果；捕获组没人读，改 `(?:`。
 *   '(?i)\bstub\b'             → `i` 由下面的统一 `i` 提供，语义相同。
 * 另两条是纯中文、大小写不变，`i` 对它们本就是空操作（eslint 会把这一点指出来）。
 *
 * ⚠️ 中文没有 `\b` 词边界，所以纯中文的那两条**不能**照搬英文那两条的
 * 「单词」写法：`/留空/` 会把 `placeholder: '留空表示未更新'` 这种**正常文案**
 * 一并命中。实测结果是这道门禁长期 exit 1——两道假阳性全在
 * `src/lib/frontmatter.ts` 的 placeholder 文案上，而按 CLAUDE.md 验收原则
 * 「一道永远红的门禁等价于没有门禁」，红着等于没门禁。
 *
 * 修法是给中文标记加**上下文**约束：要求它出现在「占位/延后」的语境里
 * （前面是赋值或注释标记），而不是要求它是某个词。后者做不到——
 * 「留空」在这两个字符串里都完全合法，改文案来迁就门禁是本末倒置。
 */
const PATTERNS = [
	['TODO/FIXME/XXX', /\b(?:TODO|FIXME|XXX)\b/i],
	['unported marker', /未移植|尚未迁入|待移植|属其他批次|后续批次/],
	// 「留空」「待接」这类只在**被当作延后说明**时才算标记。
	//
	// 中文没有词边界，所以不能写成裸 `/留空/`：那会把
	// `placeholder: '留空表示未更新'` 这类**正常 UI 提示文案**一并命中。
	// 实测那道门禁因此长期 exit 1——两道假阳性全在 frontmatter.ts 的
	// placeholder 上，而按 CLAUDE.md「一道永远红的门禁等价于没有门禁」，红着等于没门禁。
	//
	// ⚠️ 这里刻意**不用**一条大正则包办。曾经的写法是
	// `/(?:^|[^\w])(?:return\s+|=\s*)(?!.*\b(?:placeholder|label)\b\s*:)\s*["'`][^"'`]{0,12}…/`
	// ——它同时踩了三个坑：`[^"'`]{0,12}` 嵌在 `.*` 里是**指数级回溯**的形状
	// （门禁要扫 131 个文件，一个坏形状就够卡住整轮），负向前瞻里的 `\b…\s*:`
	// 在 `placeholder:` 前面恒成立（无意义断言），`[^\w]` 也不是该用的写法。
	// 改成下面的**线性**三步：定位赋值 → 看右值里有没有延后词 → 排除提示类字段。
	// 每步都是单向扫描，没有可回溯的嵌套量词。
	['deferred: 实现被写成「留空/待接」', isDeferredAssignment],
	['stub keyword', /\bstub\b/i],
]

const DEFERRED_WORDS = ['暂不可用', '暂留空', '留待', '待接', '接回', '留空']

/** 这些字段名后面跟的值是**给用户看的说明**，写「留空」是本职，不是延后标记 */
const PROMPT_FIELDS = ['placeholder', 'label', 'title', 'description', 'hint', 'tip']

/**
 * 判据：这一行是不是「把某处实现写成了『留空 / 待接』」。
 *
 * 三步都是线性扫描，没有可回溯的嵌套量词：
 *   1. 找延后词出现在行的哪个位置；
 *   2. 从那个位置**往回**看它属于哪个键——即「延后词所在的那个字符串字面量」
 *      的字段名。往回看而不是从行首找赋值号，是因为
 *      `const x = { placeholder: '留空表示未更新' }` 的赋值号在 `x` 上，
 *      而要排除的是 `placeholder`：**判据的对象是那个字符串字面量，不是整行**。
 *   3. 键名是提示类字段就放行（提示语里的「留空」恰恰是它在告诉用户
 *      「这项可以不填」）；否则报。
 *
 * ⚠️ 曾经的写法是从行首找赋值号再取左侧键名，于是 `{ placeholder: … }` 里的
 *  `placeholder` 在**右**边、永远取不到，提示语照样被报——实测过一次。
 */
function isDeferredAssignment(line) {
	for (const w of DEFERRED_WORDS) {
		let from = 0
		for (;;) {
			const at = line.indexOf(w, from)
			if (at < 0)
				break
			// 往回找最近的 `键:` 或 `键 =`，取键名。`[^:]*$` 已吞掉中间所有非冒号字符
			// （含空白），所以 `\s*` 是多余的——留着还会触发 super-linear-backtracking 告警。
			// 另注意**不能**写成 `/([\w$]+)[\s\S]*$/`：`[\s\S]*` 与前面的 `[\w$]+`
			// 能匹配同一段文本，是指数回溯的形状，而本判据要扫 131 个文件的每一行。
			const before = line.slice(0, at)
			const key = /(?:^|[^\w$.])([\w$]+)\s*(?::|=)[^:]*$/.exec(before)?.[1] ?? ''
			if (!PROMPT_FIELDS.includes(key))
				return true
			from = at + w.length
		}
	}
	return false
}

/**
 * 前置过滤：整行是注释（`//` 开头、`*` 开头、`/*` 开头）就跳过。
 *
 * 原件是 `^\s*(//|\*|/\*|\*)`——四个分支里 `\*` 写了两遍，重复分支不改变匹配集合。
 * 合并成 `//` 或单个 `/`、`*`，命中集合与原件逐字符等价。
 */
const COMMENT_LINE = /^\s*(?:\/\/|[/*])/

/** 递归列出 dir 下所有文件；排序只为让报告逐次可复现，不影响判据。 */

/** 切行按 .NET `File.ReadAllLines` 的语义：`\r\n` / `\r` / `\n` 都算断行。 */
function readLines(file) {
	return readFileSync(file, 'utf8').split(/\r\n|\r|\n/)
}

// `Get-ChildItem -Recurse -File -Include *.astro,*.ts` 的等价物。
// PowerShell 的 `-Include` 在 Windows 上大小写不敏感，这里用 `/i` 保持一致。
// （原脚本没有 `-Force`，会跳过「隐藏属性」文件；Windows 上 src/ 里没有这类文件，
//   实测 `ls -a src` 无隐藏项，所以不模拟这一条。）
//
// 大小写不敏感是**必须留在谓词里**的：共享遍历器的 `ext` 虽然也大小写不敏感，
// 但这里刻意不换成 `ext`，因为 `.astro` / `.ts` 之外还要保留原脚本的写法证据
// （`-Include` 与 `-Filter` 的语义差别不在扩展名上，而在它匹配路径而非文件名）。
// `sort: true` 是原脚本就有的：注释写着「排序只为让报告逐次可复现」。
const files = walkFiles(SRC, { sort: true }).filter(p => /\.(?:astro|ts)$/i.test(p))

const rows = PATTERNS.map(([kind, re]) => {
	const hits = []
	// 判据既可以是正则，也可以是函数（`isDeferredAssignment` 那种需要看上下文、
	// 又不能写成带回溯风险大正则的判断）。`null` 不再出现——那条提示字段的
	// 判据已经折进函数内部。
	const match = typeof re === 'function' ? re : t => re.test(t)
	for (const file of files) {
		const lines = readLines(file)
		for (let i = 0; i < lines.length; i++) {
			const t = lines[i]
			if (COMMENT_LINE.test(t))
				continue
			if (match(t))
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
