/**
 * 运行时 DOM 门禁 —— 专门盯「静态产物是对的，坏在交互之后」这一类缺陷。
 *
 * ═══ 为什么需要这道门禁 ═══
 *
 * 现有 39 道门禁全部只读**构建产物快照**，没有一道在真实浏览器里动过页面。
 * 2026-10-03 一天之内穿过了全套门禁的三个真实缺陷，全都落在同一个盲区：
 *
 *   1. **cid 作用域丢失**（分页页码按钮、combobox 对勾）
 *      Astro 的 `data-astro-cid-<hash>` 是**构建期**属性。页面脚本用
 *      `createElement` 重建的元素没有它，于是带 cid 的选择器只对构建期渲染的
 *      那批节点生效。症状：切到第 2 页后 `width:3em` / `&.active` / `&:hover`
 *      三条同时失效，四个页码糊成 `1234`；combobox 换选项后对勾涨到 90px 撑爆行高。
 *      **静态产物里规则确实匹配得到**，所以 `audit-dead-scope` 不报。
 *
 *   2. **astro-icon 的 symbol 被整块替换连坐删除**
 *      symbol 定义全局只有一份、挂在首次出现处。`menu.replaceChildren(...)`
 *      把它连同首屏那张卡一起丢掉，其余 `<use href="#ai:…">` 全部解析失败变空白。
 *      症状：翻页后卡片上的日期图标与字数图标消失、分类图标还在。
 *      **两份 HTML 逐字节相同**，MutationObserver 记录不到任何移除事件
 *      ——变化发生在**解析期**，静态比对与 DOM 观察都看不见。
 *
 *   3. **构建环境泄漏到产物**（locale 随 runner 语言变）
 *      线上 63/63 篇文章日期变英文。`Intl` 的 locale 传 `undefined` 意味着
 *      「用运行时默认值」，而 SSG 的运行时是**构建机**。
 *      这条只有 `live:head`（比本地 vs 线上）能看见，而它属于重档、从未跑完。
 *
 * 三个的共同形状：**构建期是对的，坏在交互之后或构建环境**。所以判据必须
 * 建立在「真的点了、然后读活的 DOM」，而不是再静态扫一遍产物。
 *
 * ═══ 判据 ═══
 *
 * 每完成一次会重排 DOM 的交互，就断言两条不变式：
 *
 *   A. **`<use href="#ai:…">` 全部可解析**：目标 `<symbol>` 必须仍在文档里，
 *      且 `use.getBBox()` 非零（0×0 就是空白图标，DOM 层面看不出来）。
 *   B. **cid 作用域没掉**：交互前出现的每个 `class`，交互后重建的节点仍要带
 *      相应的 `data-astro-cid-*` 属性。做法是取一份「首屏每个 class 规则用到的
 *      cid 集合」，再检查交互后 DOM 里带该 class 的元素是否仍带对应 cid。
 *
 * ═══ 为什么这道门禁很便宜 ═══
 *
 * 只开**一个**浏览器会话、只测**首页**、跑固定的 4 次交互。全程不扫 63 页 × 两侧
 * （那是 `live:ui-parity` 的 20 分钟），实测秒级。它也因此天然能在 CI 里跑。
 *
 * ⚠️ 内存下限沿用 interaction-check 的 1500MB：无头 Chrome 约 700MB，
 * 低于这个数时它的结论不可信（会随机把一批断言判红）。不足时**退出 0 并打
 * SKIPPED**，绝不谎报失败——谎报比不报更糟。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { requirePreviewSlot } from './lib/preview-guard.mjs'

const ROOT = process.cwd()
const PORT = 4402
const LOCAL = `http://localhost:${PORT}`
const DEBUG_PORT = 9415

/* ── 内存闸门（同 interaction-check）────────────────────────────────────── */
const MIN_FREE_MB = 1500
const freeMB = Math.round(freemem() / 1024 / 1024)
if (freeMB < MIN_FREE_MB) {
	console.log(`SKIPPED: insufficient free memory (${freeMB}MB of ${Math.round(totalmem() / 1024 / 1024)}MB, need >= ${MIN_FREE_MB}MB)`)
	console.log('  This gate did NOT run. Free some memory and re-run -- do not "fix" the site in response.')
	process.exit(0)
}

/**
 * 浏览器可执行文件。**必须覆盖 Linux 与 macOS** —— 这道门禁要进 CI，
 * 而 `runs-on: ubuntu`。第一版只列了 Windows 三个路径（照抄
 * interaction-check.mjs，那道门禁刻意不进 CI 所以一直没暴露），
 * 推到 ubuntu 上会直接打「no Chrome/Edge found」exit 1，**把部署卡死**。
 *
 * GitHub 的 ubuntu runner 预装 Google Chrome（`/usr/bin/google-chrome`），
 * 另外再兜 Chromium 与系统自带的几处位置。
 */
const CHROME = [
	// Windows
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	// macOS
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	// Linux（GitHub runner 与各发行版常见位置）
	'/usr/bin/google-chrome',
	'/usr/bin/google-chrome-stable',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/snap/bin/chromium',
	'/usr/bin/microsoft-edge',
].find(p => existsSync(p))
if (!CHROME) {
	console.error('FAIL: no Chrome/Edge found on this platform')
	console.error(`  搜过: ${process.platform}。CI runner 若真没有浏览器，这道门禁应该`
		+ '改成 SKIP 而不是把部署卡死——但那样它就成了永不失败的摆设。')
	process.exit(1)
}

function killTree(child) {
	if (!child?.pid)
		return
	try {
		// Windows 用 taskkill /T 杀整棵进程树；POSIX 杀进程组。
		// compare-ui-parity.mjs 只写了 taskkill 那一条，而它同样要在 ubuntu 上跑——
		// 那条路径在 Linux 上 spawnSync 会抛 ENOENT，被这里的 try/catch 吃掉，
		// 于是**预览服务器不会被杀掉**就退出了。这道门禁要修掉，别照抄。
		if (process.platform === 'win32') {
			spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
			return
		}
		// 进程组优先（preview 自己 fork 过子进程），退回到单进程
		try {
			process.kill(-child.pid, 'SIGKILL')
		}
		catch {
			try {
				process.kill(child.pid, 'SIGKILL')
			}
			catch { /* 已退出 */ }
		}
	}
	catch { /* 已退出 */ }
}
async function waitHttp(url, ms = 60000) {
	const dl = Date.now() + ms
	while (Date.now() < dl) {
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
			if (r.ok)
				return true
		}
		catch { /* 还没起来 */ }
		await sleep(400)
	}
	return false
}

/* ── 极简 CDP 客户端（与 interaction-check 同款，零依赖）───────────────── */
class CDP {
	constructor(ws) {
		this.ws = ws
		this.id = 0
		this.pending = new Map()
		ws.addEventListener('message', (ev) => {
			const m = JSON.parse(ev.data)
			if (m.id && this.pending.has(m.id)) {
				const { resolve, reject } = this.pending.get(m.id)
				this.pending.delete(m.id)
				m.error ? reject(new Error(m.error.message)) : resolve(m.result)
			}
		})
	}

	send(method, params = {}, sessionId) {
		const id = ++this.id
		const payload = { id, method, params }
		if (sessionId)
			payload.sessionId = sessionId
		this.ws.send(JSON.stringify(payload))
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
	}
}

/* ── 页面内探针：在真实交互后读活的 DOM ────────────────────────────────── */

function PROBE() {
	return `(() => {
  const missingSymbol = []
  for (const use of document.querySelectorAll('svg.iconify use')) {
    const id = (use.getAttribute('href') || '').replace(/^#/, '')
    if (!id || !document.getElementById(id))
      missingSymbol.push(id || '(空 href)')
  }

  const blankGlyph = []
  for (const svg of document.querySelectorAll('svg.iconify')) {
    const r = svg.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const use = svg.querySelector('use')
    if (!use) continue
    let b = { width: 0, height: 0 }
    try { b = use.getBBox() } catch (_) { continue }
    if (b.width <= 0 || b.height <= 0)
      blankGlyph.push({ id: svg.getAttribute('data-icon') || '?', w: Math.round(r.width) })
  }

  // ---- 判据 B：计算样式指纹在交互后有没有变 ----
  //
  // 不去解析 CSS 找 cid，也不用 cid 做启发式。**直接量后果**：把每个带 class
  // 的元素的若干计算样式属性按「标签名 + 排序后的 class 集合」归并成一张指纹表，
  // 交互之后再量一次，两次不同的即为回归。
  //
  // 为什么换掉前两版：
  //  v1 从样式表建 (class -> cid) 映射，遍历写成 if (r.cssRules) 就 continue，
  //     而现代 Chrome 的普通 CSSStyleRule 也带 cssRules（空对象也 truthy），
  //     结果 699 条规则一条没读到，判据静默恒绿。
  //  v2 改对遍历后能读到 49 个 class，但嵌套规则的 selectorText 只是片段，
  //     解析出 .t / .c / .e / .z- 这类不存在的 class，4 条假阳性常驻。
  //  两条路都依赖「从 CSS 反推」，脆。量计算样式没有这些中间层。
  //
  // 选这几个属性：三条真实缺陷都落在它们上面 ——
  //  分页页码丢 width:3em（width）、combobox 对勾丢 width/height:1em（width/height）、
  //  当前页高亮丢 background-color/color（backgroundColor/color）。
  const PROPS = ['width', 'height', 'display', 'fontSize', 'color',
    'backgroundColor', 'marginLeft', 'marginRight', 'paddingLeft', 'verticalAlign']

  // 文章列表及其祖先排除在外：翻页 / 排序**本来就会**改变它们的高度，
  // 而两条 cid 缺陷都不在那一带（分页条、combobox 下拉都在列表之外）。
  // 不排除的话 html / main / .post-list 的 height 每步都变，判据恒红。
  const list = document.querySelector('[data-post-menu]')
  // 两个方向都要排除：**在列表里面**的（每张卡），
  // 以及**包含列表**的（.post-list / .list-transition / main …）——
  // 后者同样会随内容改高度，只判一个方向时它们每步都变、判据恒红。
  const inList = (el) => {
    for (let n = el; n; n = n.parentElement) if (n === list) return true
    return false
  }
  const wrapsList = (el) => !!(list && el.contains && el.contains(list))
  const SKIP_TAGS = new Set(['html', 'body', 'main', 'menu', 'template'])

  // 首屏就是隐藏的元素整条排除。combobox 的下拉在首屏是 hidden，
  // 展开后 width 必然从 auto 变具体值、trigger 也拿到 :focus 底色——
  // 那是**正确行为**，不是回归。隐藏态元素的显隐不该参与比对。
  const isHidden = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute && n.hasAttribute('hidden')) return true
      if (n.tagName === 'DETAILS' && !n.open) return true
    }
    return false
  }

  const fingerprint = new Map()
  for (const el of Array.from(document.querySelectorAll('[class]'))) {
    if (typeof el.className !== 'string' || !el.className.trim()) continue
    const tag = el.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag) || inList(el) || wrapsList(el) || isHidden(el)) continue
    // hover / focus 态**整条跳过**，不并进签名。它们是瞬时反馈：combobox 的
    // trigger 一展开就拿到 focus 底色，CDP 也无法有意义地控制指针位置，
    // 拿它做「交互前后应当一致」的断言只会得到假阳性。过渡动画中途的元素同理。
    try {
      if (el.matches(':hover') || el.matches(':focus') || el.matches(':focus-visible')) continue
    } catch (_) { /* 某些元素不支持这些伪类 */ }
    // 用空格切而不是正则：模板字符串里正则的转义层级太多，
    // 踩过一次把 class 切碎成 po/t/t-li 的情况
    const cls = el.className.split(' ').filter(Boolean).sort().join('.')
    if (!cls) continue
    // 伪状态并入签名：翻到第 2 页后「上一页」按钮从 disabled 变成可用，
    // 它的 color / background-color 随 :disabled 规则变——那是**正确行为**，
    // 不并进来的话每次翻页都会误报一条。变了状态就是另一个条目，不算"变化"。
    // 元素「状态」并入签名：状态变了就是另一个条目，不算「变化」。
    // 伪状态 + ARIA 状态属性都要算 —— combobox trigger 展开时
    // background-color 从卡片底色变成 soft，是 aria-expanded=true 那条规则，
    // 是**正确行为**；不并进来的话每次展开都误报一条。
    //
    // ⚠️ 这个函数整体是一个模板字符串，**注释里绝不能出现反引号**，
    // 会当场闭合字面量。栽过两次。
    let state = ''
    try {
      if (el.matches(':disabled')) state += ':disabled'
      if (el.matches(':checked')) state += ':checked'
    } catch (_) { /* SVG 等不支持这些伪类 */ }
    for (const a of ['aria-expanded', 'aria-selected', 'aria-current', 'aria-checked', 'aria-pressed', 'data-state']) {
      const v = el.getAttribute(a)
      if (v !== null) state += '[' + a + '=' + v + ']'
    }
    const key = tag + '.' + cls + state
    if (fingerprint.has(key)) continue
    const cs = getComputedStyle(el)
    const fp = {}
    for (const p of PROPS) fp[p] = cs[p]
    fingerprint.set(key, fp)
  }

  // ---- 判据 C：选中项对勾的几何必须跨步骤稳定 ----
  // combobox 换选项时旧对勾被摘掉、新的用 createElementNS 插入。没有 cid 的话
  // 新对勾丢掉 width/height:1em，尺寸暴涨——而它与首屏那个**是同一个 class**，
  // 计算样式指纹会把它当成同一条目比不出来（首屏那条是带 cid 的、正常）。
  // 所以单列一条：不管选中第几项，对勾的渲染盒子都该一模一样。
  let checkBox = null
  const activeCheck = document.querySelector('.combobox-item.active .combobox-check')
  if (activeCheck) {
    const r = activeCheck.getBoundingClientRect()
    checkBox = [Math.round(r.width), Math.round(r.height)]
  }

  return {
    missingSymbol,
    blankGlyph,
    checkBox,
    fingerprint: Object.fromEntries(fingerprint),
  }
})()`
}

/**
 * 比对两张计算样式指纹表，返回发生变化的属性。
 * 按 key 取「有变化的属性名集合」，两侧都列出旧值与新值便于定位。
 */
function diffFingerprints(before, after) {
	const changed = []
	for (const [key, fp] of Object.entries(before || {})) {
		const now = after?.[key]
		if (!now)
			continue
		const props = []
		for (const p of Object.keys(fp)) {
			if (fp[p] !== now[p])
				props.push({ prop: p, before: fp[p], after: now[p] })
		}
		if (props.length)
			changed.push({ key, props })
	}
	return changed
}

/* ── 交互序列：每一步都会重排 DOM ───────────────────────────────────────── */
/* 每项 = [说明, 页内表达式]。表达式必须真的改 DOM，返回 false 表示没点上。 */
const PAGES = [
	{
		path: '/?page=1',
		label: '首页',
		steps: [
			['翻到第 2 页', `(() => { const b = document.querySelector('[data-page-num="2"]'); if (!b) return false; b.click(); return true })()`],
			['翻回第 1 页', `(() => { const b = document.querySelector('[data-page-num="1"]'); if (!b) return false; b.click(); return true })()`],
			['按更新日期排序', `(() => { const b = document.querySelector('[data-order-sort]'); if (!b) return false; b.click(); return true })()`],
			['按创建日期排序（还原）', `(() => { const b = document.querySelector('[data-order-sort]'); if (!b) return false; b.click(); return true })()`],
		],
	},
	{
		// combobox 版的 Tab 只存在于组件示例页那一节，首页没有。
		// 负控验证时发现：只测首页的话，combobox 那条缺陷**根本不会发作**——
		// 下拉是 hidden 的、对勾压根不会被重建，门禁会假绿。所以单独跑一页。
		path: '/previews/example/#tab',
		label: '组件示例页（combobox）',
		steps: [
			['展开 combobox', `(() => { const b = document.querySelector('[data-combobox-trigger]'); if (!b) return false; b.click(); return true })()`],
			['选中第 2 项', `(() => { const b = document.querySelector('.combobox-item[data-tab-select="2"]'); if (!b) return false; b.click(); return true })()`],
			['展开 combobox（再看）', `(() => { const b = document.querySelector('[data-combobox-trigger]'); if (!b) return false; b.click(); return true })()`],
			['选回第 1 项', `(() => { const b = document.querySelector('.combobox-item[data-tab-select="1"]'); if (!b) return false; b.click(); return true })()`],
		],
	},
]

/* ── 起 preview ────────────────────────────────────────────────────────── */
requirePreviewSlot({ cwd: ROOT, port: PORT })
// 直接跑仓库里装好的 astro，不经 npx：npx 在找不到本地包时会去**联网**下载，
// CI 上那既慢又可能直接把门禁卡住。bin 路径跨平台（node_modules/.bin/astro.cmd
// 是 Windows 的 shim，POSIX 下就是同名无后缀文件）。
const astroBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'astro.cmd' : 'astro')
const preview = spawn(astroBin, ['preview', '--port', String(PORT)], { cwd: ROOT, shell: process.platform === 'win32', stdio: 'ignore' })
if (!await waitHttp(`${LOCAL}/`)) {
	console.error('FAIL: preview never came up')
	killTree(preview)
	process.exit(1)
}

const profile = join(process.env.TEMP || process.env.TMPDIR || '.', `runtime-dom-gate-${process.pid}`)
const chrome = spawn(CHROME, [
	'--headless=new',
	`--remote-debugging-port=${DEBUG_PORT}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'about:blank',
], { stdio: 'ignore' })

let wsUrl = ''
for (let i = 0; i < 80 && !wsUrl; i++) {
	await sleep(300)
	try {
		const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
		wsUrl = (await r.json()).find(t => t.type === 'page')?.webSocketDebuggerUrl || ''
	}
	catch { /* 还没起来 */ }
}
if (!wsUrl) {
	console.error('FAIL: chrome devtools endpoint never came up')
	killTree(chrome)
	killTree(preview)
	process.exit(1)
}

const cdp = await (async () => {
	const ws = new WebSocket(wsUrl)
	await new Promise((res, rej) => {
		ws.addEventListener('open', res, { once: true })
		ws.addEventListener('error', () => rej(new Error('ws error')), { once: true })
	})
	return new CDP(ws)
})()

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
await cdp.send('Page.enable', {}, sid)
await cdp.send('Runtime.enable', {}, sid)

async function evaluate(expression) {
	const r = await cdp.send('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true,
		// 页面侧抛异常时把真实的 description 带回来；`text` 只有 "Uncaught"，
		// 定位不到是哪一行。第一版就栽在这里，白跑一轮。
		includeCommandLineAPI: true,
	}, sid)
	if (r.exceptionDetails) {
		const d = r.exceptionDetails
		return { __error: String(d.exception?.description || d.text || 'unknown').split('\n').slice(0, 4).join(' | ') }
	}
	return r.result?.value
}

async function goto(url) {
	const done = new Promise((res) => {
		const t = setTimeout(res, 45000)
		cdp.ws.addEventListener('message', function h(ev) {
			const m = JSON.parse(ev.data)
			if (m.method === 'Page.loadEventFired' && m.sessionId === sid) {
				clearTimeout(t)
				cdp.ws.removeEventListener('message', h)
				res()
			}
		})
	})
	await cdp.send('Page.navigate', { url }, sid)
	await done
	await sleep(1200)
}

/* ── 跑 ───────────────────────────────────────────────────────────────── */
const failures = []

for (const page of PAGES) {
	await goto(`${LOCAL}${page.path}`)

	const baseline = await evaluate(PROBE())
	if (baseline?.__error) {
		console.error(`FAIL: [${page.label}] 探针在首屏就报错:`, baseline.__error)
		killTree(chrome)
		killTree(preview)
		process.exit(1)
	}
	let refCheckBox = null
	console.log(`
[${page.label}] 首屏：指纹 ${Object.keys(baseline.fingerprint).length} 条，symbol 缺失 ${baseline.missingSymbol.length}，空白字形 ${baseline.blankGlyph.length}`)

	for (const [label, expr] of page.steps) {
		const tag = `${page.label} / ${label}`
		const clicked = await evaluate(expr)
		if (clicked !== true) {
			failures.push(`${tag}：页面上找不到触发元素（门禁没测到东西，不能算通过）`)
			continue
		}
		await sleep(900)
		const r = await evaluate(PROBE())
		if (r?.__error) {
			failures.push(`${tag}：探针报错 ${r.__error}`)
			continue
		}
		// 基准取第一个**可见**的对勾盒子
		if (!refCheckBox && r.checkBox && r.checkBox[0] > 0)
			refCheckBox = r.checkBox
		for (const id of r.missingSymbol)
			failures.push(`${tag}：<use href="#${id}"> 的 <symbol> 已不在文档里 —— 整批引用变空白`)
		for (const b of r.blankGlyph)
			failures.push(`${tag}：图标 ${b.id} 已参与布局（${b.w}px 宽）但字形 bbox 为 0 —— 空白图标`)
		for (const d of diffFingerprints(baseline.fingerprint, r.fingerprint)) {
			for (const p of d.props)
				failures.push(`${tag}：${d.key} 的 ${p.prop} 在交互后从 ${p.before} 变成 ${p.after}`)
		}
		// 判据 C：选中项对勾的几何跨步骤必须一致。
		// 只在**可见**（盒子非零）时比对：选中后下拉自动收起，对勾随之 0x0，
		// 那不是「对勾坏了」。基准也取第一个非零值。
		if (r.checkBox && r.checkBox[0] > 0 && refCheckBox && r.checkBox.join('x') !== refCheckBox.join('x'))
			failures.push(`${tag}：选中项对勾的盒子从 ${refCheckBox.join('x')} 变成 ${r.checkBox.join('x')} —— 换选项后重建的对勾没有拿到作用域`)

		console.log(`  ${label.padEnd(22)} symbol缺失 ${r.missingSymbol.length}  空白字形 ${r.blankGlyph.length}  样式变化 ${diffFingerprints(baseline.fingerprint, r.fingerprint).length}${r.checkBox ? `  对勾 ${r.checkBox.join('x')}` : ''}`)
	}
}

killTree(chrome)
killTree(preview)
try {
	rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
catch { /* 临时目录残留无害 */ }

console.log('')
if (failures.length) {
	console.log(`RESULT: FAIL - ${failures.length} 处运行时 DOM 缺陷`)
	for (const f of failures.slice(0, 40))
		console.log(`  - ${f}`)
	if (failures.length > 40)
		console.log(`  ... 另有 ${failures.length - 40} 条`)
	process.exit(1)
}
const totalSteps = PAGES.reduce((n, p) => n + p.steps.length, 0)
console.log(`RESULT: PASS - ${PAGES.length} 页 / ${totalSteps} 次交互后 <use>、计算样式与对勾几何均完好`)
process.exit(0)
