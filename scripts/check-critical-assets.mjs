/**
 * 关键路径资产门禁：第三方渲染阻塞资源的**条件化**必须与产物一致。
 *
 * ## 为什么有这道门禁（2026-10-07 实测）
 * `src/layouts/Base.astro` 曾把 `katex.min.css` 无条件 `<link rel="stylesheet">`
 * 在共享布局里，于是 **68 个页面里有 67 个**在渲染关键路径上扛一次第三方 CDN
 * （s4.zstatic.net）的 DNS + TLS + 约 23 KB 阻塞 CSS，换来零个公式——
 * 全站只有 `previews/example.mdx` 真渲染出 KaTeX，而那个演示页本身
 * 被 robots.txt Disallow、也被 sitemap filter 掉了。
 *
 * 改成按 `entry.data.hasMath`（remark-math 的 AST 节点判决）条件输出之后，
 * **实测 31 道门禁对这条行为零覆盖**：把 `hasMath` 强制成 `false` 注入坏版本，
 * 门禁照样全绿，是产物核对才发现公式页丢了 CSS。这就是「改完靠记忆守着」。
 *
 * ## 两条判据
 * 1. **KaTeX 双向一致性**（零白名单，硬判据）
 *    含公式的页面必须有 katex.min.css；带 katex.min.css 的页面必须有公式。
 *    两个方向都要：「漏」会让公式掉样式，「多」是纯浪费。
 * 2. **第三方阻塞资源预算**（棘轮）
 *    每页的第三方（`https://`）渲染阻塞样式表数量不得超过上限。
 *    新增一个就红；要放宽上限本身就是一行 diff，会被 review 到——
 *    与 `scripts/exemptions.json` 的 `meta.baseline` 同一套治理逻辑。
 *
 * ## 判据怎么写才不自欺（踩过的坑，逐条写在代码里）
 * - **必须先剥掉 `<!-- -->`**。本门禁的上一版原型把源码注释里的示例字符串
 *   当成了渲染节点，于是 66 个无公式页面各报一个假命中——而那段注释
 *   是 Astro **原样输出到每页 head** 的。文字提到不等于元素存在。
 * - **KaTeX 认标签不认裸字符串**：判 `<span …class="…\bkatex\b">`，
 *   不是判「HTML 里出现过 katex」。
 * - **被 `<script>` / `<style>` 正文吸走的字符串不算落点**。
 *
 * 用法：`node scripts/check-critical-assets.mjs [--selftest]`
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, '.output/public')

/**
 * 每页允许的第三方渲染阻塞样式表数量上限。**棘轮**：
 * 想放宽必须改这一行，那行 diff 就是 review 的落点。
 *
 * 2026-10-07 建门禁时的实测值是 4（inter-variable / inter /
 * fonts.googleapis.cn / fonts.bytedance）。bytedance 那条只为页脚签名，
 * 已改成 media=print 非阻塞，本数随之降到 3。
 */
const MAX_BLOCKING_THIRD_PARTY_PER_PAGE = 3

/** KaTeX 的根节点是 `<span class="katex">` */
const KATEX_NODE_RE = /<span[^>]*\bclass="[^"]*\bkatex\b[^"]*"/g
const KATEX_CSS_URL = 'katex.min.css'

/**
 * 走**判据 1**（条件资源与产物一致）的资产，不计入判据 2 的预算。
 *
 * 分工要清楚：条件资产由「双向一致性」管住——它出现在哪、就该有对应的内容；
 * 预算管的是**无条件**阻塞资源，也就是那些「每页都必须在关键路径上」的东西。
 * 两者混算会让公式页凭空超预算，而那不是缺陷，只是它确实需要那个 CSS。
 */
const CONDITIONAL_ASSETS = [KATEX_CSS_URL]

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
		if (!/rel="stylesheet"/.test(tag)) continue
		if (/media="print"/.test(tag)) continue
		const href = (tag.match(/href="(https:\/\/[^"]+)"/) || [])[1]
		if (href) out.push(href)
	}
	return out
}

/**
 * 判据核心。**纯函数**：不读盘、不碰构建产物，
 * 这样 `--selftest` 能在没有 dist/ 的情况下驱动它（不然自检就成了摆设）。
 *
 * @param {{path: string, markup: string}[]} pages 页面标记
 * @param {number} budget 每页第三方阻塞样式表上限
 * @returns {{failures: string[], inventory: Map<string, number>, maxPerPage: number}}
 */
export function judge(rawPages, budget = MAX_BLOCKING_THIRD_PARTY_PER_PAGE) {
	// 剥离在这里做、而不是留给调用方：自检第一版就把「调用方忘了剥」这个洞暴露出来了
	// （判据的正确性挂在每个调用点上 = 迟早有人传原始 HTML 进来）。
	// stripNonMarkup 幂等，已剥离过的再剥一次结果不变。
	const pages = rawPages.map(p => ({ ...p, markup: stripNonMarkup(p.markup) }))

	const failures = []
	const inventory = new Map()
	let maxPerPage = 0

	// ---- 判据 1：KaTeX 双向一致性 ----
	const withKatexNode = []
	const withKatexCss = []
	for (const p of pages) {
		if (KATEX_NODE_RE.test(p.markup)) withKatexNode.push(p.path)
		KATEX_NODE_RE.lastIndex = 0
		if (p.markup.includes(KATEX_CSS_URL)) withKatexCss.push(p.path)
	}
	const cssSet = new Set(withKatexCss)
	const missing = withKatexNode.filter(p => !cssSet.has(p))
	const waste = withKatexCss.filter(p => !withKatexNode.includes(p))
	if (missing.length)
		failures.push(`含 KaTeX 节点却没输出 ${KATEX_CSS_URL} 的页面 ${missing.length} 个：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}——公式会掉样式`)
	if (waste.length)
		failures.push(`输出了 ${KATEX_CSS_URL} 却没有公式的页面 ${waste.length} 个：${waste.slice(0, 5).join(', ')}${waste.length > 5 ? ' …' : ''}——纯浪费，且多一个第三方源进关键路径`)

	// ---- 判据 2：第三方阻塞样式表预算（棘轮） ----
	// 按「资源组合」聚合成一条失败，而不是逐页刷屏：67 个页面逐条列出来
	// 只会把真正的落点埋掉（坑位 27——失败路径要能行动，不能是日志墙）。
	const overBudget = new Map() // 组合签名 -> { urls, pages }
	for (const p of pages) {
		const all = thirdPartyBlockingStylesheets(p.markup)
		for (const u of all) inventory.set(u, (inventory.get(u) || 0) + 1)
		// 预算只数无条件阻塞的那些（见 CONDITIONAL_ASSETS 的分工说明）
		const urls = all.filter(u => !CONDITIONAL_ASSETS.some(c => u.includes(c)))
		if (urls.length > maxPerPage) maxPerPage = urls.length
		if (urls.length > budget) {
			const key = urls.join(' | ')
			if (!overBudget.has(key)) overBudget.set(key, { urls, pages: [] })
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
	const pages = []
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const f = path.join(dir, e.name)
			if (e.isDirectory()) walk(f)
			else if (e.name.endsWith('.html')) pages.push({ path: path.relative(DIST, f).replace(/\\/g, '/'), markup: fs.readFileSync(f, 'utf8') })
		}
	}
	walk(DIST)
	return pages
}

/* ============================ 自检 ============================ */
/**
 * 自检不读真实产物，只驱动 `judge`。理由：门禁自己错了而没人发现过二十多次
 * （CLAUDE.md 坑位 6）。自检覆盖的是**判据的方向性**——
 * 「漏」必须红、「多」必须红、预算超了必须红、而正确的 1:1 必须绿。
 */
function selftest() {
	const OK = '<link rel="stylesheet" href="https://x/katex@0.16.44/dist/katex.min.css">'
	const MATH = '<span class="katex"><span class="katex-mathml">x</span></span>'
	const PLAIN = '<html><head></head><body><p>hi</p></body></html>'

	const cases = [
		['正确的 1:1（公式页有 CSS，其余没有）必须绿',
			() => judge([{ path: 'a', markup: OK + MATH }, { path: 'b', markup: PLAIN }], 3).failures.length === 0],
		['漏：公式页没有 CSS 必须红',
			() => judge([{ path: 'a', markup: MATH }], 3).failures.length > 0],
		['多：没有公式却有 CSS 必须红',
			() => judge([{ path: 'a', markup: OK + PLAIN }], 3).failures.length > 0],
		['每页都挂（迁移前的真实形态）必须红',
			() => judge(Array.from({ length: 5 }, (_, i) => ({ path: `p${i}`, markup: OK + (i ? PLAIN : MATH) })), 3).failures.length > 0],
		['注释里提到 katex 不算公式节点（假阳性回归）',
			() => judge([{ path: 'a', markup: OK + '<!-- 见 class="katex" 节点 -->' }], 3).failures.length > 0],
		['script 正文里的字符串不算公式节点',
			() => judge([{ path: 'a', markup: OK + '<script>var c="katex"</script>' }], 3).failures.length > 0],
		['style 正文里的字符串不算公式节点',
			() => judge([{ path: 'a', markup: OK + '<style>.katex{color:red}</style>' }], 3).failures.length > 0],
		['注释里的公式节点不算真的（注释在公式页但无 CSS → 仍应绿）',
			() => judge([{ path: 'a', markup: '<!-- ' + MATH + ' -->' }], 3).failures.length === 0],
		['media="print" 的第三方样式表不计入阻塞预算',
			() => judge([{ path: 'a', markup: '<link rel="stylesheet" href="https://x/f.css" media="print">' }], 0).failures.length === 0],
		['预算超了必须红',
			() => judge([{ path: 'a', markup: Array.from({ length: 4 }, (_, i) => `<link rel="stylesheet" href="https://x/${i}.css">`).join('') }], 3).failures.length > 0],
		['恰好等于预算不红',
			() => judge([{ path: 'a', markup: Array.from({ length: 3 }, (_, i) => `<link rel="stylesheet" href="https://x/${i}.css">`).join('') }], 3).failures.length === 0],
		['本地相对路径样式表不计入第三方预算',
			() => judge([{ path: 'a', markup: '<link rel="stylesheet" href="/_astro/x.css">' }], 0).failures.length === 0],
		['缺失与浪费要分别报出来（双向都测）',
			() => { const r = judge([{ path: 'a', markup: MATH }, { path: 'b', markup: OK }], 3); return r.failures.length === 2 }],
		['条件资产不计入预算：公式页 3 个基础阻塞 + 1 个 katex 仍不该红',
			() => {
				const three = Array.from({ length: 3 }, (_, i) => `<link rel="stylesheet" href="https://x/${i}.css">`).join('')
				return judge([{ path: 'a', markup: OK + three + MATH }], 3).failures.length === 0
			}],
		['但条件资产出现在无公式的页上仍然红（不被预算豁免掉）',
			() => {
				const three = Array.from({ length: 3 }, (_, i) => `<link rel="stylesheet" href="https://x/${i}.css">`).join('')
				return judge([{ path: 'a', markup: OK + three + PLAIN }], 3).failures.length > 0
			}],
	]

	let bad = 0
	for (const [name, fn] of cases) {
		let ok = false
		try { ok = !!fn() }
		catch (e) { console.error(`FAIL  ${name}\n      抛错: ${e.message}`); bad++; continue }
		console.log(`${ok ? '  ok  ' : 'FAIL  '} ${name}`)
		if (!ok) bad++
	}
	console.log(`\n自检 ${cases.length} 例，${cases.length - bad} 通过，${bad} 失败`)
	if (bad) process.exit(1)
	process.exit(0)
}

/* ============================ 主流程 ============================ */
if (process.argv.includes('--selftest')) selftest()

if (!fs.existsSync(DIST)) {
	console.error(`SKIP: 产物目录不存在（${DIST}）。先跑 pnpm build。`)
	process.exit(0)
}

const pages = collectPages()
const { failures, inventory, maxPerPage } = judge(pages)

console.log(`页面 ${pages.length} 个`)
console.log(`KaTeX：含公式节点 ${pages.filter(p => (p.markup.match(KATEX_NODE_RE) || []).length > 0).length} 页，带 ${KATEX_CSS_URL} ${pages.filter(p => p.markup.includes(KATEX_CSS_URL)).length} 页`)
console.log(`每页第三方渲染阻塞样式表：最多 ${maxPerPage} / 上限 ${MAX_BLOCKING_THIRD_PARTY_PER_PAGE}`)
console.log('\n第三方阻塞样式表清单（页数）：')
for (const [url, n] of [...inventory].sort((a, b) => b[1] - a[1]))
	console.log(`  ${String(n).padStart(3)} 页  ${url}`)

if (failures.length) {
	console.error(`\nFAIL: ${failures.length} 项`)
	for (const f of failures) console.error(`  - ${f}`)
	process.exit(1)
}
console.log('\nPASS - 条件资源与产物一致，第三方阻塞资源在预算内')
console.log('RESULT: PASS')
process.exit(0)