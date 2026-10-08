/**
 * 零构建告警门禁。
 *
 * ## 它在防什么失败模式
 *
 * Astro + Lightning CSS **不会**因为一个不认识的 selector 让构建失败。它会打印
 *
 *     'deep' is not recognized as a valid pseudo-class. Did you mean '::deep'...
 *
 * 然后**悄悄把那条规则丢掉**。`PostHeader.astro` 里有两条从 Vue 侧带过来的、
 * 当时还活着的 `:deep()` 规则，于是文章头图同时丢了 100% 宽高填充和
 * `object-fit: cover`。构建是绿的，其他每道门禁都是绿的，唯一的症状是
 * 「一张看起来有点不对的图片」。同样的「告警后继续」形态还适用于解析不到的
 * import，以及编译器无法表达的 MDX 节点。
 *
 * 当时没有任何东西在读构建日志，所以没有任何东西抓到它。
 *
 * ⚠️ 这道门禁的全部判据都作用在**日志文本**上。产物 `dist/` 是绿的证明不了
 * 任何事：被丢掉的规则压根不会出现在 `dist/` 里，因此对产物做的任何断言都
 * 看不见它。要看见它，只能读那次构建自己写下来的日志。
 *
 * ## 输入
 *
 * 默认读 `.astro-compare/acceptance-build.log`——`accept.mjs` 步骤 1 那次 `pnpm build`
 * 写下的完整 stdout+stderr；CI 里由 `pnpm build 2>&1 | tee` 写到同一个路径。
 * `--log <path>` 可以指到别的日志。没有日志就是「跑不起来」，退 2，不会退 0。
 *
 * 这道门禁**自己不再构建**（原 PS 版会跑一次 `astro build --outDir <tmp>`，
 * 纯粹为了给自己造一份日志；`accept.mjs` 直接复用步骤 1 那次构建）。
 * Node 侧的门禁一律由 `process.execPath` 起、不起子进程，所以 `-NoBuild` / `-OutDir` 连同那条隔离构建
 * 路径一起没了——它们不是判据，是「怎么把日志弄到手」的手段。判据一条没少。
 *
 * ## 相对 PowerShell 版的改动
 *
 * 判据条数、判据本身逐条不变。只换掉运行环境相关的部分：
 *
 * - 根目录从**脚本自身位置**解析（`import.meta.url`），不跟进程 CWD。
 *   原 PS 版用 `Resolve-Path '..\..'`，跟的是调用者的 CWD——从别的目录调它
 *   就会去读错的地方。
 * - PowerShell 的 `-match` 默认**大小写不敏感**，翻译成 JS 正则时逐条加了 `i`
 *   标志。这条很要紧：`generic-warn` 那条 `warn(ing)?` 一旦大小写敏感，
 *   Rollup 的 `MODULE_LEVEL_DIRECTIVE (Use "vite:build" ...)` 之类就会漏网。
 * - `[System.IO.File]::ReadAllText` 会**按 BOM 猜编码**；`Tee-Object` 在
 *   PowerShell 5.1 下写的是 UTF-16LE。`readFileSync(p, 'utf8')` 会把那 26 KB
 *   读成一堆 `w\0a\0r\0n\0`，**每一条判据都会静默失配**，门禁永远报绿。
 *   所以下面 `readLog()` 逐个 BOM 认编码——这不是优化，这是判据能不能成立的前提。
 * - 去掉 PowerShell 专属的告警（ANSI 码页、必须 ASCII-only、`$PSScriptRoot`
 *   一类）；那些限制在 Node 下不存在。
 * - 构建退出码这条判据在 Node 下恒为「无」：没有子进程就没有退出码。原 PS 版
 *   走 `-LogPath` 时同样拿不到（`$exitCode` 保持 `$null`，该分支不参与计数），
 *   所以这是**逐条一致**，不是被删掉。构建失败由步骤 2 的 `$LASTEXITCODE` 负责，
 *   而且是同一次构建。
 *
 * 退出码：0 = PASS，1 = FAIL，2 = 跑不起来。
 */
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'

const ROOT = REPO_ROOT
const DEFAULT_LOG = join(ROOT, '.astro-compare', 'acceptance-build.log')

// -- warning allowlist --------------------------------------------------------
// 每一条都必须写清理由。光秃秃一张白名单正是「真回归被挥手放行」的方式，
// 所以往这里加一条 pattern 是一个决定，不是一次清理。
const allow = [
	{
		pattern: 'MODULE_LEVEL_DIRECTIVE',
		reason: 'MDX head 注入带来的 Rollup 噪音。已验证无害：MDX 的 head export 确实生效'
			+ '（docs/astro-phase1-findings.md E 节，死代码/清洁度清单）。它不是正确性信号。',
	},
	{
		pattern: 'chunks are larger than 500 kB',
		reason: 'Mermaid + cytoscape 是重量级图库，但它们在 dynamic import 后面，'
			+ '只有真的含图的页面才付这份代价；这里的 chunk 体积告警不等于单页负载回归'
			+ '（每页 JS+CSS 的实测数字见 docs/astro-phase1-findings.md）。',
	},
	{
		pattern: 'conflicts with higher priority route',
		reason: '预期之内：站点同时有专门的 /link 路由和兜底的 /[...slug]，兜底也匹配 /link，'
			+ 'Astro 每次构建都会说一遍。专门的那条优先，渲染出来的页面是对的'
			+ '（compare-urls 在 67 个页面上过；compare-titles 已随 Nuxt 基线退役）。',
	},
]

// -- warning detectors --------------------------------------------------------
// 顺序只影响报告里的呈现；每一次匹配都会被报出来。
const rules = [
	{
		name: 'css-invalid-selector',
		pattern: 'not recognized as a valid',
		why: 'Lightning CSS 拒绝了一个 selector 或 at-rule。那条规则被从产物里丢掉，别的什么都不失败。',
	},
	{
		name: 'css-syntax',
		pattern: 'Unable to parse|unexpected token|Unexpected end of (CSS|stylesheet)',
		why: 'Lightning CSS 没能解析某张样式表。规则被静默丢掉。',
	},
	{
		name: 'mdx-unknown-node',
		pattern: 'Cannot handle unknown node',
		why: 'MDX 产出了编译器无法表达的节点类型（例如 raw html 节点）。内容被丢掉。',
	},
	{
		name: 'dependency-resolution',
		pattern: 'Cannot find|failed to resolve',
		why: '某个 import 或资源没能解析。那个引用被从产物里丢掉。',
	},
	{
		name: 'generic-warn',
		pattern: String.raw`\[\s*warn(ing)?\s*\]|^\s*warn(ing)?\b|\bwarn(ing)?:\s`,
		why: '兜底：没有专属规则的工具链告警。显式列出来，好让下一个撞进来的必须先做个决定。',
	},
]

// PowerShell 的 -match 默认大小写不敏感，这里逐条编译成带 i 的正则。
// 顺序 = 上面的书写顺序，不做任何重排。
const allowRe = allow.map(a => ({ ...a, re: new RegExp(a.pattern, 'i') }))
const rulesRe = rules.map(r => ({ ...r, re: new RegExp(r.pattern, 'i') }))

/**
 * 逐条对应原版 `[System.IO.File]::ReadAllText`：按 BOM 认编码。
 *
 * 缺了这一步，这道门禁会在「日志存在」的前提下**永远报绿**——UTF-16 日志被当
 * UTF-8 读进来之后，`[ WARN ]` 变成 `[\0W\0A\0R\0N\0 ]`，8 条判据无一生效。
 * 那不是「宽松」，那是**判据整体消失**，而报告看上去仍然像跑过了。
 *
 * 无 BOM 时按 UTF-8 读，与 .NET 的默认行为一致。
 */
function readLog(file) {
	const buf = readFileSync(file)
	if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
		// UTF-16LE，Tee-Object 的实际输出
		return buf.subarray(2).toString('utf16le')
	}
	if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
		// UTF-16BE：Node 没有对应 codec，按字节翻过来再按 LE 解
		const be = Buffer.from(buf.subarray(2))
		be.swap16()
		return be.toString('utf16le')
	}
	if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
		// UTF-8 BOM：.NET 会把 BOM 吃掉
		return buf.subarray(3).toString('utf8')
	}
	return buf.toString('utf8')
}

/** 逐条对应原版 `Remove-Ansi`：`ESC [ <参数> <最终字节>`。 */
function removeAnsi(s) {
	// 这个正则的**全部**要点就是匹配一个控制字符、并且逐字沿用原版那两个区间写法，
	// 所以下面这两条规则在这里无法满足。
	// eslint-disable-next-line no-control-regex, regexp/no-obscure-range
	return s.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

// -- get the log --------------------------------------------------------------
// 走 -LogPath 时原版的 $exitCode 保持 $null，「构建退出码非 0」那条分支不参与
// 计数。Node 下没有子进程，情况完全相同，因此这里就是一个显式的 null。
const buildExitCode = null

const argv = process.argv.slice(2)
let logArg = argv.indexOf('--log')
if (logArg === -1)
	logArg = argv.indexOf('--log-path')
const logPath = logArg === -1
	? DEFAULT_LOG
	// 命令行给的相对路径按惯例相对**调用者的 CWD**——这是「路径必须从脚本自身
	// 位置解析」那条针对脚本资产的约束，不是针对用户显式传入的参数的。
	: resolve(argv[logArg + 1] ?? '')

if (!existsSync(logPath) || !statSync(logPath).isFile()) {
	console.log(`ERROR: log not found: ${logPath}`)
	console.log('  这道门禁的全部判据都作用在构建日志上。没有日志 = 没有验过，不该算通过。')
	console.log('  先跑一次 `pnpm build 2>&1 | tee .astro-compare/acceptance-build.log`，')
	console.log('  或用 --log <path> 指到一份已有的构建日志。')
	console.log('RESULT: ERROR - cannot read build log')
	process.exit(2)
}

const log = readLog(logPath)
console.log(`source: existing log ${logPath}`)

// -- scan ---------------------------------------------------------------------
const lines = removeAnsi(log).split(/\r?\n/)

const hits = []
const allowed = new Map()
let total = 0

for (let i = 0; i < lines.length; i++) {
	const line = lines[i]
	if (!line.trim())
		continue
	total++

	let whitelisted = false
	// Vite 的 reporter 有些告警会横跨好几行，而第一行只是个**不带消息的头**
	// （"[WARN] [vite] [plugin builtin:vite-reporter]"）。逐行匹配会在正文已经
	// 被白名单放行的情况下，还是把那个光秃秃的头判成红。这里往后看几行，让
	// 一条被放行的正文能罩住它自己的头——而不是把头那个 pattern 整个放行
	// （那样同样会藏掉将来任何一条 vite-reporter 告警）。
	if (/\[WARN\].*\[plugin .*\]/i.test(line) && /\]$/.test(line.trimEnd())) {
		const window = lines.slice(i + 1, Math.min(i + 6, lines.length - 1) + 1).join('\n')
		for (const a of allowRe) {
			if (a.re.test(window)) {
				if (!allowed.has(a.pattern))
					allowed.set(a.pattern, { reason: a.reason, count: 0 })
				allowed.get(a.pattern).count++
				whitelisted = true
				break
			}
		}
	}
	if (whitelisted)
		continue

	for (const a of allowRe) {
		if (a.re.test(line)) {
			if (!allowed.has(a.pattern))
				allowed.set(a.pattern, { reason: a.reason, count: 0 })
			allowed.get(a.pattern).count++
			whitelisted = true
			break
		}
	}
	if (whitelisted)
		continue

	for (const r of rulesRe) {
		if (r.re.test(line)) {
			let text = line.trim()
			if (text.length > 200)
				text = `${text.slice(0, 200)}...`
			hits.push({ line: i + 1, name: r.name, why: r.why, text })
			break
		}
	}
}

// -- report -------------------------------------------------------------------
console.log('')
console.log('--- build warnings ---')
console.log(`  scanned ${total} non-empty log line(s)`)

for (const [k, v] of [...allowed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
	console.log(`  ALLOW ${k}  x${v.count}`)
	console.log(`          ${v.reason}`)
}

if (hits.length === 0) {
	console.log('  OK    no warning matched any detector')
}
else {
	console.log(`  --- ${hits.length} FAILING line(s) ---`)
	for (const h of hits) {
		console.log(`  [${h.name}] line ${h.line}: ${h.text}`)
		console.log(`      why: ${h.why}`)
	}
}

if (buildExitCode !== null && buildExitCode !== 0)
	console.log(`  FAIL  build exited with code ${buildExitCode}`)

let failCount = hits.length
if (buildExitCode !== null && buildExitCode !== 0)
	failCount++

console.log('')
if (failCount === 0) {
	console.log('RESULT: PASS - build is warning-free')
	process.exit(0)
}
console.log(`RESULT: FAIL - ${failCount} warning/build problem(s)`)
process.exit(1)
