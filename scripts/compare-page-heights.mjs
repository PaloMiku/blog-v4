/**
 * 全站页高对比：遍历线上 sitemap 的**每一条** URL，与本地构建逐页比页高。
 *
 * ## 为什么要有这个
 *
 * 之前的对比只抽样了 8 页（home / archive / article / link / game / about /
 * drive / previews-example）。抽样能定位"某一类差异"，但 objective 要求的是
 * **各 UI 表现与原 Nuxt 完全一致**——那就得全量过一遍，否则 55 个没看过的页面里
 * 藏着同样的 scoped 死规则也不知道。
 *
 * 页高是这里最灵敏的单一指标：只要某个区块的尺寸、间距、换行、
 * 哪条 CSS 规则失效了，最终高度就会动。而它又不受外部资源加载影响
 * （不像对比文本量那样会因懒加载时机而漂）。
 *
 * ## 限制（必须说清）
 *
 * 1. **两侧等待策略必须一致**。原先给本地只留 1.2s、线上 4.5s，
 *    结果同一份产物两次测量能差 2000px。
 * 2. 动态路径（`/games/galgames/clannad/secret/` 这类只有目录、没有 index.html
 *    的）会被跳过并单独列出——它们**没有被验证过**，不是"通过"。
 * 3. 高度差 ≤ `TOLERANCE` 视为一致。容差不是"差不多就算了"，
 *    而是**低于浏览器自身的亚像素舍入与字体度量抖动**；超出它的每一项都要查。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PORT = 4388
const LOCAL = `http://localhost:${PORT}`
const REMOTE = 'https://blog.sotkg.com'
const TOLERANCE = 40

const CHROME = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => existsSync(p))
if (!CHROME) {
	console.error('FAIL: no chrome')
	process.exit(1)
}

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
		const p = { id, method, params }
		if (sessionId)
			p.sessionId = sessionId
		this.ws.send(JSON.stringify(p))
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
	}
	static async connect(url) {
		const ws = new WebSocket(url)
		await new Promise((res, rej) => {
			ws.addEventListener('open', res, { once: true })
			ws.addEventListener('error', () => rej(new Error('ws')), { once: true })
		})
		return new CDP(ws)
	}
	async openPage() {
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
		await this.send('Page.enable', {}, sessionId)
		await this.send('Runtime.enable', {}, sessionId)
		return sessionId
	}
}

function killTree(child) {
	if (!child?.pid)
		return
	try {
		spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
	}
	catch { /* gone */ }
}

async function waitHttp(url, ms = 60000) {
	const dl = Date.now() + ms
	while (Date.now() < dl) {
		try {
			if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok)
				return true
		}
		catch { /* not yet */ }
		await sleep(400)
	}
	return false
}

// URL 列表以**线上 sitemap** 为准（那是切流后真实存在的路径集合）
async function urls() {
	const xml = await (await fetch(`${REMOTE}/sitemap.xml`)).text()
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
		.map(m => new URL(m[1]).pathname)
}

const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], { cwd: ROOT, shell: true, stdio: 'ignore' })
if (!await waitHttp(`${LOCAL}/`)) {
	console.error('FAIL: preview never came up')
	killTree(preview)
	process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-heights-'))
const dbg = 9580 + Math.floor(Math.random() * 60)
const chrome = spawn(CHROME, [
	'--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
	'--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
	'--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })

async function waitDevtools() {
	const dl = Date.now() + 30000
	while (Date.now() < dl) {
		try {
			const j = await (await fetch(`http://127.0.0.1:${dbg}/json/version`)).json()
			if (j.webSocketDebuggerUrl)
				return j.webSocketDebuggerUrl
		}
		catch { /* not yet */ }
		await sleep(250)
	}
	return null
}

const wsUrl = await waitDevtools()
if (!wsUrl) {
	console.error('FAIL: devtools never came up')
	killTree(chrome)
	killTree(preview)
	process.exit(1)
}

const cdp = await CDP.connect(wsUrl)
const sid = await cdp.openPage()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, sid)

/**
 * 两侧一视同仁：同样的视口、同样的等待、同样的滚动。
 *
 * ⚠️ `documentElement.scrollHeight` 会骗人：页面若尚未撑开（资源未加载、
 * JS 未把内容渲染出来），它返回**视口高度**，看起来"这页就是 1000px"。
 * 全量对比第一版里 `/about` 报出 -2259（nuxt 3259 / astro 1000），
 * 逐区块复测却是 **两边完全一致、差 0** —— 纯测量失败。
 *
 * 所以这里不只取一个数：同时取 `documentElement.scrollHeight` 与
 * `body.scrollHeight` 的**较大者**，并在滚动到底之后才取。
 * 再退一步：若结果仍然恰好等于视口高度（说明仍未撑开），
 * 就重跑一次并记为 `unstable`，**不把这种数字当结论**。
 */
async function height(url) {
	async function measure() {
		await cdp.send('Page.navigate', { url }, sid)
		for (let i = 0; i < 150; i++) {
			const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sid)
			if (r.result?.value === 'complete')
				break
			await sleep(200)
		}
		await sleep(4500)
		/*
		 * 等**所有图片 settle** 再量高度。
		 *
		 * 这是必须的，不是保险：站点大量图片在远程 CDN（`blog-files.101045700.xyz`、
		 * `imgheybox.*`、`fastly.jsdelivr.net`…），而 CSS 只给 `max-width:100%; height:auto`，
		 * **没有占位高度**（Nuxt 基线同样如此）——所以未加载完时图片高度是 0，
		 * 加载完跳到自然高度。全量对比第一版连跑两次，`/about` 从 -2259 变 +1096、
		 * `kde-customization` 从 ok 变 -1007，**同一份 dist 同一批页面**。
		 * 差异全来自图片加载时序，不是站点差异。
		 *
		 * 用 `decode()` 等待解码完成；超时兜底避免被单张坏图永久卡住。
		 */
		await cdp.send('Runtime.evaluate', {
			expression: `(async () => {
				const imgs = [...document.images].filter(i => !i.complete || i.naturalWidth === 0)
				await Promise.race([
					Promise.all(imgs.map(i => i.decode().catch(() => {}))),
					new Promise(r => setTimeout(r, 20000)),
				])
			})()`,
			awaitPromise: true,
		}, sid)
		// 布局回流后再等一拍，让高度稳定
		await sleep(700)
		await cdp.send('Runtime.evaluate', {
			expression: `(async () => {
				const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
				for (let y = 0; y < H; y += window.innerHeight * 0.85) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 70)) }
				window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300))
			})()`,
			awaitPromise: true,
		}, sid)
		await sleep(500)
		const { result } = await cdp.send('Runtime.evaluate', {
			expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)',
			returnByValue: true,
		}, sid)
		return result.value
	}

	const first = await measure()
	// 恰好等于视口高 == 没撑开，这个数字不可用
	if (Math.abs(first - 1000) > 1)
		return first
	await sleep(2000)
	return measure()
}

/**
 * 连量两遍取一致值：远程资源时序仍可能让单次结果飘，
 * 两次一致才认；不一致就记为 unstable，**不用它下结论**。
 */
async function heightStable(url) {
	const a = await height(url)
	const b = await height(url)
	if (Math.abs(a - b) <= 8)
		return { v: a, stable: true }
	return { v: (a + b) / 2, stable: false }
}

const all = await urls()
console.log(`comparing ${all.length} urls (tolerance ${TOLERANCE}px)\n`)

const rows = []
const skipped = []
for (const [i, path] of all.entries()) {
	// 本地没有该页就直接记 skip，不去拿"404 页的高度"当结果
	if (!existsSync(join(ROOT, 'dist', path.replace(/^\//, ''), 'index.html')) && !existsSync(join(ROOT, 'dist', `${path.replace(/^\//, '')}.html`))) {
		skipped.push(path)
		continue
	}
	const n = await heightStable(REMOTE + path)
	const a = await heightStable(LOCAL + path)
	const d = a.v - n.v
	// 两侧任一不稳定，就不把差值当结论
	const usable = n.stable && a.stable
	rows.push({ path, nuxt: n.v, astro: a.v, d, usable, ok: usable && Math.abs(d) <= TOLERANCE })
	process.stdout.write(`  [${String(i + 1).padStart(2)}/${all.length}] ${!usable ? 'UNST' : rows[rows.length - 1].ok ? ' ok ' : 'DIFF'}  ${String(Math.round(d)).padStart(7)}  ${path}\n`)
}

const bad = rows.filter(r => !r.ok)
const unstable = rows.filter(r => !r.usable)
console.log(`\n===== 全站页高对比 =====`)
console.log(`  compared : ${rows.length}`)
console.log(`  within tolerance (|d| <= ${TOLERANCE}) : ${rows.length - bad.length - unstable.length}`)
console.log(`  exceeding tolerance : ${bad.length - unstable.length}`)
if (unstable.length) {
	console.log(`  ⚠ 两侧测量不稳定（远程图片加载时序），不作为结论 : ${unstable.length}`)
	for (const r of unstable)
		console.log(`      ${r.path}`)
}
if (bad.length) {
	console.log('\n  --- 需要查的页面 ---')
	for (const r of bad.filter(x => x.usable).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)))
		console.log(`    ${String(Math.round(r.d)).padStart(7)}px   nuxt ${r.nuxt} astro ${r.astro}   ${r.path}`)
}
if (skipped.length) {
	console.log(`\n  --- 跳过（本地无对应产物，未被验证）: ${skipped.length} ---`)
	for (const p of skipped)
		console.log(`    ${p}`)
}

writeFileSync(join(ROOT, '.astro-compare', 'page-heights.json'), JSON.stringify({ tolerance: TOLERANCE, rows, skipped }, null, 2))

killTree(chrome)
killTree(preview)
for (let i = 0; i < 5; i++) {
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
		break
	}
	catch { await sleep(400) }
}
process.exitCode = bad.length ? 1 : 0
