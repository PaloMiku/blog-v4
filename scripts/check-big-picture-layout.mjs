import { spawn, spawnSync } from 'node:child_process'
import fs, { existsSync } from 'node:fs'
import path from 'node:path'
/**
 * 门禁：大屏模式的布局不变量（阅读态收栏 + 断点单一来源）。
 *
 * ## 这条门禁在防什么
 * 大屏阅读态把两侧栏收成抽屉、正文居中 860px。这个布局曾经**完全不被任何东西守着**：
 * 它由 CSS 层叠决定，而 Task 6 首版用一个「重复 `[data-big-picture]` 抬特异性」的写法
 * 让它压过三栏规则——看起来像手误，实际是当时唯一能让它生效的办法。
 * 实测把产物里那个重复选择器去掉，正文立刻从 860px 掉回 **457px**，
 * 而**全套门禁 17/17 全绿、`pnpm test` 374/374 全过**：没有任何一道门禁或测试
 * 读这个布局。于是它靠「一个像笔误的选择器」撑着，被任何 minifier、手抖的清理、
 * 或者一次重构静默还原，而且**当场没有任何东西会红**。
 *
 * 这正是规格写的「只扫描属性不能作为功能通过依据」——
 * `check-layout` 扫的是 `id="blog-root"` 与 `--c-primary` 这类**标记**，
 * 而「正文有没有被压到 457px」是**计算后的几何**，扫不出来。
 *
 * ## 判据：真在浏览器里量，不扫选择器
 * 起 preview + 无头 Chrome，把页面切进大屏阅读态，量 `#main-content` 的实际宽度。
 * 宽度来自 `getComputedStyle` / `getBoundingClientRect`，
 * 因此**无论 CSS 怎么改写、怎么分层叠、怎么被 minifier 变形，判据都成立**。
 * 扫描选择器的门禁在这里一律没用——上一版的失败恰恰是「选择器还在、行为已经错了」。
 *
 * ## 覆盖的断点
 * 1600×1000 / 1280×800（Steam Deck）/ 800×600 / 390×844。
 * 规格把 Steam Deck 的 1280×800 单独点了名，而 Task 6 首版的 ≤768 档是
 * 「碰巧」被压住的——窄屏必须一起量，否则下一次有人加一条移动端规则就会静默破掉它。
 *
 * ## 为什么它不能自我跳过
 * 1. **不读任何基线文件。** 判据是「正文宽度 ≤ 860px」这个规格常量，
 *    拿 Nuxt 冻结基线或 `.output/` 快照当锚会让它在本机与 CI 上表现不同。
 * 2. **不联网。** 只连 `localhost` 的 preview，与 `check-runtime-dom` 同一条约束。
 * 3. **失败不是「跳过」。** 缺产物 / 起不来 preview / Chrome 不存在都 `exit 1`，
 *    输出第一行以 `RESULT:` 或 `FAIL` 开头，**绝不**输出 `SKIP:`——
 *    `accept.mjs` 用 `/^SKIP(?:PED)?\b/m` 判定「这道门禁自己放弃了」，
 *    本门禁一旦能自我跳过，它就会被记成 skipped，而 `skip: 'never'` 下
 *    违规跳过会让整轮红——但那是在浪费一整轮构建之后才发现它其实没跑。
 *    与其如此，不如让它当场红。
 *
 * ## 与 `check-runtime-dom` 的分工
 * 那道门禁量的是「交互之后计算样式有没有漂移」，视口固定在桌面；
 * 本道量的是「大屏模式在四个断点上的布局」，两者测的不是同一件事。
 */
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { REPO_ROOT, resolveDistDir } from './lib/paths.mjs'
import { requirePreviewSlot } from './lib/preview-guard.mjs'

const ROOT = REPO_ROOT
const PORT = 4409
const LOCAL = `http://localhost:${PORT}`
const DEBUG_PORT = 9419

/** 规格值：阅读态正文列宽上限。改这里之前先改 `big-picture.css` 的 `--bp-reading-max`。 */
const READING_MAX_WIDTH = 860

/**
 * 四个断点。宽度取规格与 Task 8 点名的视口；高度只影响抽屉可视高度，
 * 这里给一个不会触发浏览器缩放的值（≥1024 用 800，窄屏用 844）。
 */
const VIEWPORTS = [
	{ width: 1600, height: 1000, label: '1600x1000' },
	{ width: 1280, height: 800, label: '1280x800 (Steam Deck)' },
	{ width: 800, height: 600, label: '800x600' },
	{ width: 390, height: 844, label: '390x844' },
]

const CHROME = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	'/usr/bin/google-chrome',
	'/usr/bin/google-chrome-stable',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/usr/bin/microsoft-edge',
].find(p => existsSync(p))

function die(msg) {
	console.log(`  FAIL  ${msg}`)
	console.log('')
	console.log(`RESULT: FAIL - ${msg}`)
	process.exit(1)
}

if (!CHROME)
	die('没有找到 Chrome/Edge —— 本门禁需要真实浏览器，无法降级为静态检查')
if (!resolveDistDir())
	die('dist/ 不存在，产物没构建 —— 先跑 pnpm build')

/* ── 断点单一来源：CSS 与 JS 必须逐字一致 ──────────────────────────
 * `LAYOUT_BREAKPOINTS` 在 `src/lib/layout-state.ts`，
 * 媒体查询在 `src/styles/big-picture.css` 的 `@media` 里。
 * 漂移的症状是「抽屉已滑出画布却仍可 Tab 进去」——
 * CSS 以为它是抽屉、JS 以为它是常驻列，收起时就没写 `inert`。
 */
const cssFiles = (existsSync(path.join(ROOT, 'dist', '_astro')) ? fs.readdirSync(path.join(ROOT, 'dist', '_astro')) : [])
	.filter(f => f.endsWith('.css'))
const cssAll = cssFiles.map(f => fs.readFileSync(path.join(ROOT, 'dist', '_astro', f), 'utf8')).join('\n')

let fail = 0
const ok = msg => console.log(`  OK    ${msg}`)
function bad(msg) {
	console.log(`  FAIL  ${msg}`)
	fail++
}

console.log('--- 1. 断点单一来源（CSS @media ↔ layout-state.ts 常量）---')
{
	const stateSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'layout-state.ts'), 'utf8')
	for (const [key, value] of [['sidebar', '768'], ['aside', '1080']]) {
		const js = new RegExp(`${key}:\\s*'${value}px'`).test(stateSrc)
		if (!js) {
			bad(`${key} 断点 ${value}px 不在 layout-state.ts 的 LAYOUT_BREAKPOINTS 里`)
			continue
		}
		// CSS 侧只认产物里的媒体查询；`:root[data-big-picture]` 的档位都写了这两个值
		const hits = (cssAll.match(new RegExp(`@media \\(width<=${value}px\\)`, 'g')) || []).length
		if (hits === 0) {
			bad(`${key} 断点 ${value}px 在产物 CSS 里没有对应的 @media`)
		}
		else {
			ok(`${key} 断点 ${value}px：JS 常量与 CSS @media 都在（${hits} 处）`)
		}
	}
}

console.log('--- 2. 阅读态栅格走独立变量（不与档位规则共用属性）---')
{
	// 消费点必须优先读阅读变量：这是「阅读态由构造保证」的全部依据
	if (/grid-template-columns:\s*var\(--bp-reading-grid,\s*var\(--bp-grid-columns\)\)/.test(cssAll))
		ok('消费点是 var(--bp-reading-grid, var(--bp-grid-columns)) —— 阅读态优先')
	else bad('消费点不是 var(--bp-reading-grid, var(--bp-grid-columns))：阅读态又要和三栏规则抢同一个属性了')

	// 反面：档位规则里不得出现裸 grid-template-columns（那会重新制造竞争）。
	// 只数**大屏那段样式**——组件自己的 CSS（`.archive-list`、`.feed-list` 等）
	// 合法地写了很多 grid-template-columns，全局计数会把它们算进来。
	const bpBlocks = [...cssAll.matchAll(/:root\[data-big-picture\][^{}]*\{[^}]*\}/g)].map(m => m[0])
	const tierDecl = bpBlocks.filter(b => /grid-template-columns\s*:/.test(b)).length
	const readingDecl = (cssAll.match(/--bp-reading-grid\s*:/g) || []).length
	// 合法的一共三处：§4 的消费点、§7 首页的 `[data-post-menu]` 两列卡片、
	// §7 友链的 `.feed-list`。多出来的就是档位规则又直接写栅格了。
	if (tierDecl <= 3)
		ok(`大屏样式里只有 ${tierDecl} 处 grid-template-columns 声明（消费点 + 两个页型变体）`)
	else bad(`大屏样式里有 ${tierDecl} 处 grid-template-columns 声明，档位规则可能又直接写栅格了`)
	if (readingDecl >= 1)
		ok(`--bp-reading-grid 有 ${readingDecl} 处声明（§6 阅读态）`)
	else bad('产物里找不到 --bp-reading-grid 声明，§6 可能整段丢了')
}

/* ── 真在浏览器里量 ─────────────────────────────────────────────── */

const astroBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'astro.cmd' : 'astro')
const userDataDir = path.join(ROOT, '.astro-compare', 'bp-layout-profile')

function killTree(child) {
	try {
		spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
	}
	catch {}
	try {
		process.kill(-child.pid)
	}
	catch {}
}

async function waitHttp(url, tries = 40) {
	for (let i = 0; i < tries; i++) {
		try {
			const r = await fetch(url)
			if (r.ok)
				return true
		}
		catch {}
		await sleep(500)
	}
	return false
}

// preview 的登记表是按项目的：走 preview-guard 协商，而不是无条件 stop。
//
// 原先这里是 `npx astro preview stop` 无条件停掉本项目任何 preview——那正是
// lib/preview-guard.mjs 文件头点名批评的做法：它不看端口，会把用户为**本项目**
// 手动起的那一个也杀掉，违反「preview 启停由用户管理」这条硬约束。
// requirePreviewSlot 只在登记的端口是自己要用的 4409 时才 stop，别人的直接 exit 2。
requirePreviewSlot({ cwd: ROOT, port: PORT })
fs.rmSync(userDataDir, { recursive: true, force: true })

const preview = spawn(astroBin, ['preview', '--port', String(PORT)], { cwd: ROOT, shell: process.platform === 'win32', stdio: 'ignore' })
// Chrome 的句柄本身从不被读取（一切都走 CDP），但 `cleanup()` 要用它来 killTree。
// 放进 `handles` 里，`cleanup` 从同一个对象取——这样「被用到了」是字面可见的。
const handles = { preview }
handles.chrome = spawn(CHROME, [
	'--headless=new',
	`--remote-debugging-port=${DEBUG_PORT}`,
	`--user-data-dir=${userDataDir}`,
	// 首启抑制：干净 runner 上 Chrome 会走首次运行流程（选默认浏览器、弹默认
	// profile 提示），那套流程在 page target 注册**之前**就占住进程，于是
	// 下面那个 CDP 轮询 10s 全空 → 「Chrome 没起来」→ exit 1。
	// 2026-10-14 CI 红灯：本地 Windows 上一直绿，干净 ubuntu runner 上第一次
	// 量就红。check-runtime-dom 在同一台 runner 上一直稳，靠的就是这两条。
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'--window-size=1600,1000',
	'about:blank',
], { stdio: 'ignore' })

async function cleanup(code) {
	killTree(handles.preview)
	killTree(handles.chrome)
	// 清掉**自己**起的那条 preview 登记。killTree 只杀进程、不碰 Astro 的登记表，
	// 而 lib/preview-guard.mjs 读的是登记表 —— 不清就会变成孤儿记录，让后面
	// check-runtime-dom 把这条陈旧登记误判成「用户手动起的 preview」而 exit 2。
	// 2026-10-14 CI 红灯就是这个：两道门禁抢同一个项目的登记表，前一道退出时
	// 没清，后一道（列表里的第 19 道）拒绝启动。
	//
	// 停它不会误伤用户的 preview：`astro preview stop` 本身不带端口过滤，
	// 但走到这里的前提是 requirePreviewSlot 刚放行、本门禁紧接着成功占了 4409，
	// 此刻登记表里那条就是本门禁自己写的。用户的 preview 只在两种情况下会挡路——
	// 停在别的端口（那时 stop 恰好清的是自己的残留），或停在 4409（那时本门禁在
	// requirePreviewSlot 就 exit 2 了，根本走不到 cleanup）。
	spawnSync('npx', ['astro', 'preview', 'stop'], { cwd: ROOT, shell: true, stdio: 'ignore' })
	// Chrome 退出后 Windows 还会短暂持有 user-data-dir 里的文件句柄
	// （`check-runtime-dom.mjs` 的头注记着同一件事：crashpad / 文件句柄
	// 往往要等一会儿才释放）。删不掉就算了——它落在 `.astro-compare/` 下，
	// 是构建期临时目录，不入库，也不该让清理失败把门禁判红。
	for (let i = 0; i < 5; i++) {
		try {
			fs.rmSync(userDataDir, { recursive: true, force: true })
			break
		}
		catch {
			await sleep(300)
		}
	}
	process.exit(code)
}

if (!await waitHttp(`${LOCAL}/`)) {
	console.log('  FAIL  preview 起不来，本门禁没有量到任何东西')
	await cleanup(1)
}

let targets = []
for (let i = 0; i < 40; i++) {
	try {
		targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
		if (targets.some(t => t.type === 'page'))
			break
	}
	catch {}
	await sleep(250)
}
const pageTarget = targets.find(t => t.type === 'page')
if (!pageTarget) {
	console.log('  FAIL  Chrome 没起来（CDP 无 page target），本门禁没有量到任何东西')
	await cleanup(1)
}

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((res, rej) => {
	ws.addEventListener('open', res)
	ws.addEventListener('error', rej)
})
let msgId = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
	const m = JSON.parse(e.data)
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m)
		pending.delete(m.id)
	}
})
function send(method, params = {}) {
	const i = ++msgId
	return new Promise((res) => {
		pending.set(i, res)
		ws.send(JSON.stringify({ id: i, method, params }))
	})
}
async function evaluate(expr) {
	const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
	if (r.result?.exceptionDetails)
		return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }
	return { value: r.result?.result?.value }
}

// 阅读态模拟：Task 7 之前所有页面的 `bigPicturePage` 都是 'off'，
// 所以这里手动置位——与 Task 6 首版的量测用的是同一手法。
const ENTER_READING = `(() => {
  document.documentElement.setAttribute('data-big-picture', 'active')
  const main = document.querySelector('main#main-content')
  if (!main) return 'no #main-content'
  main.setAttribute('data-big-picture-page', 'reading')
  return 'ok'
})()`

const PROBE = `(() => {
  const main = document.querySelector('main#main-content')
  const root = document.querySelector('#blog-root')
  if (!main || !root) return { error: 'missing #main-content/#blog-root' }
  const r = main.getBoundingClientRect()
  const cs = getComputedStyle(main)
  const cols = getComputedStyle(root).gridTemplateColumns.trim().split(/\\s+/).length
  const side = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const s = getComputedStyle(el)
    return { pos: s.position, vis: s.visibility }
  }
  return {
    width: Math.round(r.width * 100) / 100,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    rootColumns: cols,
    sidebar: side('#blog-sidebar'),
    aside: side('#blog-aside'),
  }
})()`

console.log('--- 3. 阅读态实测几何（四个断点）---')
for (const vp of VIEWPORTS) {
	await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false })
	await send('Page.navigate', { url: `${LOCAL}/2025/11/riddle-joker/` })
	for (let i = 0; i < 40; i++) {
		await sleep(250)
		const r = await evaluate(`document.readyState === 'complete' && !!document.querySelector('main#main-content')`)
		if (r.value === true)
			break
	}
	await sleep(600)
	const entered = await evaluate(ENTER_READING)
	if (entered.error || entered.value !== 'ok') {
		bad(`${vp.label} 没能切进阅读态：${entered.error || entered.value}`)
		continue
	}
	// 抽屉带 `transition: transform .2s, visibility .2s`：`visibility` 在过渡**结束**时
	// 才翻到 hidden，等 300ms 会量到中间态（首屏字体还在加载时实测踩到过，
	// 表现为「只有第一个断点报 visible」）。给足一整个过渡再加余量。
	await sleep(900)
	const probed = await evaluate(PROBE)
	if (probed.error || !probed.value) {
		bad(`${vp.label} 量不到 #main-content：${probed.error || 'null'}`)
		continue
	}
	const m = probed.value

	// 正文列宽：规格 860px 上限。457px 那个缺陷正好落在这里。
	if (m.width > READING_MAX_WIDTH + 0.5)
		bad(`${vp.label} 阅读态正文 ${m.width}px > ${READING_MAX_WIDTH}px —— 两侧栏没收起（#blog-root 是 ${m.rootColumns} 列）`)
	else ok(`${vp.label} 阅读态正文 ${m.width}px ≤ ${READING_MAX_WIDTH}px（#blog-root ${m.rootColumns} 列）`)

	// 单列：根上只能剩一列
	if (m.rootColumns !== 1)
		bad(`${vp.label} #blog-root 仍有 ${m.rootColumns} 列，阅读态没有收成单列`)
	else ok(`${vp.label} #blog-root 单列`)

	// 两侧栏必须是移出流且默认隐藏的抽屉，否则顶部的「导航」「目录」打不开它们
	let drawerOk = true
	for (const [name, s] of [['#blog-sidebar', m.sidebar], ['#blog-aside', m.aside]]) {
		if (!s) {
			bad(`${vp.label} 找不到 ${name}`)
			drawerOk = false
			continue
		}
		if (s.pos !== 'fixed') {
			bad(`${vp.label} ${name} 在阅读态是 position:${s.pos}，应是移出流的 fixed 抽屉`)
			drawerOk = false
		}
		else if (s.vis !== 'hidden') {
			bad(`${vp.label} ${name} 在阅读态 visibility:${s.vis}，收起态应是 hidden`)
			drawerOk = false
		}
	}
	if (drawerOk)
		ok(`${vp.label} 两侧栏均为 fixed + hidden 的收起抽屉`)

	// 字号 / 行高：规格 18–20px / 1.8
	const fs = Number.parseFloat(m.fontSize)
	const lh = Number.parseFloat(m.lineHeight)
	if (fs < 18 || fs > 20.5)
		bad(`${vp.label} 正文字号 ${m.fontSize} 不在 18–20px`)
	const ratio = fs > 0 ? lh / fs : 0
	if (Math.abs(ratio - 1.8) > 0.06)
		bad(`${vp.label} 正文行高 ${m.lineHeight}（${ratio.toFixed(2)} 倍）不是 1.8`)
	if (fs >= 18 && fs <= 20.5 && Math.abs(ratio - 1.8) <= 0.06)
		ok(`${vp.label} 字号 ${m.fontSize} / 行高 ${m.lineHeight}（${ratio.toFixed(2)}）`)
}

console.log('--- 4. 普通模式未被波及 ---')
{
	await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
	await send('Page.navigate', { url: `${LOCAL}/2025/11/riddle-joker/` })
	for (let i = 0; i < 40; i++) {
		await sleep(250)
		const r = await evaluate(`document.readyState === 'complete' && !!document.querySelector('main#main-content')`)
		if (r.value === true)
			break
	}
	await sleep(600)
	const probed = await evaluate(PROBE)
	const m = probed.value || {}
	// 普通模式不该被阅读态压成单列：文章页有 aside，三栏是规格要求
	if (m.rootColumns === 3)
		ok(`普通模式 1600px 仍是三栏（${m.rootColumns} 列）`)
	else bad(`普通模式变成了 ${m.rootColumns} 列 —— 阅读态的覆盖泄漏到了普通模式`)

	const attr = await evaluate(`document.documentElement.getAttribute('data-big-picture')`)
	if (attr.value === null)
		ok('普通模式根上没有 data-big-picture')
	else bad(`普通模式根上出现了 data-big-picture=${attr.value}`)
}

ws.close()
console.log('')
if (fail === 0) {
	console.log('RESULT: PASS - big picture reading layout holds at every breakpoint')
	await cleanup(0)
}
console.log(`RESULT: FAIL - ${fail} problem(s)`)
await cleanup(1)
