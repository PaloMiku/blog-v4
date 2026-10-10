import { unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import {
	transformerNotationDiff,
	transformerNotationErrorLevel,
	transformerNotationFocus,
	transformerNotationHighlight,
	transformerNotationWordHighlight,
} from '@shikijs/transformers'
import icon from 'astro-icon'
import { defineConfig } from 'astro/config'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { remarkComponentFence } from './src/plugins/component-fence'
import { rehypeNuxtHeadingIds } from './src/plugins/heading-ids'
import { rehypeMathCode } from './src/plugins/math-code'
import { rehypeProseChrome } from './src/plugins/prose'
import { remarkTabPanels } from './src/plugins/tab-panels'

// 管线结构约束（改管线前逐条复核）：markdown.processor 与 mdx() 各自持有一个
// 显式构建的 unified 处理器，插件顺序即产物行为，以下几条全部仍然成立：
// 1. Astro 7 已弃用 markdown.remarkPlugins / markdown.rehypePlugins，
//    正确写法是包进 processor: unified({ ... })。
// 2. MDX 集成在 extendMarkdownConfig 为 false（默认）时会退回干净的 `satteri()`
//    处理器，**不会继承** markdown.processor，必须把同一套插件显式传给 mdx()。
// 3. 插件必须以**显式 import 的函数**传入，不能用字符串——字符串形式在 MDX 处理器里
//    不会被解析，构建时只报 `xx not applied` 警告然后静默跳过。
// 4. `unified()` 返回的处理器实例不可被两个消费者共用——`markdown.processor` 与
//    `mdx({ processor })` 复用同一实例会导致 .md 侧静默丢失插件。因此建两个独立实例。
// 5. rehypeMathCode 必须排在最前。remark-math 6 不做 `math` -> markup 转换，行间公式
//    落到 mdast-util-math 的兜底形状 `<pre><code class="language-math math-display">`，
//    rehypeKatex 认识它但要求 code 仍挂在 pre 内；而 rehypeProseChrome 补
//    `figure.z-codeblock` 外壳时会 `pre.children = code.children` 把这个 code 丢掉，
//    于是行间公式退化成裸 TeX 代码块。先摘掉 pre 外壳，两边就都满意了。
//    详见 src/plugins/math-code.ts。
// 6. rehypeProseChrome 必须排在 rehypeKatex 之前：它会把 `a` 换掉，
//    KaTeX 输出里的链接不应该再套一层 z-link 与域名图标。
// 7. rehypeNuxtHeadingIds 排最前：Astro 内建的 heading id 排在**所有**用户插件之后，
//    但它尊重已存在的 string id，所以「前置写好 id」是唯一可行解。
//    **标题锚点 id 规则是线上 URL 合同，勿改**；背景见
//    docs/plan/analysis/engineering-inventory.md §4。另见 src/plugins/heading-ids.ts。
// 8. smartypants: false —— `remark-smartypants` 默认开着（Astro 侧判断的是
//    `smartypants !== false`），它把 `"…"` 写成 `“…”`、`...` 写成 `…`。
//    换的是标点**字形**不是盒子，页高与计算样式类门禁全部看不见；而正文的字面
//    形态是内容合同（`check-text-literal` 盯这一类，另见 CLAUDE.md 坑位 13）。
// 9. remarkComponentFence 排在最前：它把 ```` ```Component [X.astro] ```` 围栏
//     展开成 <Tab> 的两个页签（现场效果 = 正文按 MDX 真实渲染、组件语法 = 正文原文）。
//     排在最前是为了让下游 remark 插件看到的是
//     展开后的树；下游还有 rehypeProseChrome 负责给派生围栏套上
//     figure.z-codeblock 外壳、走与页面上任何人工围栏完全相同的那条路。
//     详见 src/plugins/component-fence.ts 的文件头。
function createProcessor() {
	return unified({
		remarkPlugins: [remarkComponentFence, remarkTabPanels, remarkMath],
		rehypePlugins: [rehypeNuxtHeadingIds, rehypeMathCode, rehypeProseChrome, [rehypeKatex, { throwOnError: false, strict: false }]],
		smartypants: false,
	})
}

/**
 * 行号列的数据源：`prose.css` 的 `.line::before` 靠 `attr(data-line)` 取值，
 * 所以每个 `line` 节点必须在构建期挂上 `data-line`，没有它行号列就只剩一块
 * `--start-offset` 宽的空白。
 *
 * ⚠️ 只挂 `line` 钩子、不重建子树：要求树里有 `<pre><code>` 的 transformer
 * （transformerRenderIndentGuides 那类）在 Astro 的输出形状上会崩（见下方
 * transformers 的注释），纯属性写入不受影响。
 */
function transformerLineNumbers() {
	return {
		line(node, line) {
			node.properties['data-line'] = line
		},
	}
}

export default defineConfig({
	site: 'https://blog.sotkg.com',
	integrations: [
		mdx({ processor: createProcessor() }),
		sitemap({
			// robots.txt 明确 Disallow /preview 与 /previews/*，而 @astrojs/sitemap
			// 默认把所有静态资源也收进来。filter 必须与 robots.txt 口径一致，
			// 否则演示页 / favicon 会进 sitemap。
			//
			// ⚠️ 两个坑都踩过：
			//   - 不能用 endsWith('/favicon.ico')：sitemap 里的 URL 带尾斜杠，永远失配；
			//   - 不能只写 `^\/preview(\/|$)`：那是 `/preview`，而 robots.txt 禁的是
			//     `/previews/*`（复数）。少一个 s 就会把两个演示页放进 sitemap。
			filter: (page) => {
				const { pathname } = new URL(page)
				return !/^\/previews?(?:\/|$)/.test(pathname) && !/^\/favicon\.ico(?:\/|$)/.test(pathname)
			},
		}),
		// 图标：构建期渲染内联 SVG，零客户端 JS。
		// 未显式配 `include` 时，astro-icon 会把 package.json 里所有
		// `@iconify-json/*` 依赖整包收进来（含 local 集合 = src/icons/*.svg）。
		icon(),
	],
	markdown: {
		processor: createProcessor(),
		// main.css 的 `.shiki` 规则依赖 Shiki 以 CSS 变量形式输出双主题色
		// （--shiki-light-* / --shiki-dark-*），由 `.dark &` 切换。
		// defaultColor: false 表示两套主题都输出为变量，不指定默认色。
		shikiConfig: {
			themes: {
				light: 'catppuccin-latte',
				dark: 'one-dark-pro',
			},
			defaultColor: false,
			// notation 五个 + 自写的 transformerLineNumbers（行号）：它们产出
			// main.css `.shiki` 系列规则依赖的类与属性，摘掉任何一个都会让对应
			// 规则变成死规则。
			//
			// ⚠️ 不要挂 `transformerRenderIndentGuides()` / `transformerRenderWhitespace()`：
			// 它们要求 Astro 的 shiki 传下去的树形状里有 `<pre><code>`，而 Astro 直接输出
			// `<pre class="astro-code">`，transformer 产出的节点里出现 undefined，
			// MDX 的 hast→JSX 阶段就崩（「Cannot read properties of undefined
			// (reading 'type')」）。二者是纯装饰（缩进参考线、空白/制表符可见化）；
			// 语义性的 diff / highlight / word / focus / error 级别已补齐。
			// transformerLineNumbers 不重建子树，所以不受这条限制。
			transformers: [
				transformerNotationDiff(),
				transformerNotationHighlight(),
				transformerNotationWordHighlight(),
				transformerNotationFocus(),
				transformerNotationErrorLevel(),
				transformerLineNumbers(),
			],
		},
	},
})
