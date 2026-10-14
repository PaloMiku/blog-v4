#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

import { join } from 'node:path'
import process from 'node:process'
import { DIST } from './lib/paths.mjs'

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
	for (let m = re.exec(css); m; m = re.exec(css))
		res.push({ sel: m[1].trim(), body: m[2] })
	return res
}

function decl(body, prop) {
	const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
	return m ? m[1].trim() : null
}

/** 能让内层脱离 inline 基线对齐的 display 值 */
const SAFE_DISPLAY = new Set(['block', 'flow-root', 'flex', 'grid', 'inline-flex', 'inline-grid', 'contents', 'absolute', 'fixed'])

/**
 * 判据本体（纯函数：吃 CSS 片段列表与首页 HTML，吐问题数组，空 = 全过）。
 *
 * 抽成纯函数是为了能喂合成数据自检。重构前判据直接写在顶层脚本流里、读盘后立刻
 * exit，**零自检**——而「一道没被看过变红的门禁等于没有门禁」（CLAUDE.md 坑位 6）。
 */
function evaluate(cssList, indexHtml) {
	const problems = []
	if (!cssList.length)
		return ['在 dist 里一条 CSS 都没读到。产物结构变了？先确认 build 正常。']

	// 1) 先确认这个结构真的存在，否则下面的判据是在检查一个不存在的东西
	const wrapperRe = /<span class="nav-icon"[^>]*>\s*<svg[^>]*class="iconify"/g
	const wrapperCount = (indexHtml.match(wrapperRe) || []).length
	if (wrapperCount === 0) {
		return ['dist/index.html 里找不到 <span class="nav-icon"> 紧邻 <svg class="iconify"> 的结构。'
			+ '图标实现已经变了（换成 <i>/<img>/内联 SVG 文本？），本门禁的判据不再成立，'
			+ '请改判据而不是放宽它 —— 旧判据此刻是在检查一个不存在的东西。']
	}

	// 2) 找出所有「`.nav-icon` 作父、`.iconify` 作子」的选择器，以及父级自身是 flex/grid 的上下文
	const all = cssList.flatMap(c => rules(c.text).map(r => ({ ...r, from: c.from })))
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

	if (childProtected === 0 && parentFlex === 0) {
		problems.push('没有任何规则让 `.nav-icon` 里的 `.iconify` 脱离 inline 布局。'
			+ '实测后果：内层 <svg> 按 vertical-align:baseline 贴基线，比承载它的图标盒低 1.72px —— '
			+ '而盒与文字的中心差仍是 0，所以「量盒」的仪器（页高、计算样式对比）全都看不见它。'
			+ '修法：加 display:block（不要动 line-height，那会把盒高撑回 30.24px）；'
			+ '或让 `.nav-icon` 自身成为 flex/grid 容器——那时内层作为 flex item 自动块化并居中。')
	}
	if (offenders.length) {
		const list = offenders.map(o => `[${o.from}] ${o.sel} { display: ${o.display} } —— ${o.why}`).join('\n        ')
		problems.push(`${offenders.length} 条规则让内层 iconify 保持在 inline 级：\n        ${list}`)
	}
	return { problems, wrapperCount, childProtected, parentFlex }
}

/* ────────────────────────── 自检 ────────────────────────── */

const OK_HTML = '<span class="nav-icon"><svg class="iconify" data-icon="tabler:x"></svg></span>'

const SELF_TESTS = [
	{
		name: 'a) display:block 在位 → 不报',
		css: [{ from: 'good.css', text: '.sidebar-nav-item>.nav-icon>.iconify{font-size:1em;display:block}' }],
		html: OK_HTML,
		expect: [],
	},
	{
		name: 'b) 内层退回 inline → 必须报（1.72px 基线漂移的成因）',
		css: [{ from: 'x.css', text: '.sidebar-nav-item>.nav-icon>.iconify{display:inline}' }],
		html: OK_HTML,
		expect: ['保持在 inline 级'],
	},
	{
		name: 'c) 规则整个没了 → 必须报「没有任何规则」',
		css: [{ from: 'x.css', text: '.article{color:red}' }],
		html: OK_HTML,
		expect: ['没有任何规则让'],
	},
	{
		// 结构变了必须报「判据不成立」，且**不得**接着报成「没有规则」——
		// 两者混在一起时，读者会去加 display:block，而真正要改的是判据。
		name: 'd) 结构没了（换成 <i>）→ 必须报，且不得误报成「没有规则」',
		css: [{ from: 'good.css', text: '.sidebar-nav-item>.nav-icon>.iconify{display:block}' }],
		html: '<span class="nav-icon"><i class="iconify"></i></span>',
		expect: ['紧邻'],
	},
	{
		// 负控制：`.iconify` 排在 `.nav-icon` 之前 ⇒ 不是父子关系，不能算命中。
		// 判据 3 用的是「nav-icon 的下标 < iconify 的下标」，反序必须落到「没有规则」。
		name: 'e) 选择器反序（.iconify 在前）→ 算「没有规则」，不是「inline 违规」',
		css: [{ from: 'x.css', text: '.iconify>.nav-icon{display:inline}' }],
		html: OK_HTML,
		expect: ['没有任何规则让'],
	},
	{
		name: 'f) 一条 CSS 都没读到 → 必须报，不能拿空数组判过',
		css: [],
		html: OK_HTML,
		expect: ['一条 CSS 都没读到'],
	},
	{
		name: 'g) 父级自己是 flex → 记为上下文，且不误报 inline',
		css: [{ from: 'x.css', text: '.nav-icon{display:flex}' }],
		html: OK_HTML,
		expect: [],
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	const r = evaluate(t.css, t.html)
	const got = Array.isArray(r) ? r : r.problems
	const ok = t.expect.length === 0
		? got.length === 0
		: t.expect.every(k => got.some(g => g.includes(k)))
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

if (!existsSync(join(DIST, 'index.html'))) {
	console.error(`FAIL: 找不到 ${join(DIST, 'index.html')}。先构建再跑本门禁。`)
	process.exit(1)
}
const result = evaluate(readAllCss(), readFileSync(join(DIST, 'index.html'), 'utf8'))
if (Array.isArray(result)) {
	console.error(`FAIL: ${result[0]}`)
	process.exit(1)
}
if (result.problems.length) {
	console.error(`FAIL: ${result.problems.length} 处问题：`)
	for (const p of result.problems) console.error(`      ${p}`)
	process.exit(1)
}
console.log(`OK: icon-box —— index.html 里 ${result.wrapperCount} 处 <span class="nav-icon"><svg class="iconify">；`
	+ `内层脱离 inline 的规则 ${result.childProtected} 条、父级 flex/grid 上下文 ${result.parentFlex} 个，`
	+ '无一条会让内层贴基线漂移。')
