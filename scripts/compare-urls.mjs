/**
 * 对比 Astro 的路由集合与冻结的 Nuxt 基线。
 *
 * 切流会不会变成全站 404 的最后一道防线：Astro 生成一套内部自洽、但与线上
 * 不同的 URL 集合时，每一道离线门禁都是绿的，切过去才发现。
 *
 * ⚠️ 依赖未入库的 `baseline/`（见 CLAUDE.md「冻结基线」）。**基线不在时它自我
 * 跳过、退出 0** —— 在 CI 里今天提供的是零覆盖，别把接线当成已有覆盖。
 *
 * 路径全部从共享的 REPO_ROOT 解析（不跟进程 CWD，见 scripts/lib/paths.mjs 文件头），
 * 并用 path.sep 归一。
 */
import { readFileSync } from 'node:fs'
import { join, sep as pathSep, relative } from 'node:path'
import process from 'node:process'
import { DIST, REPO_ROOT, toRoute } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const BASE = join(REPO_ROOT, 'baseline', 'nuxt', 'urls.txt')

/** 排除名单，逐字沿用 .ps1。两侧目前都是空的。 */
const excludeFromBaseline = []
const excludeFromAstro = []

/**
 * 去掉尾斜杠，但**不要**让站点根塌成空串。
 *
 * 收敛到 `toRoute`：本地这份实现语义最严谨（`''` / `'/'` 都归 `'/'`），是三份
 * 重复实现里的**判据来源**。塌成空串会被下面的空值过滤吃掉，于是首页静默从比对里
 * 消失——那正是「两边都少一条」仍然能通过的形态，所以这个分支必须保留在共享实现里，
 * 不能简化成 `p.replace(/\/+$/, '')`。
 */
const normalizeUrl = toRoute

let baseline
try {
	baseline = readFileSync(BASE, 'utf8')
}
catch {
	// 基线是未入库的冻结产物（Nuxt 源码树已删，无法再重新冻结；生成器
	// freeze-baseline.mjs 也已退役——现在跑它会把 Astro 产物冻成「Nuxt 基线」，
	// 那比不跑更坏）。干净 CI 里这道门禁不成立。
	//
	// 这一行必须以 SKIP 开头：accept.mjs 靠它把「没跑」和「跑过且通过」分开计数。
	// 写 FAIL 会让这道门禁在 CI 上被当成通过——而它其实什么都没测。
	console.error(`SKIP: 基线缺失 ${relative(REPO_ROOT, BASE)}`)
	console.error('  它是未入库的冻结产物，且已无法再冻结。干净 CI 里这道门禁不成立。')
	process.exit(0)
}

const baselineSet = new Set(
	baseline
		.split('\n')
		.map(normalizeUrl)
		.filter(u => u !== '' && !excludeFromBaseline.includes(u)),
)

const astroSet = new Set()
for (const file of walkFiles(DIST, { ext: '.html' })) {
	// `slice(DIST.length)`（不是 +1）**故意**留一个前导斜杠，下面再靠
	// `base.slice(base.lastIndexOf('/') + 1)` 把文件名摘掉，两处对消。
	// 改成 relative() 会让 base 不带前导斜杠，多处 `.replace()` 的锚点跟着变。
	const base = file.slice(DIST.length).split(pathSep).join('/')
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
