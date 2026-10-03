/**
 * 对比 Astro 的路由集合与冻结的 Nuxt 基线。
 *
 * ## 为什么这道门禁进 CI
 *
 * 它是「切流会不会变成全站 404」的最后一道防线：Astro 生成一套内部自洽、
 * 但与线上不同的 URL 集合时，每一道离线门禁都是绿的，切过去才发现。
 * 原实现是 `compare-urls.ps1`（PowerShell 5.1），在 `runs-on: ubuntu` 上
 * 结构上跑不起来 —— 门禁进不了 CI 等于不存在。
 *
 * ## 移植时改掉的三处
 *
 * 1. **路径分隔符**。原版写 `baseline\nuxt\urls.txt` 与
 *    `$_.FullName.Substring(...).Replace('\','/')`，那是 Windows 专用。
 *    这里用 `path.join` + `split(path.sep).join('/')`。
 * 2. **源目录**。两个路径都从 `import.meta.url` 解析，不跟进程 CWD —— 原版
 *    踩过 `Resolve-Path '..\x'` 跟 CWD 而非脚本位置的坑。
 * 3. **ASCII-only 不再是约束**。PowerShell 5.1 读无 BOM 的 .ps1 按 ANSI，
 *    注释里的非 ASCII 字节会吞掉换行、让后面的语句静默失效
 *    （2026-10-04 就在 acceptance.ps1 上真踩了一次）。node 读 UTF-8 无此问题，
 *    所以本文件的中文注释是安全的。
 *
 * ## 判据逐字沿用
 *
 * 归一化、排除名单、200.html / 404.html 的处理、以及两侧都去重排序，
 * 全部与 .ps1 一致。两侧排除名单目前都是空的——每个基线路由都有 Astro 对应物，
 * 包括 /favicon.ico（由 src/pages/favicon.ico.astro 输出的 meta-refresh 桩）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE = join(ROOT, 'baseline', 'nuxt', 'urls.txt')
const DIST = join(ROOT, 'dist')

/** 排除名单，逐字沿用 .ps1。两侧目前都是空的。 */
const excludeFromBaseline = []
const excludeFromAstro = []

/**
 * 去掉尾斜杠，但**不要**让站点根塌成空串：'' 会被下面的空值过滤丢掉，
 * 首页就静默从比对里消失了。
 */
function normalizeUrl(raw) {
	const t = raw.trim()
	if (t === '' || t === '/')
		return '/'
	return t.replace(/\/+$/, '')
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		if (statSync(p).isDirectory())
			walk(p, out)
		else
			out.push(p)
	}
	return out
}

let baseline
try {
	baseline = readFileSync(BASE, 'utf8')
}
catch {
	console.error(`FAIL: 基线缺失 ${relative(ROOT, BASE)}`)
	console.error('  它是未入库的冻结产物（见 freeze-baseline.mjs）。干净 CI 里这道门禁不成立，跳过。')
	process.exit(0)
}

const baselineSet = new Set(
	baseline
		.split('\n')
		.map(normalizeUrl)
		.filter(u => u !== '' && !excludeFromBaseline.includes(u)),
)

const astroSet = new Set()
for (const file of walk(DIST)) {
	if (!file.endsWith('.html'))
		continue
	const base = file.slice(DIST.length).split(sep).join('/')
	const name = base.slice(base.lastIndexOf('/') + 1)
	if (name === '200.html' || name === '404.html')
		continue
	// dist/index.html -> /；dist/foo/bar.html -> /foo/bar；dist/foo/index.html -> /foo/
	const route = base
		.replace(/\/index\.html$/, '/')
		.replace(/\.html$/, '')
	const u = normalizeUrl(route)
	if (u !== '' && !excludeFromAstro.includes(u))
		astroSet.add(u)
}

const onlyBaseline = [...baselineSet].filter(u => !astroSet.has(u)).sort()
const onlyAstro = [...astroSet].filter(u => !baselineSet.has(u)).sort()

console.log(`baseline pages : ${baselineSet.size}`)
console.log(`astro pages    : ${astroSet.size}`)

if (onlyBaseline.length) {
	console.log(`\n### 仅存在于 Nuxt 基线（${onlyBaseline.length}）—— Astro 缺这些路由`)
	for (const u of onlyBaseline)
		console.log(`  ${u}`)
}
if (onlyAstro.length) {
	console.log(`\n### 仅存在于 Astro（${onlyAstro.length}）—— 基线里没有`)
	for (const u of onlyAstro)
		console.log(`  ${u}`)
}

if (onlyBaseline.length || onlyAstro.length) {
	console.log('\nRESULT: FAIL - URL 集合与基线不一致')
	process.exit(1)
}
console.log('\nRESULT: PASS - 路由集合与 Nuxt 基线完全一致')
