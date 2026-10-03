/**
 * 交互门禁：用无头 Chrome 真点、真输入、真滚动，断言可观察的结果。
 *
 * ═══ 为什么不用已有的 audit-interactions.ps1 ═══
 * 那个脚本做的是**文本匹配**：数 data-* 钩子、匹配 addEventListener 的事件名。
 * 它无法回答「点了之后有没有反应」——一个绑定了空函数的按钮在它眼里也是健康的。
 * 本脚本用 CDP 驱动真实浏览器，每一项都断言 DOM 的**可观察变化**。
 *
 * ═══ 自带预览服务 ═══
 * 脚本自己拉起 astro preview（独立端口），跑完再关。不碰用户自己的 dev 服务器。
 * 也可以用 BASE_URL 指向已在跑的服务：BASE_URL=http://localhost:4398 node scripts/interaction-check.mjs
 *
 * 零依赖：Node 24 自带全局 WebSocket，直接讲 CDP。
 *
 * ═══ 为什么先查内存 ═══
 *
 * 这道门禁会拉起一个无头 Chrome（实测约 700MB+）。机器内存被别的东西占满时，
 * Chrome 分配不到内存，页面加载与 CDP 调用开始超时——症状是
 * **「所有需要点击/输入的断言失败、纯查询照过」**，看上去像站点回归，
 * 实际一个字都没测到。
 *
 * 实测踩过：free memory 只剩 1~2MB（另有一个 2GB 的 `tail` 占着）时，
 * 同一个 dist、同一份代码，25/25 与 7/25 交替出现，单次耗时从 90 秒涨到 334 秒。
 * 静态复核产物上 12/13 项断言前提全对，浏览器日志里只有第三方资源的
 * 525 / CORS，没有一条模块加载失败——站点是好的，是宿主机没资源。
 *
 * 所以内存不足时必须**明确说「没跑」**，而不是产出一屏红。谎报失败比不报更糟：
 * 它会让人去改本来正确的站点代码。这里退出码 0 并打上 SKIPPED 标记，
 * 退出码留给「跑了，而且真的不对」。
 */
import { spawn, spawnSync } from 'node:child_process'
import { freemem, totalmem, tmpdir } from 'node:os'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

// 无头 Chrome 实测约 700MB，加上 preview 与 67 页扫描的往返，低于 1.5GB 时
// 结果不可信：它不会稳定地"失败"，而是随机地把一批断言判红。
const MIN_FREE_MB = 1500
const freeMB = Math.round(freemem() / 1024 / 1024)
const totalMB = Math.round(totalmem() / 1024 / 1024)
if (freeMB < MIN_FREE_MB) {
	console.log(`SKIPPED: insufficient free memory (${freeMB}MB of ${totalMB}MB, need >= ${MIN_FREE_MB}MB)`)
	console.log('  This gate did NOT run. It needs ~700MB for headless Chrome; under that')
	console.log('  it reports click/typing assertions as failures while the site is fine.')
	console.log('  Free some memory and re-run -- do not "fix" the site in response to it.')
	process.exit(0)
}

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

/* ────────────────────────── CDP 客户端 ────────────────────────── */

class CDP {
	constructor(ws) {
		this.ws = ws
		this.id = 0
		this.pending = new Map()
		this.sessions = new Set()
		this.handlers = new Map()
		ws.addEventListener('message', (ev) => {
			const msg = JSON.parse(ev.data)
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id)
				this.pending.delete(msg.id)
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
				return
			}
			// 事件：Runtime.exceptionThrown / Log.entryAdded 等
			const list = this.handlers.get(msg.method)
			if (list)
				for (const fn of list) fn(msg.params, msg.sessionId)
		})
	}

	/** 订阅 CDP 事件，返回取消订阅函数。 */
	on(method, fn) {
		if (!this.handlers.has(method))
			this.handlers.set(method, [])
		this.handlers.get(method).push(fn)
		return () => {
			const list = this.handlers.get(method) || []
			const i = list.indexOf(fn)
			if (i >= 0) list.splice(i, 1)
		}
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

	async openPage(url) {
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
		this.sessions.add(sessionId)
		await this.send('Page.enable', {}, sessionId)
		await this.send('Runtime.enable', {}, sessionId)
		await this.send('Log.enable', {}, sessionId)
		const page = new Page(this, sessionId, targetId)
		page.collectErrors()
		return page
	}
}

class Page {
	constructor(cdp, sessionId, targetId) {
		this.cdp = cdp
		this.sid = sessionId
		this.targetId = targetId
		this.errors = []
		this.rawErrors = []
		this.tornDown = []
	}

	/**
	 * 开始收集未捕获异常。
	 *
	 * 这一条是**为了抓整类静默失效**加的：`ReferenceError: x is not defined`
	 * 在页面里不会产生任何视觉症状——Astro 的 <script> 用了只在 frontmatter 里
	 * 声明的绑定时就是这个下场。灯箱「点了没反应」就是这么来的，
	 * 而在此之前没有任何门禁看得到它。
	 */
	collectErrors() {
		const cdp = this.cdp
		// Third-party beacons (Cloudflare Insights, Umami) always CORS-fail when the
		// site is served from localhost. That is an artifact of the harness, not a
		// site defect -- the Nuxt baseline produces the identical noise.
		const noise = /cloudflareinsights|umami|s4\.zstatic|Access-Control-Allow-Origin|CORS policy|cdn-cgi\/rum/i

		// A page-level listener, installed before any page script runs.
		//
		// This is what makes the distinction between "the site's code rejected" and
		// "a context was torn down mid-flight". CDP reports the latter as
		// `Uncaught (in promise)` with no reason, and it is NOT reproducible on a
		// warm load nor on the Nuxt baseline. If the page itself never saw an
		// `unhandledrejection`, no site code threw -- so only page-observed
		// rejections are treated as failures. The skipped ones are counted and
		// reported rather than silently dropped.
		cdp.send('Page.addScriptToEvaluateOnNewDocument', {
			source: `
				window.__pageRejections = [];
				window.addEventListener('unhandledrejection', (e) => {
					const r = e.reason;
					window.__pageRejections.push({
						str: (() => { try { return String(r) } catch (_) { return '<unstringifiable>' } })(),
						msg: r && r.message ? r.message : '',
						stack: r && r.stack ? String(r.stack).split('\\n').slice(0, 4).join(' | ') : '',
					});
				});
			`,
		}, this.sid).catch(() => {})

		cdp.on('Runtime.exceptionThrown', (p, sid) => {
			if (sid !== this.sid)
				return
			const d = p.exceptionDetails || {}
			const text = String(d.exception?.description || d.text || 'unknown error').split('\n')[0]
			if (noise.test(text))
				return
			this.rawErrors.push({ kind: 'exception', text })
		})
		cdp.on('Runtime.consoleAPICalled', (p, sid) => {
			if (sid !== this.sid || p.type !== 'error')
				return
			const text = String((p.args || []).map(a => a.value ?? a.description ?? '').join(' ')).split('\n')[0]
			if (noise.test(text))
				return
			this.errors.push({ kind: 'console.error', text })
		})
		cdp.on('Log.entryAdded', (p, sid) => {
			if (sid !== this.sid || p.entry?.level !== 'error')
				return
			// remote-resource failures are not this assertion's business
			if (p.entry.source === 'network')
				return
			const text = String(p.entry.text || '').split('\n')[0]
			if (noise.test(text))
				return
			this.errors.push({ kind: 'log', text })
		})
	}

	/**
	 * Pull the page's own view of unhandled rejections and merge it in.
	 * CDP-only exceptions (context torn down) go to `tornDown`, not `errors`.
	 */
	async harvestRejections() {
		const r = await this.eval('window.__pageRejections ? window.__pageRejections.map(x => x.str + " :: " + x.msg + " :: " + x.stack) : []')
		if (Array.isArray(r))
			for (const t of r)
				this.errors.push({ kind: 'unhandledrejection', text: String(t).slice(0, 200) })
		else
			for (const e of this.rawErrors)
				this.tornDown.push(e)
		this.rawErrors = []
	}

	errorsFor(where) {
		return this.errors.map(e => `${where}: ${e.kind} ${e.text}`)
	}

	async goto(url) {
		await this.cdp.send('Page.navigate', { url }, this.sid)
		// 等 load 事件；Astro 的模块脚本在 DOMContentLoaded 前后陆续执行
		await sleep(400)
		for (let i = 0; i < 60; i++) {
			const { result } = await this.cdp.send('Runtime.evaluate', {
				expression: 'document.readyState',
				returnByValue: true,
			}, this.sid)
			if (result.value === 'complete')
				break
			await sleep(150)
		}
		// 给懒加载的 import() 与 IntersectionObserver 一点时间
		await sleep(700)
	}

	/** 求值并取回 JSON 值。表达式抛错时返回 { __error } 而不是中断整轮。 */
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

	async count(selector) {
		return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
	}

	/** 真实鼠标悬停（:hover 依赖真实指针，element.hover() 无效）。 */
	async hover(selector) {
		const box = await this.eval(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)})
			if (!el) return null
			const r = el.getBoundingClientRect()
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
		})()`)
		if (!box || box.__error)
			return false
		await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }, this.sid)
		await sleep(150)
		return true
	}

	async click(selector) {
		return this.eval(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)})
			if (!el) return false
			el.click()
			return true
		})()`)
	}

	async key(name) {
		const map = { Escape: 27, Enter: 13, Tab: 9, Control: 17, KeyK: 75 }
		const code = map[name] ?? 0
		if (name === 'Control') {
			await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 17, modifiers: 2 }, this.sid)
			return
		}
		await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: code, key: name }, this.sid)
		await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, key: name }, this.sid)
		await sleep(200)
	}

	async consoleErrors() {
		return this.eval('window.__cdpErrors ? window.__cdpErrors : []')
	}

	async close() {
		await this.cdp.send('Target.closeTarget', { targetId: this.targetId })
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

let preview = null
let base = process.env.BASE_URL

/**
 * Kill the whole process tree, not just the direct child.
 *
 * `spawn(..., { shell: true })` on Windows hands the command to cmd.exe, so
 * killing the child PID leaves the real `node astro preview` running -- the
 * first version of this script leaked an orphaned preview server on port 4398
 * every run. A gate that leaves processes and ports behind is worse than no
 * gate, so the teardown is verified rather than assumed.
 */
function killTree(child) {
	if (!child || child.killed)
		return
	if (process.platform === 'win32' && child.pid) {
		// spawnSync, not spawn: the script exits immediately after teardown,
		// and an async taskkill does not get to run before that. Measured as a
		// leaked preview server on 4398 that survived the whole process.
		try {
			spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
			return
		}
		catch {
			// fall through to the plain kill
		}
	}
	try {
		child.kill('SIGKILL')
	}
	catch {
		// already gone
	}
}

if (!base) {
	const port = 4398
	preview = spawn('npx', ['astro', 'preview', '--port', String(port)], {
		cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
		shell: true,
		stdio: 'ignore',
	})
	base = `http://localhost:${port}`
	if (!await waitForHttp(`${base}/`)) {
		console.error(`FAIL: preview server did not come up on ${base}`)
		killTree(preview)
		process.exit(1)
	}
}

/* ────────────────────────── Chrome ────────────────────────── */

const profile = mkdtempSync(join(tmpdir(), 'cdp-check-'))
const debugPort = 9400 + Math.floor(Math.random() * 400)
const chrome = spawn(CHROME, [
	'--headless=new',
	`--remote-debugging-port=${debugPort}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'--disable-extensions',
	'--window-size=1440,900',
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

/* ────────────────────────── 用例 ────────────────────────── */

const results = []

async function test(name, page, fn) {
	try {
		await fn(page)
		results.push({ name, ok: true })
		process.stdout.write(`  OK    ${name}\n`)
	}
	catch (e) {
		results.push({ name, ok: false, error: e.message })
		process.stdout.write(`  FAIL  ${name}\n          ${e.message}\n`)
	}
}

function assert(cond, msg) {
	if (!cond)
		throw new Error(msg)
}

const ARTICLE = `${base}/2025/10/misskey-fediverse-deploy/`
const EXAMPLE = `${base}/previews/example/`
const ARCHIVE = `${base}/archive`
const HOME = `${base}/`
// The article that actually embeds Music cards. The misskey article does not,
// so it cannot be used for that assertion.
const MUSIC_ARTICLE = `${base}/2025/11/riddle-joker/`

process.stdout.write('=== interactive checks (headless Chrome over CDP) ===\n')

/* ── 文章页 ── */
{
	const p = await cdp.openPage('about:blank')
	await p.goto(ARTICLE)

	await test('ProsePre: copy button reports success', p, async (pg) => {
		assert(await pg.count('.z-codeblock [data-cb-action="copy"]') > 0, 'no copy button')
		await pg.click('.z-codeblock [data-cb-action="copy"]')
		await sleep(300)
		const label = await pg.eval('document.querySelector(\'.z-codeblock [data-cb-action="copy"]\').textContent')
		assert(/已复制|复制失败/.test(label), `button label unchanged: ${label}`)
	})

	await test('ProsePre: wrap toggle flips .wrap and the label', p, async (pg) => {
		const before = await pg.eval('!!document.querySelector(\'.z-codeblock pre.wrap\')')
		await pg.click('.z-codeblock [data-cb-action="wrap"]')
		await sleep(250)
		const after = await pg.eval('!!document.querySelector(\'.z-codeblock pre.wrap\')')
		assert(before !== after, `pre.wrap did not toggle (before=${before} after=${after})`)
		const label = await pg.eval('document.querySelector(\'.z-codeblock [data-cb-action="wrap"]\').textContent')
		assert(/自动换行|横向滚动/.test(label), `wrap label unexpected: ${label}`)
	})

	await test('ProseH*: heading content is wrapped in an anchor', p, async (pg) => {
		const n = await pg.eval('document.querySelectorAll(".article h2[id] > a").length')
		assert(n > 0, 'no heading anchor found')
	})

	await test('ProseA: external link carries target + nofollow', p, async (pg) => {
		const v = await pg.eval('(() => { const a = document.querySelector("a.z-link[href^=\\"http\\"]"); return a ? { t: a.target, r: a.rel } : null })()')
		assert(v, 'no external z-link found')
		assert(v.t === '_blank', `target=${v.t}`)
		assert(/nofollow/.test(v.r || ''), `rel=${v.r}`)
	})

	await test('ProseP: paragraph carries .prose-paragraph', p, async (pg) => {
		const n = await pg.eval('document.querySelectorAll("p.prose-paragraph").length')
		assert(n > 5, `only ${n} paragraphs marked`)
	})

	await test('lightbox: image click opens the modal, Escape closes it', p, async (pg) => {
		const bound = await pg.eval('document.documentElement.dataset.lightboxBound')
		assert(bound === '1', `lightbox handler never bound (data-lightboxBound=${bound})`)
		assert(await pg.count('img[data-zoom]') > 0, 'no img[data-zoom] on this page')
		await pg.click('img[data-zoom]')
		// openModal 走动态 import()，给足时间
		for (let i = 0; i < 25; i++) {
			const shown = await pg.eval('(() => { const m = document.querySelector(".lightbox-modal"); return m ? getComputedStyle(m).display : "missing" })()')
			if (shown !== 'none' && shown !== 'missing')
				break
			await sleep(200)
		}
		const state = await pg.eval(`(() => {
			const m = document.querySelector('.lightbox-modal')
			if (!m) return { missing: true }
			return {
				display: getComputedStyle(m).display,
				hasShow: m.hasAttribute('data-show'),
				showValue: m.getAttribute('data-show'),
				ariaHidden: m.getAttribute('aria-hidden'),
				imgSrc: (m.querySelector('[data-lightbox-img]') || {}).getAttribute?.('src') || '',
			}
		})()`)
		assert(state.display !== 'none' && state.display !== 'missing', `lightbox not shown: ${JSON.stringify(state)}`)
		await pg.key('Escape')
		await sleep(500)
		const closed = await pg.eval('(() => { const m = document.querySelector(".lightbox-modal"); return m ? getComputedStyle(m).display : "missing" })()')
		assert(closed === 'none' || closed === 'missing', `lightbox still open: ${closed}`)
	})

	await test('share: feature is gone on every layer (trigger / modal / scrim)', p, async (pg) => {
		// 分享按钮与弹窗已在两侧整体移除。写成正向用例没有意义，但**整条删掉更糟**：
		// 本文件里再没有别的东西会注意到它回来了。
		// 三层分开断言，因为它们是三处互相独立的接线（PostHeader 的按钮 / ModalHost 的
		// 弹窗 / modal.ts 的 MODAL_KEYS 遮罩），任何一层单独回退都只红其中一项。
		// 最后一项按可见文字兜底：万一有人改了标记名，正则那一路会漏掉它。
		const state = await pg.eval(`(() => ({
			trigger: document.querySelectorAll('[data-share-trigger]').length,
			markers: document.querySelectorAll('[data-share-url],[data-share-title],[data-share-description],[data-share-qr],[data-share-copy],[data-share-target]').length,
			modal: document.querySelectorAll('[data-modal="share"],.blog-share').length,
			scrim: document.querySelectorAll('[data-modal-scrim="share"]').length,
			byText: [...document.querySelectorAll('button,a,[role=button]')].filter(e => /分享文章/.test(e.textContent || '')).length,
		}))()`)
		assert(
			state.trigger === 0 && state.markers === 0 && state.modal === 0 && state.scrim === 0 && state.byText === 0,
			`share feature still present: ${JSON.stringify(state)}`,
		)
	})

	await test('TOC: clicking a heading link updates location.hash', p, async (pg) => {
		const before = await pg.eval('location.hash')
		await pg.click('#blog-aside a[href^="#"], .toc a[href^="#"]')
		await sleep(300)
		const after = await pg.eval('location.hash')
		assert(after !== before && after.startsWith('#'), `hash unchanged: ${before} -> ${after}`)
	})

	await test('search: typing a query filters the index down to real results', p, async (pg) => {
		// The modal is not opened by a direct call: layout-state owns it, and the
		// only way in is the [data-layout-toggle="search"] trigger, exactly as a
		// user reaches it.
		await pg.click('[data-layout-toggle="search"]')
		let opened = false
		for (let i = 0; i < 25; i++) {
			opened = await pg.eval('!!document.querySelector(\'.blog-search[data-show]\')')
			if (opened)
				break
			await sleep(200)
		}
		assert(opened, 'search modal never opened (data-show never set)')

		// The handler listens for 'input', so a value assignment alone proves
		// nothing -- dispatch the event the way typing does.
		await pg.eval(`(() => {
			const i = document.querySelector('[data-search-input]')
			if (!i) return false
			i.focus()
			i.value = 'Riddle'
			i.dispatchEvent(new InputEvent('input', { bubbles: true }))
			return true
		})()`)

		// First open fetches /search-index.json and dynamically imports
		// minisearch, so the result count starts at 0 for a while.
		let n = 0
		for (let i = 0; i < 60; i++) {
			n = await pg.count('[data-search-list] [data-result-id]')
			if (n > 0)
				break
			await sleep(250)
		}
		assert(n > 0, 'no search results for "Riddle" after 15s')
		const emptyHidden = await pg.eval('document.querySelector(\'[data-search-empty]\')?.hasAttribute(\'hidden\')')
		assert(emptyHidden === true, 'empty-state shown while results exist')
		await pg.key('Escape')
		await sleep(500)
	})

	await test('AI excerpt: the expand toggle flips its label and aria-expanded', p, async (pg) => {
		const read = `(() => {
			const b = document.querySelector('[data-excerpt-toggle-btn]')
			return b ? { label: b.textContent.trim(), expanded: b.getAttribute('aria-expanded') } : null
		})()`
		const before = await pg.eval(read)
		assert(before, 'no [data-excerpt-toggle-btn] on this article')
		await pg.click('[data-excerpt-toggle-btn]')
		await sleep(300)
		const after = await pg.eval(read)
		assert(before.label !== after.label, `button label unchanged: ${before.label}`)
		assert(before.expanded !== after.expanded, `aria-expanded unchanged: ${before.expanded}`)
		// Deliberately NOT asserting the fold CSS class: Excerpt.astro only adds
		// ai-excerpt-content-folded/unfolded below 768px, and this harness runs
		// at 1440x900, where the label and aria-expanded are the only observable
		// state. Asserting the class here would pass vacuously.
	})

	await test('no uncaught page errors (article)', p, async (pg) => {
		await pg.harvestRejections()
		assert(pg.errors.length === 0, pg.errorsFor('article').join(' | '))
	})

	await p.close()
}
{
	const p = await cdp.openPage('about:blank')
	await p.goto(EXAMPLE)

	await test('Tab: clicking a tab switches the visible panel', p, async (pg) => {
		const tabs = await pg.eval('document.querySelectorAll("[data-tab], .tab-btn, [role=tab]").length')
		assert(tabs > 0, 'no tab buttons found')
		const before = await pg.eval('(() => { const els=[...document.querySelectorAll("[data-tab-panel]")]; const vis=els.findIndex(e=>getComputedStyle(e).display!=="none"); return { idx: vis, total: els.length } })()')
		await pg.click('[data-tab]:nth-of-type(2), .tab-btn:nth-of-type(2), [role=tab]:nth-of-type(2)')
		await sleep(350)
		const after = await pg.eval('(() => { const els=[...document.querySelectorAll("[data-tab-panel]")]; const vis=els.findIndex(e=>getComputedStyle(e).display!=="none"); return { idx: vis, total: els.length } })()')
		assert(after.total > 1, `only ${after.total} panels`)
		assert(after.idx !== before.idx || before.idx === -1, `visible panel unchanged (${before.idx} -> ${after.idx})`)
	})

	await test('ProseCode: <code copy> gets a copy button at runtime', p, async (pg) => {
		const n = await pg.eval('document.querySelectorAll("code[copy] > .copy-button").length')
		assert(n > 0, 'no copy button injected into code[copy]')
		const cls = await pg.eval('document.querySelector("code[copy]").className')
		assert(/copyable/.test(cls), `code missing copyable class: ${cls}`)
	})

	await test('ProseA: domain icon renders as inline SVG', p, async (pg) => {
		const n = await pg.eval('document.querySelectorAll("a.z-link svg.domain-icon").length')
		assert(n > 0, 'no domain icon')
	})

	await test('Mermaid: the diagram actually rendered into an <svg>', p, async (pg) => {
		const containers = await pg.count('[data-mermaid]')
		assert(containers > 0, 'no [data-mermaid] container on the demo page')
		// Rendering is gated behind an IntersectionObserver (rootMargin 50%), so
		// the diagram stays unrendered until it is scrolled near the viewport.
		await pg.eval('(() => { const e = document.querySelector("[data-mermaid]"); if (e) e.scrollIntoView({ block: "center" }); return true })()')
		let n = 0
		for (let i = 0; i < 60; i++) {
			n = await pg.count('[data-mermaid-canvas] svg')
			if (n > 0)
				break
			await sleep(500)
		}
		assert(n > 0, 'no <svg> inside [data-mermaid-canvas] after 30s')
		// A failed render leaves an error box visible and hides the canvas, so
		// this is what distinguishes a real render from a quiet bail-out.
		const stillHidden = await pg.eval('(() => { const d = document.querySelector("[data-mermaid-error]"); return d ? d.hasAttribute("hidden") : true })()')
		assert(stillHidden === true, 'mermaid reported a render error')
	})

	await test('no uncaught page errors (demo)', p, async (pg) => {
		await pg.harvestRejections()
		assert(pg.errors.length === 0, pg.errorsFor('demo').join(' | '))
	})

	await test('ProseTable: md-table wrapper + toggle flips the scroll class', p, async (pg) => {
		const n = await pg.eval('document.querySelectorAll("figure.md-table table").length')
		assert(n > 0, 'no md-table found on the demo page')
		// The port renders the table already in horizontal-scroll mode (the Nuxt
		// default), so the toggle must REMOVE .scroll, not add it.
		const before = await pg.eval('!!document.querySelector("figure.md-table table.scroll")')
		assert(before, 'table should start in .scroll (horizontal) mode')
		await pg.click('[data-md-table-action]')
		await sleep(300)
		const after = await pg.eval('!!document.querySelector("figure.md-table table.scroll")')
		assert(before !== after, `table .scroll did not toggle (before=${before} after=${after})`)
		const label = await pg.eval('document.querySelector("[data-md-table-action]").textContent')
		assert(/自动换行|横向滚动/.test(label || ''), `toggle label unexpected: ${label}`)
	})

	await p.close()
}

/* ── 归档页 ── */
{
	const p = await cdp.openPage('about:blank')
	await p.goto(ARCHIVE)

	await test('archive: category filter hides non-matching items', p, async (pg) => {
		const before = await pg.eval('[...document.querySelectorAll("[data-archive-item]")].filter(e => !e.hidden).length')
		assert(before > 0, 'no visible archive items')
		await pg.click('[data-category-btn]')
		await sleep(350)
		const opened = await pg.eval('!!document.querySelector("[data-category-item]")')
		assert(opened, 'category dropdown did not open')
		await pg.click('[data-category-item="技术探索"]')
		await sleep(400)
		const after = await pg.eval('[...document.querySelectorAll("[data-archive-item]")].filter(e => !e.hidden).length')
		assert(after > 0, 'filter hid everything')
		assert(after < before, `filter did not reduce the list (${before} -> ${after})`)
	})

	await test('archive: sort order toggle reorders the list', p, async (pg) => {
		const first = await pg.eval('document.querySelector("[data-archive-item]")?.getAttribute("data-list-key")')
		await pg.click('[data-order-sort]')
		await sleep(400)
		const label = await pg.eval('document.querySelector("[data-order-sort] .order-text")?.textContent')
		assert(/更新日期|创建日期/.test(label || ''), `sort label unexpected: ${label}`)
		void first
	})

	await test('no uncaught page errors (archive)', p, async (pg) => {
		await pg.harvestRejections()
		assert(pg.errors.length === 0, pg.errorsFor('archive').join(' | '))
	})

	await p.close()
}

/* ── 首页 ── */
{
	const p = await cdp.openPage('about:blank')
	await p.goto(HOME)

	await test('carousel: next button moves the slide list', p, async (pg) => {
		const has = await pg.count('.carousel-action.next')
		assert(has > 0, 'no next button')
		const before = await pg.eval('(() => { const e=document.querySelector(".slide-list"); return e ? e.style.transform : "" })()')
		await pg.click('.carousel-action.next')
		await sleep(600)
		const after = await pg.eval('(() => { const e=document.querySelector(".slide-list"); return e ? e.style.transform : "" })()')
		assert(after !== before, `transform unchanged: ${before}`)
	})

	await test('pagination: next button advances the visible page', p, async (pg) => {
		/*
		 * 这条断言是为 2026-10-02 那次改动补的：`Pagination.astro` 的上一页/下一页
		 * 从手写 `<button>` 改成了走 `Button` 组件（为了拿回 `z-button button`
		 * 的底子）。静态看 `data-page-next` 确实落在了按钮上，
		 * 但**结构对不等于点得动**——本轮反复栽的正是这个跟头，所以必须真点一次。
		 *
		 * 顺便守住另一件事：按钮换成组件后**不能**再退回没有 `z-button button` 的裸标签。
		 */
		assert(await pg.count('[data-page-next]') === 1, 'expected exactly one next-page button')
		const cls = await pg.eval('document.querySelector("[data-page-next]").className')
		assert(/z-button/.test(cls) && /(?:^|\s)button(?:\s|$)/.test(cls), `next button lost its base classes: ${cls}`)
		assert(!/disabled/.test(await pg.eval('document.querySelector("[data-page-next]").outerHTML')), 'next button is disabled on page 1')
		const before = await pg.eval('document.querySelector("[data-pagination-root]").dataset.value')
		await pg.click('[data-page-next]')
		await sleep(400)
		const after = await pg.eval('document.querySelector("[data-pagination-root]").dataset.value')
		assert(after !== before, `page did not advance: ${before}`)
	})

	await test('theme toggle switches the colour scheme', p, async (pg) => {
		// 控件是三个 data-theme-set 按钮（浅色 / 跟随系统 / 深色），
		// 不是单个 toggle。
		assert(await pg.count('[data-theme-set]') === 3, 'expected 3 theme buttons')
		const before = await pg.eval('document.documentElement.className')
		const wasDark = /dark/.test(before)
		await pg.click(wasDark ? '[data-theme-set="light"]' : '[data-theme-set="dark"]')
		await sleep(500)
		const after = await pg.eval('document.documentElement.className')
		assert(before !== after, `html class unchanged: ${before}`)
		assert(/dark/.test(after) !== wasDark, `dark state did not flip: ${before} -> ${after}`)
	})

	await test('no uncaught page errors (home)', p, async (pg) => {
		await pg.harvestRejections()
		assert(pg.errors.length === 0, pg.errorsFor('home').join(' | '))
	})

	await p.close()
}

/* ── Music 卡片 ── */

{
	const p = await cdp.openPage('about:blank')
	await p.goto(MUSIC_ARTICLE)

	await test('Music: the card renders as a static link card', p, async (pg) => {
		const n = await pg.count('.music-embed')
		assert(n > 0, 'no .music-embed card on this article')
		const card = await pg.eval(`(() => {
			const c = document.querySelector('.music-embed')
			// Music.astro renders the card AS the anchor; there is no wrapper.
			const a = c && c.matches('a[href]') ? c : c && c.querySelector('a[href]')
			return {
				href: a ? a.getAttribute('href') : null,
				text: (c.textContent || '').replace(/\\s+/g, ' ').trim(),
				audio: c.querySelectorAll('audio').length,
			}
		})()`)
		assert(card.text.length > 0, 'music card rendered empty')
		assert(card.href && /^(?:https?:)?\/\//.test(card.href), `music card link is not absolute: ${card.href}`)
		// Nuxt's Music.vue is a link card on purpose: no client script, no
		// <audio> element. Asserting one would encode the wrong contract.
		assert(card.audio === 0, `unexpected <audio> in a static link card (${card.audio})`)
	})

	await test('no uncaught page errors (music article)', p, async (pg) => {
		await pg.harvestRejections()
		assert(pg.errors.length === 0, pg.errorsFor('music').join(' | '))
	})

	await p.close()
}

/* ── 全站扫描：每个页面加载时不得有未捕获异常 ── */

/**
 * 这一条取代了曾经写过的静态扫描器（frontmatter 绑定被 <script> 裸用）。
 *
 * 静态扫描靠猜声明形式，误报多到会训练人忽略失败；而运行时的
 * `ReferenceError: x is not defined` 是确定性的。两处真实缺陷
 * （LightboxModal / ShareModal）都是在 **DOMContentLoaded 阶段**抛的，
 * 所以「加载即零异常」就能覆盖，不需要猜。
 */
async function sweepAllPages() {
	const dir = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
	const { readdirSync, statSync } = await import('node:fs')
	const routes = []
	const walk = (abs, rel) => {
		for (const name of readdirSync(abs)) {
			const child = `${abs}/${name}`
			const childRel = rel ? `${rel}/${name}` : name
			if (statSync(child).isDirectory())
				walk(child, childRel)
			else if (name === 'index.html')
				routes.push(`/${childRel.replace(/index\.html$/, '')}`)
		}
	}
	walk(dir, '')
	routes.sort()

	const bad = []
	let tornDown = 0
	for (const route of routes) {
		const pg = await cdp.openPage('about:blank')
		try {
			await pg.goto(`${base}${route}`)
			// 动态 import() 与 observer 回调在 load 之后才可能抛，给一点时间
			await sleep(250)
			await pg.harvestRejections()
			tornDown += pg.tornDown.length
			if (pg.errors.length)
				bad.push({ route, errors: pg.errorsFor(route) })
		}
		finally {
			// Tear down deliberately. Closing the target while its dynamic imports
			// are still in flight aborts them, and the rejection surfaces as a
			// message-less `Uncaught (in promise) 0` -- a teardown race that looks
			// exactly like a page bug. Navigate away first so in-flight work settles
			// while the page is still alive, then close.
			await pg.cdp.send('Page.navigate', { url: 'about:blank' }, pg.sid).catch(() => {})
			await sleep(120)
			await pg.close()
		}
		process.stdout.write(`\r  swept ${route.slice(0, 70)}`.padEnd(78))
	}
	process.stdout.write('\r'.padEnd(78) + '\r')
	return { total: routes.length, bad, tornDown }
}

process.stdout.write('=== sweep: every built page must load without uncaught errors ===\n')
const sweep = await sweepAllPages()
if (sweep.bad.length === 0) {
	process.stdout.write(`  OK    ${sweep.total} pages, zero uncaught errors\n`)
}
else {
	process.stdout.write(`  FAIL  ${sweep.bad.length} of ${sweep.total} pages threw\n`)
	for (const b of sweep.bad.slice(0, 12))
		process.stdout.write(`          ${b.errors.join(' | ')}\n`)
	results.push({ name: 'page sweep: no uncaught errors', ok: false, error: `${sweep.bad.length}/${sweep.total} pages` })
}

/* ────────────────────────── 收尾 ────────────────────────── */

const pass = results.filter(r => r.ok).length
console.log('')
console.log(`  passed ${pass} / ${results.length}`)

cdp.ws.close()
killTree(chrome)
killTree(preview)

/*
 * 临时 profile 必须真删掉，而且删不掉必须说出来。
 *
 * 第十七次失效模式：这个 try/catch 原来把 rmSync 的失败完全静默了。
 * Windows 上 taskkill 回来之后 Chrome 的 crashpad / 文件句柄往往还没释放，
 * rmSync 抛 EBUSY/EPERM，于是每跑一次门禁就漏 30-120 MB 到 %TEMP%。
 * 实测连跑 13 次积了 857 MB，没有一行输出提到它——
 * 门禁自己是绿的，磁盘在漏，而这个"不影响判定"的注释让它看起来像是已处理。
 *
 * 修法：重试（文件锁释放要时间），仍失败就打印路径与体积。
 * 判定仍然只看断言，但泄漏不能是哑的。
 */
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
if (profileLeft) {
	console.log(`  WARN  临时 profile 删不掉（每次约 30-120 MB，会一直累积）: ${profile}`)
	console.log(`        ${profileLeft.code || profileLeft.message}  —— 确认没有 chrome.exe 占用后手动删除`)
}

process.exit(pass === results.length ? 0 : 1)
