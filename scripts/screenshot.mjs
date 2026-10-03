/**
 * 迁移效果截图：自拉起 astro preview，桌面/移动双视口 + 亮/暗双主题，跑完自己关掉。
 *
 * 为什么不直接用内置浏览器面板：面板宽度实测固定在 799px（移动端单栏），
 * 展示不出 Clarity 的三栏桌面布局，而三栏恰恰是这次迁移最该被看见的部分。
 * 这里用无头 Chrome + CDP 自己设视口，拿到 1600px 的真实桌面三栏。
 *
 * 零依赖：Node 24 自带全局 WebSocket，直连 CDP。
 * 不碰用户自己的 dev/preview 服务器——用独立端口 4397。
 *
 * 用法：node scripts/screenshot.mjs  或  BASE_URL=http://localhost:4398 node scripts/screenshot.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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

const DESKTOP = { width: 1600, height: 1000, dsf: 1 }
const MOBILE = { width: 420, height: 900, dsf: 2 }

/**
 * 截图清单。路径一律不带尾斜杠（原因见循环里的 url 拼接）。
 * maxH: 整页高度上限，超出裁掉——文章页整页能有 8000px，交付里没法看。
 */
const SHOTS = [
	{ name: '01-home-desktop-light', path: '/', vp: DESKTOP, maxH: 2600 },
	{ name: '02-home-desktop-dark', path: '/', vp: DESKTOP, mode: 'dark', maxH: 2600 },
	{ name: '03-home-mobile-light', path: '/', vp: MOBILE, maxH: 2200 },
	{ name: '04-archive', path: '/archive', vp: DESKTOP, maxH: 2400 },
	{ name: '05-article-misskey', path: '/2025/10/misskey-fediverse-deploy', vp: DESKTOP, maxH: 3200 },
	{ name: '06-article-mobile', path: '/2025/10/misskey-fediverse-deploy', vp: MOBILE, maxH: 2400 },
	{ name: '07-previews-example', path: '/previews/example', vp: DESKTOP, maxH: 9000 },
	{ name: '08-link-friends', path: '/link', vp: DESKTOP, maxH: 2400 },
	{ name: '09-game-clannad', path: '/games/galgames/clannad', vp: DESKTOP, maxH: 2800 },
	{ name: '10-about', path: '/about', vp: DESKTOP, maxH: 2400 },
	{ name: '11-drive', path: '/drive', vp: DESKTOP, maxH: 2000 },
	// 组件集大成页实高近 2 万 px，单张截不下也不可读，按段补拍
	{ name: '12-example-components-2', path: '/previews/example', vp: DESKTOP, slice: [8600, 13600] },
	{ name: '13-example-components-3', path: '/previews/example', vp: DESKTOP, slice: [13600, 18600] },
	{ name: '14-example-components-4', path: '/previews/example', vp: DESKTOP, slice: [18600, 24000] },
]

/*
 * 截图前逐个 HTTP 预检。这一条是被逼出来的：
 * 第一版给生产站抓基线时，路径被我无脑补了尾斜杠，EdgeOne 对深层路径直接回
 * 404 页，脚本却安安静静产出了 13 张"基线图"——每一张都是那张 404。
 * 肉眼看图要等到第 14 张才可能发现，而更糟的是它看起来"就是内容少"。
 * 截图工具自己不能判断内容对错，那就至少让它先确认 URL 活着。
 */
async function preflight(shots, baseUrl) {
	const bad = []
	for (const s of shots) {
		try {
			const r = await fetch(baseUrl + s.path, { redirect: 'follow', signal: AbortSignal.timeout(30000) })
			if (!r.ok)
				bad.push(`  HTTP ${r.status}  ${s.path}`)
		}
		catch (e) {
			bad.push(`  ERR       ${s.path}  ${e.message}`)
		}
	}
	if (bad.length) {
		console.error(`FAIL: ${bad.length} 个 URL 取不到内容，截图会全是错误页：`)
		for (const b of bad)
			console.error(b)
		process.exitCode = 1
		return false
	}
	return true
}

/*
 * 参数：
 *   --only=<子串>   只截名字含该子串的条目
 *   --out=<目录名>  输出目录（默认 .astro-shots）
 *   --base=<URL>    不用；远程站走环境变量 BASE_URL=https://blog.sotkg.com
 *
 * 抓远程站时 settle 更久：Nuxt 是客户端渲染 + hydration，本地静态站 readyState=complete
 * 就等于画完了，远程站还得等水合和懒加载，否则截到的是骨架屏。
 */
const argv = process.argv.slice(2)
const argOf = (k) => {
	const a = argv.find(x => x.startsWith(`--${k}=`))
	return a ? a.slice(k.length + 3) : null
}
const only = argOf('only')
const OUT = join(ROOT, argOf('out') || '.astro-shots')
const REMOTE = /^https?:\/\//.test(process.env.BASE_URL || '')

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

/* ────────────────────────── 预览服务 ────────────────────────── */

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

/** 杀整棵进程树：Windows 上 shell:true 会把命令交给 cmd.exe，只杀子 PID 会留下真的 node 进程。 */
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

let preview = null
let base = process.env.BASE_URL

if (!base) {
	const port = 4397
	preview = spawn('npx', ['astro', 'preview', '--port', String(port)], { cwd: ROOT, shell: true, stdio: 'ignore' })
	base = `http://localhost:${port}`
	if (!await waitForHttp(`${base}/`)) {
		console.error(`FAIL: preview server did not come up on ${base}`)
		killTree(preview)
		process.exit(1)
	}
	console.log(`preview on ${base}`)
}

/* ────────────────────────── Chrome ────────────────────────── */

const profile = mkdtempSync(join(tmpdir(), 'cdp-shot-'))
const debugPort = 9800 + Math.floor(Math.random() * 300)
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

/* ────────────────────────── 逐页截图 ────────────────────────── */

const { sessionId: sid, targetId } = await cdp.openPage()
const report = []

const SHOTS_TO_RUN = only ? SHOTS.filter(s => s.name.includes(only)) : SHOTS

if (!await preflight(SHOTS_TO_RUN, base)) {
	killTree(chrome)
	killTree(preview)
	process.exit(1)
}

for (const shot of SHOTS_TO_RUN) {
	const t0 = Date.now()
	process.stdout.write(`  ${shot.name} ... `)

	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: shot.vp.width,
		height: shot.vp.height,
		deviceScaleFactor: shot.vp.dsf,
		mobile: shot.vp.width < 700,
	}, sid)

	// 主题走 nuxt-color-mode（ColorMode 兼容键），必须在页面脚本跑之前写。
	await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
		source: `try { localStorage.setItem('nuxt-color-mode', ${JSON.stringify(shot.mode || 'light')}) } catch (e) {}`,
	}, sid)

	// 不补尾斜杠。生产站（Nuxt SSG + EdgeOne）实测 `/2025/10/xxx` 才是 200，
	// 补成 `/2025/10/xxx/` 直接吃到 EdgeOne 的 404 页——第一版就栽在这，
	// 注释写对了代码写反了，13 张基线图全是 404 才发现。
	// 本地 astro preview 两种都能命中，补不补无所谓，所以统一不补。
	const url = base + shot.path
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
	// 远程站（Nuxt 水合 + 第三方统计）比本地静态站慢一截，等它把客户端渲染做完
	if (REMOTE)
		await sleep(2500)

	// 等 webfont + 懒加载内容。
	await cdp.send('Runtime.evaluate', {
		expression: `
			(async () => {
				if (document.fonts && document.fonts.ready) await document.fonts.ready;
				// 逐步滚到底，让 IntersectionObserver / import() 的懒加载真正触发
				const H = document.documentElement.scrollHeight;
				for (let y = 0; y < H; y += window.innerHeight * 0.8) {
					window.scrollTo(0, y);
					await new Promise(r => setTimeout(r, 90));
				}
				window.scrollTo(0, H);
				await new Promise(r => setTimeout(r, 400));
				window.scrollTo(0, 0);
				await new Promise(r => setTimeout(r, 250));

				/*
				 * 解除吸底分页器，否则截图会撒谎。
				 *
				 * Pagination.astro 里是 \`position: sticky; bottom: min(2em, 5%)\`——
				 * 真实浏览器里它吸在视口底部，这是 Nuxt 原版的设计，没问题。
				 * 但 Page.captureScreenshot({captureBeyondViewport}) 会把整页压成一张长图，
				 * sticky 元素按当前 scrollY（这里已回 0）定位，于是「1 2 3 4」被画到
				 * 长图 y≈视口高度 处，看起来像跑进了文章列表中间——纯截图伪影。
				 * 临时改成 static 让它回到文档流末尾，位置就和真实观感一致。
				 * interaction-check.mjs 早就有对应的 [data-pagination-snapshot] 处理。
				 */
				if (!document.getElementById('__shot_unsticky')) {
					const st = document.createElement('style')
					st.id = '__shot_unsticky'
					st.textContent = '.pagination.sticky{position:static !important;bottom:auto !important;translate:none !important}'
					document.head.appendChild(st)
				}
				await new Promise(r => setTimeout(r, 200));
			})()`,
		awaitPromise: true,
	}, sid)
	await sleep(600)

	const { result: dims } = await cdp.send('Runtime.evaluate', {
		expression: '({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, dpr: devicePixelRatio, title: document.title })',
		returnByValue: true,
	}, sid)

	// slice 段拍：把 y 起点挪到 slice[0]，高度按 slice[1]-slice[0]，并夹到实际页高内。
	// 不夹会拿到一块空白——clip 超出文档时 CDP 不会报错，只会返回纯色图。
	const pageH = dims.value.h
	const clipW = Math.min(dims.value.w, shot.vp.width)
	let clipY = 0
	let clipH = Math.min(pageH, shot.maxH || pageH)
	if (shot.slice) {
		clipY = Math.min(shot.slice[0], Math.max(0, pageH - 1))
		clipH = Math.max(1, Math.min(shot.slice[1], pageH) - clipY)
	}
	const clip = { x: 0, y: clipY, width: clipW, height: clipH, scale: 1 }

	const { data } = await cdp.send('Page.captureScreenshot', {
		format: 'png',
		captureBeyondViewport: true,
		fromSurface: true,
		clip,
	}, sid)

	const file = join(OUT, `${shot.name}.png`)
	writeFileSync(file, Buffer.from(data, 'base64'))

	const truncated = clipY + clipH < pageH ? ` (到 ${clipY + clipH}/${pageH})` : ''
	process.stdout.write(`${clipW}x${clipH} @${dims.value.dpr}x @y=${clipY} -> ${shot.name}.png${truncated}  [${Date.now() - t0}ms]\n`)
	report.push({ ...shot, page: dims.value, file })
}

await cdp.send('Target.closeTarget', { targetId })

// 补拍时合并进已有报告，而不是整份覆盖掉
const reportFile = join(OUT, 'report.json')
let merged = report
try {
	const prev = JSON.parse(readFileSync(reportFile, 'utf8'))
	const byName = new Map(prev.map(r => [r.name, r]))
	for (const r of report)
		byName.set(r.name, r)
	merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
catch {
	// 首次运行，没有旧报告
}
writeFileSync(reportFile, JSON.stringify(merged, null, 2))

/* ────────────────────────── 收尾 ────────────────────────── */

killTree(chrome)
killTree(preview)
// 与 interaction-check.mjs 同一条教训：删不掉就要说，不能静默吞
let profileLeft = null
for (let attempt = 0; attempt < 6; attempt++) {
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
		profileLeft = null
		break
	}
	catch (e) {
		profileLeft = e
		await sleep(400)
	}
}
if (profileLeft)
	console.log(`WARN  临时 profile 删不掉: ${profile} (${profileLeft.code || profileLeft.message})`)

console.log(`\ndone: ${report.length} shots -> ${OUT}`)
process.exit(0)
