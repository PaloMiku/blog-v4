#!/usr/bin/env node
/**
 * 冻结 Nuxt 生产基线，供接管后的离线门禁当唯一对比锚点。
 *
 * ## 为什么需要它
 *
 * 接管后仓库根就是 Astro 站，Nuxt 源码树（`app/` `content/` `server/` `shared/`
 * `nuxt.config.ts` …）会被整体删除，`pnpm generate` 随之不存在。
 * 而 7 道离线门禁（`check-anchor-classes` / `check-dead-css` / `check-titles` /
 * `compare-dom` / `audit-image-pipeline` / `collect-evidence` / `compare-urls`）
 * 都要一个「Nuxt 侧长什么样」的参照物。剩下的两个来源是：
 *
 *   1. 线上站 blog.sotkg.com —— 真实，但它是**部署产物**，会随部署漂移；
 *   2. 一次冻结的本地快照 —— 确定、可离线、可复现。
 *
 * 两者测的不是同一件事，所以都要有：离线门禁用 (2)，`live:*` 门禁用 (1)。
 *
 * ## 只收 HTML 与 CSS
 *
 * 完整产物 38 MB / 850 文件，其中 589 个 JS chunk 占 28.9 MB。**没有一道门禁
 * 读基线的 JS**（它们要么解析 HTML 结构，要么比对 CSS 规则），但
 * `collect-evidence.ps1` 会逐字节比 `atom.xml` / `subscriptions.opml`——
 * 所以 `*.xml` 也在白名单里。
 *
 * 2026-10-03 首次冻结时只收了 html 与 css，**漏了 xml**，于是那一节对比在接管后
 * 报 FileNotFound。修得了白名单，修不了当时那份基线：Nuxt 源码树已删，
 * `pnpm generate` 不存在了。要取回那对 XML 只能从
 * https://blog.sotkg.com/atom.xml 抓，或者从还留着 Nuxt 树的机器上恢复
 * 2026-10-03 之前的 `.output/public`。
 *
 * `200.html` / `404.html` 是 Nuxt 的 SPA 兜底壳，不参与路由对比，排除。
 *
 * ## 用法
 *
 *   node scripts/freeze-baseline.mjs                     # 从 .output/public 冻结
 *   node scripts/freeze-baseline.mjs --from <dir>        # 指定来源目录
 *   node scripts/freeze-baseline.mjs --commit <sha>     # 手工标注来源提交
 *
 * 前提：来源目录必须由**当前源码**生成。基线早于源码就是「用旧产物当新标准」，
 * 会把已经修好的问题永久固化成一条常驻红灯（`clarity-resource-list` 的
 * 代码块计数差就是这么来的）。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT = join(ROOT, 'baseline', 'nuxt')

/** SPA 兜底壳：不是路由，不参与对比 */
const SKIP_FILES = new Set(['200.html', '404.html'])

function argOf(flag, dflt = null) {
	const i = process.argv.indexOf(flag)
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const from = resolve(ROOT, argOf('--from', '.output/public'))
const commitOverride = argOf('--commit')

if (!existsSync(from)) {
	console.error(`✗ 来源目录不存在：${from}`)
	console.error('  先用 Nuxt 侧跑一次 pnpm generate，再冻结。')
	process.exit(2)
}

/** 递归收集 html / css / xml，保留相对结构 */
function collect(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const abs = join(dir, entry.name)
		if (entry.isDirectory())
			collect(abs, out)
		else if (/\.(html|css|xml)$/.test(entry.name) && !SKIP_FILES.has(entry.name))
			out.push(abs)
	}
	return out
}

const files = collect(from).sort()
if (!files.length) {
	console.error(`✗ ${from} 里没有 html/css，它不是一个 Nuxt 静态产物目录。`)
	process.exit(2)
}

// 幂等：先清空上一份冻结，避免删过的文件残留成「幽灵基线」
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const pages = []
let bytes = 0
for (const abs of files) {
	const rel = relative(from, abs)
	cpSync(abs, join(OUT, rel))
	bytes += statSync(abs).size
	if (rel.replace(/\\/g, '/').endsWith('index.html'))
		pages.push('/' + rel.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\/$/, ''))
}
pages.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)))

writeFileSync(join(OUT, 'urls.txt'), `${pages.join('\n')}\n`, 'utf8')

/** 来源提交：记录基线是哪份源码的产物，否则日后无法判断基线是否过期 */
let commit = commitOverride ?? 'unknown'
let dirty = ''
if (!commitOverride) {
	try {
		commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
		const st = execFileSync('git', ['status', '--porcelain', '-uno'], { cwd: ROOT, encoding: 'utf8' }).trim()
		if (st)
			dirty = `\n> ⚠️ 冻结时**已跟踪文件有未提交改动**（\`git status -uno\` 非空），基线与提交 ${commit} 不完全等价。`
	}
	catch {}
}

writeFileSync(join(OUT, 'BASELINE.md'), `# Nuxt 生产基线（冻结于 ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC）

> **本目录不入库**（根 \`.gitignore\` 里有 \`baseline/\`），按迁移决策先作为本地锚点，
> 收尾时再决定是否提交。**换机器或 CI 上这 7 道离线门禁会直接报「基线缺失」**——
> 那是有意的信号，不是 bug。

| 项 | 值 |
| --- | --- |
| 来源目录 | \`${relative(ROOT, from) || from}\` |
| 来源提交 | \`${commit}\` |
| 路由数 | ${pages.length} |
| 文件数 | ${files.length}（*.html + *.css + *.xml） |
| 体积 | ${(bytes / 1024 / 1024).toFixed(2)} MB |
${dirty}

## 只收 html / css / xml

完整 Nuxt 产物是 38 MB / 850 文件，其中 589 个 JS chunk 占 28.9 MB。**没有一道门禁读基线的 JS**：
\`check-anchor-classes\` / \`check-dead-css\` 比对 CSS 规则，其余解析 HTML 结构。
若将来某道门禁开始需要基线 JS，改 \`collect()\` 的扩展名白名单即可。

\`200.html\` / \`404.html\` 是 Nuxt 的 SPA 兜底壳，不是路由，已排除。

## 谁在读这个目录

| 门禁 | 读什么 |
| --- | --- |
| \`check-anchor-classes.ps1\` | CSS 规则（\`max-width:100%\` 覆盖面） |
| \`check-dead-css.ps1\` | HTML 的 Prose* 类 + CSS 规则 + 每页 \`<pre>\` 计数 |
| \`compare-titles.ps1\` | 每页 \`<title>\` |
| \`compare-dom.ps1\` | HTML 结构 |
| \`audit-image-pipeline.ps1\` | HTML 里的 \`<img>\`/\`<NuxtImg>\` |
| \`collect-evidence.ps1\` | 汇总证据 |
| \`compare-urls.ps1\` | \`urls.txt\`（本目录生成） |

## 重新冻结

基线早于源码 = 用旧产物当新标准。先改 Nuxt 源码 → \`pnpm generate\` → 再跑本脚本。
`, 'utf8')

console.log('✓ 基线已冻结')
console.log(`  路由      ${pages.length}`)
console.log(`  文件      ${files.length}  (${(bytes / 1024 / 1024).toFixed(2)} MB)`)
console.log(`  来源提交  ${commit}${dirty ? '  (有未提交改动!)' : ''}`)
console.log(`  输出      ${relative(ROOT, OUT)}${sep}`)
console.log('')
console.log('  路由清单（前 8 条）：')
for (const p of pages.slice(0, 8))
	console.log(`    ${p}`)
console.log(`    … 共 ${pages.length} 条，见 baseline/nuxt/urls.txt`)
