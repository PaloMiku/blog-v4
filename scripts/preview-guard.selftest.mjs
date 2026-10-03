// preview-guard 的真实自检：起真的 preview、问真的登记、验真的没被杀
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { claimPreviewSlot } from './lib/preview-guard.mjs'

const ROOT = process.cwd()
const MINE = 4393
const OTHER = 4391

function killTree(child) {
	if (!child?.pid)
		return
	try {
		spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
	}
	catch { /* 已退出 */ }
}
function up(port) {
	return spawnSync('powershell', ['-NoProfile', '-Command', `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Measure-Object).Count`], { encoding: 'utf8' }).stdout.trim()
}
async function waitUp(port, ms = 45000) {
	const dl = Date.now() + ms
	while (Date.now() < dl) {
		if (up(port) !== '0')
			return true
		await sleep(400)
	}
	return false
}
async function waitDown(port, ms = 20000) {
	const dl = Date.now() + ms
	while (Date.now() < dl) {
		if (up(port) === '0')
			return true
		await sleep(300)
	}
	return false
}

let fails = 0
function check(name, cond, detail = '') {
	console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
	if (!cond)
		fails++
}

// ── 情形 1：什么都没有 → 直接放行 ─────────────────────────────
{
	const r = claimPreviewSlot({ cwd: ROOT, port: MINE })
	check('无 preview 时放行', r.ok === true, JSON.stringify(r))
}

// ── 情形 2：别人（别的端口）在跑 → 拒绝，且**绝不能杀它** ──────
{
	const p = spawn(`npx astro preview --port ${OTHER}`, { cwd: ROOT, shell: true, stdio: 'ignore' })
	const came = await waitUp(OTHER)
	check('测试前提：4391 起来了', came)
	const r = claimPreviewSlot({ cwd: ROOT, port: MINE })
	check('别人在别的端口时拒绝', r.ok === false, JSON.stringify(r))
	check('拒绝时正确报出对方端口', r.ok === false && r.running === OTHER, `running=${r.running}`)
	// 关键断言：进程还活着
	await sleep(800)
	check('**没有杀掉用户的 preview**', up(OTHER) !== '0', `监听数=${up(OTHER)}`)
	killTree(p)
	await waitDown(OTHER)
}

// ── 情形 3：自己端口的陈年残留 → stop 后放行 ───────────────────
{
	const p = spawn(`npx astro preview --port ${MINE}`, { cwd: ROOT, shell: true, stdio: 'ignore' })
	const came = await waitUp(MINE)
	check('测试前提：4393 起来了', came)
	const r = claimPreviewSlot({ cwd: ROOT, port: MINE })
	check('自己端口的残留被清掉并放行', r.ok === true && r.stopped === MINE, JSON.stringify(r))
	await waitDown(MINE)
	check('清理后 4393 确实空出来了', up(MINE) === '0')
	killTree(p)
	await waitDown(MINE)
}

// ── 情形 4：requirePreviewSlot 的拒绝路径必须真的 exit 2，且不动别人的进程 ──
// 门禁依赖的是**退出码**（acceptance.ps1 靠它判红），所以这一条必须在子进程里验。
{
	const p = spawn(`npx astro preview --port ${OTHER}`, { cwd: ROOT, shell: true, stdio: 'ignore' })
	const came = await waitUp(OTHER)
	check('测试前提：4391 又起来了', came)

	const child = spawnSync(process.execPath, [
		'-e',
		`import(${JSON.stringify(new URL('./lib/preview-guard.mjs', import.meta.url).href)}).then(m => m.requirePreviewSlot({ cwd: process.cwd(), port: ${MINE} }))`,
	], { cwd: ROOT, encoding: 'utf8' })
	check('requirePreviewSlot 以退出码 2 拒绝', child.status === 2, `status=${child.status}`)
	check('拒绝信息里写明了对方端口', String(child.stderr).includes(String(OTHER)), (child.stderr || '').trim().split('\n')[0] || '')
	await sleep(800)
	check('拒绝后依然没有杀掉它', up(OTHER) !== '0', `监听数=${up(OTHER)}`)
	killTree(p)
	await waitDown(OTHER)
}

console.log(`\n${fails === 0 ? '全部通过' : `失败 ${fails} 项`}`)
process.exit(fails ? 1 : 0)
