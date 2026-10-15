/**
 * 关键路径资产门禁：每页第三方渲染阻塞样式表的**预算棘轮**。
 *
 * ## 为什么有这道门禁（2026-10-07 实测）
 * `src/layouts/Base.astro` 曾把 `katex.min.css` 无条件 `<link rel="stylesheet">`
 * 在共享布局里，于是 **68 个页面里有 67 个**在渲染关键路径上扛一次第三方 CDN
 * （s4.zstatic.net）的 DNS + TLS + 约 23 KB 阻塞 CSS，换来零个公式——
 * 全站只有 `previews/example.mdx` 真渲染出 KaTeX，而那个演示页本身
 * 被 robots.txt Disallow、也被 sitemap filter 掉了。
 *
 * 该缺陷改成了按条件输出并配了「KaTeX 双向一致性」判据；2026-10-15 数学管线
 * （remark-math / rehype-katex / math-code.ts / hasMath）整体摘除，
 * 产物里不再可能出现 KaTeX 节点与那份 CSS，条件化判据随之退役，
 * 本门禁只保留**预算棘轮**：第三方阻塞样式表每多一个都红。
 *
 * ## 判据怎么写才不自欺（踩过的坑，逐条写在代码里）
 * - **必须先剥掉 `<!-- -->`**。上一版原型把源码注释里的示例字符串
 *   当成了渲染节点，报出成片假命中——而那段注释
 *   是 Astro **原样输出到每页 head** 的。文字提到不等于元素存在。
 * - **认标签不认裸字符串**。
 * - **被 `<script>` / `<style>` 正文吸走的字符串不算落点**。
 *
 * 用法：`node scripts/check-critical-assets.mjs [--selftest]`
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resolveDistDir } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

/**
 * 产物目录。**与仓库里其余门禁一致读 `dist/`**——deploy 步骤也是 `folder: dist`。
 *
 * ⚠️ 这里踩过一次：初版直接写 `.output/public`，本机一直绿，推到 CI 后
 * runner 上那个路径不存在，门禁自我放弃 → `skip: never` 判定违规跳过 →
 * 流水线红。**「本机绿」又一次没覆盖到环境差异**（坑位 26 的同族）。
 * 教训是产物路径属于仓库约定，不是实现细节：跟着其余门禁走，别自己推导。
 *
 * 先认 `dist`、再退回 `.output/public`，两处都没有才是真的「产物缺失」——
 * 这两条候选的先后顺序**不能反**，它就是 CI 踩坑史的结论，现在由
 * `resolveDistDir()` 表达（共享实现在 scripts/lib/paths.mjs）。
 */
const DIST = resolveDistDir()

/**
 * 每页允许的第三方渲染阻塞样式表数量上限。**棘轮**：
 * 想放宽必须改这一行，那行 diff 就是 review 的落点。
 *
 * 2026-10-07 建门禁时的实测值是 4（inter-variable / inter /
 * fonts.googleapis.cn / fonts.bytedance）。bytedance 那条只为页脚签名，
 * 已改成 media=print 非阻塞，本数随之降到 3。
 */
const MAX_BLOCKING_THIRD_PARTY_PER_PAGE = 3

/** 挖掉注释与 script/style 正文，只留真正的标记 */
function stripNonMarkup(html) {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

/**
 * 取出该页的第三方渲染阻塞样式表。
 * `media="print"` 的一律不算——那是 `onload` 换 `media` 的非阻塞写法，
 * 本仓库的 lxgw-wenkai 用的就是它，不该被算进预算。
 */
function thirdPartyBlockingStylesheets(html) {
	const out = []
	for (const m of html.matchAll(/<link\b[^>]*>/g)) {
		const tag = m[0]
		if (!/rel="stylesheet"/.test(tag))
			continue
		if (/media="print"/.test(tag))
			continue
		const href = (tag.match(/href="(https:\/\/[^"]+)"/) || [])[1]
		if (href)
			out.push(href)
	}
	return out
}

/**
 * 判据核心。**纯函数**：不读盘、不碰构建产物，
 * 这样 `--selftest` 能在没有 dist/ 的情况下驱动它（不然自检就成了摆设）。
 *
 * @param {{path: string, markup: string}[]} rawPages 页面标记（**未剥离**注释与
 * script/style 正文，剥离在 `judge` 内部做）
 * @param {number} budget 每页第三方阻塞样式表上限
 * @returns {{failures: string[], inventory: Map<string, number>, maxPerPage: number}}
 *   `failures` 每条是一个人类可读的落点；`inventory` 是「资源 → 出现页数」，
 *   用来在失败时直接说出「哪几个资源重复加载了」；`maxPerPage` 是实测单页最高阻塞数。
 */
export function judge(rawPages, budget = MAX_BLOCKING_THIRD_PARTY_PER_PAGE) {
	// 剥离在这里做、而不是留给调用方：自检第一版就把「调用方忘了剥」这个洞暴露出来了
	// （判据的正确性挂在每个调用点上 = 迟早有人传原始 HTML 进来）。
	// stripNonMarkup 幂等，已剥离过的再剥一次结果不变。
	const pages = rawPages.map(p => ({ ...p, markup: stripNonMarkup(p.markup) }))

	const failures = []
	const inventory = new Map()
	let maxPerPage = 0

	// 按「资源组合」聚合成一条失败，而不是逐页刷屏：几十个页面逐条列出来
	// 只会把真正的落点埋掉（坑位 27——失败路径要能行动，不能是日志墙）。
	const overBudget = new Map() // 组合签名 -> { urls, pages }
	for (const p of pages) {
		const urls = thirdPartyBlockingStylesheets(p.markup)
		for (const u of urls) inventory.set(u, (inventory.get(u) || 0) + 1)
		if (urls.length > maxPerPage)
			maxPerPage = urls.length
		if (urls.length > budget) {
			const key = urls.join(' | ')
			if (!overBudget.has(key))
				overBudget.set(key, { urls, pages: [] })
			overBudget.get(key).pages.push(p.path)
		}
	}
	for (const { urls, pages: ps } of [...overBudget.values()].sort((a, b) => b.pages.length - a.pages.length)) {
		failures.push(`${ps.length} 个页面有 ${urls.length} 个第三方渲染阻塞样式表（上限 ${budget}）：\n      ${urls.join('\n      ')}\n      例：${ps.slice(0, 3).join(', ')}${ps.length > 3 ? ' …' : ''}`)
	}

	return { failures, inventory, maxPerPage }
}

/** 扫 dist 收集页面 */
function collectPages() {
	return walkFiles(DIST, { ext: '.html' })
		.map(f => ({ path: path.relative(DIST, f).replace(/\\/g, '/'), markup: fs.readFileSync(f, 'utf8') }))
}

/* ============================ 自检 ============================ */
/**
 * 自检不读真实产物，只驱动 `judge`。理由：门禁自己错了而没人发现过二十多次
 * （CLAUDE.md 坑位 6）。自检覆盖的是**判据的方向性**——
 * 预算超了必须红、恰好等于预算必须绿、非阻塞写法不算。
 */
function selftest() {
	const PLAIN = '<html><head></head><body><p>hi</p></body></html>'

	const cases = [
		['无第三方样式表必须绿', () => judge([{ path: 'a', markup: PLAIN }], 3).failures.length === 0],
		['恰好等于预算不红', () => judge([{ path: 'a', markup: Array.from({ length: 3 }, (_, i) => `<link rel="stylesheet" href="https://x/${i}.css">`).join('') }], 3).failures.length === 0],
		['预算超了必须红', () => judge([{ path: 'a', markup: Array.from({ length: 4 }, (_, i) => `<link rel="stylesheet" href="https://x/${i}.css">`).join('') }], 3).failures.length > 0],
		['media="print" 的第三方样式表不计入阻塞预算', () => judge([{ path: 'a', markup: '<link rel="stylesheet" href="https://x/f.css" media="print">' }], 0).failures.length === 0],
		['本地相对路径样式表不计入第三方预算', () => judge([{ path: 'a', markup: '<link rel="stylesheet" href="/_astro/x.css">' }], 0).failures.length === 0],
		['注释里的样式表不算节点（假阳性回归）', () => judge([{ path: 'a', markup: '<!-- <link rel="stylesheet" href="https://x/a.css"> -->' }], 0).failures.length === 0],
		['script 正文里的字符串不算节点', () => judge([{ path: 'a', markup: `<script>var s='<link rel="stylesheet" href="https://x/b.css">';</script>` }], 0).failures.length === 0],
		['多页各自刚好在预算内必须绿，失败清单要按组合聚合', () => {
			const r = judge(Array.from({ length: 5 }, (_, i) => ({ path: `p${i}`, markup: PLAIN })), 3)
			return r.failures.length === 0 && r.maxPerPage === 0
		}],
	]

	let bad = 0
	for (const [name, fn] of cases) {
		let ok = false
		try {
			ok = !!fn()
		}
		catch (e) {
			console.error(`FAIL  ${name}\n      抛错: ${e.message}`)
			bad++
			continue
		}
		console.log(`${ok ? '  ok  ' : 'FAIL  '} ${name}`)
		if (!ok)
			bad++
	}
	console.log(`\n自检 ${cases.length} 例，${cases.length - bad} 通过，${bad} 失败`)
	if (bad)
		process.exit(1)
	process.exit(0)
}

/* ============================ 主流程 ============================ */
if (process.argv.includes('--selftest'))
	selftest()

// DIST 可能是 undefined（两个候选都不存在），existsSync(undefined) 会抛，
// 所以判空要在调用 existsSync 之前。
if (!DIST) {
	console.error('SKIP: 产物目录不存在（已找 dist/ 与 .output/public/）。先跑 pnpm build。')
	process.exit(0)
}

const pages = collectPages()
const { failures, inventory, maxPerPage } = judge(pages)

console.log(`页面 ${pages.length} 个`)
console.log(`每页第三方渲染阻塞样式表：最多 ${maxPerPage} / 上限 ${MAX_BLOCKING_THIRD_PARTY_PER_PAGE}`)
console.log('\n第三方阻塞样式表清单（页数）：')
for (const [url, n] of [...inventory].sort((a, b) => b[1] - a[1]))
	console.log(`  ${String(n).padStart(3)} 页  ${url}`)

if (failures.length) {
	console.error(`\nFAIL: ${failures.length} 项`)
	for (const f of failures) console.error(`  - ${f}`)
	process.exit(1)
}
console.log('\nPASS - 第三方阻塞资源在预算内')
console.log('RESULT: PASS')
process.exit(0)
