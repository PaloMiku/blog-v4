/**
 * 正文交互 —— **发现阶段**（不判定，只取证）
 *
 * 为什么不直接写断言：这一轮已经因为「靠静态文本猜」错了三次
 * （video-embed 实际 12 处不是 0、Tab 的具名插槽是 `#tab1` 裸行不是 `::tab#tab1`、
 *  Tab 的 props 在 YAML 块里所以开头行看着像裸 `::tab`）。
 * 凡是没在**渲染后的 DOM** 里看见过的东西，都不配当断言目标。
 *
 * 所以这里只做一件事：在真实 Chrome 里把每篇文章 `<article>` 内所有
 * 「看起来可交互」的元素的**实际标记** dump 出来。
 * 判定留给下一阶段的 check-prose-interactions.mjs。
 *
 * 自带一个纯 node:http 静态服务器伺服 .output/public（不起外部进程，
 * 免得留下需要清理的东西；也绝不碰用户自己的 4393/4400/4322）。
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { freemem, totalmem, tmpdir } from 'node:os'

const DIST = 'D:/Projects/blog-v4/.output/public'
const PORT = 4410

/* ── 内存守卫：低于 1.5GB 时无头 Chrome 的结论不可信，宁可不跑 ── */
const MIN_FREE_MB = 1500
const freeMB = Math.round(freemem() / 1024 / 1024)
if (freeMB < MIN_FREE_MB) {
	console.log(`SKIPPED: 空闲内存 ${freeMB}MB < ${MIN_FREE_MB}MB。这道探针需要约 700MB 给无头 Chrome，`)
	console.log('  内存不足时它会把「点了没反应」判成组件坏了 —— 那是宿主机的问题，不是站点的问题。')
	process.exit(0)
}

/* ── 静态服务器 ── */
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.xml': 'application/xml; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.webm': 'video/webm',
	'.mp4': 'video/mp4',
}

function resolveFile(urlPath) {
	const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
	const rel = clean.replace(/^\/+/, '')
	const cands = [
		join(DIST, rel),
		join(DIST, rel, 'index.html'),
		join(DIST, `${rel}.html`),
		join(DIST, rel, 'index.htm'),
	]
	for (const c of cands) {
		if (existsSync(c) && statSync(c).isFile())
			return c
	}
	return null
}

const server = createServer((req, res) => {
	const file = resolveFile(req.url || '/')
	if (!file) {
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('not found')
		return
	}
	res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
	res.end(readFileSync(file))
})
await new Promise((r) => { server.listen(PORT, '127.0.0.1', r) })
const base = `http://127.0.0.1:${PORT}`

/* ── CDP 客户端（沿用 astro-site/scripts/interaction-check.mjs 里已验证的实现形状）── */
const CHROME = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => existsSync(p))
if (!CHROME) {
	console.error('FAIL: 找不到 Chrome/Edge')
	process.exit(1)
}

class CDP {
	constructor(ws) {
		this.ws = ws
		this.id = 0
		this.pending = new Map()
		this.handlers = new Map()
		ws.addEventListener('message', (ev) => {
			const msg = JSON.parse(ev.data)
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id)
				this.pending.delete(msg.id)
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
				return
			}
			const list = this.handlers.get(msg.method)
			if (list)
				for (const fn of list) fn(msg.params, msg.sessionId)
		})
	}
	on(method, fn) {
		if (!this.handlers.has(method))
			this.handlers.set(method, [])
		this.handlers.get(method).push(fn)
	}
	static async connect(url) {
		const ws = new WebSocket(url)
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true })
			ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
		})
		return new CDP(ws)
	}
	send(method, params = {}, sessionId) {
		const id = ++this.id
		const payload = { id, method, params }
		if (sessionId)
			payload.sessionId = sessionId
		this.ws.send(JSON.stringify(payload))
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
	}
	async openPage() {
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
		await this.send('Page.enable', {}, sessionId)
		await this.send('Runtime.enable', {}, sessionId)
		return new Page(this, sessionId, targetId)
	}
}

class Page {
	constructor(cdp, sid, targetId) {
		this.cdp = cdp
		this.sid = sid
		this.targetId = targetId
		this.errors = []
		cdp.on('Runtime.exceptionThrown', (p, s) => {
			if (s === sid)
				this.errors.push(`exception: ${p.exceptionDetails?.text} ${p.exceptionDetails?.exception?.description || ''}`.trim())
		})
		cdp.on('Log.entryAdded', (p, s) => {
			if (s === sid && p.entry.level === 'error')
				this.errors.push(`log: ${p.entry.text}`)
		})
	}
	async goto(url) {
		await this.cdp.send('Page.navigate', { url }, this.sid)
		await sleep(500)
		for (let i = 0; i < 60; i++) {
			const { result } = await this.cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, this.sid)
			if (result.value === 'complete')
				break
			await sleep(150)
		}
		await sleep(900)
	}
	async eval(expression) {
		const { result, exceptionDetails } = await this.cdp.send('Runtime.evaluate', {
			expression: `(() => { try { return JSON.parse(JSON.stringify(${expression})) } catch (e) { return { __error: String(e) } } })()`,
			returnByValue: true,
			awaitPromise: true,
		}, this.sid)
		if (exceptionDetails)
			return { __error: exceptionDetails.text }
		return result.value
	}
	async close() {
		await this.cdp.send('Target.closeTarget', { targetId: this.targetId })
	}
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-prose-'))
const debugPort = 9500 + Math.floor(Math.random() * 400)
const chrome = spawn(CHROME, [
	'--headless=new',
	`--remote-debugging-port=${debugPort}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'--disable-extensions',
	'--autoplay-policy=no-user-gesture-required',
	'--window-size=1440,900',
	'about:blank',
], { stdio: 'ignore' })

function killTree(child) {
	if (!child || child.killed)
		return
	try {
		child.kill()
	}
	catch { /* 已退出 */ }
}

async function waitForDevtools() {
	const deadline = Date.now() + 30000
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
			const j = await r.json()
			if (j.webSocketDebuggerUrl)
				return j.webSocketDebuggerUrl
		}
		catch { /* 还没起来 */ }
		await sleep(250)
	}
	return null
}

const wsUrl = await waitForDevtools()
if (!wsUrl) {
	console.error('FAIL: chrome devtools 端点没起来')
	killTree(chrome)
	server.close()
	process.exit(1)
}
const cdp = await CDP.connect(wsUrl)

/* ── 采集：把 <article> 里所有可交互元素的真实标记 dump 出来 ── */
const HARVEST = `(() => {
	const art = document.querySelector('article')
	if (!art) return { noArticle: true }
	const out = { counts: {}, items: [], media: [] }
	// 组件根容器：MDC 组件会带上自己的类，先把出现过的类名与次数记下来
	for (const el of art.querySelectorAll('*')) {
		for (const c of el.classList) out.counts[c] = (out.counts[c] || 0) + 1
	}
	// 可交互元素：真的能点 / 能聚焦 / 有 role
	const sel = 'a[href], button, summary, [role=button], [tabindex], details, video, audio, iframe, input, select, [onclick]'
	for (const el of art.querySelectorAll(sel)) {
		const r = el.getBoundingClientRect()
		out.items.push({
			tag: el.tagName.toLowerCase(),
			cls: (el.getAttribute('class') || '').slice(0, 60),
			type: el.getAttribute('type') || '',
			aria: el.getAttribute('aria-label') || '',
			title: (el.getAttribute('title') || '').slice(0, 40),
			href: (el.getAttribute('href') || '').slice(0, 90),
			src: (el.getAttribute('src') || '').slice(0, 110),
			target: el.getAttribute('target') || '',
			open: el.hasAttribute('open'),
			hidden: el.hasAttribute('hidden'),
			text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50),
			w: Math.round(r.width),
			h: Math.round(r.height),
		})
	}
	// 媒体元素的真实加载状态（这才是「点起来能不能用」的关键）
	for (const v of art.querySelectorAll('video, audio')) {
		out.media.push({
			kind: v.tagName.toLowerCase(),
			src: (v.currentSrc || v.src || '').slice(0, 120),
			readyState: v.readyState,
			networkState: v.networkState,
			error: v.error ? v.error.code : null,
			videoWidth: v.videoWidth || 0,
			videoHeight: v.videoHeight || 0,
			duration: v.duration,
		})
	}
	out.iframes = [...art.querySelectorAll('iframe')].map(f => ({
		src: (f.getAttribute('src') || '').slice(0, 140),
		w: Math.round(f.getBoundingClientRect().width),
		h: Math.round(f.getBoundingClientRect().height),
	}))
	out.codeblocks = art.querySelectorAll('pre').length
	out.tables = art.querySelectorAll('table').length
	out.inlineCode = art.querySelectorAll('code').length
	out.figures = art.querySelectorAll('figure').length
	return out
})()`

/** 按普查结果挑的代表页：每页覆盖一类组件 */
const PAGES = [
	['/2025/10/nukitashi-gv-end/', 'Music+Pic+Folding+InfoCard+LinkBanner+Alert+Chat+Quote'],
	['/2025/11/riddle-joker/', 'Music x4 + VideoEmbed(bilibili)'],
	['/2025/12/love-love-school-linux-chinese/', 'VideoEmbed(raw, steam CDN)'],
	['/2025/10/clarity-resource-list/', 'Tab(plain) + ResourceList + Badge'],
	['/games/galgames/clannad/', 'Tab(combobox, 15 tabs) + Folding + LinkCard + VideoEmbed'],
	['/drive/', 'Tab + Folding + LinkCard + Alert'],
	['/2025/05/koichoco-psp/', 'Folding + LinkBanner + Pic + VideoEmbed'],
	['/about/', 'ProjectGroup + Tab'],
	['/games/galgames/sothewitch/', 'CardList + Folding + LinkCard + ResourceList + VideoEmbed'],
	['/2024/03/takagi/', '普通长文：代码块 / 表格 / 外链'],
]

const page = await cdp.openPage()
for (const [route, why] of PAGES) {
	await page.goto(`${base}${route}`)
	await sleep(1200)
	const h = await page.eval(HARVEST)
	console.log(`\n${'═'.repeat(78)}`)
	console.log(`▶ ${route}    (${why})`)
	console.log(`${'═'.repeat(78)}`)
	if (!h || h.noArticle) {
		console.log('  ⚠ 没有 <article>（该路由可能不是文章页，或构建产物里结构不同）')
		continue
	}
	console.log(`  结构: pre=${h.codeblocks} table=${h.tables} code=${h.inlineCode} figure=${h.figures} iframe=${(h.iframes || []).length}`)
	if (h.errors !== undefined) { /* noop */ }
	if (page.errors.length) {
		console.log(`  ⚠ 控制台错误 ${page.errors.length} 条:`)
		for (const e of page.errors.slice(0, 5))
			console.log(`      ${e.slice(0, 160)}`)
	}
	page.errors.length = 0

	// 组件类名出现次数（判断组件真的渲染了）
	const interesting = Object.entries(h.counts)
		.filter(([c]) => /^(alert|folding|tab|music|video|pic|info-card|card|link-card|link-banner|resource-list|project-group|quote|badge|chat|prose|paragraph|codeblock|z-)/.test(c))
		.sort((a, b) => b[1] - a[1])
	console.log(`  组件类: ${interesting.map(([c, n]) => `${c}×${n}`).join('  ') || '(无)'}`)

	if (h.media?.length) {
		console.log('  ── 媒体加载状态 ──')
		for (const m of h.media)
			console.log(`      ${m.kind}  readyState=${m.readyState} networkState=${m.networkState} error=${m.error} ${m.videoWidth}×${m.videoHeight} dur=${m.duration}\n         src=${m.src}`)
	}
	if (h.iframes?.length) {
		console.log('  ── iframe ──')
		for (const f of h.iframes)
			console.log(`      ${f.w}×${f.h}  ${f.src}`)
	}

	// 可交互元素按「类型」归类打印，只打有信息量的
	const byTag = {}
	for (const it of h.items)
		(byTag[it.tag] ||= []).push(it)
	for (const [tag, list] of Object.entries(byTag)) {
		if (tag === 'a' && list.length > 12) {
			console.log(`  ── a ×${list.length}（只列前 8）──`)
			for (const it of list.slice(0, 8))
				console.log(`      [${it.cls || '-'}] href=${it.href} target=${it.target} "${it.text}"`)
			continue
		}
		if (tag === 'code')
			continue
		console.log(`  ── ${tag} ×${list.length} ──`)
		for (const it of list.slice(0, 10))
			console.log(`      [${it.cls || '-'}]${it.type ? ` type=${it.type}` : ''}${it.aria ? ` aria="${it.aria}"` : ''}${it.title ? ` title="${it.title}"` : ''}${it.open ? ' [open]' : ''}${it.hidden ? ' [hidden]' : ''} ${it.w}×${it.h} "${it.text}"`)
	}
}

await page.close()
cdp.ws.close()
killTree(chrome)
server.close()
console.log(`\n发现阶段结束。`)
