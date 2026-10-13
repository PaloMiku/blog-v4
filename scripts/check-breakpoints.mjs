#!/usr/bin/env node
/**
 * 门禁：断点收在已知集合里，且 JS 侧与 CSS 侧同源。
 *
 * ## 这条门禁在防什么
 *
 * 全站断点**不能**做成 CSS 自定义属性——媒体查询条件里不能插值 `var()`，
 * 所以 `@media (max-width: var(--bp-mobile))` 根本不成立。可行的做法只有两个：
 * 要么上构建期宏，要么**用门禁把字面量锁死**。本脚本是后者。
 *
 * 现状是 40 处断点字面量散在 20+ 个文件里，且 `528px` / `768px` / `1080px`
 * 三者各自出现在 JS 与 CSS 两侧。`check-layout.mjs` 只断言 `1080px` 与 `768px`
 * **存在**——它无法发现**新引入**的第七个断点，也无法发现两侧取值漂移。
 *
 * 两个具体失效场景：
 *   1. 有人给某个组件随手加 `@media (max-width: 700px)`。构建全绿、页面看着
 *      也正常，只是这个宽度上下会出现一条谁都没设计过的布局缝。
 *   2. `layout-state.ts` 的 `LAYOUT_BREAKPOINTS.sidebar` 从 768 改成 800，
 *      CSS 侧那 12 处 768 没跟着改 ⇒ JS 认为侧栏收起、而 CSS 仍按展开渲染。
 *      这类分叉只在真实视口下才显形，`check-big-picture-layout` 测的是大屏模式，
 *      覆盖不到普通模式。
 *
 * ## 判据
 *
 * 1. `src/` 下所有 `@media (min|max)-width: Npx` 的 N 落在已知集合内。
 *    已知集合里的每个值都要有来源说明——不是「能用就行」，是「知道它为什么是这个值」。
 * 2. `layout-state.ts` 的 `LAYOUT_BREAKPOINTS` 每个值必须出现在 CSS 侧
 *    （该值确实被用于媒体查询），否则就是只有一侧的孤儿。
 *
 * ## 与 `check-layout.mjs` 的分工
 *
 * 那道门禁问「这两个断点在不在」；本门禁问「**只有**这两个断点在不在，
 * 而且 JS 与 CSS 是否一致」。两者不重叠。
 *
 * ## 如何自证（改本脚本后必须做）
 *
 * 往任意组件里塞一条 `@media (max-width: 700px)`，本脚本应变红并指出
 * `700px` 不在已知集合；删掉后应变绿。**没被看过变红的门禁等于没有门禁。**
 *
 * 用法：node scripts/check-breakpoints.mjs
 * 退出码：0 = 通过；1 = 有未知断点或 JS/CSS 漂移；2 = 脚本自身出错
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'

/**
 * 已知断点。`why` 不是注释而是判据的一部分：新增条目必须说明它为什么是这个值，
 * 否则下一个读代码的人无从判断该保留还是该并进相邻档。
 *
 * ⚠️ 新增断点前先问：能不能并进已有档？相邻档之间的缝隙通常不是设计出来的，
 * 而是在某个组件里顺手敲了个整数。
 */
const KNOWN = {
	'480px': '窄手机。Collection 与 PostRelated 收起次要信息（序号、图标文字）。',
	'528px': '正文窄屏档。封面切为顶部整幅、表格与资源列表改单列。多数组件的「手机」都指这一档。',
	'640px': '仅 SeriesGroup：合集条目从并排改为换行。与 528 同属窄屏，无从属关系；若日后收敛应并入 528。',
	'768px': '侧栏断点。JS 侧 LAYOUT_BREAKPOINTS.sidebar 的唯一来源。',
	'769px': '768 的补集（min-width 写法）。与 768 配对使用，只在需要「宽屏才做 X」时出现。',
	'1080px': '右侧栏断点。JS 侧 LAYOUT_BREAKPOINTS.aside 的唯一来源。',
}

const failures = []

function scan(dir, acc = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory())
			scan(full, acc)
		else if (/\.(astro|css|ts)$/.test(entry.name))
			acc.push(full)
	}
	return acc
}

const roots = ['src'].map(d => path.join(REPO_ROOT, d)).filter(fs.existsSync)
if (!roots.length) {
	console.error('找不到 src/，脚本自身出错')
	process.exit(2)
}

const files = roots.flatMap(r => scan(r))

// 剥掉注释再扫：注释里常出现「与 plumz 的 @media (max-width:480px) 同处理」
// 这类说明文本，不该被判成真实断点。
const seen = new Map()

for (const file of files) {
	const raw = fs.readFileSync(file, 'utf8')
	const code = raw
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
	const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/')
	for (const m of code.matchAll(/@media[^{]*?\((?:min|max)-width:\s*(\d+(?:\.\d+)?)px/g)) {
		const bp = `${m[1]}px`
		const line = code.slice(0, m.index).split('\n').length
		if (!seen.has(bp))
			seen.set(bp, [])
		seen.get(bp).push(`${rel}:${line}`)
	}
}

console.log('--- 断点普查 ---')
for (const [bp, sites] of [...seen.entries()].sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]))) {
	if (KNOWN[bp]) {
		console.log(`  OK    ${bp.padEnd(7)} ${sites.length} 处  ${KNOWN[bp]}`)
	}
	else {
		console.log(`  FAIL  ${bp.padEnd(7)} ${sites.length} 处，不在已知集合内`)
		for (const s of sites.slice(0, 6))
			console.log(`          ${s}`)
		if (sites.length > 6)
			console.log(`          …另 ${sites.length - 6} 处`)
		failures.push(`未知断点 ${bp}（${sites.length} 处，例：${sites[0]}）`)
	}
}

for (const bp of Object.keys(KNOWN)) {
	if (!seen.has(bp))
		console.log(`  WARN  ${bp.padEnd(7)} 已知集合里有，但 CSS 侧一处也没用到`)
}

console.log('\n--- JS / CSS 同源 ---')
const layoutState = path.join(REPO_ROOT, 'src/lib/layout-state.ts')
if (!fs.existsSync(layoutState)) {
	console.error('找不到 src/lib/layout-state.ts，脚本自身出错')
	process.exit(2)
}
const stateSrc = fs.readFileSync(layoutState, 'utf8')
const declared = [...stateSrc.matchAll(/:\s*'(\d+(?:\.\d+)?)px'/g)].map(m => `${m[1]}px`)

if (!declared.length) {
	console.error('LAYOUT_BREAKPOINTS 解析不到任何 px 取值，脚本自身出错')
	process.exit(2)
}

for (const bp of declared) {
	if (seen.has(bp)) {
		console.log(`  OK    LAYOUT_BREAKPOINTS 声明 ${bp}，CSS 侧确实用到`)
	}
	else {
		console.log(`  FAIL  LAYOUT_BREAKPOINTS 声明 ${bp}，CSS 侧一处也没用到`)
		failures.push(`JS 侧断点 ${bp} 在 CSS 侧无对应（两侧会分叉）`)
	}
	if (!KNOWN[bp]) {
		console.log(`  FAIL  JS 侧断点 ${bp} 不在已知集合内`)
		failures.push(`JS 侧断点 ${bp} 不在已知集合内`)
	}
}

console.log('')
if (failures.length) {
	console.log(`RESULT: FAIL - ${failures.length} 个问题`)
	for (const f of failures)
		console.log(`  - ${f}`)
	process.exit(1)
}

console.log(`RESULT: PASS - ${seen.size} 个断点全部在已知集合内，JS 侧取值均有 CSS 对应`)
