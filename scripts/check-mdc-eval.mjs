/**
 * 门禁：产物里不得残留**未被求值的 MDC 组件标签**。
 *
 * ═══ 抓的是什么 ═══
 *
 * 内容层的 MDC 组件（`::link-card{…}` 之类）在 Nuxt 侧由 `ContentRenderer`
 * 求值成真实组件；Astro 侧的 codemod 产出的是 frontmatter 里的
 * **字符串片段**，如果哪条通路把它当 HTML 原样吐出，
 * 片段里的 `<LinkCard … />` 就变成浏览器**不认识的未知元素**。
 *
 * 实测（§79.10）：`BlogWidget.astro` 的 `set:html={meta.content}`
 * 让 `/previews/example` 的第三个侧栏 widget **整个空白**——
 * 线上有 `a.link-card[href$="/docs/files/markdown"]`，
 * 本地是原样输出的 `<linkcard title="…" …></linkcard>`。
 * 语义探针为此报出的 `a|/docs/files/markdown|` 与 `img|/favicon.ico|`
 * 两条差异**同源于此**。
 *
 * **页高看不见它**（空白也是合法盒子），**计算样式看不见它**（压根没有元素），
 * 语义签名探针只报「数量差 1」，不指出根因。
 *
 * ═══ 判据 ═══
 *
 * 扫 `dist` 全部 HTML，找形如 `<名字` 的**未知**元素，其中「名字」取
 * `src/lib/content-components.ts` 里每个已注册组件的
 * PascalCase / kebab-case / 全小写三种写法。
 *
 * 这些名字与 HTML 原生标签**无一重名**（`time` `data` `output` `summary`
 * 之类都不在注册表里），所以「出现即未求值」是严格成立的。
 * 也正因如此，这条门禁是**零歧义**的：不需要判断「像不像原生标签」，
 * 只判断「在不在注册表里」。
 *
 * 为什么大小写三种都要查：frontmatter 里是 PascalCase 的 `<LinkCard />`，
 * 而经 `set:html` 落到产物里时实测是小写的 `<linkcard>`——
 * 中间有一层把标签名压小写。只查一种写法会漏。
 *
 * ═══ 扫描范围 ═══
 *
 * 递归 `dist` 下所有 `.html`。**不在根目录**：`/2025/12/x` 落在
 * `dist/2025/12/x/index.html`，只 glob `dist/*.html` 会漏掉绝大多数页面
 * （§67.3 同一个教训）。
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { DIST, REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const REGISTRY = join(REPO_ROOT, 'src', 'lib', 'content-components.ts')

/**
 * 从注册表源文件里读出组件名。
 *
 * 刻意**不 import** 那个 `.astro` 表：它会连带 import 30 个组件，
 * 在纯 node 门禁里拉起整条渲染链。注册表是纯配置文件，正则取名足够，
 * 且取不到时会响亮报错（见下）。
 */
function registeredNames() {
	const src = readFileSync(REGISTRY, 'utf8')
	const start = src.indexOf('export const contentComponents')
	if (start < 0)
		throw new Error(`读不到 contentComponents 的定义，路径 ${REGISTRY}`)
	const open = src.indexOf('{', start)
	const close = src.indexOf('}', open)
	const names = [...src.slice(open + 1, close).matchAll(/^\t([A-Z]\w*)\s*,?/gm)].map(m => m[1])
	if (names.length < 20)
		throw new Error(`从注册表只解析出 ${names.length} 个组件名（预期 20+），正则可能已失效`)
	return names
}

/** PascalCase → kebab-case */
function kebab(name) {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

const names = registeredNames()
/** 三种写法合到一个 alternation，整体不区分大小写 */
const variants = new Set()
for (const n of names) {
	variants.add(n)
	variants.add(kebab(n))
	variants.add(kebab(n).replace(/-/g, ''))
}
const RX = new RegExp(`<(${[...variants].map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=[\\s/>])`, 'gi')

// 原 walk 在目录读不到时返回空数组（isDir 吞异常），这里保留该语义：
// 判据下一句就是 `if (!files.length) → FAIL + exit 1`，所以「读不到」与「没有 html」
// 都会红，不会静默通过——判红由判据决定，不由遍历器决定。
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
	const bad = new Map()
	for (const m of html.matchAll(RX)) {
		const at = m.index ?? 0
		// 只收**开标签**：闭合标签 `</LinkCard>` 同样说明有未求值的标签，但要报的是开标签那一处
		const key = m[1].toLowerCase()
		bad.set(key, (bad.get(key) || 0) + 1)
		if (bad.size === 1)
			void at
	}
	if (bad.size)
		problems.push([relative(DIST, f).replace(/\\/g, '/'), bad])
}

if (!problems.length) {
	console.log(`OK: 产物里没有未求值的 MDC 组件标签（注册表 ${names.length} 个组件 × 3 种写法 = ${variants.size} 个匹配式）`)
	process.exit(0)
}

for (const [rel, bad] of problems) {
	console.error(`FAIL  ${rel}`)
	for (const [tag, n] of bad) console.error(`        <${tag}> ×${n} —— 这是 MDC 组件标签，说明它被当 HTML 原样吐出了，没有求值`)
}
console.error(`\nFAIL: ${problems.length}/${files.length} 个 HTML 里有未求值的 MDC 组件标签`)
process.exit(1)
