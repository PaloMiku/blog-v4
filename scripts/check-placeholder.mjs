/**
 * 门禁：产物里不得残留**未解析的占位符**。
 *
 * ═══ 抓的是什么 ═══
 *
 * `src/config/blog.ts` 的 `scripts[]` 曾有一个 Cloudflare beacon 条目带着
 * `b5c89be9025a4b1ba8750f8fd8850904` ——那是**旧栈的运行时替换语法**：Nuxt/部署平台会把它
 * 在服务端渲染时替换成真值；Astro 纯构建链里没有对应环节，这个字面量被
 * 原样写进每一页的 head，Cloudflare Web Analytics 静默失效（脚本带着非法
 * token 上线，没有任何报错）。
 *
 * 这个教训与坑位 14 同型：「把字符串当配置吐出去」= 静默失效。判据必须是
 * 「未解析即失败」，而不是「渲染没报错」。
 *
 * ═══ 判据 ═══
 *
 * 扫 `dist` 全部 HTML 的 `<script>` 标签——**开标签整体**（含其属性）与
 * **内联脚本正文**——查 `{{SECRET_` 字面量。命中即红。
 *
 * 为什么限定 `<script>`：正文教程（`src/content/**`）里的 `{{SECRET_x}}`
 * 是 1Panel 模板语法的合法内容（坑位 28 的教训：判据必须剥掉正文再数落点，
 * 认标签不认裸字符串）。第三方脚本注入只发生在 head 的 `<script>` 上，
 * 源码侧的配置泄漏必然途经 head 脚本；`<script src>` 的属性、内联脚本的
 * 正文都在扫描范围里。
 *
 * ═══ 范围 ═══
 *
 * 递归 `dist` 下所有 `.html`（`/2025/12/x` 落在 `dist/2025/12/x/index.html`，
 * 只 glob `dist/*.html` 会漏掉绝大多数页面——§67.3 的教训）。
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { DIST } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const NEEDLE = '{{SECRET_'

let files = []
try {
	files = walkFiles(DIST, { ext: '.html' })
}
catch {
	files = []
}
if (!files.length) {
	console.error('FAIL  dist 下没有 .html，先跑 pnpm build')
	process.exit(1)
}

const problems = []
for (const f of files) {
	const html = readFileSync(f, 'utf8')
	const hits = []

	// 1) 每个 `<script ...>` 开标签整体（含属性值）：
	//    `src="…"` / `data-cf-beacon='…'` 等属性里的占位符在这里被抓。
	const tagRX = /<script\b[^>]*>/gi
	for (const m of html.matchAll(tagRX))
		hits.push(m[0])

	// 2) 内联脚本正文：`<script …>…</script>` 中间的部分。
	//    正文里的命中往往与开标签命中不同处（配置泄漏也可能发生在内联常量里）。
	const bodyRX = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
	for (const m of html.matchAll(bodyRX)) {
		const body = m[1]
		let idx = body.indexOf(NEEDLE)
		while (idx >= 0) {
			hits.push(body.slice(idx, idx + 24))
			idx = body.indexOf(NEEDLE, idx + 1)
		}
	}

	const shown = new Set(hits.filter(h => h.includes(NEEDLE)))
	if (shown.size)
		problems.push([f, shown])
}

if (!problems.length) {
	console.log(`OK: ${files.length} 个 HTML 的 <script> 标签（含属性与内联正文）中没有未解析占位符 {{SECRET_`)
	process.exit(0)
}

let total = 0
for (const [f, shown] of problems) {
	total += shown.size
	for (const h of shown)
		console.error(`FAIL  ${f}  …${h}…`)
}
console.error(`\nFAIL: ${problems.length}/${files.length} 个 HTML 的 <script> 上下文共 ${total} 处未解析的 {{SECRET_ 占位符——`)
console.error('      这是旧栈运行时替换语法，Astro 构建链不会解析它，正原样发给读者。')
process.exit(1)
