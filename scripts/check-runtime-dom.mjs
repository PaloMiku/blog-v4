/**
 * 运行时 DOM 门禁 —— 盯「静态产物是对的，坏在交互之后」这一类缺陷。
 *
 * 其余门禁全读构建产物快照，没有一道在真实浏览器里动过页面。作用域属性
 * （Astro 的 data-astro-cid 是构建期的，createElement 重建的节点没有它）、
 * astro-icon 的 symbol 被整块替换连坐删除——这类缺陷静态比对与 DOM 观察
 * 都看不见，症状都是「评论区图标/页码样式在交互后悄悄失效」。
 *
 * 每次重排 DOM 的交互后断言：
 *   A. <use href="#ai:…"> 全部可解析，已布局的图标字形非零
 *   B. 计算样式指纹（10 个属性，按 标签名+class+状态 归并）交互前后不变
 *   C. 选中项对勾的渲染盒子跨步骤稳定
 *   D. dropdown 的展开态计数按步骤在 1/0 之间来回翻（/archive/ 那一组）
 *
 * 比计算样式、而不是去样式表反推 cid：后者试过两版都不可靠——遍历写成
 * if (r.cssRules) 会把每条规则当嵌套容器跳过（空的 CSSRuleList 也 truthy），
 * 修好后又会解析出 .t/.c 这类不存在的 class。量后果没有那些中间层。
 *
 * 只开一个浏览器会话、三个页面、12 次交互，两个页面时实测 23s，因此能进 CI。
 * 第三页是 /archive/ 的 dropdown 交互组：它不另起浏览器，复用同一个会话与探针，
 * 边际成本只有一次导航加四段 900ms 等待。为它单开第 31 道门禁不划算——
 * 要解决的是覆盖盲区，不是门禁数量。
 *
 * 内存不足 1500MB 时退出 0 并打 SKIPPED：无头 Chrome 约 700MB，低于此数
 * 它的结论不可信。谎报失败比不报更糟。
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
// 1500MB 是实测出来的：低于它，起 preview + 无头 Chrome 这一串会被 OOM killer
// 或 Windows 的提交上限打断，表现为 Chrome 悄悄起不来、探针全部报空——
// 那不是「门禁红了」，是「门禁没跑成」，两者必须分开。
//
// 需要在内存更紧的机器上强制跑一遍时（例如本地验证门禁改动，而本机被别的
// 进程占满）：GATE_MIN_FREE_MB=0 node scripts/check-runtime-dom.mjs。
// 这是**降低自我保护**，不是提高判据；CI 上不要设（runner 有 7GB，用不着）。
const MIN_FREE_MB = Number(process.env.GATE_MIN_FREE_MB ?? 1500)
const freeMB = Math.round(freemem() / 1024 / 1024)
if (freeMB < MIN_FREE_MB) {
	console.log(`SKIPPED: insufficient free memory (${freeMB}MB of ${Math.round(totalmem() / 1024 / 1024)}MB, need >= ${MIN_FREE_MB}MB)`)
	console.log('  This gate did NOT run. Free some memory and re-run -- do not "fix" the site in response.')
	console.log('  强制跑：GATE_MIN_FREE_MB=0 node scripts/check-runtime-dom.mjs（仅限本机验证）')
	process.exit(0)
}

/**
 * 浏览器可执行文件。**必须覆盖 Linux 与 macOS** —— 这道门禁要进 CI，
 * 只列 Windows 路径会让 ubuntu runner 直接报「no Chrome/Edge found」exit 1，
 * 把部署卡死。
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
  // 直接量后果：按「标签名 + class 集合 + 状态」归并成指纹表，交互后再量一次。
  // 属性选这几个是因为历史缺陷都落在它们上面：页码丢 width:3em、对勾丢
  // width/height:1em、当前页高亮丢 background-color（见文件头）。
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
    // hover / focus 整条跳过：瞬时反馈，CDP 也无法有意义地控制指针位置
    try {
      if (el.matches(':hover') || el.matches(':focus') || el.matches(':focus-visible')) continue
    } catch (_) { /* 某些元素不支持这些伪类 */ }
    const cls = el.className.split(' ').filter(Boolean).sort().join('.')
    if (!cls) continue
    // 状态并入签名：翻页后「上一页」从 disabled 变可用、combobox trigger 展开后
    // background-color 变 soft——都是正确行为，不并进来的话每次都误报一条。
    //
    // ⚠️ 本函数在模板字符串里，**注释中不能出现反引号**，会当场闭合字面量。
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

  // ---- 判据 D：dropdown 展开态计数 ----
  //
  // 只认根元素上那一个 data-open 属性。不去读面板的 hidden：hidden 同时被
  // 「hidden 属性」和「CSS 两条路」控制，任一侧失效都可能在视觉上看着还是收起。
  // 也不做文本匹配：视口外的元素文本匹配会返回 count 0，那是假绿（实测踩过）。
  const openDropdowns = document.querySelectorAll('[data-dropdown-root][data-open]').length

  return {
    missingSymbol,
    blankGlyph,
    checkBox,
    openDropdowns,
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

/**
 * 等页面「静止」：连续两次探针结果完全相同才算settled。
 *
 * ## 为什么必须有这一步
 *
 * 基线原本是 `Page.navigate` + load 事件 + `sleep(1200)` 之后立刻取的。1200ms 足够
 * 静态产物渲染完，**不够第三方脚本水合完**：Twikoo 要先从 CDN 取 `twikoo.min.js`，
 * 再跨域 POST 到 Netlify 云函数，拿到数据才把评论区渲染进 DOM。这两步加起来
 * 远超 1200ms，于是**基线拍在水合之前、交互探针拍在水合之后**，同一个 key 的
 * 元素凭空多出来，判据报「16 处运行时 DOM 缺陷」。
 *
 * 2026-10-04 之前这道门禁一直是绿的，因为 Twikoo 的 `envId` 坏掉、评论区永远
 * 加载不出来，DOM 从不变化——**一个坏掉的第三方依赖把一道门禁的时序缺陷盖住了**。
 * 修好 envId 之后它立刻变红。这不是回归，是门禁终于看见了真实的水合过程。
 *
 * 修法是通用的：不特判 Twikoo，而是要求基线取自一个已经稳定的页面。字体、
 * 统计脚本、任何异步注入的组件都吃这一条。连续两次相同才算静止，最多等 20s。
 */
async function waitSettled() {
	let prev = null
	for (let i = 0; i < 20; i++) {
		const cur = await evaluate(PROBE())
		if (cur && !cur.__error) {
			const stable = prev && JSON.stringify(cur.fingerprint) === JSON.stringify(prev.fingerprint)
			if (stable)
				return cur
			prev = cur
		}
		await sleep(1000)
	}
	return prev
}

/**
 * dropdown 探针的**接线自证**：跑那四步之前，先确认页面上真的有一个可测的实例。
 *
 * 为什么必须单独一层：下面四步的期望值是 1/0/0/0。页面上一旦没有可测的 dropdown，
 * 计数恒为 0，前三步会「全部按预期收拢」、绿得毫无意义。而以下四种失效在计数为 0
 * 时长得一模一样：组件没渲染、脚本没执行、测错了实例、面板里没有可点项。
 * 「对着没接线的页面报绿」是这道门禁最坏的失效模式，所以每一种都单独报红，
 * 绝不静默跳过、也不退化成 SKIP。
 */
function DROPDOWN_CONTRACT() {
	return `(() => {
  const all = Array.from(document.querySelectorAll('[data-dropdown-root]'))
  if (!all.length)
    return { ok: false, reason: '页面上一个 [data-dropdown-root] 都没有 —— dropdown 没渲染出来' }
  const focusin = all.filter(r => r.getAttribute('data-dropdown-trigger') === 'focusin')
  if (!focusin.length)
    return { ok: false, reason: '没有 data-dropdown-trigger="focusin" 的实例（实际取值：'
      + all.map(r => r.getAttribute('data-dropdown-trigger')).join(', ') + '）—— 测的不是 focusin 那一路' }
  if (focusin.length > 1)
    return { ok: false, reason: 'focusin 实例有 ' + focusin.length + ' 个，[data-open] 计数会互相串味' }
  const root = focusin[0]
  if (root.dataset.dropdownReady !== '1')
    return { ok: false, reason: 'dataset.dropdownReady 不是 1 —— 组件脚本没执行，或脚本已改接线' }
  if (!root.querySelector('[data-dropdown-anchor]'))
    return { ok: false, reason: '缺少触发器 [data-dropdown-anchor]' }
  const panel = root.querySelector('[data-dropdown-panel]')
  if (!panel)
    return { ok: false, reason: '缺少面板 [data-dropdown-panel]' }
  if (!panel.querySelector('[data-dropdown-item]'))
    return { ok: false, reason: '面板里没有 [data-dropdown-item] —— 「点选项后收起」无从触发' }
  return { ok: true }
})()`
}

/* ── dropdown 交互组 ────────────────────────────────────────────────────── */
/*
 * 覆盖 partial/Dropdown.astro 的三条关闭路径：点外部、Esc、点面板内选项。
 * 这三条都挂在 document 级委托上，静态产物里完全看不出来，30 道门禁此前一条都没覆盖。
 */
const DD_OPEN_COUNT = `document.querySelectorAll('[data-dropdown-root][data-open]').length`

/**
 * 组装一个 dropdown 步骤：先展开，再执行动作。
 *
 * 展开放在每一步**自己**里面，而不是依赖上一步的遗留状态：焦点是粘的，
 * 上一轮留下的展开态会让下一步的「点外部后收起」对着一个已经开着的东西，
 * 测出来的绿灯不代表任何东西。同时展开后立刻断言计数为 1，
 * 使「收起」那三步的前置条件本身也是被检查过的，而不是假设出来的。
 */
function ddStep(action) {
	return `(() => {
  const r = document.querySelector('[data-dropdown-root][data-dropdown-trigger="focusin"]')
  if (!r) return '页面上找不到 focusin 模式的 [data-dropdown-root]'
  const t = r.querySelector('[data-dropdown-anchor] button, [data-dropdown-anchor] a, [data-dropdown-anchor] [tabindex]')
  if (!t) return '[data-dropdown-anchor] 内没有可聚焦元素，focusin 触发不了'
  // OrderToggle 的分类按钮在「一篇分类都没有」时是 disabled 的，此时 focus() 静默无效。
  // 单独点出来，别让它混进下面那句含糊的「计数不是 1」。
  if (t.disabled) return '触发按钮处于 disabled，focus() 不会派发 focusin'
  // focusin 的坑：元素已处于焦点上时 focus() 不会再派发 focusin，
  // 连着两步里的第二次展开会静默失效（实测）。先 blur 再 focus，与真实 Tab 序列一致。
  if (r.contains(document.activeElement)) document.activeElement.blur()
  t.focus()
  if (${DD_OPEN_COUNT} !== 1) return 'focus() 之后展开态计数是 ' + ${DD_OPEN_COUNT} + '，不是 1'
  ${action}
})()`
}

// 派发真实的 KeyboardEvent，而不是拿 focusout 近似：Esc 那条路径就挂在
// document 的 keydown 上，近似等于没测。
const DD_OPEN = ddStep('return true')
const DD_CLOSE_OUTSIDE = ddStep(`const h1 = document.querySelector('h1')
  if (!h1) return '页面上没有 h1，没法当「外部」点击目标'
  h1.click()
  return true`)
const DD_CLOSE_ESC = ddStep(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  return true`)
const DD_CLOSE_ITEM = ddStep(`const item = r.querySelector('[data-dropdown-panel] [data-dropdown-item]')
  if (!item) return '面板里没有 [data-dropdown-item]，点不到'
  item.click()
  return true`)

/* ── 交互序列：每一步都会重排 DOM ───────────────────────────────────────── */
/* 每项 = [说明, 页内表达式, 展开态期望?]。表达式必须真的改 DOM，返回 false 表示没点上；
   返回一句字符串则表示「没测到东西」，那句话会原样进 failures（见下方 typeof 分支）。 */
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
	{
		// Dropdown（partial/Dropdown.astro）在生产里的唯一使用方是 OrderToggle 的分类
		// 下拉。它是 /archive/ 上唯一带「点外部关闭 / Esc 关闭」document 级委托的组件，
		// 而这两条路径此前**没有任何一条门禁覆盖过**。
		path: '/archive/',
		label: '归档页（dropdown）',
		contract: DROPDOWN_CONTRACT(),
		steps: [
			['focusin 展开下拉', DD_OPEN, 1],
			['点外部（h1）后收起', DD_CLOSE_OUTSIDE, 0],
			['Esc 后收起', DD_CLOSE_ESC, 0],
			['点面板内选项后收起', DD_CLOSE_ITEM, 0],
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
		// 定位不到是哪一行。
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

	// 接线自证先行。这组判据的期望值是 1/0/0/0，页面上一旦没有可测的 dropdown，
	// 计数恒为 0、每一步都「符合预期」——那是最坏的假绿。这里不通过就整页跳过，
	// 并且**报红**而不是 SKIP：测不到东西不算通过。
	if (page.contract) {
		const c = await evaluate(page.contract)
		const bad = !c || c.__error
			? (c?.__error || '探针没有返回结果')
			: (c.ok ? '' : c.reason)
		if (bad) {
			failures.push(`[${page.label}] dropdown 接线自证失败：${bad}`)
			console.log(`\n[${page.label}] 接线自证未通过，跳过该页交互（不测一个不存在的实例）`)
			continue
		}
	}

	// 基线必须取自**已经静止**的页面：第三方脚本水合完成后才算数，否则它注入的
	// DOM 会被算成「交互造成的样式变化」。见 waitSettled 的注释。
	const baseline = await waitSettled()
	if (baseline?.__error) {
		console.error(`FAIL: [${page.label}] 探针在首屏就报错:`, baseline.__error)
		killTree(chrome)
		killTree(preview)
		process.exit(1)
	}
	let refCheckBox = null
	console.log(`
[${page.label}] 首屏：指纹 ${Object.keys(baseline.fingerprint).length} 条，symbol 缺失 ${baseline.missingSymbol.length}，空白字形 ${baseline.blankGlyph.length}`)

	// 步骤第三项是可选的展开态期望（判据 D），前两页没有就不参与比较。
	for (const [label, expr, expectOpen] of page.steps) {
		const tag = `${page.label} / ${label}`
		const clicked = await evaluate(expr)
		if (clicked !== true) {
			// 表达式可以回一句人话说明「为什么没测到东西」；只回 false 时用通用原因。
			failures.push(typeof clicked === 'string'
				? `${tag}：${clicked}`
				: `${tag}：页面上找不到触发元素（门禁没测到东西，不能算通过）`)
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
		// 判据 D：展开态计数必须落在该步的期望上。
		if (expectOpen !== undefined && r.openDropdowns !== expectOpen)
			failures.push(`${tag}：展开态 [data-dropdown-root][data-open] 计数应为 ${expectOpen}，实际 ${r.openDropdowns}`)

		console.log(`  ${label.padEnd(22)} symbol缺失 ${r.missingSymbol.length}  空白字形 ${r.blankGlyph.length}  样式变化 ${diffFingerprints(baseline.fingerprint, r.fingerprint).length}${r.checkBox ? `  对勾 ${r.checkBox.join('x')}` : ''}${expectOpen !== undefined ? `  展开 ${r.openDropdowns}/${expectOpen}` : ''}`)
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
console.log(`RESULT: PASS - ${PAGES.length} 页 / ${totalSteps} 次交互后 <use>、计算样式、对勾几何与 dropdown 开合均完好`)
process.exit(0)
