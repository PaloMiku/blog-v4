import fs from 'node:fs'
import path from 'node:path'
/**
 * 门禁：正文渲染层（Prose*）确实落进了产物。
 *
 * ## 这条门禁在防什么
 *
 * `ProsePre` / `ProseA` / `ProseP` / `ProseTable` 是正文排版的主体。任何一层
 * 只搬进来一半——有标记没样式，或有样式没标记——**构建照样全绿**，因为其它门禁
 * 只断言文字还在，看不见盒子。
 *
 * 附带守一条 shiki 的坑：Astro 只输出 CSS 变量、不内联 `color:`，
 * 少了这层映射每个 token 都会静默继承正文色，代码高亮等于没有。
 *
 * ## 为什么不读 Nuxt 基线了
 *
 * 原版（`check-dead-css.ps1`）有三节：死 class 普查、正文层锚点、
 * 「代码块计数与 Nuxt 基线逐页相等」。第一节与第三节都建立在
 * `baseline/nuxt/` 上，而基线无法再冻结（Nuxt 源码树已删）、迁移也早已完成。
 * 第一节的职责由 `audit-dead-scope.mjs` 承担（它对 src 下的 astro 作用域规则
 * 逐条复算，棘轮锁在 3 条已知），第三节是纯 Nuxt 对比，已退役。
 * 留在原文件里、并且现在仍然有价值的就是本文件这两节。
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

const SAMPLE = path.join(DIST, '2025', '10', 'misskey-fediverse-deploy', 'index.html')
const cssDir = path.join(DIST, '_astro')
let css = ''
if (fs.existsSync(cssDir)) {
	for (const f of fs.readdirSync(cssDir)) {
		if (f.endsWith('.css'))
			css += `${fs.readFileSync(path.join(cssDir, f), 'utf8')}\n`
	}
}
for (const p of walk(DIST)) {
	for (const m of fs.readFileSync(p, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += `${m[1]}\n`
}

let fail = 0
const ok = msg => console.log(`  OK    ${msg}`)
function miss(msg) {
	console.log(`  MISS  ${msg}`)
	fail++
}

console.log('--- 1. Prose* 层的标记与样式两侧都在 ---')
if (!fs.existsSync(SAMPLE)) {
	miss('样例文章没构建出来')
}
else {
	const html = fs.readFileSync(SAMPLE, 'utf8')
	for (const [needle, label] of [
		['<figure class="z-codeblock"', 'ProsePre 包裹层'],
		['class="operations"', 'ProsePre 的复制 / 换行按钮'],
		['class="prose-paragraph"', 'ProseP 段落 class'],
		['class="z-link"', 'ProseA 链接 class'],
	]) {
		if (html.includes(needle))
			ok(label)
		else miss(`${label}  (${needle})`)
	}
	for (const sel of ['.z-codeblock', '.prose-paragraph', '.z-link', '.md-table']) {
		if (css.includes(sel))
			ok(`样式 ${sel}`)
		else miss(`样式 ${sel}`)
	}
	if (/color:\s*var\(--shiki-light\)/.test(css))
		ok('shiki 亮色模式颜色映射')
	else miss('shiki 亮色模式颜色映射（代码块不会高亮）')
}

console.log('--- 2. ProseA 的域名图标确实渲染了 ---')
// 样例页可能一条外链都没有，所以扫全站而不是只看一个文件
let icons = 0
for (const p of walk(DIST)) {
	const h = fs.readFileSync(p, 'utf8').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
	icons += (h.match(/domain-icon/g) || []).length
}
if (icons > 0)
	ok(`全站 ${icons} 处域名图标`)
else miss('全站找不到任何 ProseA 域名图标')

console.log('')
if (fail === 0) {
	console.log('RESULT: PASS - prose layer complete')
	process.exit(0)
}
console.log(`RESULT: FAIL - ${fail} problem(s)`)
process.exit(1)
