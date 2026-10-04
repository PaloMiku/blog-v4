import fs from 'node:fs'
import path from 'node:path'
/**
 * 门禁：锚点 class 必须有落点。
 *
 * ## 这条门禁在防什么
 *
 * `styles/article.css` 是一个顶层 `.article { … }` 大块，装着全部正文排版规则
 * （行高、标题、列表、引用，以及 `img { max-width: 100% }`）。页面模板某次输出
 * `<article class="md-story">` 并丢掉了静态 `article` class，于是**整份样式表
 * 在每个文章页上都匹配不到任何东西**：正文裸奔、图片撑破栏宽。
 *
 * 当时所有结构类门禁都是绿的——它们只断言文字 / 标题 / 链接 / 日期还在，
 * 从来不检查「CSS 还有没有选择器能挂上去」。
 *
 * ## 判据
 *
 * 1. 每个带 `<article>` 的页面，`<article>` 上必须带 `article` 这个锚点 class
 *    （页面模板输出的是 `<article class="md-story">`，锚点一丢，整份样式表脱靶）
 * 2. `article` 锚点必须在产物 CSS 里有规则——规则不在，是同一种症状的另一种成因
 * 3. `max-width:100%` 必须在产物 CSS 里（图片溢出栏宽的那个症状）
 *
 * ## 为什么不读 Nuxt 基线了
 *
 * 原版逐页对比 Astro 与 `baseline/nuxt/` 的 `<article>` class 集合。迁移已完成，
 * 基线也无法再冻结（Nuxt 源码树已删），留着只会得到「基线缺失」。
 * 上面三条不依赖任何历史快照，且第 2、3 条**比原版更强**：
 * 原版只能发现「Nuxt 有、Astro 没有」的 class，现在能发现任何一条让锚点脱靶的改动。
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, 'dist')

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name)
		if (e.isDirectory())
			walk(p, out)
		else if (e.name.endsWith('.html'))
			out.push(p)
	}
	return out
}

function articleClasses(html) {
	const tag = html.match(/<article\b[^>]*>/)
	if (!tag)
		return null
	const cls = tag[0].match(/class="([^"]*)"/)
	if (!cls)
		return []
	return cls[1].split(/\s+/).filter(Boolean).sort()
}

const pages = fs.existsSync(DIST) ? walk(DIST) : []
if (!pages.length) {
	console.log('SKIP: dist/ 没有 html，页面没构建出来')
	process.exit(1)
}

let fail = 0

console.log('--- 1. 正文页的 <article> 都带 article 锚点 class ---')
// 首页与预览页的 <article> 是卡片组件的根（只有 data-astro-cid、没有 class），
// article.css 本来就不该套在它们身上，所以跳过「完全没有 class」的那些。
// 其余 class 随分类变化（md-tech / md-gal / …），那是设计，不是缺陷；
// 唯独 article 锚点一旦脱靶，整份 article.css 就挂不上去了。
const sets = new Map()
const missing = []
let classless = 0
for (const p of pages) {
	const rel = path.relative(DIST, p).split(path.sep).join('/')
	const c = articleClasses(fs.readFileSync(p, 'utf8'))
	if (c === null)
		continue
	if (!c.length) {
		classless++
		continue
	}
	sets.set(rel, c)
	if (!c.includes('article'))
		missing.push(`${rel}  [${c.join(' ')}]`)
}
if (!sets.size) {
	console.log('  MISS  没有任何页面的 <article> 带 class')
	fail++
}
else if (missing.length) {
	console.log(`  FAIL  ${missing.length}/${sets.size} 个页面的 <article> 没有 article 锚点 class`)
	for (const m of missing.slice(0, 10)) console.log(`          ${m}`)
	if (missing.length > 10)
		console.log(`          …还有 ${missing.length - 10} 页`)
	fail++
}
else {
	const variants = new Set([...sets.values()].map(c => c.join(' ')))
	console.log(`  OK    ${sets.size} 个正文页的 <article> 都带 article 锚点（另有 ${variants.size} 种分类 class 组合）`)
}
// 棘轮：锚点整体脱落（模板把 class 属性整个删掉）时，上面那条会静默退化成「0 页参与检查」，
// 和 check-dates 那族 skip 陷阱同形——一道什么都没测的门禁不能算通过。
if (sets.size < 60) {
	console.log(`  FAIL  带锚点的正文页只剩 ${sets.size} 个（棘轮 60）——锚点可能整体脱落了`)
	fail++
}
else {
	console.log(`  OK    带锚点的正文页 ${sets.size} 个 ≥ 棘轮 60（另有 ${classless} 个无 class 的卡片 <article> 已跳过）`)
}

console.log('--- 2. article 锚点必须在产物 CSS 里有规则 ---')
const cssDir = path.join(DIST, '_astro')
const cssAll = (fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(f => f.endsWith('.css')) : [])
	.map(f => fs.readFileSync(path.join(cssDir, f), 'utf8'))
	.join('\n')
if (/\.article\b/.test(cssAll)) {
	console.log('  OK    .article 规则在 dist/_astro 的 css 里')
}
else {
	console.log('  MISS  .article 规则在所有 css 里都不见了')
	fail++
}

console.log('--- 3. 图片不撑破栏宽（max-width:100%）---')
if (/max-width:\s*100%/.test(cssAll)) {
	console.log('  OK    max-width:100% 存在于 css')
}
else {
	console.log('  MISS  css 里没有 max-width:100%')
	fail++
}

console.log('')
if (fail === 0) {
	console.log(`RESULT: PASS - anchor classes attach (${sets.size} pages)`)
	process.exit(0)
}
console.log(`RESULT: FAIL - ${fail} problem(s) found`)
process.exit(1)
