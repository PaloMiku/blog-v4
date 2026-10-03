import { unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import vue from '@astrojs/vue'
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
import { rehypeNuxtHeadingIds } from './src/plugins/heading-ids'
import { rehypeMathCode } from './src/plugins/math-code'
import { rehypeProseChrome } from './src/plugins/prose'
import { remarkComponentSource } from './src/plugins/component-source'

// Phase 1 spike 结论（Astro 7.3.5 默认 Sätteri 管线）：
//   GFM / 任务列表 / 表格 / 删除线 / heading ID / Shiki —— 全部正常
//   数学公式 —— 不渲染，且 `\\` 换行会被 Markdown 强调解析破坏
// 因此显式切回 @astrojs/markdown-remark 的 unified 管线。
//
// 三个易踩的点：
// 1. Astro 7 已弃用 markdown.remarkPlugins / markdown.rehypePlugins，
//    正确写法是包进 processor: unified({ ... })。
// 2. MDX 集成在 extendMarkdownConfig 为 false（默认）时会退回干净的 `satteri()`
//    处理器，**不会继承** markdown.processor，必须把同一个处理器显式传给 mdx()。
// 3. 插件必须以**显式 import 的函数**传入，不能用字符串——字符串形式在 MDX 处理器里
//    不会被解析，构建时只报 `remark-math not applied` 警告然后静默跳过。
// 4. `unified()` 返回的处理器实例不可被两个消费者共用——`markdown.processor` 与
//    `mdx({ processor })` 复用同一实例会导致 .md 侧静默丢失插件。因此建两个独立实例。
// 6. rehypeMathCode 必须排在最前。remark-math 6 不做 `math` -> markup 转换，行间公式
//    落到 mdast-util-math 的兜底形状 `<pre><code class="language-math math-display">`，
//    rehypeKatex 认识它但要求 code 仍挂在 pre 内；而 rehypeProseChrome 补
//    `figure.z-codeblock` 外壳时会 `pre.children = code.children` 把这个 code 丢掉，
//    于是行间公式退化成裸 TeX 代码块。先摘掉 pre 外壳，两边就都满意了。
//    详见 src/plugins/math-code.ts 与 docs/astro-phase1-findings.md。
// 7. rehypeProseChrome 必须排在 rehypeKatex 之前：它会把 `a` 换掉，
//    KaTeX 输出里的链接不应该再套一层 z-link 与域名图标。
// 8. rehypeNuxtHeadingIds 排最前：`rehypeHeadingIds` 排在**所有**用户插件之后，
//    但它尊重已存在的 string id，所以「前置写好 id」是唯一可行解。
//    详见 src/plugins/heading-ids.ts 的文件头（含为什么不能放 loader 层）。
// 9. smartypants: false —— `remark-smartypants` 默认开着（Astro 侧判断的是
//    `smartypants !== false`），它把 `"…"` 写成 `“…”`、`...` 写成 `…`。
//    Nuxt 侧没开，于是同一段文字两站**字面**不同，而页高与计算样式两道门禁
//    都看不见：换的是标点字符，不是盒子。
//    实测 20 页受影响，最极端的 `/games/galgames/clannad`：`”` 111 个 vs 2 个、
//    `…` 24 个 vs 2 个。例：`安装"飞牛播放器"登录 NAS` 线上是 `&quot;…&quot;`，
//    本地被改成 `”…”`。
// 10. remarkComponentSource 排在最前：它把 ```` ```astro [X.astro] source=… ````
//     这种空围栏的正文换成磁盘上的组件源码。换在 remark 阶段意味着下游**什么都没变**——
//     还是 Astro 自己的 shiki → transformerLineNumbers 的 data-line → rehypeProseChrome
//     的 figure.z-codeblock → prose-enhance 的换行/复制/折叠按钮，
//     所以展示出来的源码与页面上任何人工围栏外观逐字一致，也不会像快照那样腐烂。
//     详见 src/plugins/component-source.ts 的文件头。
function createProcessor() {
	return unified({
		remarkPlugins: [remarkComponentSource, remarkMath],
		rehypePlugins: [rehypeNuxtHeadingIds, rehypeMathCode, rehypeProseChrome, [rehypeKatex, { throwOnError: false, strict: false }]],
		smartypants: false,
	})
}

/**
 * 行号列的数据源：对应 Nuxt 侧 app/composables/useShiki.ts:38-52 的
 * `transformerUnwrap` —— 它除了拆 `<pre><code>` 外，还在 `line` 钩子里写
 * `data-line`。Astro 侧不用拆壳（rehypeProseChrome 已经拆了），但
 * `prose.css` 的 `.line::before` 靠 `attr(data-line)` 取值，
 * 没有它行号列就只剩一块 `--start-offset` 宽的空白。
 *
 * ⚠️ 只挂 `line` 钩子、不重建子树：顶部记的「Cannot read properties of
 * undefined (reading 'type')」是 transformerRenderIndentGuides 那类
 * transformer 踩的（它们要求树里有 `<pre><code>`），纯属性写入不受
 * Astro 与 Nuxt 的 shiki 输出形状差异影响。同一通道已被实测验证：
 * notationDiff 产出的 `.line.diff` 能进最终产物。
 *
 * 放最后是为了和 Nuxt 的 getTransformers() 顺序一致；实际上 notation 五个
 * 只加类名、`--line-indicator` 是纯 CSS 声明，两者互不干扰，先后无所谓的。
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
		vue(),
		mdx({ processor: createProcessor() }),
		sitemap({
			// 基线的 robots.txt 明确 Disallow /preview 与 /previews/*，
			// 而 @astrojs/sitemap 默认把所有静态资源也收进来。
			// 实测未过滤时比基线多 4 条：/favicon.ico、/preview、
			// /previews/bangumi-components、/previews/example——其中后三条
			// 正是站点刻意不收录的演示页。这里补回与 robots.txt 一致的口径。
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
		// 对应 Nuxt 侧 app/shiki.config.ts 的 catppuccin-latte + one-dark-pro。
		// defaultColor: false 表示两套主题都输出为变量，不指定默认色。
		shikiConfig: {
			themes: {
				light: 'catppuccin-latte',
				dark: 'one-dark-pro',
			},
			defaultColor: false,
			// 对齐 Nuxt 侧 app/composables/useShiki.ts 的 getTransformers()。
			// 此前 Astro 一个 transformer 都没挂，导致 main.css 里
			// `.shiki > .line .indent` / `.space::before` / `.tab::before`
			// 这几组规则全部是死的。
			//
			// ⚠️ notation 五个 + 自写的 transformerLineNumbers（行号）。
			// `transformerRenderIndentGuides()` 与
			// `transformerRenderWhitespace()` 摘掉后 BUILD OK 一加上就炸在
			// 「Cannot read properties of undefined (reading 'type')」——
			// 它们要求 Astro 的 shiki 传下去的树形状里有 `<pre><code>`，
			// 而 Astro 直接输出 `<pre class="astro-code">`，transformer 产出的
			// 节点里出现 undefined，MDX 的 hast→JSX 阶段就崩。
			// 二者是纯装饰（缩进参考线、空白/制表符可见化），暂不移植；
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
