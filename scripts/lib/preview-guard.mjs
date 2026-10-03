/**
 * preview 端口协商：起自己的门禁 preview 之前，先确认这个端口是自己的。
 *
 * ## 背景
 *
 * Astro 7 的 `astro preview` 带一份「正在运行的 preview 服务器」登记表，
 * **跨端口**检查：项目里任何一条残留登记都会让新实例直接启动失败——
 *
 *     Preview server already running at http://localhost:4392
 *     Run `astro preview stop` to stop it, or use `astro preview --force`
 *
 * `--force` 实测仍然被拒，所以老办法是开跑前先无条件 `astro preview stop`。
 *
 * ## 那个无条件 stop 错在哪
 *
 * 它**不看端口**。只要本项目里登记着任何 preview，就一律停掉——包括用户自己
 * 为本项目手动起的那一个。而本项目的硬约束是「dev / 预览服务器的启停由用户管理，
 * 代理不得擅自启停」。仪器为了跑通自己，把用户的服务器杀了，这跟没写约束一样。
 *
 * 登记表是**按项目**的（实测：Clannad-site 的 preview 跑在 4321，而 blog-v4
 * 里 `preview status` 报「没有在跑」），所以这条命令**不会**误杀别的项目——
 * 风险范围只有「本项目、用户手动起的」这一个。
 *
 * ## 现在的做法
 *
 * 先 `preview status` 读出登记，再按端口分三种情况处理：
 *
 * | status 结果                          | 判定             | 动作                        |
 * |--------------------------------------|------------------|-----------------------------|
 * | No preview server is running         | 干净             | 直接起                     |
 * | ...running at http://localhost:4393  | **自己**的残留   | stop 后起（清掉陈年登记）   |
 * | ...running at http://localhost:4321  | **用户**手动起的 | 拒绝启动，exit 2，不碰它   |
 *
 * 拒绝时把端口和 pid 一起打出来，用户要么自己停、要么给门禁换一个端口
 * （`--port=`），不需要代理去猜该杀谁。
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const RUNNING_RE = /Preview server running at https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\s*\(pid (\d+)/

/**
 * @param {object} opts
 * @param {string} opts.cwd   astro 项目根
 * @param {number} opts.port  本次要占的端口
 * @returns {{ ok: true, stopped?: number }
 *   | { ok: false, running: number, pid: number, reason?: string }}
 *   ok 时表示可以启动；stopped 是被清掉的**自己**的残留端口（没有则缺省）。
 */
export function claimPreviewSlot({ cwd, port }) {
	const status = spawnSync('npx astro preview status', { cwd, shell: true, encoding: 'utf8', timeout: 60000 })
	const out = `${status.stdout || ''}${status.stderr || ''}`

	// status 自己失败时不能当成「干净」——那等于盲开，可能撞上用户的服务器。
	if (status.error || (status.status !== 0 && !RUNNING_RE.test(out)))
		return { ok: false, running: -1, pid: -1, reason: `\`astro preview status\` 退出码 ${status.status}，无法确认端口归属` }

	const m = RUNNING_RE.exec(out)
	if (!m)
		return { ok: true }

	const running = Number(m[1])
	if (running !== port)
		return { ok: false, running, pid: Number(m[2]) }

	// 是自己上次残留的，登记不清理就永远起不来
	spawnSync('npx astro preview stop', { cwd, shell: true, encoding: 'utf8', timeout: 60000 })
	return { ok: true, stopped: port }
}

/**
 * 谈不拢就打清楚原因并退出。非零退出码 = 门禁红，而不是悄悄换个端口蒙混过关。
 */
export function requirePreviewSlot(opts) {
	const r = claimPreviewSlot(opts)
	if (r.ok)
		return r

	if (r.running === -1) {
		console.error(`FAIL: ${r.reason}。不猜端口，直接停手。`)
		process.exit(2)
	}
	console.error(`FAIL: 本项目已有一个 preview 跑在 http://localhost:${r.running} (pid ${r.pid})。`)
	console.error('      那是手动起的，不归门禁处置，因此本次不启动自己的 preview。')
	console.error(`      要么自己停掉它，要么给本次测量换一个端口（--port=，当前请求 ${opts.port}）。`)
	process.exit(2)
}
