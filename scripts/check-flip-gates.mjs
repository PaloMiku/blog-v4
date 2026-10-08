/**
 * 静态检查：ListTransition / Toggle / Slider 三个交互组件**真的被编译进产物并接上线**了。
 *
 * ═══ 这道门禁为什么存在 ═══
 * 这三个组件的共同点是：**缺席时页面照样正常渲染**。
 *
 * - `ListTransition` 只是两个 wrapper div，去掉它页面一模一样，
 *   只是排序时不再有 FLIP 动画。
 * - `Toggle` / `Slider` 是纯视觉 + 纯交互，去掉后静态产物仍然成立。
 *
 * 所以本项目现有的两道门禁都看不见它们：
 *   - `compare-page-heights` 比的是渲染高度——wrapper 不改变高度；
 *   - `compare-ui-parity` 比的是计算样式——动画不触发时样式一致。
 * 这正是「Astro 改写静默丢功能」能一路绿灯的原因。
 *
 * 更阴的一种：**源码里有、组件没被引用**。Astro 不会编译没人引用的组件，
 * 构建照样绿。这道门禁因此只认产物（`dist/`），不认源码——
 * 源码里写了什么不算数，产物里没有就是没有。
 *
 * ═══ 检查项 ═══
 *  1. `/` 与 `/archive` 的产物里都有 `list-transition` / `list-transition-content` 两层 wrapper
 *  2. 产物 CSS 里有 `z-toggle` / `input-toggle` / `z-slider` / `input-slider` 选择器
 *  3. 产物 JS 里真的吐出了 FLIP 客户端脚本（**不是**只在源码里存在）
 *  4. Nuxt 原版的三个行为钩子在产物 JS 里都还在：
 *     `data-changing` 写入者、`prefers-reduced-motion` 逃生口、`data-article-transition` 逃生口
 *
 * ═══ 「产物 CSS/JS」到底指哪一段 ═══
 * Astro 7 对够小的组件样式与脚本**直接内联进 HTML**，不落 `dist/_astro/*.css|js`：
 * 68 个页面里内联了 69 段 `<style>`（100 KB，外链 CSS 全部加起来才 80 KB）
 * 与 491 段可执行 `<script>`（676 KB）。
 * 只读外链 chunk 等于把一大半产物当成「不存在」——本门禁曾 14 条全红就是这么来的
 * （`--motion-duration`、`z-toggle` 明明就在 `dist/archive/index.html` 的内联块里）。
 * 所以判据的「产物 CSS/JS」= 外链 chunk **加**各页内联块，收法照
 * `check-icon-swap.mjs` 的 `scriptsOf()`：内联与外链同权，`src=` 的仍归外链那一路。
 *
 * 另一头要同时守住：页面的**标记**与**代码**必须分开数。内联脚本里满是
 * `list-transition-content` 这类选择器字面量，拿整段 HTML 找 wrapper 会把
 * 「wrapper 已经没了」判成「wrapper 还在」。故标记类判据一律过 `markupOf()`。
 *
 * ═══ 为什么钩子要查 JS 而不是查 CSS ═══
 * `data-changing` 在 CSS 里只有 `overflow: clip` 一条静态规则，
 * 写不写这个属性页面看不出来——只有 JS 里的赋值才是行为。
 * 少一条钩子的后果是「动画还在，但没有逃生口」：
 * 用户开了「减少动效」，或正处在整页文章过渡中，列表照样动。
 * 这类偏差在任何自动门禁下都是隐形的，所以单独列成三条硬性检查。
 *
 * ═══ 自检 ═══
 * 判据带 14 个用例，其中 1 例专门复现本项目最典型的失败模式
 * （markup 在、JS 丢——即「组件写了但没被引用」），
 * 另 3 例锁死本轮改动的两条边界：内联块与外链 chunk 同权（l/m）、
 * 内联脚本里的选择器字面量不算标记（n）。
 * 判据自己判错的时候，门禁就是在教人忽略红灯，所以自检不过直接 exit 1、不输出结论。
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { DIST } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

/** 需要检查的两个页面；键名即报告里的名字 */
const PAGES = {
	index: 'index.html',
	archive: join('archive', 'index.html'),
}

/**
 * 页面 HTML 里内联的 `<style>` / `<script>` 正文。
 *
 * `src=` 的那一路不算（那是外链 chunk，由 `collectArtifacts` 单独收）；
 * `type` 只收缺省与 JS MIME 两种，`application/ld+json` / `importmap` 是数据不是代码。
 */
function inlineOf(html) {
	const css = []
	const js = []
	for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
		if (m[1].trim())
			css.push(m[1])
	}
	for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
		if (/\bsrc\s*=/.test(m[1]))
			continue
		const type = /\btype\s*=\s*['"]?([^'"\s>]+)/i.exec(m[1])?.[1]?.toLowerCase()
		if (type && !/^(?:module|text\/javascript|application\/javascript)$/.test(type))
			continue
		if (m[2].trim())
			js.push(m[2])
	}
	return { css, js }
}

/**
 * 只留标记：抹掉 `<style>` / `<script>` 的正文，标签本身留着。
 * 数 wrapper、数控件时，内联脚本里的选择器字面量不是标记。
 */
function markupOf(html) {
	return html.replace(/(<(?:script|style)\b[^>]*>)([\s\S]*?)(<\/(?:script|style)>)/g, '$1$3')
}

/** 把产物收成一份「页面 HTML / 全部 CSS / 全部 JS」的快照，判据只认这个结构 */
function collectArtifacts(distDir) {
	const files = walkFiles(distDir)
	const read = f => readFileSync(f, 'utf8')
	const pages = {}
	for (const [name, rel] of Object.entries(PAGES)) {
		const full = join(distDir, rel)
		pages[name] = statSync(full, { throwIfNoEntry: false }) ? read(full) : null
	}
	// 外链之外的那一半：Astro 7 内联进各页的 <style> / <script>
	// （分字段留着，不揉进 css/js —— 来源要看得见，自检才喂得出「只有内联」这种快照）
	const inline = { css: [], js: [] }
	for (const file of files.filter(f => f.endsWith('.html'))) {
		const inl = inlineOf(read(file))
		inline.css.push(...inl.css)
		inline.js.push(...inl.js)
	}
	return {
		pages,
		css: files.filter(f => f.endsWith('.css')).map(read).join('\n'),
		js: files.filter(f => f.endsWith('.js')).map(read).join('\n'),
		inline,
	}
}

/**
 * 判据本体：输入一份产物快照，返回问题描述数组（空 = 全过）。
 *
 * 保持纯函数、不读盘、不打印，自检才能喂合成数据。
 */
function evaluate(art) {
	const problems = []
	// 「产物 CSS/JS」= 外链 chunk + 各页内联块，两路同权
	const css = [art.css, ...art.inline.css].join('\n')
	const js = [art.js, ...art.inline.js].join('\n')

	// 1. 两页都要有两层 wrapper
	//    判的是标记：FLIP 驱动脚本被内联进同一页，里面满是 list-transition-content 字面量，
	//    直接对整段 HTML 找会把「wrapper 没了」判成「wrapper 还在」
	for (const [name, html] of Object.entries(art.pages)) {
		if (html === null) {
			problems.push(`页面产物缺失：/${name === 'index' ? '' : name}`)
			continue
		}
		const markup = markupOf(html)
		if (!markup.includes('list-transition-content'))
			problems.push(`/${name === 'index' ? '' : name} 缺少 .list-transition-content wrapper（ListTransition.astro 没接上）`)
		if (!markup.includes('list-transition'))
			problems.push(`/${name === 'index' ? '' : name} 缺少 .list-transition wrapper（ListTransition.astro 没接上）`)
	}

	// 2. 两个控件的 CSS 必须在产物里
	//    样式门禁是按选择器与 Nuxt 基线比对的，改名等于整组失效，故按原名断言
	for (const sel of ['z-toggle', 'input-toggle']) {
		if (!css.includes(sel))
			problems.push(`产物 CSS 里没有 ${sel} 选择器（Toggle 的样式没被编译进来？）`)
	}
	for (const sel of ['z-slider', 'input-slider', 'data-value']) {
		if (!css.includes(sel))
			problems.push(`产物 CSS 里没有 ${sel} 选择器（Slider 的样式没被编译进来？）`)
	}

	// 3. FLIP 客户端脚本必须真的在产物 JS 里
	//    只在源码里出现不算数：没人引用的组件 Astro 根本不会编译
	const flipFingerprint = [
		['--motion-duration', '读取容器上的动画时长自定义属性'],
		['--motion-easing', '读取容器上的缓动自定义属性'],
		['data-list-key', '按 data-list-key 收集条目'],
		['data-article-transition', '整页文章过渡逃生口'],
		['prefers-reduced-motion', '减少动效逃生口'],
	]
	for (const [needle, what] of flipFingerprint) {
		if (!js.includes(needle))
			problems.push(`产物 JS 里没有「${needle}」（${what}）——FLIP 脚本没有被打进产物`)
	}

	// 4. 三个行为钩子
	//    `dataset.changing = ''` 压缩后是 `.changing`（DOM 属性名不会被 mangle），
	//    故用 `changing` 配合赋值/删除形态来判，不用裸词。
	if (!/\.changing\s*=/.test(js))
		problems.push('产物 JS 里没有 `dataset.changing` 的写入（过渡期的 overflow: clip / overflow-anchor: none 永远不会生效）')
	if (!/delete\s+\w+\.dataset\.changing/.test(js))
		problems.push('产物 JS 里没有 `delete dataset.changing`（动画结束后属性不清除，列表会永久 overflow: clip）')
	if (!js.includes('prefers-reduced-motion'))
		problems.push('产物 JS 里没有 prefers-reduced-motion 逃生口（开了「减少动效」的用户仍会看到整列表动画）')
	if (!js.includes('data-article-transition'))
		problems.push('产物 JS 里没有 data-article-transition 逃生口（与整页文章过渡叠加）')

	return problems
}

/* ────────────────────────── 自检 ────────────────────────── */

const OK_HTML = '<div class="list-transition"><div class="list-transition-content"><a class="article-card" data-list-key="/a"></a></div></div>'

/** 一份「全部齐活」的产物快照，逐条用例从这里派生 */
function goodArtifacts() {
	return {
		pages: { index: OK_HTML, archive: OK_HTML },
		css: [
			'.list-transition[data-changing]{overflow:clip;overflow-anchor:none}',
			'.z-toggle{user-select:none}',
			'.input-toggle[data-astro-cid-x]::before{content:""}',
			'.z-slider{display:flex}',
			'.input-slider[data-astro-cid-y][type=range]{appearance:none}',
			'.data-value[data-astro-cid-y]{min-width:var(--slider-value,3ch)}',
		].join('\n'),
		js: [
			'const a=[...e.querySelectorAll("[data-list-key]")];',
			'const c=getComputedStyle(e);',
			'const d=c.getPropertyValue("--motion-duration"),g=c.getPropertyValue("--motion-easing");',
			'e.style.height=t+"px";e.dataset.changing="";',
			'e.animate([{height:t+"px"},{height:n+"px"}],{duration:d,fill:"forwards"});',
			'matchMedia("(prefers-reduced-motion: reduce)").matches',
			'document.documentElement.hasAttribute("data-article-transition")',
			'delete e.dataset.changing',
		].join('\n'),
		// 内联那一路默认留空：上面 11 个用例各自抽掉外链片段即可验证「缺了就报」，
		// 放进内联就不然了。内联路径由 l) / m) 单独覆盖
		inline: { css: [], js: [] },
	}
}

/** 在一份好产物上删掉某个片段，用来验证「缺了就必须报」 */
function without(art, kind, needle) {
	const clone = structuredClone(art)
	clone[kind] = clone[kind].split(needle).join('')
	return clone
}

const good = goodArtifacts()
const problemsOf = art => evaluate(art)

const SELF_TESTS = [
	{
		name: 'a) 全部齐活 → 不报',
		art: good,
		expect: [],
	},
	{
		name: 'b) 归档页没接 wrapper（现状即此）',
		art: { ...good, pages: { index: OK_HTML, archive: '<div class="archive"></div>' } },
		expect: ['缺少 .list-transition-content'],
	},
	{
		name: 'c) 索引页没接 wrapper',
		art: { ...good, pages: { index: '<main></main>', archive: OK_HTML } },
		expect: ['缺少 .list-transition'],
	},
	{
		name: 'd) 页面产物整个缺失 → 必须报错，不能当过',
		art: { ...good, pages: { index: null, archive: OK_HTML } },
		expect: ['页面产物缺失'],
	},
	{
		name: 'e) Toggle 样式没进产物',
		art: without(good, 'css', 'z-toggle'),
		expect: ['没有 z-toggle'],
	},
	{
		name: 'f) Slider 样式没进产物',
		art: without(good, 'css', 'input-slider'),
		expect: ['没有 input-slider'],
	},
	{
		// 本项目最典型的失败模式：组件写了、markup 也在，但没人引用 → JS 根本没编译
		name: 'g) 「写了没引用」：markup 在但 FLIP 脚本不在产物 JS 里',
		art: { ...good, js: 'console.log("hello")' },
		expect: ['FLIP 脚本没有被打进产物'],
	},
	{
		name: 'h) 少了 data-changing 的写入者（动画没有 overflow 裁剪）',
		art: without(good, 'js', 'e.dataset.changing=""'),
		expect: ['没有 `dataset.changing` 的写入'],
	},
	{
		name: 'i) 少了 delete（结束后属性不清，列表永久 overflow: clip）',
		art: without(good, 'js', 'delete e.dataset.changing'),
		expect: ['没有 `delete dataset.changing`'],
	},
	{
		name: 'j) 少了 prefers-reduced-motion 逃生口',
		art: without(good, 'js', 'prefers-reduced-motion'),
		expect: ['没有 prefers-reduced-motion 逃生口'],
	},
	{
		name: 'k) 少了 data-article-transition 逃生口',
		art: without(good, 'js', 'data-article-transition'),
		expect: ['没有 data-article-transition 逃生口'],
	},
	{
		// 本门禁自己踩过的坑：Astro 7 把 Toggle / Slider / FLIP 的 CSS 与 JS 直接内联进
		// 页面，产物里明明有、外链 chunk 里没有。只读外链时这 14 条会全红
		name: 'l) CSS/JS 只内联在页面里、外链 chunk 一个都没有 → 不报',
		art: { ...good, css: '', js: '', inline: { css: [good.css], js: [good.js] } },
		expect: [],
	},
	{
		name: 'm) 内联块里也没有 → 照样必须报（内联那一半是同权判据，不是安慰奖）',
		art: { ...good, css: '', js: '', inline: { css: [], js: [] } },
		expect: ['没有 z-toggle'],
	},
	{
		// 内联脚本里有选择器字面量 ≠ 标记还在：wrapper 被删掉后 FLIP 脚本照样会被内联进来
		name: 'n) wrapper 标记没了、只剩内联脚本里的同名选择器字面量 → 必须报',
		art: { ...good, pages: { index: OK_HTML, archive: '<main><script>document.querySelectorAll(`[data-list-transition-content]`)</script></main>' } },
		expect: ['缺少 .list-transition-content'],
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	const got = problemsOf(t.art)
	const ok = t.expect.length === 0
		? got.length === 0
		: got.some(g => t.expect.every(k => g.includes(k)))
	if (!ok) {
		selfOk = false
		console.error(`  自检失败：${t.name}`)
		console.error(`    期望含 [${t.expect.join(', ') || '（无问题）'}]，实得 ${JSON.stringify(got)}`)
	}
	else {
		console.log(`  PASS  ${t.name}`)
	}
}
if (!selfOk) {
	console.error('FAIL: 判据自检不过，判据本身不可信，拒绝输出结论。')
	process.exit(1)
}
console.log(`self-test: ${SELF_TESTS.length} 例全过\n`)

/* ────────────────────────── 实际检查 ────────────────────────── */

if (!statSync(DIST, { throwIfNoEntry: false })) {
	console.error(`FAIL: 找不到产物目录 ${DIST}。先构建再跑本门禁。`)
	process.exit(1)
}

const artifacts = collectArtifacts(DIST)
const problems = evaluate(artifacts)

const pageCount = Object.values(artifacts.pages).filter(Boolean).length
const bytes = arr => arr.reduce((n, s) => n + s.length, 0)
console.log('===== FLIP / 交互组件接线门禁 =====')
console.log(`  产物：${pageCount} 个页面`)
console.log(`    CSS 外链 ${artifacts.css.length} 字节 + 内联 ${artifacts.inline.css.length} 段 <style>（${bytes(artifacts.inline.css)} 字节）`)
console.log(`    JS  外链 ${artifacts.js.length} 字节 + 内联 ${artifacts.inline.js.length} 段 <script>（${bytes(artifacts.inline.js)} 字节）`)
console.log('  判据只读 dist/，不读源码——源码里有但没被引用的组件，Astro 不会编译。')
console.log('  Astro 7 的内联块与外链 chunk 同权；标记类判据只认 markupOf()，代码里的字面量不算标记。')

if (!problems.length) {
	console.log('\n  PASS: 三个交互组件都已编译进产物且接线完整。')
	process.exit(0)
}

console.log(`\n  FAIL: ${problems.length} 处未接线\n`)
for (const p of problems)
	console.log(`    - ${p}`)
console.log('\n  排查顺序：')
console.log('    1. 组件是否真的被页面 import 并渲染（未被引用 ⇒ Astro 不编译 ⇒ 产物里没有）')
console.log('    2. 产物 CSS 里选择器名是否与 Nuxt 基线一致（改名会让样式门禁整组失效）')
console.log('    3. 三个逃生口缺任一条都不会让构建失败，只会静默影响交互')
process.exit(1)
