/**
 * 门禁：dist 里所有标题锚点 id 必须与 Nuxt Content 的算法逐字一致。
 *
 * ## 判据（哪四条）
 *
 * Nuxt 用 `@nuxtjs/mdc` 的 `compileHast` 给标题写 id，规则是
 * **github-slugger + 三个后处理**（`@nuxtjs/mdc/dist/runtime/parser/compiler.js:41`）：
 *
 * ```js
 * String(node.properties?.id || slugs.slug(toString(node)))
 *   .replace(/-+/g, "-")      // 折叠连续短横
 *   .replace(/^-|-$/g, "")    // 去首尾短横
 *   .replace(/^(\d)/, "_$1")  // 首位数字补 _
 * ```
 *
 * Astro 侧原本只有 `github-slugger`（`rehypeHeadingIds`），
 * 三个后处理一个都没有。已由 `src/lib/slug.ts` + `src/loaders/with-article-meta.ts` 补上。
 *
 * 这里查的**不是**「id 等于某个字面量」，而是**四条不变式**——
 * 它们恰好就是那三个后处理的可判定形式（外加一条幂等）：
 *
 * 1. 不含 `--`（连续短横已折叠）
 * 2. 不以 `-` 开头 / 结尾
 * 3. 首位不是裸数字（是数字就必须写成 `_1` 这种）
 * 4. 幂等：再过一次后处理不变（保证重复 build 不会让 id 漂移）
 *
 * 外加两条独立数据通路的核对：目录链接指向的 id 必须存在（旧有），
 * 以及**第五判据**——`dist/search-index.json` 的每个片段锚点必须 ∈
 * 对应页面产物的标题 id 集合（搜索索引自己跑 slugger，与 DOM 那套不同步
 * 就会「点搜索结果跳到不存在的片段」；全量核对，见下方判据处的说明）。
 *
 * **为什么值得单开一道门禁**：页高与计算样式两道门禁都**看不见**它——
 * `<a href="#…">` 指向一个不存在的 id，盒子尺寸一点不变。
 * 它是本轮新增的语义签名探针（`live:ui-parity`）抓出来的，
 * 但那趟要起浏览器、30 分钟；这道门禁纯静态、秒级，可以进基础流水线。
 *
 * 另外顺带查**目录链接指向的 id 必须存在**（`Toc.astro` 消费
 * `render(entry).headings` 的 slug，正文 DOM 的 id 由 `rendered.html` 归一，
 * 两处来自同一次归一，但它们是**两条独立的数据通路**，值得钉住）。
 *
 * ## 为什么扫的路径要写全
 *
 * `dist/` 下 HTML **不在根目录**：`/2025/12/x` 落在
 * `dist/2025/12/x/index.html`，`/x`（hidePostPrefix）落在 `dist/x/index.html`，
 * `/` 落在 `dist/index.html`。只 glob `dist/*.html` 会漏掉绝大多数页面
 * （这是 §67.3 同一个教训的形态）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { DIST } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

/** 三个后处理，与 `src/lib/slug.ts` 的 `nuxtHeadingId` 保持同一份语义 */
function nuxtHeadingId(slug) {
	return String(slug)
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.replace(/^(\d)/, '_$1')
}

/** 递归列出 dist 下所有 .html（不依赖层级约定） */
function htmlFiles(dir) {
	return walkFiles(dir, { ext: '.html' })
}

/**
 * 取每个 `h1`–`h6` 起始标签上的 `id`。
 *
 * 标签名后面不写 `\b`：`[^>]+` 已经把「必须还有属性」这件事表达了，
 * 写成 `\b[^>]*?` 反而触发 `regexp/no-contradiction-with-assertion`
 * （断言已经保证有进展，惰性量词的最小 0 就成了废话）。
 *
 * ⚠️ `id` 是**可选**的，且 `missing` 会被单独计数而不是直接判红。
 * 早先写成 `…\sid="([^"]*)"`（id 必需），于是「标题压根没有 id」这件事
 * 被正则**静默跳过**——门禁看不见自己最该看的那种缺失。
 * 反过来说，若把 `missing` 直接判红，又会把「MDC 组件内部手写的 `<h3>`」
 * 这类两边都没有 id 的合法情况也报出来，所以只统计、只在总结里摊开，
 * 由人判断。
 */
function headingIds(html) {
	const re = /<h([1-6])([^>]*)>/g
	const out = []
	for (const m of html.matchAll(re)) {
		const id = /\sid="([^"]*)"/.exec(m[2])
		out.push({ depth: m[1], id: id ? id[1] : null })
	}
	return out
}

const problems = []
const files = htmlFiles(DIST)
if (!files.length) {
	console.error('FAIL  dist 下没有 .html，先跑 pnpm build')
	process.exit(1)
}

/** 标题里根本没有 id 的次数——只统计不判红，理由见 headingIds 的注释 */
let missingId = 0

for (const file of files) {
	const rel = relative(DIST, file).replace(/\\/g, '/')
	const html = readFileSync(file, 'utf8')
	const ids = headingIds(html)
	const bad = new Set()

	for (const { id } of ids) {
		if (id === null) {
			missingId++
			continue
		}
		if (!id) {
			bad.add('id 是空串（`id=""` 与没有 id 一样不可用）')
			continue
		}
		if (id.includes('--'))
			bad.add(`含连续短横: ${JSON.stringify(id)}`)
		if (id.startsWith('-'))
			bad.add(`以短横开头: ${JSON.stringify(id)}`)
		if (id.endsWith('-'))
			bad.add(`以短横结尾: ${JSON.stringify(id)}`)
		if (/^\d/.test(id))
			bad.add(`首位是裸数字（Nuxt 会补 _）: ${JSON.stringify(id)}`)
		if (nuxtHeadingId(id) !== id)
			bad.add(`不是后处理的不动点（再过一次会变成 ${JSON.stringify(nuxtHeadingId(id))}）: ${JSON.stringify(id)}`)
	}

	const idSet = new Set(ids.map(h => h.id).filter(Boolean))

	// 目录里的页内链接必须指到真实存在的标题 id。
	//
	// ⚠️ 范围只能是 `[data-toc]` 容器，不能扫全页的 `href="#…"`：
	// 全页还有 `Toc.astro` 的两个动作链接 `#main-content`（返回开头）与
	// `#twikoo`（评论区容器，客户端才有）、GFM 脚注的
	// `#user-content-fn-…`（挂在 `<li>` 上而不是标题）、
	// 以及 MDC 组件里指向同名 slot 的 `#link-banner` 之类。
	// 这些都不是「标题锚点」，混进来会淹没真正的差异——
	// 第一次跑就报了 67/68 个文件「有问题」，把三处真缺陷埋掉了。
	// 标签名后不写 `\b`：`[^>]+` 本身已表达「后面还有属性」，
	// 写成 `\b[^>]*` 会触发 regexp/no-contradiction-with-assertion。
	const toc = html.match(/<div[^>]+data-toc[^>]*>([\s\S]*?)<\/div>/)
	if (toc) {
		for (const m of toc[1].matchAll(/<a[^>]+href="#([^"]+)"/g)) {
			if (m[1] && !idSet.has(decodeURIComponent(m[1])))
				bad.add(`目录链接 #${m[1]} 指向不存在的标题 id`)
		}
	}

	if (bad.size)
		problems.push([rel, [...bad]])
}

const headings = files.reduce((n, f) => n + headingIds(readFileSync(f, 'utf8')).length, 0)

/*
 * 第五判据：dist/search-index.json 的每个片段锚点必须 ∈ 对应页面产物里的标题 id 集合。
 *
 * 搜索索引由 `src/pages/search-index.json.ts` 独立跑一遍 github-slugger（数据通路
 * 与 `src/plugins/heading-ids.ts` 写进 DOM 的 id 完全分离），两边算法不同步时
 * 坏的是「点搜索结果跳到不存在的片段」——页高、样式门禁都看不见它。
 * 全量核对，不抽样（这是回归面最大的一条通路）。
 *
 * 自证：json 缺失、锚点总数为 0、url 定位不到产物 HTML，都判 FAIL。
 */
const idxFile = join(DIST, 'search-index.json')
const idxProblems = []
let idxAnchors = 0
if (!existsSync(idxFile)) {
	idxProblems.push('dist/search-index.json 不存在 —— 无法核对搜索锚点，先跑 pnpm build')
}
else {
	const sections = JSON.parse(readFileSync(idxFile, 'utf8'))
	const idsOfPage = new Map()
	for (const sec of sections) {
		const hashAt = sec.id.indexOf('#')
		if (hashAt === -1)
			continue
		const urlPath = sec.id.slice(0, hashAt) || '/'
		const anchor = decodeURIComponent(sec.id.slice(hashAt + 1))
		// build.format=directory：/x → dist/x/index.html，站点根 → dist/index.html
		const rel = urlPath === '/'
			? 'index.html'
			: `${urlPath.replace(/^\/+/, '').replace(/\/+$/, '')}/index.html`
		const file = join(DIST, rel)
		if (!idsOfPage.has(file))
			idsOfPage.set(file, existsSync(file) ? new Set(headingIds(readFileSync(file, 'utf8')).map(h => h.id).filter(Boolean)) : null)
		idxAnchors++
		const ids = idsOfPage.get(file)
		if (ids === null)
			idxProblems.push(`${sec.id} → 定位不到产物 HTML（dist/${rel}）`)
		else if (!ids.has(anchor))
			idxProblems.push(`${sec.id} → #${anchor} 不在页面标题 id 集合里${ids.has(nuxtHeadingId(anchor)) ? `（补 nuxtHeadingId 后处理即存在：#${nuxtHeadingId(anchor)}）` : ''}`)
	}
	if (idxAnchors === 0)
		idxProblems.push('search-index.json 里锚点总数为 0 —— 断言没接到东西，不能算通过')
}
// 无 id 的这些是**布局壳**里的标题，不是 markdown 内容标题：
//   h1.post-title（文章头）、h3.title（侧栏文章列表）、h3.text-creative（评论区）
//   ——全都在 .astro 模板里写死，Nuxt 侧同样没有 id。
// 实测抽样三页（takagi / misskey-sidebar / clannad）：线上同样只多这 3 个。
// 所以这里只统计、不判红，但**要把数字摊开**——
// 一个「静默不做任何事」的数字比没有数字更危险。
//
// ⚠️ 2026-10-03 分享功能移除后，本计数从 401 降到 334（总标题 1109 → 1042），
// 两个数**同步 −67**：分享弹窗里那个写死的 `h3`「分享方式」曾在一篇里出现 67 次
// （Nuxt 侧它是客户端才渲染的，Astro 侧是静态输出——见坑位 15）。
// 这里记一笔是因为它同时说明了为什么这个计数**不能当回归基线**：
// 少一个组件就是少 67 个标题，数字掉下去未必是缺陷。要判断得先看 diff。
const missingNote = missingId ? `，另有 ${missingId} 个布局壳标题没有 id（不判红，见本行上方注释）` : ''

if (!problems.length && !idxProblems.length) {
	console.log(`OK: 标题锚点 id —— ${files.length} 个 HTML / ${headings} 个标题，全部符合 Nuxt 的 github-slugger + 三步后处理；search-index 的 ${idxAnchors} 个片段锚点全部 ∈ 对应页面标题 id 集合${missingNote}`)
	process.exit(0)
}

for (const [rel, list] of problems) {
	console.error(`FAIL  ${rel}`)
	for (const b of list) console.error(`        ${b}`)
}
for (const b of idxProblems)
	console.error(`FAIL  search-index  ${b}`)
console.error(`\nFAIL: ${problems.length}/${files.length} 个 HTML 有标题锚点问题，另有 ${idxProblems.length} 条搜索索引锚点问题`)
process.exit(1)
