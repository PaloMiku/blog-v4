/**
 * 无头 Chrome + CDP 会话层：`compare-ui-parity.mjs` 与 `probe-subtree.mjs` 共用。
 *
 * ## 为什么能抽
 *
 * 抽取前，这两个文件里**逐字相同**（用 `seg(A,200,240) === seg(B,91,131)` 核过）的有：
 *
 *   · `class CDP`            40 行，构造/send/connect/openPage 四件套
 *   · `killTree`             8 行，taskkill /T /F
 *   · `waitHttp`             12 行，preview 就绪轮询
 *
 * 这三块是"仪器本身"，不是"被测对象"。它们一旦分叉，后果是**两个仪器的读数
 * 没有可比性**，而症状极难归因：页高对 2.5s 与 3.0s 的等待差别敏感，
 * `openPage` 少发一个 `Page.enable` 只会让某些页面安静地少量一半——
 * 全站仍能跑完、仍能报出一份格式完全正常的结论。
 *
 * 这与 `probe-subtree.mjs` 头里记的那条教训同源：被注入页面的函数必须是
 * 自包含的，模块作用域在页面里不存在。同理，**会话层必须只有一份**，
 * 否则"两个仪器量了同一样东西"这个前提本身就不成立。
 *
 * ## 边界：只抽"会话怎么起、怎么发命令、怎么关"
 *
 * 下面这些**故意留在各自脚本里**，因为两边真的不一样，硬合并就会改变行为：
 *
 *  · `waitDevtools` —— 一边 `fetch` 不带 signal、一边带 `AbortSignal.timeout(2000)`；
 *    返回语义也不同（一边"没拿到 wsUrl 就继续轮询"，另一边"拿到 JSON 就返回"，
 *    哪怕 `webSocketDebuggerUrl` 是 undefined）。合并就要选一种，
 *    而选任何一种都是在**没跑过门禁**的情况下改超时与重试语义。
 *  · `preview` 的 spawn —— 一边 `stdio: ['ignore','pipe','pipe']` 收集日志并在
 *    失败时打最后 12 行，另一边不收日志、失败时打整个尾巴 1200 字。
 *    报错文案不同是**有意的**：它们对应两种不同的排查方向。
 *  · `cleanup()` —— 一边闭包持有 chrome/preview/onlineSession 三个对象，
 *    另一边用 `spawned[]` 数组；一边只挂 uncaught/unhandled/信号，
 *    另一边还挂了 `process.on('exit')`。合并会改变"哪些入口会触发清理"。
 *  · chrome 启动参数 —— 端口分配、`--user-data-dir` 前缀、`--no-default-browser-check`
 *    vs `--no-default-browser-icon`、offline 隔离规则的插入位置，全都不一样。
 *  · online 复核用的第二个浏览器 —— 只有 `compare-ui-parity.mjs` 有。
 *
 * ## 不能动的东西
 *
 * `send()` 的 `sessionId` 是**可选第三参**，且 `pending` 的 resolve/reject 靠
 * `m.id` 配对：CDP 的 `flatten: true` 模式下事件消息不带 id，会被 `if (m.id && …)`
 * 挡掉。别为了"清理未完成的请求"在 close 时 reject 全部 pending——
 * `compare-ui-parity.mjs` 的 uncaughtException 兜底正是靠这个差异工作的。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 找一个可用的 Chromium 内核。
 *
 * 只返回路径，找不到返回 `undefined` —— **报错文案由调用方自己决定**：
 * 两边分别是 `FAIL: no chrome` 与 `FAIL: no chrome/edge`，
 * 差别反映的是各自脚本当时的搜索意图，不是笔误。
 *
 * @returns {string | undefined} 浏览器可执行文件的绝对路径；一个都没找到时 undefined
 */
export function findBrowser() {
	return [
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	].find(p => existsSync(p))
}

/**
 * 只杀**自己 spawn 出来的**那棵进程树。
 *
 * ⚠️ 绝不能按进程名批量杀 chrome —— 那会连用户自己开着的浏览器一起杀掉。
 * `compare-ui-parity.mjs` 的注释记着本轮已经犯过一次这个错。
 *
 * @param {import('node:child_process').ChildProcess} [child]
 * @returns {void} 永远不抛：进程已经没了也是一种「清理成功」
 */
export function killTree(child) {
	if (!child?.pid)
		return
	try {
		spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
	}
	catch { /* 已退出 */ }
}

/**
 * 轮询一个 URL 直到它返回 2xx，或超时。
 *
 * 单次请求 3s 超时、每 400ms 一次 —— 这两个值是**判据的一部分**：
 * 60s 总预算恰好等于 `FAIL: preview never came up`（实测 60.8s）的观感来源，
 * 而单次 3s 是为了别让一次挂起的连接把总预算吃光。
 *
 * @param {string} url
 * @param {number} [ms] 总预算，默认 60000
 * @returns {Promise<boolean>} 是否在预算内就绪
 */
export async function waitHttp(url, ms = 60000) {
	const dl = Date.now() + ms
	while (Date.now() < dl) {
		try {
			if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok)
				return true
		}
		catch { /* 还没起来 */ }
		await sleep(400)
	}
	return false
}

/**
 * 一条 CDP 连接。
 *
 * `WebSocket` 用 Node 内置的全局实现（Node ≥ 22），不引第三方依赖。
 * 消息按 `id` 配对，事件类消息（无 `id`）直接忽略。
 */
export class CDP {
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

	/**
	 * 开一个新 target 并 attach，返回它的 sessionId。
	 *
	 * `Page.enable` / `Runtime.enable` 缺一不可：后者是 `Runtime.evaluate` 的前提，
	 * 前者是导航与 `readyState` 可读的前提。少发任何一个的症状都是
	 * "页面加载了但读不到东西"，而不是报错。
	 */
	async openPage() {
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
		const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
		await this.send('Page.enable', {}, sessionId)
		await this.send('Runtime.enable', {}, sessionId)
		return sessionId
	}
}
