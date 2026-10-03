#!/usr/bin/env node
/**
 * 图标名审计：扫 dist 产物，列出全站实际用到的图标名，并与已安装的 iconify 集合做差集。
 *
 * 为什么扫 dist 而不是扫源码：
 * 站点里相当一部分图标名是**构建期算出来**的（`getDomainIcon(url)` 依赖文章里的
 * 外链域名、`getArchIcon(arch)` 依赖友链数据），静态扫源码拿不全。
 * `Icon.astro` 是所有调用方的唯一出口，正常路径由 astro-icon 在 `<svg>` 上打
 * `data-icon`，降级路径由本组件打 `data-icon-missing`，
 * 两者的并集就是「本次构建真实请求过的全部图标名」。
 *
 * 用法（需先 `pnpm build`）：
 *   node scripts/audit-icons.mjs [--dist dist] [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')

const argv = process.argv.slice(2)
const distDir = join(root, argv[argv.indexOf('--dist') + 1] ?? 'dist')
const asJson = argv.includes('--json')

/** 递归收集所有 .html */
function collectHtml(dir, acc = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory())
			collectHtml(full, acc)
		else if (entry.endsWith('.html'))
			acc.push(full)
	}
	return acc
}

if (!existsSync(distDir)) {
	console.error(`[audit-icons] 找不到 ${distDir}，请先执行 pnpm build`)
	process.exit(1)
}

const files = collectHtml(distDir)
const used = new Map() // name -> 出现次数
const missing = new Map() // name -> 出现次数
const pagesWithMissing = new Set()

for (const file of files) {
	const html = readFileSync(file, 'utf8')
	for (const m of html.matchAll(/data-icon-missing="([^"]*)"/g))
		missing.set(m[1], (missing.get(m[1]) ?? 0) + 1)
	if (html.includes('data-icon-missing'))
		pagesWithMissing.add(relative(distDir, file))
	for (const m of html.matchAll(/\sdata-icon="([^"]*)"/g)) {
		// 排除降级占位（它同时带 data-icon 与 data-icon-missing）
		if (m[1] in Object.fromEntries(missing))
			continue
		used.set(m[1], (used.get(m[1]) ?? 0) + 1)
	}
}

/* ---- 与已安装的 @iconify-json 集合做差集 ---- */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const installed = new Set(
	[...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
		.filter(n => n.startsWith('@iconify-json/'))
		.map(n => n.slice('@iconify-json/'.length)),
)

const bySet = new Map() // set -> Set<icon>
for (const name of used.keys()) {
	const sep = name.indexOf(':')
	const set = sep < 0 ? 'local' : name.slice(0, sep)
	const icon = sep < 0 ? name : name.slice(sep + 1)
	if (!bySet.has(set))
		bySet.set(set, new Set())
	bySet.get(set).add(icon)
}

/** 逐个去集合里查真实存在性（含别名） */
const unresolved = []
for (const [set, icons] of bySet) {
	if (set === 'local')
		continue // local 集合由 src/icons/*.svg 构建期生成，无法离线校验
	if (!installed.has(set)) {
		unresolved.push({ name: `${set}:*`, reason: `集合未安装（缺 @iconify-json/${set}）` })
		continue
	}
	const collection = require(`@iconify-json/${set}/icons.json`)
	const known = { ...collection.icons, ...(collection.aliases ?? {}) }
	for (const icon of icons) {
		if (!(icon in known))
			unresolved.push({ name: `${set}:${icon}`, reason: `集合 ${set} 内无此图标` })
	}
}

const summary = {
	distDir: relative(root, distDir),
	htmlFiles: files.length,
	installedCollections: [...installed].sort(),
	setsUsed: [...bySet.keys()].sort(),
	distinctIcons: used.size,
	totalIconInstances: [...used.values()].reduce((a, b) => a + b, 0),
	missing: [...missing.entries()].sort().map(([name, count]) => ({ name, count })),
	pagesWithMissing: [...pagesWithMissing].sort(),
	unresolvedFromSource: unresolved,
}

if (asJson) {
	console.log(JSON.stringify(summary, null, 2))
	process.exit(0)
}

console.log(`产物目录      : ${summary.distDir}（${summary.htmlFiles} 个 HTML）`)
console.log(`已装集合      : ${summary.installedCollections.join(', ')}`)
console.log(`实际用到集合  : ${summary.setsUsed.join(', ')}`)
console.log(`去重图标数    : ${summary.distinctIcons}，总实例 ${summary.totalIconInstances}`)
console.log('')
console.log(`降级占位      : ${summary.missing.length} 个名字，分布在 ${summary.pagesWithMissing.length} 个页面`)
for (const m of summary.missing)
	console.log(`  - ${m.name}  ×${m.count}`)
if (summary.pagesWithMissing.length)
	console.log(`  页面: ${summary.pagesWithMissing.slice(0, 10).join(', ')}${summary.pagesWithMissing.length > 10 ? ' …' : ''}`)
console.log('')
console.log(`源集合对不上  : ${summary.unresolvedFromSource.length}`)
for (const u of summary.unresolvedFromSource)
	console.log(`  - ${u.name}  ${u.reason}`)

console.log('')
console.log('按集合统计：')
for (const [set, icons] of [...bySet].sort()) {
	const miss = summary.missing.filter(m => m.name.startsWith(`${set}:`)).length
	console.log(`  ${set.padEnd(18)} ${String(icons.size).padStart(3)} 个${miss ? `（其中降级 ${miss}）` : ''}`)
}
