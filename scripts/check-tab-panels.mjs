#!/usr/bin/env node
/**
 * 门禁：`#tabN` 面板标记必须与 `tabs` 声明对得上。
 *
 * ## 抓的是什么
 *
 * `src/plugins/tab-panels.ts` 在构建期把 `#tabN` 展开成 `<div slot="tabN">`。
 * 它自己会抛错拦住「数量对不上」和「编号跳号」两类，但那是**构建期**的——
 * 而这两类错误的真正后果是产物里那个页签空白，构建却是绿的（跳号会生成
 * Tab 不认识的 `slot="tab3"`）。所以需要一道**源侧**判据，让它在改内容的
 * 那一刻就红，而不是等到跑完整条流水线。
 *
 * 判据只读源文件、不需要构建，因此能进默认档（毫秒级）。
 * 构建期的红绿双向由 `scripts/tab-panels-red.mjs` 覆盖（它真的跑 4 次
 * `astro build`，~45 s，刻意不进流水线——与 `interaction-check.mjs` 同理）。
 *
 * ## 判据
 *
 * 对每个含 `#tabN` 的 `.mdx`：
 * 1. 每个标记都必须落在某个 `<Tab …>` 与 `</Tab>` 之间。落在外面的标记插件**根本
 *    不会处理**（`walk()` 只进 `<Tab>` 元素的子节点），于是它以字面 `#tab1` 段落
 *    渲染在页面上——不报错、不留痕迹
 * 2. 编号必须从 1 连续递增
 * 3. 标记数必须等于 `tabs={[…]}` 数组的长度
 * 4. 面板里不能嵌套另一个带标记的 `<Tab>`（内层不会被处理，会把标记漏到页面）
 *
 * ## 用法
 *
 *     node scripts/check-tab-panels.mjs
 *
 * 退出码：0 = 通过；1 = 有问题
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const ROOT = REPO_ROOT
const CONTENT = join(ROOT, 'src', 'content')

/** 面板标记：独占一行的 `#tab1` */
const MARK_RE = /^#tab(\d+)[ \t]*$/gm
/**
 * 早期过滤用的**非全局**副本。
 *
 * ⚠️ 不能直接 `MARK_RE.test(source)`：MARK_RE 带 /g，而 `test()` 会推进
 * `lastIndex`；更坑的是 `String.prototype.matchAll()` **复制原正则的 lastIndex**，
 * 于是后面每个 body 的 `matchAll` 都从那个偏移开始找——body 只有几十行，标记在
 * 开头，于是「一个都找不到」，门禁一路绿到底（实测踩过：注入的 DBG 打印显示
 * bodyLen=94 / marks=0，而同样内容单独测能匹配到 2 个）。
 * 这个坑的表现是**静默漏检**，与「判据写错」同形，肉眼极难看出来。
 */
const MARK_TEST_RE = /^#tab\d+[ \t]*$/m

function collectMdx(dir) {
	return walkFiles(dir, { ext: '.mdx' })
}

/** 从 `tabs={[…]}` 里数出顶层元素个数；数不出（变量引用）返回 null */
function declaredTabs(openTag) {
	const m = /tabs\s*=\s*\{/.exec(openTag)
	if (!m)
		return null
	let i = openTag.indexOf('[', m.index + m[0].length)
	if (i < 0)
		return null
	let depth = 0
	let count = 1
	for (; i < openTag.length; i++) {
		const c = openTag[i]
		if (c === '[' || c === '{' || c === '(') {
			depth++
		}
		else if (c === ']' || c === '}' || c === ')') {
			depth--
			if (depth === 0)
				return count
		}
		else if (c === ',' && depth === 1) {
			count++
		}
	}
	return null
}

const problems = []
let checked = 0
let tabs = 0

for (const file of collectMdx(CONTENT)) {
	const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
	if (!MARK_TEST_RE.test(source))
		continue

	const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')

	// 判据 1 要用：每个标记的**全局**偏移。Tab 体里的标记登记进来，
	// 扫完全部 <Tab> 后剩下的就是落在任何 Tab 之外的孤立标记。
	const owned = new Set()

	// 每个 `<Tab` 开标签到它自己的闭合标签之间算一个 Tab 体
	const opens = [...source.matchAll(/^<Tab\b[^>]*>/gm)]
	for (const open of opens) {
		const start = open.index
		const close = source.indexOf('\n</Tab>', start)
		if (close < 0)
			continue
		const body = source.slice(start, close)
		const marks = [...body.matchAll(MARK_RE)].map(m => ({ n: Number(m[1]), at: m.index }))
		if (!marks.length)
			continue

		for (const m of marks)
			owned.add(start + m.at)

		tabs++
		const line = source.slice(0, start).split('\n').length

		// 编号连续
		const gapped = marks.filter((m, idx) => m.n !== idx + 1)
		if (gapped.length) {
			problems.push(`${rel}:${line} 面板编号不是从 1 连续递增：${marks.map(m => `#tab${m.n}`).join(', ')}。跳号会生成 Tab 不认识的 slot="tab${gapped[0].n}"，那个页签空白而构建照样绿`)
			continue
		}

		// 数量与 tabs 数组一致
		const want = declaredTabs(open[0])
		if (want !== null && want !== marks.length) {
			problems.push(`${rel}:${line} 声明了 ${want} 个页签，却有 ${marks.length} 个 #tabN 标记`)
			continue
		}

		// 嵌套：某个标记与它所属的下一个 <Tab 之间不能再出现 <Tab 开标签
		for (const m of marks) {
			const after = body.slice(m.at)
			const nextMark = after.slice(1).search(MARK_RE)
			const limit = nextMark < 0 ? after.length : nextMark + 1
			if (/^\s*<Tab\b/m.test(after.slice(0, limit)))
				problems.push(`${rel}:${line} 面板里嵌套了 <Tab>。内层 Tab 来自合成文本、不再经过 tab-panels 插件，它的 #tabN 会原样漏到页面上`)
		}
		checked++
	}

	/*
	 * 判据 1：落在任何 <Tab> 之外的标记。
	 *
	 * 症状在页面上**看得见**（一段字面 `#tab1`），但没有任何一道判据会红——
	 * 它不在任何 Tab 体里，于是「编号连续」「数量与 tabs 一致」那两条都数不到它；
	 * 构建期插件的 `walk()` 只进 `<Tab>` 元素的子节点，同样碰不到它。
	 * 换句话说这正是「仪器出局」的那类缺陷：不是判据写错，是判据根本没看见。
	 *
	 * ⚠️ `MARK_RE` 在这里第二次 `matchAll` 是安全的：`matchAll` 克隆正则、
	 * 不推进原对象的 lastIndex，而 `MARK_RE` 全程只经 `matchAll` 使用。
	 * 它带 /g，直接 `test()` 会推进 lastIndex——上面 `MARK_TEST_RE` 那个副本
	 * 就是为躲开这件事才存在的，两处别混用。
	 */
	for (const m of source.matchAll(MARK_RE)) {
		if (owned.has(m.index))
			continue
		const line = source.slice(0, m.index).split('\n').length
		problems.push(`${rel}:${line} #tab${m[1]} 不在任何 <Tab> 里，面板插件不会处理它——它会作为字面 \`#tab${m[1]}\` 段落渲染在页面上。面板标记必须写在 <Tab …> 与 </Tab> 之间。`)
	}
}

if (problems.length) {
	console.error(`\n✗ #tabN 面板语法有 ${problems.length} 处问题：\n`)
	for (const p of problems)
		console.error(`  - ${p}`)
	process.exit(1)
}
console.log(`OK: ${checked} 处用 #tabN 写面板（分布在 ${tabs} 个 <Tab> 里），编号连续、数量与 tabs 声明一致、无嵌套、无游离标记。`)
process.exit(0)
