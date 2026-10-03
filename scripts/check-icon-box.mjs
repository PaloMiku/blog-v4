#!/usr/bin/env node
/*
 * 门禁：侧栏/页脚/搜索框的图标包装层，内层 svg 必须**脱离 inline 布局**。
 *
 * ## 为什么需要这道门禁
 *
 * 2026-10-03 用户报「侧边栏图标和字不是很对齐」。探针量到的核心事实：
 *
 *   线上 `span.iconify`      盒高 21.59，内层无 svg（图形用 CSS mask 铺满盒子）
 *   Astro `span.nav-icon`    盒高 21.59，内层 `svg.iconify` **偏下 1.72px**
 *   两侧「盒中心 vs 文字中心」都是 0
 *
 * ⇒ 盒与字是对齐的，偏的是**盒里那个 svg**。而 `compare-ui-parity.mjs`
 * 结构上看不见它，原因有两条，缺一不可：
 *
 *   1. `STYLE_PROPS` 里是计算样式（color / padding / …），**没有几何偏移**；
 *   2. `.nav-icon > .iconify` 这个选择器**跨侧不匹配**——
 *      线上根本没有内层 svg，`.iconify` 自己就是 flex item。
 *
 * 而「补 `STYLE_SELECTORS`」这条路也走不通：它按选择器跨侧匹配，
 * 这里两侧**没有同一个东西**可以对。
 *
 * ⇒ 这是一条**单侧不变量**，不是差异比对。
 *
 * ## 不变量是什么
 *
 * `.nav-icon` 是显式 `width/height: 1em` 的**图标盒**。盒内的图形有两种合法摆法：
 *
 *   (a) 父级自己是 flex/grid —— 内层作为 flex item 被块化并居中（搜索框 `.input .nav-icon{display:flex}`）
 *   (b) 父级是 block/inline-block —— **必须**另有一条规则把内层 `.iconify`
 *       设成 block/flex/grid/absolute，`否则它按 `vertical-align: baseline`
 *       贴基线，位置由父的行盒决定，随 `line-height` 漂移。
 *
 * 违规的实测后果就是那 1.72px——它由 `line-height: 1`（为了把盒高压回 21.6px
 * 而写的）与 inline 基线对齐共同产生，而**盒本身完全正常**，
 * 于是所有「量盒」的仪器都看不见。
 *
 * ⚠️ 走查法：`<span class="nav-icon">` 之后必须**紧邻** `<svg class="iconify">`。
 * 若图标换成 `<i>` / `<img>` / 内联 SVG 文本，本门禁会**如实报错**而不是静默放过。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

if (!existsSync(DIST)) {
	console.error('FAIL: dist/ 不存在。先跑 pnpm build —— 门禁读的是构建产物，不是源码。')
	process.exit(1)
}

/** 读取全部产物 CSS（外链 + 内联在 HTML 里的都要） */
function readAllCss() {
	const out = []
	const cssDir = join(DIST, '_astro')
	if (existsSync(cssDir)) {
		for (const f of readdirSync(cssDir)) {
			if (f.endsWith('.css'))
				out.push({ from: `_astro/${f}`, text: readFileSync(join(cssDir, f), 'utf8') })
		}
	}
	for (const f of readdirSync(DIST)) {
		if (f.endsWith('.html')) {
			const html = readFileSync(join(DIST, f), 'utf8')
			for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
				if (m[1].includes('nav-icon'))
					out.push({ from: `${f} <style>`, text: m[1] })
			}
		}
	}
	return out
}

/** 拆出所有 `选择器 { 声明 }`，兼容嵌套（CSS nesting）时只取最外层花括号 */
function rules(css) {
	const res = []
	const re = /([^{}]+)\{([^{}]*)\}/g
	let m
	while ((m = re.exec(css)))
		res.push({ sel: m[1].trim(), body: m[2] })
	return res
}

function decl(body, prop) {
	const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
	return m ? m[1].trim() : null
}

/** 能让内层脱离 inline 基线对齐的 display 值 */
const SAFE_DISPLAY = new Set(['block', 'flow-root', 'flex', 'grid', 'inline-flex', 'inline-grid', 'contents', 'absolute', 'fixed'])

const css = readAllCss()
if (!css.length) {
	console.error('FAIL: 在 dist 里一条 CSS 都没读到。产物结构变了？先确认 build 正常。')
	process.exit(1)
}

// 1) 先确认这个结构真的存在，否则下面的判据是在检查一个不存在的东西
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
const wrapperRe = /<span class="nav-icon"[^>]*>\s*<svg[^>]*class="iconify"/g
const wrapperCount = (indexHtml.match(wrapperRe) || []).length
if (wrapperCount === 0) {
	console.error('FAIL: dist/index.html 里找不到 <span class="nav-icon"> 紧邻 <svg class="iconify"> 的结构。')
	console.error('      图标实现已经变了（换成 <i>/<img>/内联 SVG 文本？），本门禁的判据不再成立，')
	console.error('      请改判据而不是放宽它 —— 旧判据此刻是在检查一个不存在的东西。')
	process.exit(1)
}

// 2) 找出所有「`.nav-icon` 作父、`.iconify` 作子」的选择器，以及父级自身是 flex/grid 的上下文
const all = css.flatMap(c => rules(c.text).map(r => ({ ...r, from: c.from })))
let childProtected = 0
let parentFlex = 0
const offenders = []

for (const r of all) {
	for (const one of r.sel.split(',')) {
		const s = one.trim()
		// 父级自身是 flex/grid：内层作为 flex item 自动块化并居中（形态 a）
		if (/\.nav-icon(?![\w-])/.test(s) && !/\.iconify/.test(s)) {
			const d = decl(r.body, 'display')
			if (d && ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(d))
				parentFlex++
		}
		// 同一选择器里 nav-icon 在前、iconify 在后 ⇒ 父子关系（形态 b）
		const ni = s.indexOf('.nav-icon')
		const ic = s.indexOf('.iconify')
		if (ni >= 0 && ic > ni) {
			const d = decl(r.body, 'display')
			if (d && SAFE_DISPLAY.has(d.toLowerCase()))
				childProtected++
			else if (d)
				offenders.push({ from: r.from, sel: s, display: d, why: '内层 iconify 仍是 inline 级，位置会随父级 line-height 漂移' })
		}
	}
}

if (childProtected === 0) {
	console.error('FAIL: 没有任何规则让 `.nav-icon` 里的 `.iconify` 脱离 inline 布局。')
	console.error('      实测后果：内层 <svg> 按 vertical-align:baseline 贴基线，')
	console.error('      比承载它的图标盒低 1.72px —— 而盒与文字的中心差仍是 0，')
	console.error('      所以「量盒」的仪器（页高、计算样式对比）全都看不见它。')
	console.error('      修法：加 display:block（不要动 line-height，那会把盒高撑回 30.24px）。')
	process.exit(1)
}

if (offenders.length) {
	console.error(`FAIL: ${offenders.length} 条规则让内层 iconify 保持在 inline 级：`)
	for (const o of offenders)
		console.error(`      [${o.from}] ${o.sel} { display: ${o.display} } —— ${o.why}`)
	process.exit(1)
}

console.log(`OK: icon-box —— index.html 里 ${wrapperCount} 处 <span class="nav-icon"><svg class="iconify">；`
	+ `内层脱离 inline 的规则 ${childProtected} 条、父级 flex/grid 上下文 ${parentFlex} 个，`
	+ `无一条会让内层贴基线漂移。`)
