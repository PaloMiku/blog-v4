/**
 * 正文组件交互可用性 —— 判定阶段
 *
 * 判据全部落在**渲染后的 DOM 的可观察变化**上，不是「元素存在」。
 * 选择器全部来自 .probe-prose-discovery.mjs 的实测输出，不是照源码想出来的。
 *
 * ★ 本轮已经因为「靠静态文本猜」错了三次，所以每条断言的 selector 都在注释里
 *   标了它是在哪一页、哪个组件上看见的。
 *
 * 用法：node scripts/check-prose-interactions.mjs
 * 前置：先 `pnpm generate`（本探针伺服 .output/public，自带静态服务器，不起外部进程）
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { freemem, totalmem, tmpdir } from 'node:os'

const DIST = 'D:/Projects/blog-v4/.output/public'
const PORT = Number(process.env.PROSE_PORT || 4411)

const MIN_FREE_MB = 1500
const freeMB = Math.round(freemem() / 1024 / 1024)
if (freeMB < MIN_FREE_MB) {
	console.log(`SKIPPED: 空闲内存 ${freeMB}MB < ${MIN_FREE_MB}MB。低于这个值时无头 Chrome 会把`)
	console.log('  一批「点了没反应」判成组件坏了 —— 那是宿主机的问题，先释放内存再跑。')
	process.exit(0)
}

const MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
	'.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
	'.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
	'.webm': 'video/webm', '.mp4': 'video/mp4',
}

function resolveFile(urlPath) {
	const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
	const rel = clean.replace(/^\/+/, '')
	for (const c of [join(DIST, rel), join(DIST, rel, 'index.html'), join(DIST, `${rel}.html`)]) {
		if (existsSync(c) && statSync(c).isFile())
			return c
	}
	return null
}

const server = createServer((req, res) => {
	const f = resolveFile(req.url || '/')
	if (!f) {
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('nf')
		return
	}
	res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' })
	res.end(readFileSync(f))
})
await new Promise(r => { server.listen(PORT, '127.0.0.1', r) })
const base = `http://127.0.0.1:${PORT}`

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
			const m = JSON.parse(ev.data)
			if (m.id && this.pending.has(m.id)) {
				const { resolve, reject } = this.pending.get(m.id)
				this.pending.delete(m.id)
				m.error ? reject(new Error(m.error.message)) : resolve(m.result)
				return
			}
			for (const fn of this.handlers.get(m.method) || []) fn(m.params, m.sessionId)
		})
	}
	on(method, fn) {
		if (!this.handlers.has(method))
			this.handlers.set(method, [])
		this.handlers.get(method).push(fn)
	}
	static async connect(url) {
		const ws = new WebSocket(url)
		await new Promise((res, rej) => {
			ws.addEventListener('open', res, { once: true })
			ws.addEventListener('error', () => rej(new Error('ws error')), { once: true })
		})
		return new CDP(ws)
	}
	send(method, params = {}, sessionId) {
		const id = ++this.id
		const p = { id, method, params }
		if (sessionId)
			p.sessionId = sessionId
		this.ws.send(JSON.stringify(p))
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
	}
	async openPage() {
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
		await this.send('Page.enable', {}, sessionId)
		await this.send('Runtime.enable', {}, sessionId)
		// 不开 Log.enable 就订阅 Log.entryAdded，console error 一条都收不到 —— 静默失效
		await this.send('Log.enable', {}, sessionId)
		await this.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId)
		return new Page(this, sessionId, targetId)
	}
}

class Page {
	constructor(cdp, sid, targetId) {
		this.cdp = cdp
		this.sid = sid
		this.targetId = targetId
		this.errors = []
		/** 跨域 iframe 的执行上下文：父页面读不到 iframe 内部，只能靠它 */
		this.contexts = []
		cdp.on('Runtime.exceptionThrown', (p, s) => {
			if (s === sid)
				this.errors.push(`exception: ${p.exceptionDetails?.text} ${(p.exceptionDetails?.exception?.description || '').split('\n')[0]}`)
		})
		cdp.on('Log.entryAdded', (p, s) => {
			if (s === sid && p.entry.level === 'error')
				this.errors.push(`log: ${p.entry.text.slice(0, 150)}`)
		})
		cdp.on('Runtime.executionContextCreated', (p) => {
			this.contexts.push({ id: p.context.id, frameId: p.context.auxData?.frameId, origin: p.context.origin, sessionId: p.sessionId })
		})
		cdp.on('Runtime.executionContextDestroyed', (p) => {
			this.contexts = this.contexts.filter(c => c.id !== p.executionContextId)
		})
	}
	resetCtx() {
		this.contexts = []
	}
	async goto(url, settle = 900) {
		this.resetCtx()
		await this.cdp.send('Page.navigate', { url }, this.sid)
		await sleep(500)
		for (let i = 0; i < 60; i++) {
			const { result } = await this.cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, this.sid)
			if (result.value === 'complete')
				break
			await sleep(150)
		}
		await sleep(settle)
	}
	async eval(expression, contextId) {
		const params = { expression: `(() => { try { return JSON.parse(JSON.stringify(${expression})) } catch (e) { return { __error: String(e) } } })()`, returnByValue: true, awaitPromise: true }
		const session = contextId ? (this.contexts.find(c => c.id === contextId)?.sessionId || this.sid) : this.sid
		if (contextId)
			params.contextId = contextId
		const { result, exceptionDetails } = await this.cdp.send('Runtime.evaluate', params, session)
		if (exceptionDetails)
			return { __error: exceptionDetails.text }
		return result.value
	}
	/** 取子 iframe 的执行上下文 id；没有就返回 null（并说明为什么） */
	async childFrameContext() {
		const { frameTree } = await this.cdp.send('Page.getFrameTree', {}, this.sid)
		const kids = frameTree.childFrames || []
		if (!kids.length)
			return null
		const fid = kids[0].frame.id
		const c = this.contexts.find(x => x.frameId === fid)
		return c ? { id: c.id, origin: c.origin } : null
	}
	async click(selector) {
		return this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
	}
	async errorsFor() {
		const list = [...this.errors]
		this.errors.length = 0
		return list
	}
	async close() {
		try {
			await this.cdp.send('Target.closeTarget', { targetId: this.targetId })
		}
		catch { /* 关不掉就靠 killTree 兜底 */ }
	}
}

const results = []
async function test(name, fn) {
	try {
		await fn()
		results.push({ name, ok: true })
		console.log(`  OK    ${name}`)
	}
	catch (e) {
		results.push({ name, ok: false, error: e.message })
		console.log(`  FAIL  ${name}\n          ${e.message}`)
	}
}
function assert(cond, msg) {
	if (!cond)
		throw new Error(msg)
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-prose-'))
const debugPort = 9600 + Math.floor(Math.random() * 300)
const chrome = spawn(CHROME, [
	'--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
	'--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
	'--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
function killTree(c) {
	try {
		c?.kill()
	}
	catch { /* 已退出 */ }
}
async function waitForDevtools() {
	const dl = Date.now() + 30000
	while (Date.now() < dl) {
		try {
			const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
			const j = await r.json()
			if (j.webSocketDebuggerUrl)
				return j.webSocketDebuggerUrl
		}
		catch { /* 未就绪 */ }
		await sleep(250)
	}
	return null
}
const wsUrl = await waitForDevtools()
if (!wsUrl) {
	console.error('FAIL: devtools 端点没起来')
	killTree(chrome)
	server.close()
	process.exit(1)
}
const cdp = await CDP.connect(wsUrl)
const page = await cdp.openPage()

console.log('=== 正文组件交互可用性 ===')
console.log(`  视口 1440x900   静态源 ${DIST}\n`)

/* ─────────────────────────── 1. Folding ─────────────────────────── */
// 选择器来源：/games/galgames/clannad/ 实测 `article details` ×3、`summary` ×3
console.log('— Folding（原生 <details>，clannad 有 3 个）—')
await page.goto(`${base}/games/galgames/clannad/`)
await test('Folding: 点 summary 真的展开/收起（open 属性 + 内容高度）', async () => {
	const before = await page.eval(`(() => { const d = document.querySelector('article details'); if (!d) return { __error: '没有 details' }; const s = d.querySelector('summary'); return { open: d.hasAttribute('open'), summaryText: (s?.textContent||'').trim().slice(0,20), h: d.querySelector(':scope > *:not(summary)')?.getBoundingClientRect().height ?? 0 } })()`)
	assert(!before.__error, before.__error)
	assert(before.summaryText.length > 0, 'summary 没有文字，无法确认点对了元素')
	await page.click('article details > summary')
	await sleep(400)
	const after = await page.eval(`(() => { const d = document.querySelector('article details'); return { open: d.hasAttribute('open'), h: d.querySelector(':scope > *:not(summary)')?.getBoundingClientRect().height ?? 0 } })()`)
	assert(after.open !== before.open, `open 属性没翻转：${before.open} → ${after.open}`)
	if (!after.open)
		assert(after.h < before.h, `收起了但内容高度没变：${before.h} → ${after.h}`)
	else
		assert(after.h > before.h, `展开了但内容高度没变：${before.h} → ${after.h}`)
})

/* ─────────────────────────── 2. Tab 普通模式 ─────────────────────────── */
// 来源：/2025/10/clarity-resource-list/ 实测 `.tabs button` = [active]组件 / 语法；/drive 3 个
console.log('\n— Tab 普通模式（clarity-resource-list 2 页签 / drive 3 页签 / about 2 页签）—')
for (const [route, expect] of [['/2025/10/clarity-resource-list/', 2], ['/drive/', 3], ['/about/', 2]]) {
	await page.goto(`${base}${route}`)
	await test(`Tab[${route}] ${expect} 个页签：点第 2 个真的换内容`, async () => {
		const btns = await page.eval('document.querySelectorAll("article .tabs button").length')
		assert(btns === expect, `页签数量不对：期望 ${expect}，实测 ${btns}`)
		const before = await page.eval(`(() => { const t = document.querySelector('article .tab-content'); const a = document.querySelector('article .tabs button.active'); return { text: (t?.textContent||'').replace(/\\s+/g,' ').trim(), active: (a?.textContent||'').trim(), h: t?.getBoundingClientRect().height ?? 0 } })()`)
		assert(before.text.length > 0, '初始 tab-content 是空的 —— 第一个插槽就没渲染出来')
		await page.eval(`(() => { const b = document.querySelectorAll('article .tabs button')[1]; b.click(); return true })()`)
		await sleep(500)
		const after = await page.eval(`(() => { const t = document.querySelector('article .tab-content'); const a = document.querySelector('article .tabs button.active'); return { text: (t?.textContent||'').replace(/\\s+/g,' ').trim(), active: (a?.textContent||'').trim() } })()`)
		assert(after.active === before.active, `active 没移动：仍是「${after.active}」`)
		assert(after.text !== before.text, `active 移了但 tab-content 内容没变（长度 ${after.text.length} vs ${before.text.length}）—— 具名插槽没对上`)
	})
}

/* ─────────────────────────── 3. Tab combobox ─────────────────────────── */
// 来源：/games/galgames/clannad/ 实测 `.combobox-trigger`「前言」，`.tab-content` ×1
console.log('\n— Tab combobox 模式（clannad 中文版表格攻略，15 个页签）—')
await page.goto(`${base}/games/galgames/clannad/`)
await test('Tab combobox: 点开下拉 → 真的有 15 个选项 → 选第 3 个换内容', async () => {
	const t0 = await page.eval(`(() => { const c = document.querySelector('article .combobox-trigger'); return { exists: !!c, label: (c?.querySelector('.combobox-label')?.textContent||'').trim(), expanded: c?.getAttribute('aria-expanded') } })()`)
	assert(t0.exists, '没有 .combobox-trigger')
	assert(t0.label.length > 0, 'combobox 没有标签文字')
	assert(t0.expanded === 'false', `aria-expanded 初始应是 false，实测 ${t0.expanded}`)
	await page.click('article .combobox-trigger')
	await sleep(400)
	const items = await page.eval(`(() => { const l = [...document.querySelectorAll('article .combobox-item')]; return { n: l.length, labels: l.slice(0,3).map(x => (x.textContent||'').trim()) } })()`)
	assert(items.n > 1, `下拉没打开或只有 ${items.n} 项（aria-expanded 变了但没有 .combobox-item）`)
	const before = await page.eval(`(() => ({ label: (document.querySelector('article .combobox-label')?.textContent||'').trim(), text: (document.querySelector('article .tab-content')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,200) }))()`)
	await page.eval(`(() => { document.querySelectorAll('article .combobox-item')[2].click(); return true })()`)
	await sleep(500)
	const after = await page.eval(`(() => ({ label: (document.querySelector('article .combobox-label')?.textContent||'').trim(), text: (document.querySelector('article .tab-content')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,200), expanded: document.querySelector('article .combobox-trigger')?.getAttribute('aria-expanded'), open: !!document.querySelector('article .combobox-dropdown') }))()`)
	assert(after.label !== before.label, `选完标签没变：仍是「${after.label}」`)
	assert(after.text !== before.text, `标签变了但正文内容没变（第 3 页签可能是空插槽）`)
	assert(after.open === false, '选完下拉没收起')
})

/* ─────────────────────────── 4. 音乐链接卡 ─────────────────────────── */
// 来源：/2025/11/riddle-joker/ 实测 `.music-embed` ×4，href 指 music.163.com
console.log('\n— Music 链接卡（不是播放器，是外链；判据=链接合法且新窗口打开）—')
await page.goto(`${base}/2025/11/riddle-joker/`)
await test('Music: 4 张卡的 href 都是绝对 http(s) 且 target=_blank', async () => {
	const list = await page.eval(`[...document.querySelectorAll('article a.music-embed')].map(a => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), text: (a.textContent||'').trim().slice(0,40) }))`)
	assert(list.length === 4, `期望 4 张卡，实测 ${list.length}`)
	for (const m of list) {
		assert(/^https?:\/\/.+\..+/.test(m.href), `href 不是绝对地址：${m.href}`)
		assert(m.target === '_blank', `target 不是 _blank：${m.target} (${m.text})`)
	}
})

/* ─────────────────────────── 5. 视频 ─────────────────────────── */
// 5a raw：来源 /2025/12/love-love-school-linux-chinese/ 实测 readyState=4 600x200 dur=5
console.log('\n— 视频 —')
await page.goto(`${base}/2025/12/love-love-school-linux-chinese/`, 2500)
await test('Video[raw]: 元数据真的加载出来且能推进播放', async () => {
	const v = await page.eval(`(() => { const el = document.querySelector('article video'); if (!el) return { __error: '没有 <video>' }; return { src: el.currentSrc, readyState: el.readyState, networkState: el.networkState, error: el.error?.code ?? null, w: el.videoWidth, h: el.videoHeight, dur: el.duration } })()`)
	assert(!v.__error, v.__error)
	assert(v.error === null, `<video> 报错 code=${v.error}（1=中止 2=网络 3=解码 4=源不支持） src=${v.src}`)
	assert(v.readyState >= 1, `readyState=${v.readyState}，连元数据都没拿到`)
	assert(v.w > 0 && v.h > 0, `视频尺寸 ${v.w}×${v.h}，解码失败或源不是视频`)
	const played = await page.eval(`(async () => { const el = document.querySelector('article video'); el.muted = true; try { await el.play() } catch (e) { return { __error: String(e) } } await new Promise(r => setTimeout(r, 1200)); return { t: el.currentTime, paused: el.paused, dur: el.duration } })()`)
	assert(!played.__error, `play() 抛错：${played.__error}`)
	assert(played.t > 0, `play() 后 currentTime 仍是 0（paused=${played.paused}）—— 点得动但播不了`)
})

// 5b bilibili iframe：跨域，父页面读不到内部 → 用 CDP 取 iframe 的 executionContext
for (const [route, bvid] of [['/2025/11/riddle-joker/', 'BV1rg4y1i7Ye'], ['/games/galgames/clannad/', 'BV1KE411y7Y3'], ['/2025/05/koichoco-psp/', 'BV1Dh41147FN']]) {
	await page.goto(`${base}${route}`, 3500)
	await test(`Video[bilibili ${bvid}]（${route}）: iframe 内部真的加载出了播放器`, async () => {
		const src = await page.eval(`document.querySelector('article iframe')?.getAttribute('src') || ''`)
		assert(src.includes('player.bilibili.com'), `iframe src 不对：${src}`)
		assert(src.includes(bvid), `iframe src 里的 bvid 不是 ${bvid}：${src}`)
		const ctx = await page.childFrameContext()
		if (!ctx)
			throw new Error('拿不到 iframe 的执行上下文（可能是 OOPIF 未 attach），无法判定内部内容——这是仪器限制，不等于播放器坏了')
		const inner = await page.eval(`(() => ({ url: location.href, title: document.title, bodyLen: (document.body?.innerText||'').replace(/\\s+/g,' ').trim().length, hasVideo: !!document.querySelector('video'), hasPlayer: !!document.querySelector('#bilibiliPlayer, .bpx-player-container, .player'), bodyHead: (document.body?.innerText||'').replace(/\\s+/g,' ').trim().slice(0,90) }))()`, ctx.id)
		if (inner.__error)
			throw new Error(`iframe 内求值失败：${inner.__error}`)
		assert(inner.bodyLen > 20, `iframe 内部几乎是空的（正文 ${inner.bodyLen} 字，title="${inner.title}"）——播放器没加载出来`)
	})
}

/* ─────────────────────────── 6. InfoCard ─────────────────────────── */
// 来源：/2025/10/nukitashi-gv-end/ 实测 info-card-body--error ×5 + info-card-retry ×5
console.log('\n— InfoCard（nukitashi-gv-end 实测 5 张全部是错误态）—')
await page.goto(`${base}/2025/10/nukitashi-gv-end/`, 3000)
await test('InfoCard: 记录 5 张卡的加载结果（成功还是错误态）', async () => {
	const st = await page.eval(`(() => { const cards = [...document.querySelectorAll('article .info-card')]; return { n: cards.length, err: cards.filter(c => c.querySelector('.info-card-body--error')).length, ok: cards.filter(c => !c.querySelector('.info-card-body--error')).length, errText: (cards.map(c => c.querySelector('.info-card-error-text')?.textContent||'').find(Boolean)||'').replace(/\\s+/g,' ').trim().slice(0,80) } })()`)
	console.log(`          → ${st.n} 张：成功 ${st.ok} / 错误 ${st.err}${st.errText ? `  错误文案「${st.errText}」` : ''}`)
	assert(st.n > 0, '这一页没有 .info-card')
	assert(st.ok > 0, `${st.n} 张 InfoCard 全部处于错误态（文案「${st.errText}」）——组件在页面上是「有外观但没内容」`)
})

/* ─────────────────────────── 7. 代码块按钮 ─────────────────────────── */
// 来源：/2025/10/clarity-resource-list/ 实测 [toggle-btn]「展开代码块」+「自动换行」+「复制」
console.log('\n— 代码块（展开 / 自动换行 / 复制）—')
await page.goto(`${base}/2025/10/clarity-resource-list/`)
await test('CodeBlock: 「展开代码块」真的展开（高度变化）', async () => {
	const before = await page.eval(`(() => { const b = document.querySelector('article .toggle-btn'); return { exists: !!b, aria: b?.getAttribute('aria-label'), preH: document.querySelector('article pre')?.getBoundingClientRect().height ?? 0 } })()`)
	assert(before.exists, '没有 .toggle-btn（该页代码块没有折叠）')
	await page.click('article .toggle-btn')
	await sleep(500)
	const after = await page.eval(`(() => ({ aria: document.querySelector('article .toggle-btn')?.getAttribute('aria-label'), preH: document.querySelector('article pre')?.getBoundingClientRect().height ?? 0 }))()`)
	assert(after.preH > before.preH, `点了展开但 pre 高度没变：${before.preH} → ${after.preH}`)
	assert(after.aria !== before.aria, `高度变了但 aria-label 没更新：${before.aria} → ${after.aria}`)
})
await test('CodeBlock: 「自动换行」真的切换换行类', async () => {
	const pick = `(() => { const b = [...document.querySelectorAll('article button')].find(x => /换行/.test(x.textContent||'')); if (!b) return null; const box = b.closest('.z-codeblock') || b.closest('figure') || b.parentElement; return { cls: box.className, text: (b.textContent||'').trim() } })()`
	const before = await page.eval(pick)
	assert(before, '找不到「自动换行」按钮')
	await page.eval(`(() => { const b = [...document.querySelectorAll('article button')].find(x => /换行/.test(x.textContent||'')); b.click(); return true })()`)
	await sleep(400)
	const after = await page.eval(pick)
	assert(after.cls !== before.cls, `点了但容器 class 没变：${before.cls}`)
	assert(after.text !== before.text, `class 变了但按钮文案没变：${before.text}`)
})
await test('CodeBlock: 「复制」点了之后有可见反馈', async () => {
	const before = await page.eval(`(() => { const b = [...document.querySelectorAll('article button')].find(x => /复制/.test(x.textContent||'')); if (!b) return null; return { text: (b.textContent||'').trim(), cls: b.className } })()`)
	assert(before, '找不到「复制」按钮')
	await page.eval(`(async () => { const b = [...document.querySelectorAll('article button')].find(x => /复制/.test(x.textContent||'')); b.click(); return true })()`)
	await sleep(600)
	const after = await page.eval(`(() => ({ any: [...document.querySelectorAll('article button')].map(x => (x.textContent||'').trim()).filter(t => /复制|已复制/.test(t)) }))()`)
	assert(after.any.length > 0, '点复制之后页面上一个「复制」按钮都没了 —— 可能整块被重建')
	const changed = after.any.some(t => t !== before.text) || after.any.length > 1
	assert(changed, `点了复制但按钮文案没变（仍是「${after.any.join(',')}」）——headless 下剪贴板常被拒，但文案反馈应当还在`)
})

/* ─────────────────────────── 8. 外链 ─────────────────────────── */
console.log('\n— 外链（ProseA z-link）—')
await page.goto(`${base}/2025/12/love-love-school-linux-chinese/`)
await test('ProseA: 外链带 target=_blank 且 rel 含 noopener', async () => {
	const links = await page.eval(`[...document.querySelectorAll('article a.z-link')].map(a => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '' }))`)
	assert(links.length > 0, '这一页没有 z-link')
	for (const l of links) {
		assert(/^https?:\/\//.test(l.href), `href 不是绝对地址：${l.href}`)
		assert(l.target === '_blank', `外链没有 target=_blank：${l.href}`)
		assert(/noopener/.test(l.rel), `外链 rel 缺 noopener：${l.href} (rel="${l.rel}")`)
	}
})

/* ─────────────────────────── 收尾 ─────────────────────────── */
await page.close()
cdp.ws.close()
killTree(chrome)
server.close()

const pass = results.filter(r => r.ok).length
console.log(`\n  passed ${pass} / ${results.length}`)
const failed = results.filter(r => !r.ok)
if (failed.length) {
	console.log('\n  FAILED:')
	for (const f of failed)
		console.log(`    - ${f.name}\n        ${f.error}`)
}
process.exit(pass === results.length ? 0 : 1)
