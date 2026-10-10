/**
 * 线上 URL 集合漂移门禁：线上站 sitemap 与本地构建 sitemap 的 URL 集合必须逐条相等。
 * 2026-10-03 前它是「切流前对比 Nuxt」的硬门禁；现在线上已是 Astro 产物，
 * 它的含义变成「这次构建没有让 URL 集合意外漂移」——外部事实源仍是线上 sitemap。
 *
 * 为什么单独一道门禁而不是并进 check-generated-urls：
 * check-generated-urls 只看本地产物自洽，它**永远发现不了**「Astro 生成的 URL 跟
 * 线上不是同一批」这类问题——本地自洽地生成 /2025/10/x/，线上是 /x/，
 * 两边各自门禁都是绿的，切流当天全站 404。这道门禁需要一个外部事实源，
 * 而事实源就是线上 sitemap。
 *
 * 用法：
 *   node scripts/compare-remote-sitemap.mjs
 *   BASE_URL=https://blog.sotkg.com node scripts/compare-remote-sitemap.mjs
 *   BASE_URL=http://localhost:4397 node scripts/compare-remote-sitemap.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { DIST, fileToRoute, toRoute } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const REMOTE = process.env.BASE_URL || 'https://blog.sotkg.com'

/** 从 sitemap XML 里取全部 <loc>，归一化成带前导斜杠、不带尾斜杠的路径。 */
function parseLocs(xml) {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
		.map(m => m[1].trim())
		.map((u) => {
			const p = new URL(u).pathname
			// 收敛前这里写的是 `p.length > 1 ? p.replace(/\/+$/, '') : p`，
			// 与 compare-urls / check-aria-current 的两份本地实现同义，现统一到 toRoute。
			return toRoute(p)
		})
}

/** 本地 sitemap-index.xml 里列出分片文件，递归读完。 */
function readLocalSitemap() {
	const direct = join(DIST, 'sitemap.xml')
	if (existsSync(direct))
		return readFileSync(direct, 'utf8')

	const idx = join(DIST, 'sitemap-index.xml')
	if (existsSync(idx)) {
		const index = readFileSync(idx, 'utf8')
		const parts = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())
		return parts
			.map(p => join(DIST, new URL(p).pathname.replace(/^\//, '')))
			.filter(p => existsSync(p))
			.map(p => readFileSync(p, 'utf8'))
			.join('\n')
	}

	// 没有 sitemap 文件（可能被过滤规则清空了）：退回从 dist 目录结构枚举。
	//
	// `skipDirs: ['_astro', 'api']` 是**刻意**的差异，不是遗漏：这里枚举的对象是
	// 「站点路由」，不是「产物里的文件」。`_astro` 是资源目录、`api` 是端点，
	// 两者都不对应任何页面；其余门禁要的恰恰是这两类文件，所以它们要扫、这里不扫。
	// 它会**替换**共享遍历器的默认跳过列表（node_modules / .git），而 dist 下本来
	// 就没有那两个目录，所以无副作用——写全是让「覆盖了默认值」这件事可见。
	//
	// 路由用 `fileToRoute`，**不带尾斜杠**。收敛前这里是手写的
	// `/${rel.replace(/index\.html$/, '')}`，对 `/2025/11/x/index.html` 产出
	// `/2025/11/x/`（带尾斜杠）——与另两处（`compare-urls` / `check-aria-current`）
	// 的形状不一致，属实。
	//
	// 但**它当时并没有造成假阳性**：产出随即被喂回 `parseLocs`，而 `parseLocs`
	// 的归一化会把尾斜杠去掉，两边因此仍然相等（已实测：改前改后输出逐字相同）。
	// 也就是说这处是**被下游掩盖的不一致**，不是活着的缺陷。
	// 统一到 `fileToRoute` 的理由是：它依赖「下游一定会再归一化一次」这个
	// 跨文件的巧合——哪天 `parseLocs` 因为别的理由不再抹尾斜杠（或者有人把这个
	// 回退路径单独拿去用），带尾斜杠的那份就会静默地和线上对不上。
	// 统一之后形状由产生它的那一步就定死，不再依赖下游兜底。
	const fallbackRoutes = walkFiles(DIST, {
		skipDirs: ['_astro', 'api'],
		test: (full, name) => name === 'index.html',
	}).map(fileToRoute)
	return fallbackRoutes
		.map(p => `<loc>${REMOTE}${p}</loc>`)
		.join('\n')
}

const localXml = readLocalSitemap()
const localLocs = parseLocs(localXml)

// 线上 sitemap 的形状随托管产物变：Nuxt 时代直接给 /sitemap.xml；
// 2026-10-03 起线上就是 Astro 产物（/sitemap-index.xml + 分片）。
// 两种形状都要认——这道门禁现在的含义是「新产物与线上没有 URL 漂移」，
// 而不是「模仿旧站」。
const base = REMOTE.replace(/\/+$/, '')
let remoteLocs = null
for (const p of ['/sitemap-index.xml', '/sitemap.xml']) {
	const res = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(30000) })
	if (!res.ok)
		continue
	const xml = await res.text()
	const locs = parseLocs(xml)
	if (locs.length === 0) {
		console.error(`FAIL: ${base}${p} 返回 200 但解析不出任何 <loc>——空解析不放行`)
		process.exit(1)
	}
	// index 形态：locs 指向分片，递归取回合并
	const looksLikeIndex = p === '/sitemap-index.xml'
	if (!looksLikeIndex) {
		remoteLocs = locs
		break
	}
	const shardPaths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname)
	const parts = []
	for (const sp of shardPaths) {
		const sr = await fetch(`${base}${sp}`, { signal: AbortSignal.timeout(30000) })
		if (!sr.ok) {
			console.error(`FAIL: ${base}${sp} -> HTTP ${sr.status}（index 已取到但分片缺失，不能当一致）`)
			process.exit(1)
		}
		parts.push(...parseLocs(await sr.text()))
	}
	remoteLocs = parts
	break
}
if (remoteLocs === null) {
	// 两种形状都拿不到 = 没有外部事实源，判「不可运行」，不是「一致」。
	console.log(`SKIP: 线上 ${base} 既没有 sitemap-index.xml 也没有 sitemap.xml —— 无外部事实源，不可运行`)
	process.exit(0)
}

const localSet = new Set(localLocs)
const remoteSet = new Set(remoteLocs)
const onlyLocal = [...localSet].filter(u => !remoteSet.has(u))
const onlyRemote = [...remoteSet].filter(u => !localSet.has(u))

console.log(`remote (live) : ${remoteSet.size}`)
console.log(`local  (Astro): ${localSet.size}`)

// 单一出口：PASS / FAIL 分支互斥。
//
// 原来这里是 `if (一致) { PASS; process.exit(0) }` 再顺序往下打印 FAIL。
// 某次把 process.exit(0) 批量替换成 process.exitCode = 0 之后，
// 标志位不终止执行，控制流继续掉进 FAIL 分支——
// 一句 sed 式替换毁掉控制流，症状还长得像真失败。
// （另外顶层 `return` 在 ESM 里也是语法错误，所以只能用 if/else。）
if (!onlyLocal.length && !onlyRemote.length) {
	console.log('\nPASS: URL 集合完全一致')
	process.exitCode = 0
}
else {
	if (onlyRemote.length) {
		console.log(`\n线上有、本地没有（切流后会 404）: ${onlyRemote.length}`)
		for (const u of onlyRemote.sort())
			console.log(`  - ${u}`)
	}
	if (onlyLocal.length) {
		console.log(`\n本地有、线上没有（切流后是多出来的 URL）: ${onlyLocal.length}`)
		for (const u of onlyLocal.sort())
			console.log(`  + ${u}`)
	}
	console.log('\nFAIL: URL 集合不一致')
	process.exitCode = 1
}
