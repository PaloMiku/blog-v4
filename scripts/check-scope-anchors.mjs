/**
 * 顶层 `:global()` 锚点门禁。
 *
 * ## 它盯的是什么
 *
 * Vue 的 `<style scoped>` 里，**顶层**的 `:deep(X)` 会被编译成
 * `[data-v-<hash>] X`——那个属性选择器不是装饰，它**要求祖先里有本组件的元素**。
 * 实测（线上产物 `_nuxt/link.ybPUspFo.css`）：
 *
 *     [data-v-ad1ec0bb] .feed-card.feed-card{width:auto;margin:0}
 *
 * 而 Astro 没有对应机制：`:global(X)` 就是**全站**的 X，锚点得自己写回去。
 * 漏掉一次的后果不是「样式没生效」，而是**样式在不该生效的地方生效了**——
 * 这类缺陷比死规则更难发现，因为它看起来是对的。
 *
 * 实测已中过一次（findings §76）：`/link` 上那张不在 FeedGroup 内的独立卡片
 * 本该保留 `margin: 1em auto`，却被这条规则顶成 `margin: 0`，整页少 8px。
 * 而 63 页页高扫描只给出一个「8」，样式对比又因为**只采样头部**
 * （缺陷元素排在尾部）而报 0 差异——前后查了好几轮才定位。
 *
 * ## 判据（2026-10-03 接管后重写）
 *
 * 原判据 1 是「逐个 `.vue` 抽顶层 `:deep(X)`，逐个 `.astro` 抽顶层裸 `:global(Y)`，
 * 同组件内主体相同即红」。它需要 Nuxt 源码树，而接管把那棵树删了——**这条判据的前提
 * 已经不存在**。留着它只会让门禁悄悄退化成「只打印不变式、新增裸 `:global()` 全绿」，
 * 那比没有门禁更糟。
 *
 * 定稿是两条，都只用 Astro 侧：
 *
 * 1. **棘轮**：src 里每一条顶层裸 `:global()` 都必须出现在 KNOWN 里。新增一条即红。
 *    这正是 §76 那条缺陷的守门方式：`.feed-group :global(.feed-card.feed-card)` 被改回
 *    裸 `:global(.feed-card.feed-card)` 时，主体重新出现在清单里而 KNOWN 里没有它 → 红。
 * 2. **可达性**：KNOWN 每条都要附一条**在 dist 上按 DOM 标记复算**的不变式
 *    「该主体只出现在渲染了本组件根标记的页面上」，门禁每次重算。
 *    哪天有人在组件外放了个 `#twikoo`，它自己会变红。这里刻意用 `id="twikoo"` 这种
 *    **DOM 标记**而不是 `#twikoo`：后者在每个页面的内联 `<style>` 里都有，普查它会得到
 *    「全站命中」，不变式就成了摆设。
 *
 * 另外仍然把清单打出来，让「新增了一条无锚点全局」没法悄悄溜过去。
 *
 * ## 门禁自己也要能被证伪
 *
 * §76 那条缺陷是**注入回去**验过本门禁会红的。第一版门禁对这条缺陷**报绿**
 * （抽取器有两个 bug），正是这次负控把它逮住的——没被看过变红的门禁等于没有门据。
 * 接管后判据换成了棘轮，负控要重做一遍：把 FeedGroup 那条改回裸 `:global(...)`，
 * 本门禁必须 exit 1 并指名道姓说是哪一条。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * 接管当天（2026-10-03）src 里已有的一批顶层裸 `:global()`，**逐条按完整选择器钉住**。
 *
 * ## 为什么是「钉住」而不是「删掉」
 *
 * 这 32 条都是迁移期间**有意**写的，每条旁边都有就地注释说明为什么加不了锚点：
 * slot 内容由 MDX 渲染、目录树是 `set:html` 注入的字符串、子组件（Icon / embla /
 * tippy）渲染的 DOM、`::view-transition-*` 的名字天然是全局的、`:hover` 作为祖先
 * 不能被作用域约束。它们**不是**疏忽。
 *
 * 但「作者写了注释」不等于「泄漏面被验证过」。给它们逐条补一个 dist 上的可达性
 * 不变式（像 KNOWN 那 3 条一样）是一项独立的复核工作，不该塞进一次接管里。
 *
 * ## 这里刻意不做的事
 *
 * 1. **不把它们写进 KNOWN。** KNOWN 的每一条都带一条每次重算的 DOM 不变式；
 *    把没复核的规则塞进去会让那 3 条有不变式的例外失去「例外是少数」这个前提。
 * 2. **不用计数棘轮。** 计数（像 `audit-dead-scope` 的 `$knownDeadScope`）挡不住
 *    「删掉一条旧的、同时加进一条新的」——总数不变，门禁全绿。钉字符串能挡住：
 *    改名会被抓到，删除也会（因为它必须被显式删掉才不算漏）。
 * 3. **不因为「主体看起来有锚点」就放过。** `:global(:hover) > .icon-line` 的
 *    `subjectOf()` 主体是 `:hover`，看上去完全没锚点；`:global(.toc ol)` 的主体是
 *    `.toc`，看上去有锚点。按主体判断会同时误报和漏报——所以这里按完整选择器比对。
 *
 * 复核任意一条之后：把它连同一个 `dom` / `root` 不变式移进上面的 `KNOWN`，
 * 并从这里删掉。清单因此会变短，**但必须是显式删**。
 */
const UNREVIEWED = [
	// Blog.astro —— 布局壳的锚点本身
	'Blog\t:global(#blog-root)',
	'Blog\t:global(#blog-sidebar), :global(#blog-aside)',
	'Blog\t:global(#blog-sidebar)',
	'Blog\t:global(#main-content)',
	'Blog\t:global(#blog-root > .blog-footer)',
	'BlogHeader\t:global(.blog-header)',
	'BlogSidebar\t:global(.sidebar-nav-item-parent .nav-icon), :global(.sidebar-nav-item > .nav-icon)',
	'BlogSidebar\t:global(.sidebar-nav-item-parent .nav-icon > .iconify), :global(.sidebar-nav-item > .nav-icon > .iconify)',
	'BlogSidebar\t:global(.sidebar-footer menu)',
	'BlogSidebar\t:global(.sidebar-footer menu a)',
	'BlogSidebar\t:global(.sidebar-footer menu a:hover)',
	'BlogSidebar\t:global(.sidebar-footer menu a .nav-icon)',
	'BlogSidebar\t:global(.sidebar-footer menu a .nav-icon .iconify)',
	// view-transition 伪元素：名字由文档全局解析，没有可挂 scope 的地方
	'BlogPanel\t:global(::view-transition-group(article-panel))',
	'BlogPanel\t:global(::view-transition-new(article-panel))',
	'BlogPanel\t:global(::view-transition-old(article-panel))',
	'Pagination\t:global(::view-transition-group(article-pagination)), :global(::view-transition-new(article-pagination))',
	'Pagination\t:global(::view-transition-old(article-pagination))',
	// slot / set:html 注入的内容拿不到本组件的 scope
	'Toc\t:global(.toc ol)',
	'Toc\t:global(.toc li)',
	'Quote\t:global(:hover) > .icon-line',
	'Tab\t:global(.search-input)',
	// 子组件 / 第三方库渲染的 DOM
	'OrderToggle\t:global(.icon) + .order-text',
	'Slide\t:global(.carousel-action)',
	'Tip\t:global(.tip .icon-done)',
	'PostHeader\t:global(.post-cover)',
	// Tip 的复制/完成图标：class 通过 <Icon class="tip-icon icon-copy" /> 传下去，
	// 落在 astro-icon 子组件自己的根上，主体确实拿不到本组件的锚点。
	// 2026-10-03 接管时补上的：此前这条写成 scoped `.tip-icon`，永不匹配，
	// 丢了 display:inline-block / font-size:1em / vertical-align:top。
	'Tip\t:global(.tip-icon)',
	'FeedCard\t:global([data-feed-card]) ~ :global([data-tippy-root]) > :global(.tippy-box)',
	'FeedCard\t:global([data-feed-card]) ~ :global([data-tippy-root]) > :global(.tippy-box[data-placement=\'top\']) > :global(.tippy-svg-arrow)',
	'Excerpt\t:global(.ai-gpt-icon)',
	'BlogTech\t:global(.tech-service) :global(img)',
	'CommGroup\t:global(.blog-widget) :global(.tip)',
	'CommGroup\t:global(.blog-widget) :global(.bg-img)',
]

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SITE_ROOT = join(HERE, '..')
const DIST = join(SITE_ROOT, 'dist')

/**
 * 已知例外。每条都要能被下面的不变式复算，否则删掉它。
 *
 * 为什么这几处不能简单把锚点加回去：Vue 的 `[data-v-x] X` 恰好比裸 `X` 多
 * **一个属性选择器**的权重，而 Astro 任何 scoped 前缀都会连带加上 `data-astro-cid`，
 * 补回去就是 `[data-v-x][cid] X`——比基线还重，同样不是 parity。
 * `:where()` 又会把锚点权重抹成 0，等于没补。所以保持裸 `:global()`，
 * 改为用「主体可达性」把泄漏面钉死。
 */
const KNOWN = [
	{
		component: 'Comment',
		subject: '#twikoo',
		dom: 'id="twikoo"',
		root: 'class="z-comment',
		reason: 'Twikoo 容器由本组件渲染；Vue 侧是 `[data-v-x] #twikoo`。理由见文件头。',
	},
	{
		component: 'Comment',
		subject: ':where(.tk-preview-container,.tk-content)',
		dom: 'class="tk-preview-container',
		root: 'class="z-comment',
		reason: '同上。Twikoo 客户端渲染的预览容器，dist 里 DOM 出现 0 次，不变式按 0 自动成立。',
	},
	{
		component: 'OrderToggle',
		subject: '.secret-container',
		dom: 'class="secret-container',
		root: 'class="order-toggle',
		reason: '`.secret-container` 由 Collection 组件渲染，永远在 `.order-toggle` 内。',
	},
]

function walk(dir, ext) {
	const out = []
	if (!existsSync(dir))
		return out
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		const s = statSync(p)
		if (s.isDirectory())
			out.push(...walk(p, ext))
		else if (p.endsWith(ext))
			out.push(p)
	}
	return out
}

/**
 * 抽 `<style>` 里处于花括号深度 0 的选择器。
 *
 * 两个坑，都是第一版踩过并被负控逮到的：
 *
 * 1. **不能用 `indexOf('<style')`**。frontmatter 的 JSDoc 里就会写
 *    「`<style>` 里的钩子」这种话，第一版因此从文件开头开始扫，
 *    把 frontmatter、模板、`<script>` 全当成 CSS——
 *    结果 FeedGroup 整份没被认出来，**注回去的缺陷它照样报绿**。
 *    现在按 `<style…>…</style>` 配对取内容。
 * 2. **注释必须整块剥，不能逐行剥**。逐行剥时，跨行的块注释（起止符分处两行）
 *    根本匹配不上，注释正文被当成选择器，花括号配平被带偏，后续规则一起废掉。
 *    同时不再剥 `//`——那是 JS 的注释规则，CSS 里没有，
 *    留着只会把 `https://` 之类从中间截断。
 *
 * 只认深度 0 是必须的：嵌套里的 `:global()` 天然被外层 scoped 选择器锚着，
 * 那是正确写法（陷阱 3 的正解），一起报出来就成了噪声。
 */
function topLevelSelectors(file) {
	const src = readFileSync(file, 'utf8')
	const out = []
	for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
		const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '')
		let depth = 0
		let buf = ''
		let at = 0
		for (const [i, line] of body.split(/\r?\n/).entries()) {
			if (depth === 0) {
				if (buf === '')
					at = i
				buf += `${line}\n`
				for (const ch of line) {
					if (ch === '{')
						depth++
					else if (ch === '}')
						depth--
				}
				if (depth === 0 && buf.includes('{')) {
					const sel = buf.slice(0, buf.indexOf('{')).trim()
					if (sel)
						out.push({ line: at, sel })
					buf = ''
				}
			}
			else {
				for (const ch of line) {
					if (ch === '{')
						depth++
					else if (ch === '}')
						depth--
				}
			}
		}
	}
	return out
}

/** 取 `open` 后第一个**配平**的括号内容；`open` 不在则返回 null。 */
function balanced(text, open) {
	const i = text.indexOf(open)
	if (i < 0)
		return null
	let d = 0
	for (let k = i + open.length - 1; k < text.length; k++) {
		if (text[k] === '(') {
			d++
		}
		else if (text[k] === ')') {
			d--
			if (d === 0)
				return { start: i, end: k, inner: text.slice(i + open.length, k) }
		}
	}
	return null
}

/**
 * 选择器的「主体」：第一个有意义的成分。
 * `:where(...)` 整体算一个——它内部含逗号和空格，按组合符切会切碎。
 */
function subjectOf(sel) {
	const w = balanced(sel, ':where(')
	if (w && w.start === 0)
		return `:where(${w.inner.replace(/\s+/g, '')})`
	const first = sel.split(/[\s>+~]+/).filter(Boolean)[0] ?? ''
	return first.replace(/:global\(/, '').replace(/\)$/, '').trim()
}

const norm = s => s.replace(/\s+/g, '').toLowerCase()
const baseName = (p, ext) => p.split(/[\\/]/).pop().replace(new RegExp(`\\${ext}$`), '')

/** '组件名\t选择器' 的归一化键；UNREVIEWED 的每一项也要过同一把尺子 */
const pinKey = (component, sel) => norm(`${component}\t${sel}`)
const pinnedKeys = new Set(UNREVIEWED.map(norm))

const astroGlobal = new Map()
for (const file of walk(join(SITE_ROOT, 'src'), '.astro')) {
	const rows = []
	for (const r of topLevelSelectors(file)) {
		const sel = r.sel.trim()
		if (!sel.startsWith(':global('))
			continue
		const b = balanced(sel, ':global(')
		if (!b)
			continue
		rows.push({ line: r.line, y: sel.replace(/\s+/g, ' '), inner: b.inner.trim(), subject: subjectOf(b.inner.trim()) })
	}
	if (rows.length)
		astroGlobal.set(baseName(file, '.astro'), rows)
}

const pages = []
for (const file of walk(DIST, '.html')) {
	pages.push({ name: file.slice(DIST.length + 1).replace(/\\/g, '/'), html: readFileSync(file, 'utf8') })
}
const pagesWith = token => pages.filter(p => p.html.includes(token)).map(p => p.name)

const problems = []

// 判据 1（钉住）：每一条顶层裸 `:global()` 都必须在 KNOWN（带可达性不变式）
// 或 UNREVIEWED（钉住但未复核）里。
//
// 没有 Nuxt 侧可比之后，这道门禁唯一还能拦住的缺陷形态是「有人新写了一条无锚点的
// 全局规则」——它会立刻红，并要求写清为什么不能加锚点。
for (const [component, rows] of [...astroGlobal].sort()) {
	for (const r of rows) {
		if (KNOWN.some(k => k.component === component && norm(k.subject) === norm(r.subject)))
			continue
		if (pinnedKeys.has(pinKey(component, r.y)))
			continue
		problems.push({
			component,
			detail: `${component}.astro 有一条顶层裸 ${r.y}，既不在 KNOWN 也不在 UNREVIEWED。`
				+ '顶层 :global() 没有 scope 锚点，规则会在组件外也生效。'
				+ '先问一句「这条是不是真的加不了锚点」：主体由子组件渲染 / slot 注入 / '
				+ '第三方库 DOM 才需要 :global()。确实需要，就按文件头的格式补进 UNREVIEWED'
				+ '（钉住待复核）或带 dom/root 不变式补进 KNOWN（已复核）；'
				+ '不需要，就给它加回锚点。',
		})
	}
}

console.log('=== KNOWN 的可达性不变式（按 DOM 标记复算，不是按选择器字面量）===')
for (const k of KNOWN) {
	const hits = pagesWith(k.dom)
	const outside = hits.filter(name => !pages.find(x => x.name === name).html.includes(k.root))
	const total = pages.reduce((s, p) => s + p.html.split(k.dom).length - 1, 0)
	console.log(`  ${k.component.padEnd(12)} ${k.dom.padEnd(30)} ${String(total).padStart(4)} 次 / ${String(hits.length).padStart(2)} 页，`
		+ `其中缺 ${k.root}… 的：${outside.length}`)
	if (outside.length) {
		problems.push({
			component: k.component,
			detail: `KNOWN 例外「${k.dom}」已不成立：它在 ${outside.length} 个不含 ${k.root}… 的页面上出现`
				+ `（${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ' …' : ''}）。`
				+ '要么改回带锚点的写法，要么删掉这条 KNOWN 并接受泄漏。',
		})
	}
}

/**
 * 从选择器主体推出一个**只在 DOM 里出现**的标记。
 *
 * ⚠️ 这里踩过两次：
 *   1. 留前导点（`.post-cover`）→ HTML 里只有 `class="post-cover"`，于是报 0 页，
 *      而该规则实际命中 50 页。
 *   2. 直接拿主体当 token（`.blog-widget`）→ 命中的是每页内联 `<style>` 里的
 *      **选择器文本**，不是元素，于是报 62 页，纯属误中。
 *   3. 前缀匹配 `class="x`（想着能覆盖 `class="x y"`）→ 元素上常是
 *      `class="image post-cover"`，`class` 属性里 x 不是第一个，同样漏。
 *   4. 修成 `class="[^"]*(?:^|[\s"])x(?:[\s"]|$)` → `[^"]*` 吃不到 `"`，
 *      于是永远没法落在 `class="` 的那个**开引号**上，`class="blog-widget shrink"`
 *      匹不上。第三版。
 *   5. 改用 `\b` 词边界 → 连字符不是单词字符，`class="nav-icon"`、
 *      `class="…one-dark-pro…"` 里的 `icon` / `dark` 全被误中。第四版。
 *
 * 定稿：**把 class 属性整个取出来、按空白切分、再判断成员**。
 * class 名里可以含 `-`，正则边界在这里没有意义。
 * id 走精确 `id="x"`。伪元素 / 属性选择器没有 DOM 标记，返回 null。
 */
function domToken(subject) {
	const w = balanced(subject, ':where(')
	const inner = w ? w.inner : subject
	const id = /#([\w-]+)/.exec(inner)
	if (id) {
		return { kind: 'id', value: id[1] }
	}
	const cls = /\.([\w-]+)/.exec(inner)
	if (cls) {
		return { kind: 'class', value: cls[1] }
	}
	return null
}

/** 名字必须作为**完整的一个 class**出现在某个 class 属性里 */
function pagesWithClass(name) {
	return pages.filter((p) => {
		for (const m of p.html.matchAll(/class="([^"]*)"/g)) {
			if (m[1].split(/\s+/).includes(name))
				return true
		}
		return false
	}).length
}

function countByDom(dom) {
	if (!dom)
		return null
	if (dom.kind === 'id')
		return pagesWith(`id="${dom.value}"`).length
	return pagesWithClass(dom.value)
}

console.log('\n=== 顶层裸 :global() 清单（新增一条就会出现在这里）===')
for (const [component, rows] of [...astroGlobal].sort()) {
	for (const r of rows) {
		const known = KNOWN.find(k => k.component === component && norm(k.subject) === norm(r.subject))
		const dom = known ? { kind: 'raw', value: known.dom } : domToken(r.subject)
		const n = known ? pagesWith(known.dom).length : countByDom(dom)
		const shown = n === null ? ' —（无 DOM 标记）' : `${String(n).padStart(2)} 页`
		console.log(`  ${known ? 'KNOWN' : '  --  '} ${(`${component}.astro`).padEnd(24)} L${String(r.line + 1).padStart(4)}  ${r.subject.padEnd(30)} 出现在 ${shown}`)
	}
}

if (problems.length) {
	console.log(`\nFAIL: ${problems.length} 处`)
	for (const p of problems) console.log(`\n  [${p.component}] ${p.detail}`)
	process.exit(1)
}
console.log(`\nOK: ${KNOWN.length} 条 KNOWN 不变式在 dist 上复算成立，src 里没有新的顶层裸 :global()。`)
