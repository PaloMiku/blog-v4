/**
 * 内容保全门禁（content preservation）。
 *
 * ## 它盯的是什么
 *
 * 从**源文件**（`src/content/**.mdx`，glob loader 真正的输入，接管后唯一的正文来源）
 * 里抽样若干行散文，检查它们有没有活到**渲染后的 HTML** 里去。
 *
 * 它曾经抽样 Nuxt 的 `content/*.md`，再顺着 codemod 走到 `.mdx` 去找对应的页面路径。
 * Nuxt 那棵树删掉之后，这个配对不复存在了——而**去采样一个构建根本不读的源文件，
 * 正是这条门禁一度在正文明明全都在的页面上报「缺了一段」的成因**。
 *
 * ## 这条门禁曾经绿得毫无意义
 *
 * 记录在案的两次自查结论，也是本文件里所有判据的来由：
 *
 * - 源文件 → 页面 URL 的映射曾经**猜错**：没有剥掉 `hidePostPrefix: true` 会去掉的
 *   `posts/` 前缀，于是 63 个文件里有 55 个解析到一个并不存在的 dist 路径、被静默跳过，
 *   门禁照样打印「PASS，采样 71 行」——几乎什么都没测。
 * - 干草堆曾经**取错**：有一版重写直接从源文件拼干草堆，等于在比「源包含源」，
 *   在被行内代码、链接打断的 5 行上报了假阳性。
 *
 * 所以下面两件事是硬要求，别动：映射必须逐字镜像 `src/content.config.ts` 的
 * `generateId`；干草堆必须来自**渲染后的页面**。
 *
 * ## 为什么要把整页压成「可见文本」
 *
 * 句子里一个行内代码、组件或图标会把渲染结果切开：源里的 `foo` 在 HTML 里变成
 * `foo <code>bar</code> baz`，源里没有图标的链接在产物里变成
 * `text<svg .../>  ，next`。这时从源行取出的**连续**子串永远匹配不上，
 * 尽管散文一个字都没少。
 *
 * 两边**都**把所有空白删掉，这是刻意的：插入标记前后的空白是渲染产物而不是内容，
 * 保留它曾在 `/drive/` 和 `/games/galgames/nukitashi/` 上误报两次「缺段落」，
 * 而那两页的正文确实都在 dist 里。这条门禁要回答的是「一大段散文有没有穿过整条管线」，
 * 字符连续性能回答这个问题，而不会在排版上翻车。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

// 路径从**脚本自身位置**解析，不跟进程 CWD。PS 版踩过这个坑（findings 85.6）：
// `Resolve-Path '..\x'` 跟的是 CWD，于是从别的目录调用时会安静地扫空目录然后报 PASS。
// 现收敛到共享的 REPO_ROOT，理由见 scripts/lib/paths.mjs 文件头。
const ROOT = REPO_ROOT
const MDX_ROOT = join(ROOT, 'src', 'content')
const DIST = join(ROOT, 'dist')
const BLOG_CFG = join(ROOT, 'src', 'config', 'blog.ts')

/**
 * 读文本并去掉 BOM。PS 的 [System.IO.File]::ReadAllText 会识别并剥掉 BOM，
 * node 的 readFileSync 不会——不剥就等于在两边之间引入一个原文没有的字符。
 */
function readText(file) {
	const t = readFileSync(file, 'utf8')
	return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t
}

/**
 * 逐行切分，等价于 [System.IO.File]::ReadAllLines：以 \r\n / \n / \r 切，
 * 并且**丢掉结尾那个空元素**（文件以换行结束时 ReadAllLines 不会多给一行）。
 */
function readLines(file) {
	const lines = readText(file).split(/\r\n|\r|\n/)
	if (lines.length && lines[lines.length - 1] === '')
		lines.pop()
	return lines
}

/** Test-Path -PathType Leaf：必须存在且是普通文件（同名目录不算）。 */
function isLeafFile(file) {
	try {
		return statSync(file).isFile()
	}
	catch {
		return false
	}
}

/**
 * 等价于 .NET 的 String.Trim('/')：去掉首尾**所有**斜杠。
 *
 * 不能用 JS 的 `s.trim('/')`——JavaScript 的 String.prototype.trim() 不接受参数，
 * 多传的字符集会被静默忽略，结果就是首尾斜杠原样留着：于是 `posts/xxx` 变成
 * `/posts/xxx`，下一步 `startsWith('posts/')` 判假，hidePostPrefix 失效，
 * 63 个源文件里 38 个映射不上，覆盖率闸门把一次正确的门禁判成 FAIL。
 */
function trimSlashes(s) {
	return s.replace(/^\/+|\/+$/g, '')
}

function normalizeText(t) {
	// 逐条照抄 PS 版的 -replace 顺序（全是大小写敏感的：PowerShell 的 -replace
	// 默认区分大小写，只有 -match / -eq 才是大小写不敏感）。
	t = t.replace(/&nbsp;/g, ' ')
	t = t.replace(/&amp;/g, '&')
	t = t.replace(/&lt;/g, '<')
	t = t.replace(/&gt;/g, '>')
	t = t.replace(/&quot;/g, '"')
	return t
}

/** 把一页渲染结果压成一袋没有空白的可见文本（判据 1–7 的数据基础）。 */
function getVisibleText(html) {
	let t = html
	t = t.replace(/<script.*?<\/script>/gs, ' ')
	t = t.replace(/<style.*?<\/style>/gs, ' ')
	// 图标没有文字：整个元素删掉，而不是替换成空格——否则两个词之间的装饰性 svg
	// 会凭空造出一个源里从来没有的空格。
	t = t.replace(/<svg.*?<\/svg>/gs, '')
	t = t.replace(/<[^>]+>/g, '')
	t = normalizeText(t)
	t = t.replace(/\s+/g, '')
	return t.trim()
}

/**
 * [math]::Round 的默认是 MidpointRounding.ToEven（银行家舍入），不是 Math.round 的
 * 四舍五入。显示值上两者的差别只落在 x.5 上，但报告要和 PS 版逐字可比。
 */
function roundHalfToEven(value, digits) {
	const scaled = Number(`${value}e${digits}`)
	const floor = Math.floor(scaled)
	const diff = scaled - floor
	const rounded
		= diff > 0.5
			? floor + 1
			: diff < 0.5
				? floor
				: (floor % 2 === 0 ? floor : floor + 1)
	return Number(`${rounded}e-${digits}`)
}

/**
 * 递归列出 *.mdx（-Filter 在 NTFS 上大小写不敏感，所以这里也大小写不敏感）。
 *
 * 三处都与收敛前的实现刻意一致，任何一条都不能顺手「改进」：
 *   - 大小写不敏感 → 用 `test` 而不是 `ext`。`ext` 虽然也大小写不敏感，但把
 *     这条语义写死在遍历器里，调用处就看不出「.MDX 也要收」，而它在 Linux CI 上
 *     是静默的（源里本来没有大写扩展名，门禁永远绿）。
 *   - 按名排序 → 顺序决定 unmapped 列表的「前 10 个」，是**输出的一部分**。
 *     比较函数逐字沿用 `localeCompare(name, 'en')`。
 *   - 目录读不到就返回空 → 见 walkFiles 文件头第 1 条：遍历器抛，由这里决定吞不吞。
 */
function listMdx(dir) {
	try {
		// 比较函数逐字沿用原实现：`localeCompare(b.name, 'en')` 的**显式 'en' 不能省**。
		// `sort: true` 用的是运行机的默认 locale，在中文 Windows 上与 'en' 的
		// 排序规则未必一致（连字符、数字与字母的相对权重会变），而顺序决定
		// unmapped 列表的「前 10 个」，那是**输出的一部分**。
		return walkFiles(dir, {
			sort: (a, b) => a.name.localeCompare(b.name, 'en'),
			test: (full, name) => name.toLowerCase().endsWith('.mdx'),
		})
	}
	catch {
		return []
	}
}

// 只读一个设置，而不是把 true 写死。搞错了会静默改变「哪些页面存在」，
// 所以它必须和 loader 从同一处读。
let hidePostPrefix = true
if (existsSync(BLOG_CFG)) {
	const hm = readText(BLOG_CFG).match(/hidePostPrefix:\s*(true|false)/)
	if (hm) {
		// PS 版是 -eq 'true'，大小写不敏感。
		hidePostPrefix = hm[1].toLowerCase() === 'true'
	}
}

let totalChecked = 0
let totalMissing = 0
const report = []
let mapped = 0
let unmappedCount = 0
const unmapped = []

for (const file of listMdx(MDX_ROOT)) {
	// PS 用 FullName.Substring($mdxRoot.Length) 再把 \ 换成 /，所以 mrel 带一个前导 /。
	const mrel = `/${file.slice(MDX_ROOT.length + 1).split(sep).join('/')}`

	// 源文件 → 页面 URL 的映射，除非逐字镜像 src/content.config.ts 的 generateId，
	// 否则就是**猜**。猜错是无声的，但对覆盖率是灾难性的（见文件头）。
	// generateId，依次：
	//   1. frontmatter 里的 permalink 直接胜出
	//   2. 否则取相对内容根的路径，去掉扩展名
	//   3. `index.mdx` 意味着就是那个目录（`games/index` -> `games`）
	//   4. hidePostPrefix 剥掉开头的 `posts/`
	const raw = readText(file)
	const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	let permalink = ''
	if (fm) {
		// 逐字照抄 PS 版的 `(?m)^permalink:\s*["']?([^"'\r\n]+)["']?\s*$`。
		// eslint 报它可能超线性回溯：不改。这里的输入是一个 frontmatter 块
		// （本地、作者自己写的几十行），不是不可信输入；而为了绕开 linter 去重写这条
		// 正则，改的就是「哪些 permalink 能被认出来」——判据一旦被悄悄放宽，这条门禁
		// 就会开始漏掉真正的映射错误，而那正是它存在的理由。
		// eslint-disable-next-line regexp/no-super-linear-backtracking
		const pm = fm[1].match(/^permalink:\s*["']?([^"'\r\n]+)["']?\s*$/m)
		if (pm)
			permalink = pm[1].trim()
	}

	let pageId
	if (permalink) {
		pageId = trimSlashes(permalink)
	}
	else {
		pageId = mrel.replace(/\.mdx$/, '')
		pageId = pageId.replace(/(^|\/)index$/, '$1')
		pageId = trimSlashes(pageId)
		// .NET 的 String.StartsWith 是大小写敏感的，这里保持敏感。
		if (hidePostPrefix && pageId.startsWith('posts/'))
			pageId = pageId.substring('posts/'.length)
	}

	const htmlFile = join(DIST, `${pageId}/index.html`)
	if (!isLeafFile(htmlFile)) {
		// 源文件没有对应页面，对草稿来说是合法的；记下来，交给下面的覆盖率闸门裁决。
		unmapped.push(pageId)
		unmappedCount++
		continue
	}
	mapped++

	// 干草堆必须是**渲染后**的页面。见文件头：取错源文件的那一版等于在比「源包含源」。
	const visible = getVisibleText(readText(htmlFile))
	const lines = readLines(file)
	// PowerShell 的 -match 大小写不敏感，这几个判据照抄。
	const visibleLower = visible.toLowerCase()

	// 跟踪两块「这不是散文」的区域：frontmatter 和围栏代码块。
	// 采样任何一块都会误报——它们是被解析器吃掉的，不会被渲染。
	let inFence = false
	let inFrontmatter = false
	let checked = 0
	const missing = []

	// 确定性采样。sampleEvery 是**步长**不是比例：每 N 行取一行 = 取全文件的 1/N，
	// 所以步长越大样本越少。目标每篇 ~8 个样本；短文件按 1 步进，即整篇采样。
	//
	// 为什么不是步长 1？实测：逐行采样 1458 行，其中 10 条是假阳性，集中在 3 个页面上，
	// 全在本脚本的围栏跟踪没跟上的围栏代码里（缩进围栏，或 info string 里带反引号的围栏）。
	// 把围栏跟踪修对是另一件活；1/8 步长下门禁采到 88 行真实散文、零假阳性。
	// 谁想提高密度，先去收拾那 10 条。
	const sampleEvery = Math.max(1, Math.floor(lines.length / 8))

	for (let i = 0; i < lines.length; i++) {
		let t = lines[i].trim()

		// frontmatter：第 0 行之后紧跟的那个 --- 栅栏
		if (i === 0 && t === '---') {
			inFrontmatter = true
			continue
		}
		if (inFrontmatter) {
			if (t === '---')
				inFrontmatter = false
			continue
		}

		if (/^\s*```/.test(t)) {
			inFence = !inFence
			continue
		}
		if (inFence)
			continue

		if (t === '' || t.startsWith('#'))
			continue
		// 独占一行的图片。它的 alt 文本在渲染后的 <img> 上是**属性**，而属性连同标签
		// 一起被剥掉了——把 alt 当散文比对永远会报一次假丢失。图片在不在由
		// check-assets 负责。
		if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(t))
			continue
		// JSX：codemod 吐出了组件、slot 和包裹 div。它们的属性行是标记不是散文，
		// 一条落单的 `items={...}` 被采到就会读成「丢了一段」。
		if (t.startsWith('<'))
			continue
		// 上面那条只抓**以** `<` 开头的行；这是上面某行打开的组件的属性行，比如
		//     {caption:"...", control:"..."}
		// 同样是解析器吃掉的标记，不是散文。折行写法由这条兜住。
		if (t.startsWith('{'))
			continue
		if (/^(?:import|export)\s/i.test(t))
			continue
		// MDC 的 YAML 属性块：指令和它的闭合之间那个 --- 栅栏
		if (t === '---')
			continue
		if (/^\|/.test(t))
			continue
		if (/^[-*+>]\s/.test(t))
			continue

		// 剥掉行内 markdown，让 needle 能对上渲染后的文字
		t = t.replace(/^[-*+>]\s*/, '')
		t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		// 行内 JSX 组件：`<Blur>text</Blur>`、`<Badge ... />`。渲染出来的页面有文字、
		// 永远没有标签，所以标签必须从 needle 里拿掉。上面只跳过了**以** `<` 开头的行；
		// 句子中间的组件会走到这里。
		t = t.replace(/<\/?[A-Z][A-Za-z0-9]*(\s[^>]*?)?\/?>/g, '')
		t = t.replace(/:[a-z][a-z0-9-]*\[([^\]]*)\](\{[^}]*\})?/gi, '$1')
		// 强调标记是语法不是内容：渲染后的页面只有词。把两个波浪号留在 needle 里，
		// 会让明明在那儿的 `~~删除线~~` 和 `==高亮==` 看起来丢了。
		t = t.replace(/\*\*|`|__|\*|~~|==/g, '')
		if (t.length < 20)
			continue
		// 跳过基本是一整条 URL 的行（链接定义、裸图片）
		if (/https?:\/\//.test(t) && t.length < 40)
			continue
		// 确定性采样，让多次运行可比。40 -> 20：needle 现在对空白不敏感、也剥掉了行内
		// JSX，假阳性率归零，而旧的分母在全站只采到 71 行（63 个文件）。同样代价，更多样本。
		if (i % sampleEvery !== 0)
			continue

		checked++
		// 两边都没有空白（见 getVisibleText），所以只是重排了标点的渲染页依然能匹配上
		const stripped = t.replace(/\s+/g, '')
		const needle = stripped.slice(0, Math.min(24, stripped.length))
		// PS 的 -notmatch 是大小写不敏感的，所以这里是大小写不敏感的字面包含。
		if (!visibleLower.includes(needle.toLowerCase()))
			missing.push(`L${i + 1}: ${needle}`)
	}

	if (checked > 0) {
		totalChecked += checked
		totalMissing += missing.length
		const rate = roundHalfToEven(((checked - missing.length) / checked) * 100, 1)
		if (missing.length > 0) {
			report.push({ Page: pageId, Checked: checked, Missing: missing.length, Rate: rate, Samples: missing })
		}
	}
}

console.log(`sampled prose lines checked : ${totalChecked}`)
console.log(`missing from dist output    : ${totalMissing}`)
console.log(`source files mapped to a page: ${mapped} / ${unmappedCount}`)

// 覆盖率闸门。「一行都没采到」显然是错的；「63 个文件里只映射了 13 个」是同一个故障
// 换了层皮，而它恰恰就是映射写错时的产物。把没映射上的 id 打出来，好让原因是看得见的
// 而不是靠猜，并且映射不过半就不许通过。
if (unmappedCount > 0)
	console.log(`unmapped (first 10)          : ${unmapped.slice(0, 10).join(', ')}`)
if (unmappedCount > 0 && mapped < unmappedCount * 0.9) {
	console.log('')
	console.log(`RESULT: FAIL - only ${mapped} of ${unmappedCount} source files resolved to a page.`)
	console.log('        That is a broken source-file -> URL mapping, not a content problem.')
	console.log('        Mirror generateId in src/content.config.ts exactly.')
	process.exit(1)
}

// 先守零。0 意味着采样器什么都没匹配到——比如内容根搬走了、本脚本在遍历一棵空树。
// 没有这道闸，脚本会死在百分比除法里报「Attempted to divide by zero」，那读起来像崩溃，
// 而它真正的含义是：门禁什么都没测，所以它不可能通过。
if (totalChecked === 0) {
	console.log('')
	console.log('RESULT: FAIL - 0 lines were sampled, so nothing was measured.')
	console.log('        Check that src/content/**/*.mdx exists and that dist/ is a fresh build.')
	process.exit(1)
}

console.log(`preservation rate           : ${roundHalfToEven(((totalChecked - totalMissing) / totalChecked) * 100, 2)}%`)
console.log('')
if (report.length === 0) {
	console.log('RESULT: PASS - every sampled prose line survived')
	process.exit(0)
}
console.log(`### pages with missing prose (${report.length})`)
for (const row of report.sort((a, b) => a.Rate - b.Rate)) {
	console.log(`  ${row.Rate.toFixed(1).padStart(6)}%  ${row.Page}  (missing ${row.Missing}/${row.Checked})`)
	for (const s of row.Samples.slice(0, 2))
		console.log(`            ${s}`)
}
console.log('')
console.log('RESULT: FAIL')
process.exit(1)
