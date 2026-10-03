/**
 * 线上（Nuxt）vs 本地（Astro）逐页 DOM 特征对比。
 *
 * ## 为什么需要这个，而不是肉眼看截图
 *
 * 第一轮人工比对时我盯上了「文章卡片上的日期」，Nuxt 显示 `4月1日`、Astro 显示
 * `2026年 04月 01日 星期三 中国标准时间 14:00:00`。看起来只是格式差异，
 * 但把两站每一页的总高度拉出来一比，**规律性差了 200~600px**：
 *
 *   页面      Nuxt     Astro    差
 *   首页       2624     3192   -568
 *   友链       2220     2802   -582
 *   游戏页     4240     4613   -373
 *   about      4355     4722   -367
 *   drive      2162     2529   -367
 *   文章页    10724    11054   -330
 *   归档       1920     2278   -358
 *
 * 10 张卡片 × 每张多换行一行 ≈ 200~300px，高度差的量级和根数对得上。
 * 但这是**推断**，不是证据——卡片高度也可能来自别处（间距、字体度量、
 * 某个多出来的区块）。所以要有能跑的、能复现的取证工具。
 *
 * ## 设计上的三个取舍
 *
 * 1. **选类名尽量宽松，且两边同用**。两站 DOM 结构并不逐字相同，用 Astro 的
 *    类名去查 Nuxt 会得到空数组，然后误判成「Nuxt 缺东西」。宁可粗一点，
 *    命中不了就报 MISSING 而不是报 0。
 * 2. **MISSING 与「真的为空」分开报**。前者是工具没查到，后者才是事实。
 *    把两者混为一谈会造出一堆假差异，白白派活给子智能体。
 * 3. **同一个浏览器进程、同一套视口、同样等待策略**。两站一个是 Nuxt 水合、
 *    一个是纯静态，等待时间必须按 REMOTE 分开，否则比的是加载速度不是页面。
 *
 * 用法：
 *   node scripts/compare-dom-live.mjs                       # 默认对比线上 vs 本地
 *   BASE_LOCAL=http://localhost:4397 node scripts/compare-dom-live.mjs
 *   REMOTE=https://blog.sotkg.com node scripts/compare-dom-live.mjs
 *   node scripts/compare-dom-live.mjs --only=home
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => existsSync(p))

if (!CHROME) {
	console.error('FAIL: no Chrome/Edge found')
	process.exit(1)
}

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const OUT = join(ROOT, '.astro-compare')

const REMOTE = process.env.REMOTE || 'https://blog.sotkg.com'
const LOCAL_PORT = 4396
const LOCAL = process.env.BASE_LOCAL || `http://localhost:${LOCAL_PORT}`

const argv = process.argv.slice(2)
const onlyArg = argv.find(a => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length) : null

/** 对比页面清单。path 不带尾斜杠（生产站对深层路径不容忍尾斜杠）。 */
const PAGES = [
	{ name: 'home', path: '/' },
	{ name: 'archive', path: '/archive' },
	{ name: 'article', path: '/2025/10/misskey-fediverse-deploy' },
	{ name: 'link', path: '/link' },
	{ name: 'game', path: '/games/galgames/clannad' },
	{ name: 'about', path: '/about' },
	{ name: 'drive', path: '/drive' },
	{ name: 'previews-example', path: '/previews/example' },
]
const PAGES_TO_RUN = only ? PAGES.filter(p => p.name.includes(only)) : PAGES

/* ────────────────────────── 页面内探针 ────────────────────────── */

/*
 * 这段在页面上下文里求值。对两站用同一份代码——任何针对某一站的特判都会
 * 让对比失去意义。
 */
// 探针定义见 dom-probe.mjs：逐字段小表达式，理由写在那里的注释里
import { EXTRACTORS } from './dom-probe.mjs'

/* ────────────────────────── CDP 客户端 ────────────────────────── */

class CDP {
	constructor(ws) {
		this.ws = ws
		this.id = 0
		this.pending = new Map()
		ws.addEventListener('message', (ev) => {
			const msg = JSON.parse(ev.data)
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id)
				this.pending.delete(msg.id)
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
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

	static async connect(url) {
		const ws = new WebSocket(url)
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true })
			ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
		})
		return new CDP(ws)
	}

	async openPage() {
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
		await this.send('Page.enable', {}, sessionId)
		await this.send('Runtime.enable', {}, sessionId)
		return { sessionId, targetId }
	}
}

/* ────────────────────────── 本地 preview ────────────────────────── */

function killTree(child) {
	if (!child || child.killed)
		return
	if (process.platform === 'win32' && child.pid) {
		try {
			spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
			return
		}
		catch {
			// 落到下面
		}
	}
	try {
		child.kill('SIGKILL')
	}
	catch {
		// 已经没了
	}
}

async function waitForHttp(url, timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
			if (r.ok)
				return true
		}
		catch {
			// 还没起来
		}
		await sleep(400)
	}
	return false
}

let preview = null
if (!process.env.BASE_LOCAL) {
	preview = spawn('npx', ['astro', 'preview', '--port', String(LOCAL_PORT)], { cwd: ROOT, shell: true, stdio: 'ignore' })
	if (!await waitForHttp(`${LOCAL}/`)) {
		console.error(`FAIL: local preview did not come up on ${LOCAL}`)
		killTree(preview)
		process.exit(1)
	}
}

/* ────────────────────────── Chrome ────────────────────────── */

const profile = mkdtempSync(join(tmpdir(), 'cdp-compare-'))
const debugPort = 9700 + Math.floor(Math.random() * 250)
const chrome = spawn(CHROME, [
	'--headless=new',
	`--remote-debugging-port=${debugPort}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'--hide-scrollbars',
	'--force-device-scale-factor=1',
	'about:blank',
], { stdio: 'ignore' })

async function waitForDevtools() {
	const deadline = Date.now() + 30000
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
			const j = await r.json()
			if (j.webSocketDebuggerUrl)
				return j.webSocketDebuggerUrl
		}
		catch {
			// 还没起来
		}
		await sleep(250)
	}
	return null
}

const wsUrl = await waitForDevtools()
if (!wsUrl) {
	console.error('FAIL: chrome devtools endpoint never came up')
	killTree(chrome)
	killTree(preview)
	process.exit(1)
}

const cdp = await CDP.connect(wsUrl)
mkdirSync(OUT, { recursive: true })

/* ────────────────────────── 探测 ────────────────────────── */

/** 打开一个 URL，等它真正稳定，返回 PROBE 的结果。 */
async function probe(sid, url, isRemote) {
	const loaded = new Promise((resolve) => {
		const onMsg = (ev) => {
			const m = JSON.parse(ev.data)
			if (m.method === 'Page.loadEventFired') {
				cdp.ws.removeEventListener('message', onMsg)
				resolve()
			}
		}
		cdp.ws.addEventListener('message', onMsg)
		setTimeout(resolve, 45000)
	})
	await cdp.send('Page.navigate', { url }, sid)
	await loaded
	// Nuxt 要水合 + 客户端渲染，静态站不需要；同一视口、同样滚动策略
	if (isRemote)
		await sleep(3000)
	await cdp.send('Runtime.evaluate', {
		expression: `(async () => {
			if (document.fonts && document.fonts.ready) await document.fonts.ready;
			const H = document.documentElement.scrollHeight;
			for (let y = 0; y < H; y += window.innerHeight * 0.8) {
				window.scrollTo(0, y);
				await new Promise(r => setTimeout(r, 90));
			}
			window.scrollTo(0, 0);
			await new Promise(r => setTimeout(r, 300));
		})()`,
		awaitPromise: true,
	}, sid)
	/*
	 * 等待时间必须两侧一致。原先按「静态站不需要等」只给 Astro 留了 700ms，
	 * 但 Astro 站同样有 Mermaid、灯箱、代码块折叠等异步渲染——
	 * 等不够会量到半成品。实测同一份 dist 两次测量差 2050px。
	 * 「静态站 = 同步渲染完」是错误直觉。
	 */
	await sleep(4500)

	/*
	 * 逐字段求值，每个字段一条独立的小表达式。
	 *
	 * 走过四版：整体 IIFE（被吞成 {}）、IIFE + JSON.stringify（仍是 {}）、
	 * async 包一层（仍是 {}），而同一时刻的 PING 恒正常。三版的共同点是
	 * 表达式太长太复杂；拆开之后每个都短到能稳定求值。
	 *
	 * 关键：任一字段取不到值就记为 __error 并让整页失败，绝不"两边都没取到
	 * 就算相等"——那正是上一版把八页全哑掉却报「无结构差异」+ 退出码 0 的原因。
	 */
	const out = {}
	const errors = []
	for (const [key, expr] of Object.entries(EXTRACTORS)) {
		try {
			const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
				expression: expr.startsWith('(') ? expr : `(${expr})`,
				returnByValue: true,
			}, sid)
			if (exceptionDetails)
				throw new Error(exceptionDetails.text)
			const v = result?.value
			if (v === undefined)
				throw new Error('undefined value')
			out[key] = v
		}
		catch (e) {
			out[key] = null
			errors.push(`${key}: ${e.message}`)
		}
	}
	if (errors.length) {
		out.__error = `字段提取失败 ${errors.length}/${Object.keys(EXTRACTORS).length}: ${errors.slice(0, 5).join('; ')}`
	}
	return out
}

/** 只取一个标量的最小探针，用来确认 evaluate 通道本身通不通。 */
const PING = 'JSON.stringify({ ok: 1, h: document.documentElement.scrollHeight, t: document.title.length })'

const { sessionId: sid } = await cdp.openPage()
await cdp.send('Emulation.setDeviceMetricsOverride', {
	width: 1600,
	height: 1000,
	deviceScaleFactor: 1,
	mobile: false,
}, sid)

const data = {}
for (const page of PAGES_TO_RUN) {
	process.stdout.write(`  ${page.name.padEnd(16)} `)
	// 主题统一压成 light：暗色下 computed style 会变，但文本不会，这里只取文本
	await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
		source: `try { localStorage.setItem('nuxt-color-mode','light') } catch (e) {}`,
	}, sid)
	const remote = await probe(sid, REMOTE + page.path, true)

	// 第一页先打一发 PING：evaluate 通道坏了的话后面每一页都会安静地失败，
	// 与其等 8 页跑完才发现，不如当场把通道状态打出来。
	if (page === PAGES_TO_RUN[0]) {
		const { result: pr, exceptionDetails: pe } = await cdp.send('Runtime.evaluate', {
			expression: `(async () => ${PING})()`,
			awaitPromise: true,
			returnByValue: true,
		}, sid)
		console.log(`PING ${pe ? 'EXC ' + pe.text : JSON.stringify(pr?.value)}`)
		if (!remote || remote.__error || !remote.docHeight) {
			console.log('  remote probe broken, raw =', JSON.stringify(remote).slice(0, 200))
		}
	}

	const local = await probe(sid, LOCAL + page.path, false)
	data[page.name] = { remote, local, path: page.path }
	const rh = remote?.docHeight ?? '?'
	const lh = local?.docHeight ?? '?'
	const d = (typeof rh === 'number' && typeof lh === 'number') ? rh - lh : '?'
	process.stdout.write(`Nuxt ${rh}px  Astro ${lh}px  diff ${d}\n`)
}

/* ────────────────────────── diff ────────────────────────── */

/** 深比较两个值，返回可读差异列表。 */
function diff(a, b, prefix, out, limit = 40) {
	if (out.length >= limit)
		return
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length)
			out.push(`${prefix}: 长度 ${a.length} vs ${b.length}`)
		const n = Math.min(a.length, b.length)
		for (let i = 0; i < n; i++) {
			if (JSON.stringify(a[i]) !== JSON.stringify(b[i]))
				out.push(`${prefix}[${i}]: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`)
			if (out.length >= limit)
				return
		}
		return
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
			diff(a[k], b[k], prefix ? `${prefix}.${k}` : k, out, limit)
		return
	}
	if (a !== b)
		out.push(`${prefix}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
}

const report = []
for (const [name, { remote, local }] of Object.entries(data)) {
	if (remote?.__error || local?.__error) {
		report.push({ page: name, fatal: remote?.__error || local?.__error })
		continue
	}
	const out = []
	// 探针字段已经是扁平结构（meta.* 前缀的键 + 顶层标量），
	// 直接整体深比较即可，diff 会自己按 key 前缀展开。
	diff(remote, local, '', out, 60)
	report.push({
		page: name,
		height: { nuxt: remote.docHeight, astro: local.docHeight, diff: remote.docHeight - local.docHeight },
		bodyTextLen: { nuxt: remote.bodyTextLen, astro: local.bodyTextLen, diff: remote.bodyTextLen - local.bodyTextLen },
		title: { nuxt: remote.title, astro: local.title },
		diffs: out,
	})
}

writeFileSync(join(OUT, 'dom-diff.json'), JSON.stringify({ remote: REMOTE, local: LOCAL, report }, null, 2))

const fatalCount = report.filter(r => r.fatal).length
const diffCount = report.filter(r => !r.fatal && r.diffs.length).length

console.log('\n================ 差异汇总 ================')
for (const r of report) {
	if (r.fatal) {
		console.log(`\n[${r.page}] 探测失败: ${r.fatal}`)
		continue
	}
	console.log(`\n[${r.page}] 高度 ${r.height.nuxt} vs ${r.height.astro} (差 ${r.height.diff})  文本量 ${r.bodyTextLen.nuxt} vs ${r.bodyTextLen.astro} (差 ${r.bodyTextLen.diff})`)
	if (!r.diffs.length) {
		console.log('  无结构差异')
		continue
	}
	for (const d of r.diffs)
		console.log(`  ${d}`)
}
console.log(`\n-> ${join(OUT, 'dom-diff.json')}`)
console.log(`\n探测失败 ${fatalCount} 页，有结构差异 ${diffCount} 页`)

/*
 * 探测失败必须让整轮非零退出。
 *
 * 第一版这里无条件 `process.exitCode = 0`，而探测失败的那几页在 diff 里全部
 * "相等"（undefined vs undefined），于是输出是一屏"无结构差异"、退出码 0——
 * 一次彻底的失败被报告成了全绿。这类门禁比没有门禁更危险。
 * 退出码 1 表示"有差异或没测成"，具体看控制台；退出码 0 只在全部测成且无差异时给。
 */
process.exitCode = (fatalCount > 0 || diffCount > 0) ? 1 : 0

/* ────────────────────────── 收尾 ────────────────────────── */

killTree(chrome)
killTree(preview)
for (let i = 0; i < 6; i++) {
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
		break
	}
	catch {
		await sleep(400)
	}
}
