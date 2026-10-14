import fs from 'node:fs'
import path from 'node:path'
/**
 * 门禁：正文渲染层（Prose*）确实落进了产物。
 *
 * ## 这条门禁在防什么
 *
 * `ProsePre` / `ProseA` / `ProseP` / `ProseTable` 是正文排版的主体。任何一层
 * 只搬进来一半——有标记没样式，或有样式没标记——**构建照样全绿**，因为其它门禁
 * 只断言文字还在，看不见盒子。
 *
 * 附带守一条 shiki 的坑：Astro 只输出 CSS 变量、不内联 `color:`，
 * 少了这层映射每个 token 都会静默继承正文色，代码高亮等于没有。
 *
 * ## 为什么不读 Nuxt 基线了
 *
 * 原版（`check-dead-css.ps1`）有三节：死 class 普查、正文层锚点、
 * 「代码块计数与 Nuxt 基线逐页相等」。第一节与第三节都建立在
 * `baseline/nuxt/` 上，而基线无法再冻结（Nuxt 源码树已删）、迁移也早已完成。
 * 第一节的职责由 `audit-dead-scope.mjs` 承担（它对 src 下的 astro 作用域规则
 * 逐条复算，棘轮锁在 3 条已知），第三节是纯 Nuxt 对比，已退役。
 * 留在原文件里、并且现在仍然有价值的就是本文件这两节。
 *
 * ## 本门禁合并了什么
 *
 * - `check-anchor-classes.mjs`（已删）的判据 1（正文 `<article>` 必须带 `article`
 *   锚点 class + 棘轮）并入本文件第 3 节。它守的缺陷是 `article.css` 整份脱靶、
 *   而其它门禁全绿——判据有效，但它扫的是同一份 `dist/`，单开一道门禁不值得。
 *   它的判据 2/3 **未迁入**：实测两条都不可证伪（见第 3 节注释）。
 */
import process from 'node:process'
import { DIST } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

function walkHtml(dir) {
	return walkFiles(dir, { ext: '.html' })
}

const SAMPLE = path.join(DIST, '2025', '10', 'misskey-fediverse-deploy', 'index.html')
const cssDir = path.join(DIST, '_astro')
let css = ''
if (fs.existsSync(cssDir)) {
	for (const f of fs.readdirSync(cssDir)) {
		if (f.endsWith('.css'))
			css += `${fs.readFileSync(path.join(cssDir, f), 'utf8')}\n`
	}
}
for (const p of walkHtml(DIST)) {
	for (const m of fs.readFileSync(p, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += `${m[1]}\n`
}

let fail = 0
const ok = msg => console.log(`  OK    ${msg}`)
function miss(msg) {
	console.log(`  MISS  ${msg}`)
	fail++
}

console.log('--- 1. Prose* 层的标记与样式两侧都在 ---')
if (!fs.existsSync(SAMPLE)) {
	miss('样例文章没构建出来')
}
else {
	const html = fs.readFileSync(SAMPLE, 'utf8')
	for (const [needle, label] of [
		['<figure class="z-codeblock"', 'ProsePre 包裹层'],
		['class="operations"', 'ProsePre 的复制 / 换行按钮'],
		['class="prose-paragraph"', 'ProseP 段落 class'],
		['class="z-link"', 'ProseA 链接 class'],
	]) {
		if (html.includes(needle))
			ok(label)
		else miss(`${label}  (${needle})`)
	}
	for (const [sel, label] of [
		// ⚠️ 必须带词边界，且排除前缀更长的同族 class：`.z-link` 若按裸子串找，
		// `.z-link-tip`（外链提示图标的 class）会把它顶替成假绿——判据 2 的旧写法
		// 就是这么长期测不到东西的。`.z-codeblock` / `.md-table` 无同族前缀，仍直接找。
		[/\.z-codeblock(?![\w-])/, '.z-codeblock'],
		[/\.prose-paragraph(?![\w-])/, '.prose-paragraph'],
		[/\.z-link(?![\w-])/, '.z-link'],
		[/\.md-table(?![\w-])/, '.md-table'],
	]) {
		if (sel.test(css))
			ok(`样式 ${label.slice(1)}`)
		else miss(`样式 ${label.slice(1)}`)
	}
	if (/color:\s*var\(--shiki-light\)/.test(css))
		ok('shiki 亮色模式颜色映射')
	else miss('shiki 亮色模式颜色映射（代码块不会高亮）')
}

console.log('--- 2. ProseA 的域名图标确实渲染了 ---')
// 样例页可能一条外链都没有，所以扫全站而不是只看一个文件
let icons = 0
for (const p of walkHtml(DIST)) {
	const h = fs.readFileSync(p, 'utf8').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
	icons += (h.match(/domain-icon/g) || []).length
}
if (icons > 0)
	ok(`全站 ${icons} 处域名图标`)
else miss('全站找不到任何 ProseA 域名图标')

// ---- 3. 正文锚点 class ----
//
// 原 `check-anchor-classes.mjs` 的判据 1 并入本节（该门禁已删）。它守的缺陷是
// 页面模板输出 `<article class="md-story">` 而丢掉静态 `article` 锚点 ⇒
// `src/styles/article.css` 整份样式表在每个文章页上匹配不到任何东西，正文裸奔、
// 图片撑破栏宽。当时所有结构门禁都是绿的：它们只断言文字/标题/链接/日期还在。
//
// ⚠️ 原门禁的判据 2（`.article` 规则在 CSS 里）与判据 3（`max-width:100%` 存在）
// **已删除，不迁入**：实测这两条是可证伪的反面。产物 CSS 里 `.article` 的匹配
// 来自 `.article-card`(7) / `.article-item`(2) / `.article-info` / `.article-description`，
// 而 `article.css` 早已被打进共享 bundle、不再是独立文件；`max-width:100%` 的命中
// 则来自 `fit-content`、`min-width:140px` 等无关规则。两条报红的机会与真实缺陷无关，
// 留着只会给出虚假安全感（CLAUDE.md 坑位 13：一个从不报错的门禁比没有门禁更糟）。
console.log('--- 3. 正文 <article> 带 article 锚点 class ---')
//
// ⚠️ 一页里可能有多个 `<article>`：首页 / /preview 的**卡片**就是
// `<article class="article-card">`（带 class 但不是正文锚点），正文容器是另一个。
// 因此必须遍历全部 `<article>` 并逐个判定，不能只取第一个——
// 只取第一个时，首页第一个命中的是卡片，整页被误判成「没有锚点」。
//
// 判定口径与原 check-anchor-classes 一致：**没有 class 的 `<article>` 不参与**
// （卡片容器天然无 class），带 class 的必须含 `article` 这个词。
let anchored = 0
let classless = 0
const missingAnchor = []
for (const p of walkHtml(DIST)) {
	const h = fs.readFileSync(p, 'utf8')
	const rel = path.relative(DIST, p).split(path.sep).join('/')
	// 棘轮按**页**计（与原 check-anchor-classes 同口径），不是按 <article> 元素数：
	// 首页有几十张卡片，按元素计会让棘轮永远满足、起不到「锚点整体脱落」的告警作用。
	let pageHasClass = false
	for (const m of h.matchAll(/<article\b([^>]*)>/g)) {
		const attrs = m[1]
		if (!attrs || !/\sclass\s*=/.test(attrs)) {
			classless++
			continue
		}
		pageHasClass = true
		// 在 class 属性的**引号内**按整词判定。不能用 /class=["'][^"']*\barticle\b/ 这种
		// 形态：`article-card` / `article-item` 的 \b 在 `-` 处也成立，会把它们顶替成假绿。
		// 也不能在 `[^"']*` 之后接 `(?:^|\s)`——那个 `^` 锚的是整条正则的起点，
		// 于是 `class="article md-tech"` 反而匹配不上（实测 63 页全报假红）。
		const cls = /class\s*=\s*["']([^"']*)["']/.exec(attrs)?.[1] ?? ''
		if (!cls.split(/\s+/).includes('article'))
			missingAnchor.push(`${rel}  [${attrs.trim()}]`)
	}
	if (pageHasClass)
		anchored++
}
if (!anchored) {
	miss('没有任何页面的 <article> 带 class —— 判据在空样本上成立，等于没测')
}
else if (missingAnchor.length) {
	miss(`${missingAnchor.length}/${anchored} 个正文页的 <article> 没有 article 锚点 class`)
	for (const s of missingAnchor.slice(0, 5))
		console.log(`        ${s}`)
	if (missingAnchor.length > 5)
		console.log(`        …还有 ${missingAnchor.length - 5} 页`)
}
else {
	ok(`${anchored} 个正文页的 <article> 都带 article 锚点`)
	// classless 是「无 class 的 <article>」的数量（卡片容器一类）。打出来是为了让
	// 「参与判据的元素数」与「被跳过的元素数」都可见——否则有人改模板把 class
	// 整个删掉时，看到的仍是一句漂亮的「N 页全过」，而 N 其实悄悄少了。
	if (classless)
		ok(`另有 ${classless} 个无 class 的 <article>（卡片容器）不参与本判据`)
}
// 棘轮：锚点整体脱落（模板把 class 属性整个删掉）时上面那条会静默退化成「0 页参与检查」，
// 与 check-dates 那族 skip 陷阱同形——一道什么都没测的门禁不能算通过。
if (anchored < 60) {
	miss(`带锚点的正文页只剩 ${anchored} 个（棘轮 60）——锚点可能整体脱落了`)
}
else {
	ok(`带锚点的正文页 ${anchored} 个 ≥ 棘轮 60`)
}

console.log('')
if (fail === 0) {
	console.log('RESULT: PASS - prose layer complete')
	process.exit(0)
}
console.log(`RESULT: FAIL - ${fail} problem(s)`)
process.exit(1)
