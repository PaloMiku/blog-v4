import fs from 'node:fs'
import path from 'node:path'
/**
 * 门禁：布局骨架完好。
 *
 * ## 这条门禁在防什么
 *
 * 三栏博客外壳由 `id` / `class` 精确驱动，响应式收起侧栏还额外依赖一个
 * `:has()` 选择器。这几样任何一样写错，**构建照样全绿**，只是布局静默塌掉。
 *
 * 判据全部只读 `dist/`：静态产物里有没有这些 id、令牌、选择器。
 *
 * ## 为什么不读 Nuxt 基线了
 *
 * 原版拿这些判据和 `baseline/nuxt/` 对比，但迁移早已完成、线上就是这份产物，
 * 基线也**无法再冻结**（Nuxt 源码树已删）。留着它只会得到一句「基线缺失」。
 * 骨架是否完好，本地产物自己就能回答。
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, 'dist')
const PAGE = path.join(DIST, '2025', '11', 'riddle-joker', 'index.html')

if (!fs.existsSync(PAGE)) {
	console.log('SKIP: page not built')
	process.exit(1)
}

const page = fs.readFileSync(PAGE, 'utf8')
const cssDir = path.join(DIST, '_astro')
const cssFiles = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(f => f.endsWith('.css')) : []
const cssAll = cssFiles.map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n')

let fail = 0
const ok = msg => console.log(`  OK    ${msg}`)
function miss(msg) {
	console.log(`  MISS  ${msg}`)
	fail++
}

console.log('--- 1. 骨架 id / class ---')
for (const r of ['id="blog-root"', 'id="main-content"', 'id="blog-sidebar"', 'id="blog-aside"', 'class="blog-aside-track"', 'class="blog-footer']) {
	const n = page.split(r).length - 1
	if (n >= 1)
		ok(`${r} (x${n})`)
	else miss(r)
}

console.log('--- 2. 设计令牌存在 ---')
if (!cssFiles.length) {
	miss('构建没有产出任何 css')
}
else {
	ok(`${fs.readdirSync(cssDir).length} 个文件在 dist/_astro 下`)
	for (const tok of ['--c-primary', '--c-text-1', '--c-border', '--ld-bg-card', '--box-shadow-2']) {
		if (cssAll.includes(tok))
			ok(`token ${tok}`)
		else miss(`token ${tok}`)
	}
}

console.log('--- 3. 三栏网格与响应式收起 ---')
// :has() 是收起右栏的那条选择器，必须活着穿过编译
if (/:has\(/.test(cssAll))
	ok(':has() 选择器存活')
else miss(':has() 选择器没了（右侧栏永远不会收起）')
for (const bp of ['1080px', '768px']) {
	if (cssAll.includes(bp))
		ok(`断点 ${bp}`)
	else miss(`断点 ${bp}`)
}

console.log('--- 4. 作用域陷阱：article 祖先不得被二次加作用域 ---')
// Vue 产出 article .x[data-v-a]（作用域只落在 & 上）；
// Astro 侧写错会变成 article[data-astro-cid-x] .x[...]，永不匹配
const broken = cssAll.match(/article\[data-astro-cid-[^\]]+\]\s*\./g) || []
if (!broken.length)
	ok('没有二次加作用域的 article 祖先选择器')
else miss(`${broken.length} 个二次加作用域的 article 选择器`)

console.log('--- 4b. 嵌套回归：`:hover > &` 必须已被展平 ---')
// Astro 不像 postcss-nesting 那样展平 CSS 嵌套：源码里的 `.x { :hover > & {} }`
// 会原样输出成 `[cid]:hover>&`，非法 CSS，被浏览器静默丢弃
const invalidNesting = cssAll.match(/\[[^\]]+\]:hover>&/g) || []
if (!invalidNesting.length)
	ok('没有未展平的 hover-& 选择器')
else miss(`${invalidNesting.length} 个未展平的 hover-& 选择器`)
if (/:hover>\.icon-line\[/.test(cssAll))
	ok('Quote 的 hover 规则以展平形态存在')
else miss('Quote 的 hover 规则不见了')

console.log('--- 5. head 内联脚本 ---')
// 判据是「<script> 开标签上没有 src 属性」，与 PowerShell 原件逐字等价。
// eslint 建议把 `[^>]*` 收紧成 `[^>]+`（它认为 `\b` 与零次进入矛盾），但那会
// 改变匹配范围——改判据不是 lint 的职责，所以只关掉这条规则并写明理由。
// eslint-disable-next-line regexp/no-contradiction-with-assertion
const inline = page.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []
ok(`${inline.length} 段内联 script`)
const preload = page.match(/<link[^>]+rel="modulepreload"/g) || []
ok(`modulepreload 链接: ${preload.length}`)

console.log('')
if (fail === 0) {
	console.log('RESULT: PASS - layout shell intact')
	process.exit(0)
}
// 原版打印了 RESULT: FAIL 却没有 exit 1 —— 属「打了分不算红」那一族：
// 打印不算判红，没有非零退出码这道门禁就永远绿。打印与退出码必须同时存在。
console.log(`RESULT: FAIL - ${fail} problem(s)`)
process.exit(1)
