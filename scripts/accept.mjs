import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
/**
 * 验收 runner —— 单一入口，跨平台。
 *
 * 取代曾经的 `scripts/acceptance.ps1`。改写的理由不是「PowerShell 不好」，是三条实测：
 *
 * 1. **跨平台**：`.ps1` 在 `runs-on: ubuntu` 上根本跑不了，于是所有 PowerShell 门禁
 *    永远进不了 CI。整套门禁只能在本机跑，等于没有 CI 保护。
 * 2. **接线会静默失效**：旧 runner 逐个解析 `scripts/<名字>.ps1`，文件不在就打
 *    `SKIP (script not present)` 并**记 exit 0**。把一个门禁从 `.ps1` 改成 `.mjs`
 *    而忘了改名单，它就变成「还在列表里、但一次都不会跑」——这正是仓库里记着的
 *    「新写的门禁不接进流水线就等于不存在」那一族。
 * 3. **组装即事实**：门禁名单、归属档位、命令参数全在这一个文件里，文档只描述分档
 *    原则。旧 runner 与 CLAUDE.md 各存一份名单，已经漂移过好几次。
 *
 * 用法：
 *   node scripts/accept.mjs                     # 默认档 offline
 *   node scripts/accept.mjs --profile full      # 加重档（含打线上站，约 20-25 min）
 *   node scripts/accept.mjs --skip-build        # 复用现有 dist/，只跑门禁
 *   node scripts/accept.mjs --only check-dates  # 只跑某几道（调试用，逗号分隔）
 *
 * 退出码：0 全绿；1 有门禁红；2 用法错 / 环境跑不起来。
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, 'dist')
const LOG_DIR = path.join(ROOT, '.astro-compare')
const BUILD_LOG = path.join(LOG_DIR, 'acceptance-build.log')

/**
 * 默认档门禁。全部只读 dist/ 与 src/，零外网、零浏览器（check-runtime-dom 例外：
 * 它起本地 preview + 无头 Chrome，但只连 localhost）。
 *
 * 新增门禁时：把脚本放进 scripts/、在这里加一行、同一条命令跑一次红绿双向。
 * 「写了没接线」等于没写。
 */
const OFFLINE_GATES = [
	// 结构与内容：产物里该有的东西在不在
	'check-integration',
	'check-layout',
	'check-anchor-classes',
	'check-prose-layer',
	'check-content-preservation',
	'check-dates',
	'check-assets',
	'audit-deferred',
	// 组件与标记
	'check-component-fence',
	'check-mdc-eval',
	'check-icon-box',
	'check-icon-swap',
	'check-flip-gates',
	'check-list-controls',
	// 结构语义
	'check-scope-anchors',
	'check-heading-ids',
	'check-text-literal',
	'check-aria-current',
	// CSS
	'audit-css-blocks',
	'audit-dead-scope',
	'check-dropped-css',
	'check-affordances',
	// 依赖边界与外部合同
	'check-self-contained',
	'check-twikoo-cdn',
	'compare-urls',
	// 运行时
	'check-runtime-dom',
	// 自检：门禁清单本身
	'check-ci-triggers',
]

/**
 * 加重档：需要打线上站或花很久的。默认档刻意不跑——20 分钟的重档谁也不会跑，
 *  那比它要防的失败更糟。只在切换 / 发布前显式点名。
 */
const FULL_EXTRA = [
	{ name: 'preview-guard-selftest', script: 'preview-guard.selftest.mjs', note: '验 preview 端口协商的守卫本身' },
	{ name: 'live:sitemap', script: 'compare-remote-sitemap.mjs', note: '线上 sitemap vs 本地产物' },
	{ name: 'live:ui-parity', script: 'compare-ui-parity.mjs', note: '逐页对比线上与本地产物（大头，约 20 min）' },
]

/** 默认档没有独立步骤，靠 --build-log 拿到日志单独跑。 */
const BUILD_WARNING_GATE = 'check-build-warnings'

function parseArgs(argv) {
	const opt = { profile: 'offline', skipBuild: false, only: null }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--profile')
			opt.profile = argv[++i]
		else if (a === '--skip-build')
			opt.skipBuild = true
		else if (a === '--only')
			opt.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean)
		else if (a === '-h' || a === '--help')
			opt.help = true
		else return { error: `未知参数 ${a}` }
	}
	// 错档直接拒，不静默回落——「悄悄用了一个更松的默认值」和「悄悄丢了一道门禁」
	// 是同一种错。旧 runner 用 ValidateSet 拒，这里手写等价检查。
	if (!['offline', 'full'].includes(opt.profile)) {
		return { error: `-Profile ${opt.profile} 不是合法档位（合法值：offline / full）。这是参数错误，不是静默回落。` }
	}
	return opt
}

const results = []
function record(step, exit, seconds, note, skipped) {
	results.push({ step, exit, seconds, note: note || '', skipped: Boolean(skipped) })
}

function runNode(script, args = []) {
	const file = path.join(ROOT, 'scripts', script)
	if (!fs.existsSync(file))
		return { status: 2, out: `SKIP: scripts/${script} 不存在`, missing: true }
	// 用 process.execPath 而不是 'node'：跨平台，且不会因为 PATH 里没有 node 而失败
	const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', cwd: ROOT, maxBuffer: 32 * 1024 * 1024 })
	return { status: r.status === null ? 2 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

// 门禁主动放弃时（内存不够、基线缺失、网络不可达…）多数脚本选择退 0 而不是报错，
// 理由本身成立——一次网络抖动不该拦住一次发布。但对**验收结论**来说，
// 「没跑」和「跑过且通过」必须分开计数，否则汇报里的「全绿」是假的。
//
// 约定：门禁要表示「我没跑」，第一行必须以大写 SKIP / SKIPPED 开头。
// **大小写敏感是故意的**——`check-dates` 的汇总表里有一行小写的
// `skipped : 23`（跳过原因分类，不是「整道门禁被跳过」），忽略大小写会把它
// 误判成跳过，于是真跑过的门禁被记成没跑。宁可漏报也不误报：把没跑的算成跑了
// 才是危险的那个方向。
const SKIP_MARKERS = /^SKIP(?:PED)?\b/m

function runGate(name) {
	const t0 = process.hrtime.bigint()
	const r = runNode(`${name}.mjs`)
	const secs = Number(process.hrtime.bigint() - t0) / 1e9
	const skipped = r.status === 0 && (r.missing || SKIP_MARKERS.test(r.out))
	const note = r.missing
		? 'SKIP 脚本不存在'
		: skipped
			? firstSkipLine(r.out)
			: lastResultLine(r.out)
	record(name, r.status, secs, note, skipped)
	return { ...r, skipped }
}

function firstSkipLine(out) {
	const l = (out || '').split('\n').map(s => s.trim()).find(l => SKIP_MARKERS.test(l))
	return l ? l.slice(0, 90) : 'SKIP'
}

function lastResultLine(out) {
	const line = (out || '').split('\n').map(s => s.trim()).filter(Boolean).findLast(l => l.startsWith('RESULT:'))
	return line ? line.slice(7, 90) : ''
}

function section(title) {
	console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

// ── 步骤 1：构建 ──────────────────────────────────────────────────────────
function stepBuild(skip) {
	if (skip) {
		section('构建（跳过，复用现有 dist/）')
		if (!fs.existsSync(DIST)) {
			console.error('FAIL: --skip-build 但 dist/ 不存在。先跑一次 pnpm build。')
			process.exit(2)
		}
		record('build (skipped)', 0, 0, '复用现有 dist/')
		return
	}
	section('构建')
	fs.mkdirSync(LOG_DIR, { recursive: true })
	// Windows 上 pnpm 是 .cmd，必须走 shell；Linux/macOS 直接 spawn。
	// 这是全仓库唯一必须 shell 的地方，门禁一律用 process.execPath 起。
	const r = spawnSync('pnpm', ['build'], {
		cwd: ROOT,
		encoding: 'utf8',
		shell: process.platform === 'win32',
		maxBuffer: 64 * 1024 * 1024,
	})
	fs.writeFileSync(BUILD_LOG, `${r.stdout || ''}${r.stderr || ''}`)
	const secs = 0
	if (r.status !== 0) {
		record('build', r.status ?? 2, secs, `日志 ${path.relative(ROOT, BUILD_LOG)}`)
		console.error('FAIL: pnpm build 没通过，日志已写入', BUILD_LOG)
		console.error((r.stdout || '').split('\n').slice(-15).join('\n'))
		process.exit(r.status === null ? 2 : 1)
	}
	record('build', 0, secs, `日志 ${path.relative(ROOT, BUILD_LOG)}`)
}

// ── 主流程 ───────────────────────────────────────────────────────────────
// 名单在文件顶部 export 出去，是为了让 check-ci-triggers.mjs 能直接 import 它们
// 校验「名单里的脚本都真实存在」——CI 不再手抄名单，那份手抄清单已经漂过。
// 所以本文件必须能被 import 而不执行任何东西。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain)
	main()

function main() {
	const opt = parseArgs(process.argv.slice(2))
	if (opt.error) {
		console.error('FAIL:', opt.error)
		process.exit(2)
	}
	if (opt.help) {
		console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''))
		process.exit(0)
	}

	console.log(`验收 runner  档位=${opt.profile}`)
	stepBuild(opt.skipBuild)

	let gates = [...OFFLINE_GATES]
	if (opt.profile === 'full')
		gates.push(...FULL_EXTRA.map(g => g.name))
	if (opt.only)
		gates = gates.filter(g => opt.only.includes(g))

	section(`门禁（${gates.length} 道）`)
	let missing = 0
	for (const name of gates) {
		if (FULL_EXTRA.some(g => g.name === name)) {
			const meta = FULL_EXTRA.find(g => g.name === name)
			const t0 = process.hrtime.bigint()
			const r = runNode(meta.script)
			const secs = Number(process.hrtime.bigint() - t0) / 1e9
			const skipped = r.status === 0 && (r.missing || SKIP_MARKERS.test(r.out))
			record(name, r.status, secs, skipped ? firstSkipLine(r.out) : lastResultLine(r.out), skipped)
			console.log(`  ${r.status !== 0 ? 'FAIL' : skipped ? 'SKIP' : 'OK  '}  ${name.padEnd(24)} ${secs.toFixed(1)}s  ${results.at(-1).note}`)
			if (r.missing)
				missing++
			continue
		}
		const r = runGate(name)
		if (r.missing)
			missing++
		const badge = r.status !== 0 ? 'FAIL' : r.skipped ? 'SKIP' : 'OK  '
		console.log(`  ${badge}  ${name.padEnd(24)} ${(results.at(-1).seconds).toFixed(1)}s  ${results.at(-1).note}`)
	}

	// check-build-warnings 单独跑：它读步骤 1 写下的日志，不自己构建。
	// --skip-build 时仍然跑，只要那份日志还在——CI 正是这么用的：它自己 build，
	// 把日志 tee 到同一个路径，然后 `--skip-build` 复用产物。这样「零告警构建」
	// 在 CI 里也自动获得覆盖，而不用再手写一遍门禁列表。
	if (!opt.only || opt.only.includes(BUILD_WARNING_GATE)) {
		section('构建告警（读构建日志）')
		if (opt.skipBuild && !fs.existsSync(BUILD_LOG)) {
			record(`${BUILD_WARNING_GATE} (skipped)`, 0, 0, '没有构建日志可读', true)
			console.log(`  SKIP  ${BUILD_WARNING_GATE}（--skip-build，且 ${path.relative(ROOT, BUILD_LOG)} 不存在）`)
		}
		else {
			const t0 = process.hrtime.bigint()
			const r = runNode(`${BUILD_WARNING_GATE}.mjs`, ['--log', BUILD_LOG])
			const secs = Number(process.hrtime.bigint() - t0) / 1e9
			record(BUILD_WARNING_GATE, r.status, secs, lastResultLine(r.out), r.status === 0 && SKIP_MARKERS.test(r.out))
			console.log(`  ${r.status !== 0 ? 'FAIL' : 'OK  '}  ${BUILD_WARNING_GATE.padEnd(24)} ${secs.toFixed(1)}s  ${lastResultLine(r.out)}`)
		}
	}

	// ── 汇总 ─────────────────────────────────────────────────────────────────
	section('汇总')
	for (const r of results) {
		const badge = r.exit !== 0 ? 'FAIL' : r.skipped ? 'SKIP' : 'OK  '
		console.log(`  ${badge}  ${r.step.padEnd(26)} ${r.seconds.toFixed(1).padStart(6)}s  ${r.note}`)
	}
	const failed = results.filter(r => r.exit !== 0)
	const skipped = results.filter(r => r.skipped)
	const ran = results.filter(r => !r.skipped)
	const total = results.length
	const passed = ran.filter(r => r.exit === 0).length
	console.log(`\ntotal: ${total}   passed: ${passed}   failed: ${failed.length}   skipped: ${skipped.length}`)
	if (skipped.length) {
		console.log(`\n注意：${skipped.length} 道门禁**没有真正运行**（脚本自己放弃了：内存不够 / 基线缺失 / 网络不可达）。`)
		console.log('      它们不计入通过。上面的备注写了各自的原因——「全绿」不包括它们。')
	}
	if (missing) {
		console.log(`\n注意：有 ${missing} 道门禁的脚本不存在。它们在名单里但不会跑——`)
		console.log('      「写了没接线」等于没写。要么补上脚本，要么从名单里删掉。')
	}
	if (failed.length) {
		console.log('\nFAILED STEPS:')
		for (const f of failed) console.log(`  - ${f.step}  (exit ${f.exit})`)
		process.exit(1)
	}
	console.log(skipped.length ? 'ACCEPTED: no failures, but see the skipped steps above' : 'ACCEPTED: all steps green')
	process.exit(0)
}

// 名单在底部导出，是为了让 check-ci-triggers.mjs 能 import 它校验
// 「名单里的脚本都真实存在」——CI 不再手抄名单。
export { BUILD_WARNING_GATE, FULL_EXTRA, OFFLINE_GATES }
