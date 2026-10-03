/**
 * 切流前的硬门禁：生产站（Nuxt）sitemap 与本地 Astro sitemap 的 URL 集合必须逐条相等。
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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const DIST = join(ROOT, 'dist')
const REMOTE = process.env.BASE_URL || 'https://blog.sotkg.com'

/** 从 sitemap XML 里取全部 <loc>，归一化成带前导斜杠、不带尾斜杠的路径。 */
function parseLocs(xml) {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
		.map(m => m[1].trim())
		.map((u) => {
			const p = new URL(u).pathname
			return p.length > 1 ? p.replace(/\/+$/, '') : p
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
			.map((p) => join(DIST, new URL(p).pathname.replace(/^\//, '')))
			.filter(p => existsSync(p))
			.map(p => readFileSync(p, 'utf8'))
			.join('\n')
	}

	// 没有 sitemap 文件（可能被过滤规则清空了）：退回从 dist 目录结构枚举
	const walk = (dir, acc = []) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.name === '_astro' || e.name === 'api')
				continue
			const full = join(dir, e.name)
			if (e.isDirectory())
				walk(full, acc)
			else if (e.name === 'index.html')
				acc.push('/' + full.slice(DIST.length + 1).replace(/\\/g, '/').replace(/index\.html$/, ''))
		}
		return acc
	}
	return walk(DIST)
		.map(p => `<loc>${REMOTE}${p}</loc>`)
		.join('\n')
}

const localXml = readLocalSitemap()
const localLocs = parseLocs(localXml)

const res = await fetch(`${REMOTE.replace(/\/+$/, '')}/sitemap.xml`, { signal: AbortSignal.timeout(30000) })
if (!res.ok) {
	console.error(`FAIL: ${REMOTE}/sitemap.xml -> HTTP ${res.status}`)
	process.exitCode = 1
}
const remoteLocs = parseLocs(await res.text())

const localSet = new Set(localLocs)
const remoteSet = new Set(remoteLocs)
const onlyLocal = [...localSet].filter(u => !remoteSet.has(u))
const onlyRemote = [...remoteSet].filter(u => !localSet.has(u))

console.log(`remote (Nuxt) : ${remoteSet.size}`)
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
