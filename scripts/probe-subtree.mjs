/**
 * 子树逐节点几何对比：线上 Nuxt vs 本地 Astro，**只针对一个选择器**。
 *
 * ## 为什么需要它
 *
 * `compare-ui-parity.mjs` 能告诉你「这个页面差了 519px」，也能告诉你
 * 「`div.panel-anchor` 差了 9px」——但**到此为止**。它比的是 62 个写死的
 * 选择器上的 28 个 CSS 属性，不会去比某个容器内部每一层子节点的几何。
 * 于是「这 9px 是哪几个像素、从哪个盒子来的」只能靠推理。
 *
 * 这个迁移里这类问题反复出现（findings §73 是一例），所以补一个能把
 * **每个节点的矩形高、display、line-height、vertical-align 都列出来并对齐**
 * 的探针。只量一个子树，跑得比全站扫描快得多。
 *
 * ## 节点怎么对齐
 *
 * 两侧 DOM 结构不一定相同（astro-icon 渲染成 `<svg>`，unplugin-icons 渲染成
 * `<span>`），所以**不能按标签名或 class 配对**。这里按 DOM 路径（nth-child 链，
 * 如 `0/2/1`）配对：路径相同就认为是同一个逻辑位置，于是「Astro 多包了一层
 * span」会表现为路径整体错位，而不是被悄悄跳过。
 *
 * 路径对不上的节点单独列在「仅一侧存在」里——那正是结构差异本身。
 *
 * ## 两种模式
 *
 * `--mode=tree`（默认）逐节点比高度，见下面的 `subtreeProbe`。
 * `--mode=profile` 补上**垂直位置**——见 `profileProbe`。
 *
 * 为什么需要 profile：tree 模式只有「高」，没有「在哪」。
 * `/link` 的 `.link-tab` 是 274 vs 266、−8，而 tree 模式列出的每个能配对的
 * 子节点都逐值相等，于是那 8px 既不在任何子节点上、也不在根的 padding/margin 上，
 * 只能靠推理——而推理出来的结论（§52.6「外层 span 与首个 code.copy 的间距
 * 16 vs 8」）**说不清多出来的 8px 是哪个盒子给的**，也就没法改。
 * profile 模式把整棵子树铺成若干条**垂直带**（band），只在一侧出现的带直接
 * 点名差在哪个纵坐标区间，不需要配对。
 *
 * ## 用法
 *
 *   node scripts/probe-subtree.mjs --sel='.panel-anchor' --urls=/2025/10/nukitashi-gv-end
 *   node scripts/probe-subtree.mjs --sel='#blog-panel' --width=390 --height=844
 *   node scripts/probe-subtree.mjs --sel='.link-tab' --urls=/link --mode=profile --width=1600
 *
 * 不碰用户自己的 dev/preview 服务器：独立端口 4393，跑完按进程树清理。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { CDP, findBrowser, killTree, waitHttp } from './lib/cdp-session.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import { requirePreviewSlot } from './lib/preview-guard.mjs'
import { argOf } from './lib/ui-parity-args.mjs'

const REMOTE = 'https://blog.sotkg.com'
const PORT = Number(argOf('port', '4393'))
const LOCAL = `http://localhost:${PORT}`
const SELECTOR = argOf('sel')
const PATHNAME = argOf('urls', '/')
const MODE = argOf('mode', 'tree')
const VIEW_W = Number(argOf('width', '390'))
const VIEW_H = Number(argOf('height', '844'))
// 断网隔离：图片与字体都在远端 CDN 且没有占位高度，不隔离的话量出来的是加载运气
const QUERY = argOf('query', 'shuffle=false')

if (!SELECTOR) {
	console.error('用法：node scripts/probe-subtree.mjs --sel=<css> [--urls=/path] [--mode=tree|profile] [--width=390 --height=844]')
	process.exit(2)
}
if (!['tree', 'profile'].includes(MODE)) {
	console.error(`FAIL: --mode 只接受 tree / profile，收到 ${JSON.stringify(MODE)}`)
	process.exit(2)
}

const ROOT = REPO_ROOT

/*
 * 浏览器可执行文件与会话层（`CDP` / `killTree` / `waitHttp`）都在
 * `lib/cdp-session.mjs`，与 `compare-ui-parity.mjs` 共用同一份——见那里的边界说明。
 * 找不到浏览器时的报错文案仍留在本文件（本脚本写的是 chrome/edge）。
 */
const CHROME = findBrowser()
if (!CHROME) {
	console.error('FAIL: no chrome/edge')
	process.exit(1)
}

/*
 * 清理必须**无条件**发生。
 *
 * 第一版把 killTree 放在正常路径末尾，于是 evaluate() 里任何一次抛错
 * （例如被注入页面的函数引用了同文件的兄弟函数，报 ReferenceError）
 * 都会跳过清理，留下一棵 headless chrome + 一个占着 4393 的 preview。
 * 那个 preview 还会写进 Astro 的跨端口登记表，让**下一次**门禁直接起不来——
 * 仪器自己的 bug 变成了别人要花一小时才能查出的环境问题。
 *
 * 这里改成幂等的 cleanup()，同时挂 exit / 信号 / uncaughtException 三个入口。
 */
const spawned = []
let cleaned = false
function cleanup() {
	if (cleaned)
		return
	cleaned = true
	for (const p of spawned)
		killTree(p)
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		cleanup()
		process.exit(130)
	})
}
process.on('uncaughtException', (e) => {
	console.error(e)
	cleanup()
	process.exit(1)
})

// Astro 7 的 preview 有跨端口登记表，残留条目会直接挡住下一次启动。
// 登记表是**按项目**的（别的项目的 preview 不受影响），但同一项目内不能无条件 stop：
// 那会杀掉用户手动起的那一个，也会杀掉并行门禁正在用的那一个。
// 改成先问登记、只清自己端口的残留，遇到别人的直接拒绝。见 lib/preview-guard.mjs。
requirePreviewSlot({ cwd: ROOT, port: PORT })

const preview = spawn(`npx astro preview --port ${PORT}`, { cwd: ROOT, shell: true })
spawned.push(preview)
const previewLog = []
preview.stdout?.on('data', d => previewLog.push(String(d)))
preview.stderr?.on('data', d => previewLog.push(String(d)))
if (!await waitHttp(`${LOCAL}/`)) {
	console.error(`FAIL: preview never came up on ${LOCAL}`)
	console.error(previewLog.join('').slice(-1200))
	cleanup()
	process.exit(1)
}

const dbg = PORT + 1
const chrome = spawn(CHROME, [
	'--headless=new',
	`--remote-debugging-port=${dbg}`,
	`--user-data-dir=${mkdtempSync(join(tmpdir(), 'probe-subtree-'))}`,
	'--no-first-run',
	'--no-default-browser-icon',
	'--disable-gpu',
	'--hide-scrollbars',
	// 排掉会异步改变布局的东西：动画、懒加载、滚动条宽度
	'--force-prefers-reduced-motion',
	`--window-size=${VIEW_W},${VIEW_H}`,
	'about:blank',
], { stdio: 'ignore' })
spawned.push(chrome)

async function waitDevtools(ms = 30000) {
	const dl = Date.now() + ms
	while (Date.now() < dl) {
		try {
			const j = await (await fetch(`http://127.0.0.1:${dbg}/json/version`, { signal: AbortSignal.timeout(2000) })).json()
			return j.webSocketDebuggerUrl
		}
		catch { /* 还没起来 */ }
		await sleep(250)
	}
	return null
}

const wsUrl = await waitDevtools()
if (!wsUrl) {
	console.error('FAIL: devtools never came up')
	cleanup()
	process.exit(1)
}

const cdp = await CDP.connect(wsUrl)
const sid = await cdp.openPage()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false }, sid)

async function evaluate(expression) {
	const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sid)
	if (exceptionDetails)
		throw new Error(exceptionDetails.exception?.description || exceptionDetails.text)
	return result.value
}

function withQuery(u) {
	return `${u}${u.includes('?') ? '&' : '?'}${QUERY}`
}

/**
 * 走一遍子树，每个节点给出签名 + 矩形 + 几个最可能造成高度差的属性。
 * 只取盒模型与行盒相关的属性：display / line-height / vertical-align / font-size。
 *
 * ## 键为什么不是 nth-child 路径
 *
 * 第一版按 `el.children` 序号配对，两处都栽了：
 *
 * 1. Astro 内联的 `<script>` 会把后面所有下标整体顶偏一格，量出来是一堆
 *    毫无意义的 ±25.6 互相抵消，而真正的 8px 藏在噪声里。
 * 2. 就算跳过 script，**两侧顶层子元素数量不同**时照样错位——`/link` 上
 *    Nuxt 多一个 3px 的子元素，于是 nuxt[4]=1880.8 实际对应 astro[3]=1872.8，
 *    而按序号配出来的是 nuxt[3]=1000 ↔ astro[3]=1872.8，纯属胡说。
 *
 * 改成**类名签名 + 同签名出现序号**：`tag.class` 逐级拼上去，同一层里签过名的
 * 兄弟再按出现次序加后缀。类名比下标稳定得多——结构分叉只影响下标，而两边
 * 照抄自同一套源码，类名通常是对齐的。
 *
 * 代价：同层同名同标签的兄弟仍靠出现次序配对，那部分退化成 nth-child 语义。
 * 实测上这比原来的纯序号好得多，剩余不可配对的一律进「仅一侧存在」。
 */
function subtreeProbe(sel) {
	const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
	const root = document.querySelector(sel)
	if (!root)
		return null
	const rows = []
	const walk = (el, sig) => {
		const cs = getComputedStyle(el)
		const r = el.getBoundingClientRect()
		rows.push({
			path: sig,
			tag: el.tagName.toLowerCase(),
			cls: (el.getAttribute('class') || '').slice(0, 60),
			h: Math.round(r.height * 10) / 10,
			w: Math.round(r.width * 10) / 10,
			display: cs.display,
			lineHeight: cs.lineHeight,
			verticalAlign: cs.verticalAlign,
			fontSize: cs.fontSize,
			// 外边距/内边距要单独看。差值常等于 0.5em 这类量时，
			// 几乎总是 margin 塌陷穿过了一层包装 div——而只报矩形高是看不出来的。
			marginTop: cs.marginTop,
			marginBottom: cs.marginBottom,
			paddingTop: cs.paddingTop,
			paddingBottom: cs.paddingBottom,
			hidden: el.hasAttribute('hidden'),
		})
		const seen = new Map()
		for (const c of el.children) {
			if (SKIP.has(c.tagName))
				continue
			const base = `${c.tagName.toLowerCase()}${c.getAttribute('id') ? `#${c.getAttribute('id')}` : ''}.${(c.getAttribute('class') || '').trim().split(/\s+/)[0] || '-'}`
			const n = (seen.get(base) || 0) + 1
			seen.set(base, n)
			walk(c, `${sig}/${base}${n > 1 ? `~${n}` : ''}`)
		}
	}
	walk(root, 'ROOT')
	return rows
}

/**
 * 垂直剖面：把子树铺成若干条**水平带**（band），并给每条带点名是哪些节点撑出来的。
 *
 * ## 为什么不配对
 *
 * tree 模式靠「类名签名 + 出现序号」把两侧节点对上，但结构一有分叉就错位
 * （Astro 多一层 `div.tab-panel`、复制按钮多一个 svg），错位之后「高度差」那一列
 * 报出来的多半是配对错误，不是真的差。剖面绕开配对：**只关心纵坐标区间**。
 *
 * ## 带是怎么算的
 *
 * 收集根下所有非 `display:none` 后代元素的 `[top, bottom]`（页面绝对坐标，已加
 * `scrollY`），按 top 排序后合并所有**相交或相接**的区间。合并后剩下的就是
 * 「从根顶往下，这一整列上真正被内容占住的每一段」——根高度里没被任何带覆盖的
 * 空隙，就是 padding / margin / 行盒空白。
 *
 * 再把每条带里**最深的那个节点**（深度最大、同深度取最后一个）报出来当 owner：
 * 一条只在一侧出现的带，owner 就是差的那几个像素的来源。
 *
 * 坐标全部减掉根的 top，于是两侧的带可以直接对区间比较，根的绝对位置不影响结果。
 */
function profileProbe(sel) {
	const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
	const root = document.querySelector(sel)
	if (!root)
		return null
	const sy = window.scrollY
	const sx = window.scrollX
	const nodes = []
	const walk = (el, path, depth) => {
		if (SKIP.has(el.tagName))
			return
		const cs = getComputedStyle(el)
		const r = el.getBoundingClientRect()
		const top = r.top + sy
		const bottom = r.bottom + sy
		nodes.push({
			path,
			depth,
			tag: el.tagName.toLowerCase(),
			cls: (el.getAttribute('class') || '').slice(0, 48),
			top: Math.round(top * 10) / 10,
			bottom: Math.round(bottom * 10) / 10,
			h: Math.round(r.height * 10) / 10,
			display: cs.display,
			float: cs.float,
			position: cs.position,
			marginTop: cs.marginTop,
			marginBottom: cs.marginBottom,
			paddingTop: cs.paddingTop,
			paddingBottom: cs.paddingBottom,
			// 匿名行盒/inline 元素最容易被忽略：display 不是 block 也能撑出高度
			isInline: cs.display.startsWith('inline'),
		})
		if (nodes[nodes.length - 1].display === 'none')
			return
		const seen = new Map()
		for (const c of el.children) {
			const base = `${c.tagName.toLowerCase()}.${(c.getAttribute('class') || '').trim().split(/\s+/)[0] || '-'}`
			const n = (seen.get(base) || 0) + 1
			seen.set(base, n)
			walk(c, `${path}/${base}${n > 1 ? `~${n}` : ''}`, depth + 1)
		}
	}
	walk(root, 'ROOT', 0)

	const rootTop = nodes[0].top
	const rootBottom = nodes[0].bottom
	// 只保留真正有高度的盒子；padding/margin 不产生盒子，边距靠「带之间的空隙」体现
	const boxes = nodes
		.filter(n => n.h > 0.05 && n.bottom > n.top + 0.05)
		.map(n => ({ ...n, top: n.top - rootTop, bottom: n.bottom - rootTop }))
		.sort((a, b) => a.top - b.top || a.bottom - b.bottom)

	// 合并相交/相接的区间；每条带记下最深的 owner
	const bands = []
	for (const b of boxes) {
		const last = bands[bands.length - 1]
		if (last && b.top <= last.bottom + 0.05) {
			last.bottom = Math.max(last.bottom, b.bottom)
			if (b.depth > last.owner.depth || (b.depth === last.owner.depth && b.path > last.owner.path))
				last.owner = b
			// 记下所有恰好构成这条带边界的节点，方便定位「谁结束了这一段」
			if (Math.abs(b.bottom - last.bottom) < 0.05)
				last.enders.push(b)
		}
		else {
			bands.push({ top: b.top, bottom: b.bottom, owner: b, enders: [] })
		}
	}
	for (const band of bands) {
		band.h = Math.round((band.bottom - band.top) * 10) / 10
	}

	// 根的直接子节点 + 与前一个可见子节点之间的空隙：空隙是「差值最可能藏的地方」
	const kids = []
	let prevBottom = 0
	for (const b of boxes.filter(n => n.depth === 1).sort((a, b) => a.top - b.top)) {
		kids.push({ ...b, gap: Math.round((b.top - prevBottom) * 10) / 10 })
		prevBottom = Math.max(prevBottom, b.bottom)
	}

	// 带与带之间的空隙 = 根高里没被任何盒子占住的部分，也就是 margin / padding /
	// 行盒空白。这些地方不产生盒子，纯靠盒子高度是永远看不到的。
	//
	// `gapsOf` 必须**内联**在这里而不是抽成同文件兄弟函数：这个函数整体被
	// `.toString()` 注入页面执行，页面里没有模块作用域，兄弟函数一律 ReferenceError。
	// （第一版就是踩了这个：报 `gapsOf is not defined`，白跑一轮 preview + chrome。）
	const gapsOf = (bs, rootH) => {
		const out = []
		let cursor = 0
		for (const b of bs) {
			if (b.top - cursor > 0.05)
				out.push({ top: Math.round(cursor * 10) / 10, bottom: Math.round(b.top * 10) / 10, h: Math.round((b.top - cursor) * 10) / 10 })
			cursor = Math.max(cursor, b.bottom)
		}
		if (rootH - cursor > 0.05)
			out.push({ top: Math.round(cursor * 10) / 10, bottom: Math.round(rootH * 10) / 10, h: Math.round((rootH - cursor) * 10) / 10 })
		return out
	}

	return {
		rootTop,
		rootH: Math.round((rootBottom - rootTop) * 10) / 10,
		scrollW: Math.round((document.documentElement.scrollWidth - sx) * 10) / 10,
		bands: bands.map(({ top, bottom, h, owner, enders }) => ({
			top: Math.round(top * 10) / 10,
			bottom: Math.round(bottom * 10) / 10,
			h,
			owner: `${owner.tag}.${owner.cls || '-'}`,
			ownerPath: owner.path,
			ender: enders.length ? `${enders[enders.length - 1].tag}.${enders[enders.length - 1].cls || '-'}` : '',
		})),
		gaps: gapsOf(bands, rootBottom - rootTop),
		kids: kids.map(k => ({
			path: k.path,
			tag: k.tag,
			cls: k.cls,
			top: k.top,
			bottom: k.bottom,
			h: k.h,
			gap: k.gap,
			display: k.display,
			float: k.float,
			marginTop: k.marginTop,
			marginBottom: k.marginBottom,
			paddingTop: k.paddingTop,
			paddingBottom: k.paddingBottom,
		})),
	}
}

async function side(url) {
	await cdp.send('Page.navigate', { url }, sid)
	for (let i = 0; i < 150; i++) {
		if (await evaluate('document.readyState') === 'complete')
			break
		await sleep(200)
	}
	await sleep(2000)
	if (!await evaluate('!!document.getElementById("blog-root")'))
		return null
	const fn = MODE === 'profile' ? profileProbe : subtreeProbe
	return evaluate(`(${fn.toString()})(${JSON.stringify(SELECTOR)})`)
}

/** profile 模式的报告：两侧并排打直接子节点（含空隙），再逐条比对垂直带 */
function reportProfile(n, a) {
	const r1 = x => Math.round(x * 10) / 10
	console.log(`\n=== 根 ===`)
	console.log(`  高 nuxt ${n.rootH}  astro ${a.rootH}  d ${r1(a.rootH - n.rootH)}`)
	console.log(`  宽 nuxt ${n.scrollW}  astro ${a.scrollW}  d ${r1(a.scrollW - n.scrollW)}`)

	console.log(`\n=== 直接子节点（纵坐标相对根顶；gap = 与前一个可见子节点之间的空隙）===`)
	const maxK = Math.max(n.kids.length, a.kids.length)
	const line = (k, pad) => {
		if (!k)
			return ' '.repeat(pad)
		return `top ${String(k.top).padStart(7)} bot ${String(k.bottom).padStart(7)} h ${String(k.h).padStart(6)} gap ${String(k.gap).padStart(5)}  ${k.display.padEnd(11)} m${`${k.marginTop}/${k.marginBottom}`.padEnd(15)} p${`${k.paddingTop}/${k.paddingBottom}`.padEnd(13)} ${k.tag}.${k.cls || '-'}`
	}
	const tag = (k, side) => `${(k ? side : '—').padEnd(7)}`
	for (let i = 0; i < maxK; i++) {
		const nk = n.kids[i]
		const ak = a.kids[i]
		console.log(`  [${i}] ${tag(nk, 'nuxt')}${line(nk, 0)}`)
		console.log(`      ${tag(ak, 'astro')}${line(ak, 0)}`)
	}

	console.log(`\n=== 垂直带（合并后的实际占位区间）===`)
	const showBands = (label, bands) => {
		console.log(`  -- ${label} (${bands.length} 条) --`)
		for (const b of bands)
			console.log(`     top ${String(b.top).padStart(7)} bot ${String(b.bottom).padStart(7)} h ${String(b.h).padStart(6)}  ${b.owner.padEnd(30)} ${b.ownerPath.slice(-40)}`)
	}
	showBands('线上', n.bands)
	showBands('Astro', a.bands)

	// 只在一侧出现的带 = 差值的来源。容差 1px：亚像素取整不该被判成差异
	const match = (x, y) => Math.abs(x.top - y.top) <= 1 && Math.abs(x.bottom - y.bottom) <= 1
	const onlyN = n.bands.filter(x => !a.bands.some(y => match(x, y)))
	const onlyA = a.bands.filter(x => !n.bands.some(y => match(x, y)))
	console.log(`\n=== 只在一侧出现的带 ===`)
	console.log(`  线上独有 ${onlyN.length} 条 / Astro 独有 ${onlyA.length} 条`)
	for (const b of onlyN)
		console.log(`  仅线上 top ${String(b.top).padStart(7)} bot ${String(b.bottom).padStart(7)} h ${String(b.h).padStart(6)}  owner ${b.owner.padEnd(28)} ${b.ownerPath.slice(-40)}`)
	for (const b of onlyA)
		console.log(`  仅 Astro top ${String(b.top).padStart(7)} bot ${String(b.bottom).padStart(7)} h ${String(b.h).padStart(6)}  owner ${b.owner.padEnd(28)} ${b.ownerPath.slice(-40)}`)

	console.log(`\n=== 空隙（没被任何盒子占住的部分：margin / padding / 行盒空白）===`)
	const showGaps = (label, gaps) => {
		const tot = r1(gaps.reduce((s, g) => s + g.h, 0))
		console.log(`  -- ${label} -- ${gaps.length} 处，合计 ${tot}`)
		for (const g of gaps)
			console.log(`     top ${String(g.top).padStart(7)} bot ${String(g.bottom).padStart(7)} h ${String(g.h).padStart(6)}`)
		return tot
	}
	const gN = showGaps('线上', n.gaps)
	const gA = showGaps('Astro', a.gaps)

	/*
	 * 对账：**垂直带必须正好铺满根盒子**。
	 *
	 * 第一版写的是「占住的高度差 + 空隙的高度差 == 根高差」——那是**恒等式**：
	 * `covered` 与 `gaps` 都是从 `rootH` 反推的（`covered = rootH - gaps`），
	 * 于是 `explained` 恒等于 `rootDelta`，守卫永远不会触发。
	 * 「没被看过变红的守卫等于没有守卫」这条，这次是在自己身上又犯了一次。
	 *
	 * 真正的不变式是：所有后代的矩形应当**不越出**根盒子。
	 * 一旦有节点越界（`position: absolute` 戳出下沿、`transform` 溢出、
	 * 负 margin 顶出上沿），「带 + 空隙」就不再是根高的一个划分，
	 * 上面那份差值分解也就没有意义了——这时必须报错退出，而不是给结论。
	 */
	const overN = n.bands.reduce((s, b) => s + Math.max(0, b.bottom - n.rootH), 0)
	const overA = a.bands.reduce((s, b) => s + Math.max(0, b.bottom - a.rootH), 0)
	const rootDelta = r1(a.rootH - n.rootH)
	const covN = Math.round((n.bands.reduce((s, b) => s + b.h, 0)) * 10) / 10
	const covA = Math.round((a.bands.reduce((s, b) => s + b.h, 0)) * 10) / 10
	console.log('\n=== 对账 ===')
	console.log(`  带高合计  nuxt ${covN}（根 ${n.rootH}）  astro ${covA}（根 ${a.rootH}）`)
	console.log(`  空隙合计  nuxt ${gN}   astro ${gA}`)
	console.log(`  根高      nuxt ${n.rootH}  astro ${a.rootH}  d ${rootDelta}`)
	if (overN > 0.5 || overA > 0.5) {
		console.log(`\n  !! FAIL 有后代越出根盒子：线上越出 ${Math.round(overN * 10) / 10}px、Astro 越出 ${Math.round(overA * 10) / 10}px。`)
		console.log('     绝对定位 / transform / 负 margin 之类让矩形跑到了根之外，')
		console.log('     于是「带 + 空隙」不再是根高的划分，上面的差值分解不可采信。')
		process.exitCode = 3
	}
	else {
		console.log('  带与空隙正好铺满根盒子，上面的条目可直接采信。')
	}
}

console.log(`\n子树探针  ${SELECTOR}  on  ${PATHNAME}  @ ${VIEW_W}x${VIEW_H}  mode=${MODE}\n`)
const nuxt = await side(withQuery(REMOTE + PATHNAME))
const astro = await side(withQuery(LOCAL + PATHNAME))
cleanup()

if (!nuxt || !astro) {
	console.error(`FAIL: ${PATHNAME} 有一侧没有正常渲染，不产出结论（nuxt=${!!nuxt} astro=${!!astro}）`)
	process.exit(1)
}

if (MODE === 'profile') {
	reportProfile(nuxt, astro)
	// 保留 reportProfile 设的 exitCode=3（剖面解释不掉根差），
	// 写死 exit(0) 会把「仪器不可信」这个信号吞掉——正是本项目反复吃过的那类亏。
	process.exit(process.exitCode || 0)
}

const nMap = new Map(nuxt.map(r => [r.path, r]))
const aMap = new Map(astro.map(r => [r.path, r]))
const allPaths = [...new Set([...nMap.keys(), ...aMap.keys()])].sort(
	(a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
)

const rows = []
for (const p of allPaths) {
	const n = nMap.get(p)
	const a = aMap.get(p)
	const d = n && a ? Math.round((a.h - n.h) * 10) / 10 : null
	rows.push({ p, n, a, d })
}

const onlyOneSide = rows.filter(r => !r.n || !r.a)
const both = rows.filter(r => r.n && r.a)
const heightDiffs = both.filter(r => Math.abs(r.d) > 0.05)

console.log('=== 逐节点 ===')
// 签名路径可能很长，只显示最有辨识度的尾部（根和最外层已由选择器给出）
const shortPath = p => (p.length <= 46 ? p : `…${p.slice(-45)}`)
const has = x => (x ? `${x.tag}.${x.cls || '-'}`.slice(0, 34) : '(缺)')
for (const r of rows) {
	if (!r.n || !r.a) {
		// 单侧节点也要打高度。原先只打名字，于是「Astro 那个多出来的包装层
		// 到底有多高」根本看不到——而这恰恰是判断它是 display:none 还是
		// 真的占了位所必需的那一个数。
		const x = r.n || r.a
		const h = r.n ? `h ${String(r.n.h).padStart(7)}` : `h ${' '.repeat(7)}`
		const h2 = r.a ? `h ${String(r.a.h).padStart(7)}` : `h ${' '.repeat(7)}`
		console.log(`  ${(r.n ? '仅线上' : '仅 Astro').padEnd(7)} ${shortPath(r.p).padEnd(47)} nuxt ${h}  astro ${h2}  ${x.display.padEnd(11)} m${x.marginTop.padEnd(7)} ${has(x)}`)
		continue
	}
	const mark = Math.abs(r.d) > 0.05 ? '  <== 高度差' : ''
	const mbox = (r.n.marginTop === r.a.marginTop && r.n.marginBottom === r.a.marginBottom) ? '' : `  <margin nuxt ${r.n.marginTop}/${r.n.marginBottom} vs astro ${r.a.marginTop}/${r.a.marginBottom}>`
	console.log(`  ${shortPath(r.p).padEnd(47)} h nuxt ${String(r.n.h).padStart(7)}  astro ${String(r.a.h).padStart(7)}  d ${String(r.d).padStart(6)}  ${r.n.display.padEnd(11)} m${r.n.marginTop.padEnd(7)}${mark}${mbox}`)
}

console.log('\n=== 汇总 ===')
console.log(`  节点总数        : nuxt ${nuxt.length} / astro ${astro.length}`)
console.log(`  仅一侧存在      : ${onlyOneSide.length}`)
console.log(`  高度有差异的节点: ${heightDiffs.length}`)
const rootDelta = rows.find(r => r.p === 'ROOT')
console.log(`  根节点高度差    : ${rootDelta ? rootDelta.d : '(根缺失)'}`)
const sum = heightDiffs.filter(r => r.p !== 'ROOT').reduce((s, r) => s + r.d, 0)
console.log(`  子节点差值之和  : ${Math.round(sum * 10) / 10}`)
console.log('\n  注意：子节点差值之和通常不等于根差——有 padding / margin / 定位元素时')
console.log('  两者本就不同。看哪一层对得上，比看总数有用。')
