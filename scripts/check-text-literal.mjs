/**
 * 门禁：构建**不得凭空产生** smartypants 字符（`…` `—` `–` `“` `”` `‘` `’`）。
 *
 * ## 抓的是什么
 *
 * `remark-smartypants` 在 Astro 侧**默认开启**（`@astrojs/markdown-remark`
 * 判的是 `smartypants !== false`），它把
 *
 *   `...` → `…`      `"…"` → `“…”`      `--` → `–`      `---` → `—`
 *
 * Nuxt 侧没开，于是同一段文字两站**字面**不同。实测 64 页里 20 页受影响，
 * 最极端的 `/games/galgames/clannad`：`”` 111 个 vs 2 个、`…` 24 个 vs 2 个。
 * 典型句子：`安装"飞牛播放器"登录 NAS` 在线上是 `&quot;…&quot;`，本地被改成 `”…”`。
 *
 * **为什么页高与计算样式两道门禁都看不见**：换的是标点字符，不是盒子。
 * `…` 是单字符 advance，三个 `.` 换行宽度也接近，差值落在亚像素容差内。
 * 是语义签名探针在一页的 h4 文字上偶然撞见的（`Key社，我哭死...` vs `…`）。
 *
 * ## 判据：按字符**计数**，不是「出现过没有」
 *
 * 第一版判的是「dist 里每个 `…` 在源里都出现过」——**它红不了**。
 * 注入 `smartypants: true` 重建后仍然 exit 0：源 `.mdx` 里本来就有
 * `“ ” … ’ –`（clannad 正文里就写着 `切换“横向滚动”和“自动换行”`），
 * 于是每个字符都「有出处」，判据形同虚设。
 * **一个从不报错的门禁比没有门禁更糟**：它让人以为这条已被覆盖。
 *
 * 定稿判据是**逐字符计数不等式**：
 *
 *     dist 产物里的出现次数  ≤  源 markdown 里的出现次数
 *
 * 「≤」而不是「=」：构建也可能**减少**这些字符（标题被抽走、
 * frontmatter 与代码块里的字符不进入正文），减少是合法的。
 * 增加则一定是构建改写了字面——源里根本没有那么多这个字符，
 * 多出来的只能来自转换。
 *
 * ## 为什么不逐页比、只做全局求和
 *
 * 逐页比需要「源文件 → 路由」的映射，而路由来自 frontmatter 的 `permalink`
 * 与 `hidePostPrefix`，这份映射本身就是一个会漂移的东西。
 * 全局求和没有这个依赖，且判据强度对本次缺陷足够：
 * smartypants 是**全站**开关，打开必然让至少一个字符的总数上升。
 *
 * 代价是「某一页少、另一页多」互相抵消时看不见。实测排除了这种可能：
 * 打开 smartypants 后 `”` 从 29 涨到 111+、`…` 从 0 涨到 24+，
 * 没有任何字符下降，正负不可能抵消。
 *
 * ## 扫描范围
 *
 * - 源：`src/content` 递归下所有 `.mdx`（codemod 产物，glob loader 的真实输入）
 * - 产物：`dist` 递归下所有 `.html`，**只取 `<article>` 内**
 *
 * 只取 `<article>` 是必须的：`dist` 里的页头/页脚/侧栏文案写在
 * `.astro` 模板与 `app.config.ts` 里，压根不走 markdown 管线，
 * 它们的 `…`/`—` 在源 markdown 里没有出处，混进来会全部误报。
 *
 * ⚠️ **产物侧还必须把 `<pre>` / `<code>` 的整段内容排除掉**（§85.8）。
 * 代码块按构造就是**逐字**的：remark 把围栏与缩进代码解析成 `code` 节点，
 * smartypants 是文本转换器、不会碰节点值。所以「产物里的字符多于源」在代码块上
 * **永远不可能**是 smartypants 造成的，只能来自某个正当地把代码注进正文的插件。
 * 本项目**曾经**有一个：`plugins/component-fence.ts` 把 26 个组件源码（9 万余字符）
 * 注入 `/previews/example` 的「源码」页签，实测带来 `…` +15 / `—` +40。
 *
 * ⚠️ 那个页签已于 2026-10-04 移除（改成「现场效果 / 组件语法」两页签）。插件现在
 * 只注入围栏正文——**那就是作者自己写的那段 MDX，它的字符本来就在源文件里**——
 * 于是这个例外随之消失。2026-10-04 实测全站 68 页逐字符产物/源：
 * `…` 80/85、`—` 56/64、`–` 8/99、`“` 316/390、`”` 308/382、`’` 2/2，全部 ≤ 源。
 *
 * 之所以还要把这段写在这里：判据 `产物 ≤ 源` 成立的**前提**就是「不存在已查明的
 * 合法注入」。哪天重新注入任何源里没有的字，门禁会报红，而它报的「产物多于源」
 * 需要这样一份已查明名单才不会被当成误报——名单只能空着或指着真实成因，
 * 不能指着一个已经删掉的东西。
 *
 * 这与本文件已有的推理是同一件事的两面：判据写的是 `产物 ≤ 源`，
 * 而上面那段注释已经承认「frontmatter 与代码块里的字符不进入正文」——
 * 也就是说代码块字符在 src 与 dist 之间**两个方向**都可以合法不等，
 * 只是过去只考虑了「源多」这一半。
 *
 * ⚠️ 排除代码块**不会**削弱它对目标缺陷的检测力：把 `smartypants: true`
 * 注回去重建，门禁仍然 exit 1（实测，见 findings §85.8）。
 * 「排除了什么」和「还抓不抓得住」是两件事，后者必须单独验过。
 *
 * ⚠️ 路径里不能直接写 `**` 通配：块注释里出现 `*` 紧跟 `/` 会**提前结束注释**，
 * 于是后面整段被当成代码解析，报的却是 `src/content/...` 那一行的
 * `Unexpected token '*'`——离真正的病因（上面那行）差了两行。已用文字描述代替。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const SRC = new URL('../src/content/', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')
const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')

/** smartypants 会写入的目标字符 → 它的源形态（仅用于报错信息） */
const CONVERTED = { '…': '...', '—': '---', '–': '--', '“': '"', '”': '"', '‘': '\'', '’': '\'' }
const CHARS = Object.keys(CONVERTED)
const RX = new RegExp(`[${CHARS.join('')}]`, 'g')

function isDir(p) {
	try {
		return statSync(p).isDirectory()
	}
	catch {
		return false
	}
}

function walk(dir, test, out = []) {
	if (!isDir(dir))
		return out
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory())
			walk(full, test, out)
		else if (test(name))
			out.push(full)
	}
	return out
}

function tally(text) {
	const m = Object.fromEntries(CHARS.map(c => [c, 0]))
	for (const c of text.matchAll(RX)) m[c[0]]++
	return m
}

/**
 * 只取 `<article …>…</article>`，剥成纯文本。
 *
 * 顺序有讲究：先整段删掉 `<pre>` / `<code>`（含其文字内容），再剥标签。
 * 反过来做等于只删了标签、把代码正文留在文本里，那正是 §85.8 的假阳性。
 */
function articleText(html) {
	const open = html.indexOf('<article')
	if (open < 0)
		return null
	const close = html.indexOf('</article>', open)
	return html
		.slice(open, close < 0 ? undefined : close)
		.replace(/<script[\s\S]*?<\/script>/g, ' ')
		.replace(/<pre[\s\S]*?<\/pre>/g, ' ')
		.replace(/<code[\s\S]*?<\/code>/g, ' ')
		.replace(/<[^>]*>/g, ' ')
}

const srcFiles = walk(SRC, n => n.endsWith('.mdx'))
if (!srcFiles.length) {
	console.error('FAIL  src/content 下没有 .mdx，内容根在 src/content/，找不到 .mdx 说明构建输入被搬走了')
	process.exit(1)
}
const srcCount = Object.fromEntries(CHARS.map(c => [c, 0]))
for (const f of srcFiles) {
	const m = tally(readFileSync(f, 'utf8'))
	for (const c of CHARS) srcCount[c] += m[c]
}

const distFiles = walk(DIST, n => n.endsWith('.html'))
const distCount = Object.fromEntries(CHARS.map(c => [c, 0]))
let withArticle = 0
for (const f of distFiles) {
	const text = articleText(readFileSync(f, 'utf8'))
	if (text === null)
		continue
	withArticle++
	const m = tally(text)
	for (const c of CHARS) distCount[c] += m[c]
}

const over = CHARS.filter(c => distCount[c] > srcCount[c])

if (!over.length) {
	const brief = CHARS.filter(c => distCount[c] || srcCount[c]).map(c => `${c} ${distCount[c]}/${srcCount[c]}`).join('  ')
	console.log(`OK: 正文字面 —— ${distFiles.length} 个 HTML（${withArticle} 个有 <article>）未凭空产生 smartypants 字符。逐字符 产物/源：${brief || '（全为 0）'}`)
	process.exit(0)
}

/*
 * 报错只陈述**量到的事实**，不替原因下结论。
 *
 * 原来这里写死「（smartypants 会把 X 改成它）」，而 §85.8 实测到那次红灯时
 * `smartypants: false` 是显式配着的、产物里的 `“` 还**少于**源——
 * 也就是说那句话给出的因果是反的。照着它去查会先查错方向。
 * 两种可能都列出来，让人按数据分辨：
 *   (a) smartypants（或别的文本转换）真的开了 —— 判据是产物里成对引号也变多
 *   (b) 有插件把源 markdown 之外的内容注入了正文 —— 判据是超出量恰好等于被注入的量
 */
console.error('FAIL  产物正文里的 smartypants 类字符比源 markdown 还多 —— 有东西在改写或注入正文字面：')
for (const c of over)
	console.error(`        ${JSON.stringify(c)}  产物 ${distCount[c]} 个 / 源 ${srcCount[c]} 个，多出 ${distCount[c] - srcCount[c]} 个`)
console.error('\n  先分辨是哪一种，别照抄结论：')
console.error('    (a) 文本转换真的开了：看产物里 “ ” 是否也**成对**变多。')
console.error('        是的话查 astro.config.mjs 的 createProcessor() 是否仍是 `smartypants: false`')
console.error(`        （smartypants 会把 ${JSON.stringify(CONVERTED['…'])} → ${JSON.stringify('…')}、${JSON.stringify(CONVERTED['—'])} → ${JSON.stringify('—')}、直引号 → 弯引号）。`)
console.error('    (b) 有插件把 markdown 源之外的内容注入了正文（本项目有 component-fence.ts）：')
console.error('        拿超出量去对被注入文件的同名字符数，对得上就是它。')
console.error('    两者都不是的话，把 <article> 逐段 dump 出来定位到具体那一段，别在总数上猜。')
process.exit(1)
