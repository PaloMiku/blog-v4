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
 *   node scripts/accept.mjs --print-policies    # 只打印门禁的跳过策略矩阵，不跑门禁
 *   ACCEPT_FORCE_CI=1 node scripts/accept.mjs   # 本机按 CI 判定跑（验 CI 行为，见下）
 *
 * 退出码：
 *   0  全绿
 *   1  有门禁红，或出现违规跳过
 *   2  用法错 / 环境跑不起来 / 门禁进程被杀
 *
 * ⚠️ **门禁自己的退出码比这套多，本 runner 一律按「非 0 = FAIL」处理**，
 * 也就是说门禁的细分码到这一层就压平了。目前有两处已知会被压平：
 * `probe-subtree.mjs` 用 `exitCode = 3` 表示「后代元素越出了根盒子」
 * （探测器的几何结论，不是通过/不通过），用 `130` 表示 SIGINT。
 * 两者都不是「判据判红」，但在 accept 的语境里都应该红——所以压平是对的。
 * **新门禁若要引入新的非 0 码，请在这里补一行**，否则下一个人会以为
 * 退出码只有 0/1/2 三档。
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import stripAnsi from 'strip-ansi'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, 'dist')
const LOG_DIR = path.join(ROOT, '.astro-compare')
const BUILD_LOG = path.join(LOG_DIR, 'acceptance-build.log')

/**
 * 「跳过」的三档策略。**默认是 `never`——没标注就是最严的那一档**，
 * 这样新增门禁时忘记考虑跳过条件，代价是「一旦跳过就红」，而不是「静默放过」。
 *
 * | skip            | 本机跳过 | CI 跳过 | 用在什么门禁上 |
 * |-----------------|----------|----------|----------------|
 * | `never`         | 红       | 红       | 绝大多数门禁：它们没有正当的跳过理由，跳过即缺陷 |
 * | `env-dependent` | 绿       | **红**   | 内存不足 / 网络不可达。CI runner 是 16GB 规格，跳过说明环境退化 |
 * | `expected-in-ci`| 红       | 绿       | 结构性跳过（输入不在 checkout 里），仍计入 skipped 并在汇总里点名 |
 *
 * 为什么要分 CI 与本机：这道 runner 的旧版对 `skipped > 0` 一律 `exit 0`，
 * 而 CI 的步骤顺序是 `pnpm build` → `accept.mjs --skip-build`——**恰好在内存
 * 最紧的时刻**调用唯一的浏览器门禁。它在 CI 上自我放弃，流水线照样绿灯，
 * 且这个绿灯和「门禁跑过并通过」在汇报里长得一模一样。
 *
 * `expected-in-ci` 要克制着用：它等价于「永久豁免」，
 * 所以每一条都必须写 `why`，且 CI 上仍然计入 `skipped`、
 * 在汇总里逐条点名，不是静默放行。
 */
const SKIP_POLICIES = new Set(['never', 'env-dependent', 'expected-in-ci'])

/** 门禁项要么是名字字符串，要么是 { name, skip, why }。默认 `never`。 */
function gateName(g) {
	return typeof g === 'string' ? g : g.name
}

function gatePolicy(g) {
	const p = typeof g === 'string' ? 'never' : (g.skip || 'never')
	if (!SKIP_POLICIES.has(p))
		throw new Error(`${gateName(g)} 的 skip 策略 "${p}" 不合法（合法值：${[...SKIP_POLICIES].join(' / ')}）`)
	if (p !== 'never' && typeof g === 'object' && !g.why)
		throw new Error(`${gateName(g)} 标了 skip: '${p}' 但没写 why——豁免没有理由就等于永久静默放行`)
	return p
}

/**
 * 是否按 CI 判定。`ACCEPT_FORCE_CI=1` 让本机也能验 CI 行为——
 * CI 相关的判据如果只能到 CI 上才能验，就等于没有 CI 相关的判据。
 */
const IS_CI = process.env.ACCEPT_FORCE_CI === '1'
	|| process.env.GITHUB_ACTIONS === 'true'
	|| process.env.CI === 'true'

/**
 * 默认档门禁。全部只读 dist/ 与 src/，零外网、零浏览器（check-runtime-dom 例外：
 * 它起本地 preview + 无头 Chrome，但只连 localhost）。
 *
 * 新增门禁时：把脚本放进 scripts/、在这里加一行、同一条命令跑一次红绿双向。
 * 「写了没接线」等于没写。
 *
 * 元素是字符串时 skip 策略取默认的 `never`。**只有三道门禁例外**——
 * 每一道都要能一句话说清「它为什么有正当的跳过理由」，否则不许标。
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
	'check-tab-panels',
	'check-mdc-eval',
	'check-icon-box',
	'check-icon-swap',
	'check-flip-gates',
	'check-list-controls',
	// 结构语义
	'check-scope-anchors',
	// 豁免台账治理（棘轮 / 到期）。放默认档：它只读台账与配置，不依赖 dist，
	// 也不依赖构建是不是新的——一条豁免到期跟产物新旧无关。
	'check-expirations',
	'check-heading-ids',
	'check-feeds',
	'check-text-literal',
	'check-aria-current',
	// CSS
	'audit-css-blocks',
	'audit-dead-scope',
	'check-dropped-css',
	'check-affordances',
	// 关键路径资产：条件资源（KaTeX）与产物必须一致 + 第三方阻塞样式表预算。
	// 放这里是因为它治的正是 2026-10-07 实测到的那类缺陷——把 hasMath 强制成
	// false 时，其余 31 道门禁全绿，是产物核对才发现公式页丢了 CSS。
	'check-critical-assets',
	// 依赖边界与外部合同
	'check-self-contained',
	{
		name: 'check-twikoo-cdn',
		skip: 'env-dependent',
		why: '要连真实 CDN 比对 Twikoo 版本。本机断网可以跳，CI 上跳过即红——CDN 上的版本不对是真实风险，不该被一次网络抖动放过。',
	},
	{
		name: 'compare-urls',
		skip: 'expected-in-ci',
		why: '比的是 baseline/nuxt/urls.txt，而根 .gitignore 里有 baseline/，CI 的 checkout 里没有它。结构性跳过，CI 上必然发生。',
	},
	// 运行时
	{
		name: 'check-runtime-dom',
		skip: 'env-dependent',
		why: '无头 Chrome 约 700MB，内存不足时自我保护。本机被别的进程占满可以跳；CI runner 是 16GB 规格，在那里跳过说明环境退化，不是环境使然。',
	},
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
	const opt = { profile: 'offline', skipBuild: false, only: null, printPolicies: false }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--profile')
			opt.profile = argv[++i]
		else if (a === '--skip-build')
			opt.skipBuild = true
		else if (a === '--only')
			opt.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean)
		else if (a === '--print-policies')
			opt.printPolicies = true
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

/**
 * 起一道门禁进程，返回**两份**输出：`out` 是原文（失败时原样打给人看，
 * 保留颜色有助于读堆栈），`text` 是脱色后的（**所有判定只用它**）。
 *
 * ## 为什么要分两份
 *
 * 这道 runner 用正则判定子进程输出：`SKIP_MARKERS = /^SKIP(?:PED)?\b/m` 决定
 * 「这道门禁是不是自己放弃了」，`lastResultLine` 用 `startsWith('RESULT:')`
 * 决定汇总表那一列填什么。**两个都是逐行前缀匹配**——而门禁里 9 个脚本自发
 * ANSI 颜色（`compare-ui-parity` 12 处、`check-dropped-css` 8 处、
 * `audit-css-blocks` / `audit-dead-scope` 各 7 处、`check-runtime-dom` 4 处）。
 *
 * 只要有谁给 `RESULT:` 或 `SKIP:` 那一行加了颜色前缀，**判定会静默失效**：
 * 汇总表那列恒为空、被放弃的门禁不再被计入 `skipped`、而流水线照样绿灯——
 * 正是「绿灯失效」那一族。现在没炸是因为恰好没人给那两行上色，属运气不属设计。
 *
 * 收在这里而不是让每个门禁各自脱色，是因为**判定发生在这一层**：
 * 脱色点必须与判定点同源，散在各门禁里就等于没有。
 * 代价是 `strip-ansi` 从「零引用的死 devDep」变成真依赖——它本来就躺在
 * devDependencies 里，正好。
 */
function runNode(script, args = []) {
	const file = path.join(ROOT, 'scripts', script)
	if (!fs.existsSync(file))
		return { status: 2, out: `SKIP: scripts/${script} 不存在`, text: `SKIP: scripts/${script} 不存在`, missing: true }
	// 用 process.execPath 而不是 'node'：跨平台，且不会因为 PATH 里没有 node 而失败
	const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', cwd: ROOT, maxBuffer: 32 * 1024 * 1024 })
	const out = `${r.stdout || ''}${r.stderr || ''}`
	return { status: r.status === null ? 2 : r.status, out, text: stripAnsi(out) }
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
	const skipped = r.status === 0 && (r.missing || SKIP_MARKERS.test(r.text))
	const note = r.missing
		? 'SKIP 脚本不存在'
		: skipped
			? firstSkipLine(r.text)
			: lastResultLine(r.text)
	record(name, r.status, secs, note, skipped)
	return { ...r, skipped }
}

/**
 * 判定一次跳过在当前环境里「该不该红」。
 *
 * 返回 `null` 表示合规，`{ reason }` 表示这次跳过破坏了「绿灯 = 该跑的跑了」。
 * 注意判据的方向：**宁可误报也不漏报**——把一条真跳过的门禁当成跑过并通过，
 * 才是危险的那个方向（那正是这套判据要治的病）。
 */
function skipViolation(name, policy) {
	const allowed = IS_CI
		? policy === 'expected-in-ci'
		: policy === 'env-dependent'
	if (allowed)
		return null
	const where = IS_CI ? 'CI 上' : '本机'
	return {
		reason: `${name} 跳过了，但它的 skip 策略是 '${policy}'，${where}不允许跳过。${
			policy === 'never' ? '它没有正当的跳过理由——跳过即缺陷。' : ''
		}${IS_CI ? '' : ' 若这是本机环境问题，先看它该不该标 env-dependent。'}`,
	}
}

function firstSkipLine(out) {
	const l = (out || '').split('\n').map(s => s.trim()).find(l => SKIP_MARKERS.test(l))
	return l ? l.slice(0, 90) : 'SKIP'
}

function lastResultLine(out) {
	const line = (out || '').split('\n').map(s => s.trim()).filter(Boolean).findLast(l => l.startsWith('RESULT:'))
	return line ? line.slice(7, 90) : ''
}

/**
 * 门禁红了就把它的完整输出打出来。
 *
 * 2026-10-04 CI 第一次跑时 `check-dates` 红了，汇总里只有一行 `FAIL`——
 * 「哪一页、源值多少、产物值多少」全在门禁自己的 stdout 里，而 runner 把它吞了。
 * 于是只能把流水线日志整个拉下来、grep 门禁名才能看到原因。
 * **一道门禁在流水线里红了却说不出为什么，等于逼人去重跑一遍本地。**
 */
function dumpFailure(name, out) {
	const text = (out || '').trimEnd()
	if (!text) {
		console.log(`      （${name} 没有输出）`)
		return
	}
	for (const line of text.split('\n'))
		console.log(`      │ ${line}`)
}

function section(title) {
	console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

/**
 * 打印名单的跳过策略矩阵。不跑门禁、只算策略——用来在改名单时
 * 一眼看到「哪些门禁在本机允许跳过、哪些在 CI 上不允许」，
 * 免得改完才发现 CI 会红。
 */
function printPolicies() {
	const all = [...OFFLINE_GATES, ...FULL_EXTRA.map(x => ({ name: x.name, skip: 'never' }))]
	const rows = all.map((g) => {
		const p = gatePolicy(g)
		return {
			门禁: gateName(g),
			策略: p,
			本机跳过: p === 'env-dependent' ? '绿' : p === 'expected-in-ci' ? '红' : '红',
			CI跳过: p === 'expected-in-ci' ? '绿' : '红',
			理由: typeof g === 'object' && g.why ? g.why : '',
		}
	})
	console.log(`门禁 ${rows.length} 道；判定环境：${IS_CI ? 'CI' : '本机'}${process.env.ACCEPT_FORCE_CI === '1' && !process.env.GITHUB_ACTIONS ? '（ACCEPT_FORCE_CI=1 强制）' : ''}`)
	for (const r of rows) {
		console.log(`\n  ${r.门禁}  [${r.策略}]  本机跳过→${r.本机跳过}  CI跳过→${r.CI跳过}`)
		if (r.理由)
			console.log(`      ${r.理由}`)
	}
	const exempt = rows.filter(r => r.策略 !== 'never')
	console.log(`\n合计：${rows.length} 道门禁，其中 ${exempt.length} 道有跳过豁免（${exempt.map(r => r.门禁).join('、')}），其余 ${rows.length - exempt.length} 道跳过即红。`)
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

	if (opt.printPolicies) {
		printPolicies()
		process.exit(0)
	}

	console.log(`验收 runner  档位=${opt.profile}${IS_CI ? '  [按 CI 判定跳过策略]' : ''}`)
	stepBuild(opt.skipBuild)

	let gates = [...OFFLINE_GATES]
	if (opt.profile === 'full')
		gates.push(...FULL_EXTRA.map(g => g.name))
	if (opt.only)
		gates = gates.filter(g => opt.only.includes(gateName(g)))

	// 过滤后一道都不剩时**必须报错**，不能让它走到汇总变成「全绿」。
	// 实测踩过：名单元素从字符串改成 { name, skip, why } 之后，
	// `--only` 里的字符串跟对象比不上，--only 整个失效、被过滤成空，
	// runner 照样打出「ACCEPTED: all steps green」——**一道门禁都没跑，却报全绿**。
	// 这正是这套判据要治的病，只不过这次发生在 runner 自己身上。
	if (opt.only && !gates.length) {
		const known = [...OFFLINE_GATES, ...FULL_EXTRA.map(x => x.name)].map(gateName)
		console.error(`FAIL: --only ${opt.only.join(',')} 没有匹配到任何门禁。已排除。`)
		console.error(`      档位 ${opt.profile} 里可用的门禁：${known.join(', ')}`)
		process.exit(2)
	}

	section(`门禁（${gates.length} 道）`)
	let missing = 0
	const violations = []
	for (const g of gates) {
		const name = gateName(g)
		const policy = gatePolicy(g)
		if (FULL_EXTRA.some(x => x.name === name)) {
			const meta = FULL_EXTRA.find(x => x.name === name)
			const t0 = process.hrtime.bigint()
			const r = runNode(meta.script)
			const secs = Number(process.hrtime.bigint() - t0) / 1e9
			const skipped = r.status === 0 && (r.missing || SKIP_MARKERS.test(r.text))
			record(name, r.status, secs, skipped ? firstSkipLine(r.text) : lastResultLine(r.text), skipped)
			if (skipped) {
				// 加重档的门禁默认 never：它们要么打真实网络要么跑很久，没有正当跳过理由
				const v = skipViolation(name, 'never')
				if (v)
					violations.push(v)
			}
			console.log(`  ${r.status !== 0 ? 'FAIL' : skipped ? 'SKIP' : 'OK  '}  ${name.padEnd(24)} ${secs.toFixed(1)}s  ${results.at(-1).note}`)
			if (r.status !== 0)
				dumpFailure(name, r.out)
			if (r.missing)
				missing++
			continue
		}
		const r = runGate(name)
		if (r.missing)
			missing++
		const badge = r.status !== 0 ? 'FAIL' : r.skipped ? 'SKIP' : 'OK  '
		if (r.skipped) {
			const v = skipViolation(name, policy)
			if (v)
				violations.push(v)
		}
		console.log(`  ${badge}  ${name.padEnd(24)} ${(results.at(-1).seconds).toFixed(1)}s  ${results.at(-1).note}`)
		if (r.status !== 0)
			dumpFailure(name, r.out)
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
			record(BUILD_WARNING_GATE, r.status, secs, lastResultLine(r.text), r.status === 0 && SKIP_MARKERS.test(r.text))
			console.log(`  ${r.status !== 0 ? 'FAIL' : 'OK  '}  ${BUILD_WARNING_GATE.padEnd(24)} ${secs.toFixed(1)}s  ${lastResultLine(r.text)}`)
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
	// 违规跳过：门禁没跑，且按它的 skip 策略，这次不该跑得起。绿灯必须红。
	const allowedSkipped = skipped.length - violations.length
	console.log(`\ntotal: ${total}   passed: ${passed}   failed: ${failed.length}   skipped: ${skipped.length}   (合规跳过 ${allowedSkipped} / 违规跳过 ${violations.length})`)
	if (skipped.length) {
		console.log(`\n注意：${skipped.length} 道门禁**没有真正运行**（脚本自己放弃了：内存不够 / 基线缺失 / 网络不可达）。`)
		console.log('      它们不计入通过。上面的备注写了各自的原因——「全绿」不包括它们。')
	}
	if (violations.length) {
		section('违规跳过（绿灯因此作废）')
		for (const v of violations) console.log(`  - ${v.reason}`)
		console.log(`\n判据是「绿灯 = 该跑的跑了且跑过了」。这 ${violations.length} 道既没跑、`
			+ '策略又不允许在此处跳，所以这次不能算通过。')
		console.log('真要豁免就把该门禁的 skip 策略显式标成 env-dependent / expected-in-ci 并写清 why——')
		console.log('那是带理由的、有 diff 的一行改动，不是让 runner 悄悄放过。')
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
	if (violations.length) {
		console.log(`\nFAILED: ${violations.length} 道门禁违规跳过，「全绿」不成立。`)
		process.exit(1)
	}
	console.log(skipped.length ? 'ACCEPTED: no failures, but see the skipped steps above' : 'ACCEPTED: all steps green')
	process.exit(0)
}

// 名单在底部导出，是为了让 check-ci-triggers.mjs 能 import 它校验
// 「名单里的脚本都真实存在」——CI 不再手抄名单。
export { BUILD_WARNING_GATE, FULL_EXTRA, gateName, gatePolicy, IS_CI, OFFLINE_GATES }
