/**
 * 对比 Astro 的路由集合与冻结的 Nuxt 基线。
 *
 * 切流会不会变成全站 404 的最后一道防线：Astro 生成一套内部自洽、但与线上
 * 不同的 URL 集合时，每一道离线门禁都是绿的，切过去才发现。
 *
 * ⚠️ 依赖未入库的 `baseline/`（见 CLAUDE.md「冻结基线」）。**基线不在时它自我
 * 跳过、退出 0** —— 在 CI 里今天提供的是零覆盖，别把接线当成已有覆盖。
 *
 * 路径全部从 `import.meta.url` 解析（不跟进程 CWD），并用 path.sep 归一。
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
