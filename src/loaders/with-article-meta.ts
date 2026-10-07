import type { Loader } from 'astro/loaders'
import { createProcessor } from '@mdx-js/mdx'
import readingTimeOf from 'reading-time'
import remarkGFM from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkMDC, { parseFrontMatter } from 'remark-mdc'

/**
 * 取文本规则必须逐字对齐 `remark-reading-time@2.1.0`：
 *
 *   node_modules/remark-reading-time/index.js:16-18
 *     visit(info, ["text", "code"], (node) => { text += node.value })
 *   node_modules/remark-reading-time/index.js:20
 *     file.data[attribute] = getReadingTime(text)
 *
 * 即：**只**取 mdast 里 `type` 为 `text` 与 `code` 的节点，把它们的 `value`
 * **无分隔符**直接拼起来，交给 `reading-time`。
 *
 * 由此推出的「计 / 不计」清单：
 * - 计：`text`（段落、标题、强调、链接、引用、列表、表格单元里的文字，
 *   以及 MDC 组件 `children` 里的文字）、`code`（围栏与缩进代码块的**内容**）
 * - 不计：`inlineCode`（另一个节点类型）、`math` / `inlineMath`（`$…$`、`$$…$$`）
 * - 不计：`html` 节点（整块裸 HTML 的 `value` 是原始标签串，**其内部文字不可见**）
 * - 不计：`mdxJsxFlowElement` / `mdxJsxTextElement` 的属性值
 *   （属性落在 `attributes[].value`，是字符串或 ESTree，不是 `text` 节点）
 * - 不计：`mdxjsEsm`（import/export）、`mdxFlowExpression` / `mdxTextExpression`
 *   （`{…}` 表达式，内容是 ESTree）
 *
 * Nuxt 侧的处理器是 `remarkParse → remarkMDC → remarkGFM → remark-math`
 * （见 `@nuxtjs/mdc/dist/runtime/parser/options.js` 与 `nuxt.config.ts:171-180`），
 * 跑在**原始 `.md`** 上。Astro 侧喂进来的是 codemod 产物 `.mdx`，
 * 里面同时存在 MDC 指令与 JSX 组件，所以这里用 `@mdx-js/mdx` 建解析器
 * 并补上 GFM / math / MDC 三个扩展，得到与 Nuxt 同构的 mdast。
 *
 * `remark-math` 不能省：`.mdx` 里的 LaTeX（如 `\frac{\text{…}}`）带花括号，
 * 而 MDX 把 `{` 当表达式起始，不装 math 扩展会让 acorn 解析
 * `\t` / `\u` 转义直接抛错（`previews/example.mdx:240`）。
 */
const mdxProcessor = createProcessor({ jsx: true })
	.use(remarkGFM)
	.use(remarkMath)
	.use(remarkMDC)
	.freeze()

interface MdastNode {
	type?: string
	value?: unknown
	children?: MdastNode[]
}

/** 复刻 `visit(info, ["text", "code"])`：深度优先、按文档顺序拼接 value */
function collectCountableText(node: MdastNode, sink: string[]): void {
	if (node.type === 'text' || node.type === 'code') {
		if (typeof node.value === 'string')
			sink.push(node.value)
		return
	}
	for (const child of node.children ?? []) collectCountableText(child, sink)
}

/**
 * 这份 mdast 有没有公式？判据是 **remark-math 自己产出的节点类型**
 * （`math` = `$$…$$` / `\[…\]` / `\begin{…}`，`inlineMath` = `$…$`），
 * 不是对源文本做正则。
 *
 * ⚠️ 为什么不能用正则（实测踩过）：直接扫原文的 `$` 会命中代码围栏里的
 * shell 变量与正则字符类。63 个 mdx 里朴素正则报 7 个「有公式」，
 * 逐个查下去 6 个全是假阳性——`${CONTAINER_NAME}`、`.%@$!&~\_-` 这类；
 * 真正渲染出 KaTeX 的只有 `previews/example.mdx` 一篇。
 * 而 remark-math 本来就不解析代码块与行内代码，所以它给出的判决与产物一致。
 *
 * 顺带省掉一次解析：`mdxProcessor` 本来就要 parse 一遍给 reading-time 用。
 */
function hasMathNode(node: MdastNode): boolean {
	if (node.type === 'math' || node.type === 'inlineMath')
		return true
	for (const child of node.children ?? []) {
		if (hasMathNode(child))
			return true
	}
	return false
}

/** 取文本 + 判公式，一次解析两用；解析失败时公式一律按「无」处理（与 reading-time 同口径兜底） */
function analyzeBody(body: string): { text: string, hasMath: boolean } {
	try {
		const { content } = parseFrontMatter(body)
		const tree = mdxProcessor.parse(content) as MdastNode
		const sink: string[] = []
		collectCountableText(tree, sink)
		return { text: sink.join(''), hasMath: hasMathNode(tree) }
	}
	catch {
		return { text: toPlainTextByRegex(body), hasMath: false }
	}
}

/**
 * MDX 解析万一失败（未预见的语法组合）时的兜底：宁可偏差也别让构建挂掉。
 * 正常路径不会走到这里。
 */
function toPlainTextByRegex(body: string): string {
	return body
		.replace(/^---\r?\n[\s\S]*?\r?\n---/, ' ')
		.replace(/^\s*(?:```|~~~)[^\n]*$/gm, ' ')
		.replace(/`[^`\n]*`/g, ' ')
		.replace(/^\s*(?:import|export)\s[^\n]*$/gm, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\{[^{}]*\}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * 包装一个 loader，在其 load 之后补齐 Nuxt 侧由插件/钩子注入的派生字段。
 *
 * 背景：Astro 7.3 的 glob loader 没有 transform 钩子，collection 上的 `transform`
 * 会被静默忽略，因此只能在 loader 外层包一层。
 *
 * 补齐两个字段：
 * 1. `readingTime` —— 对应 Nuxt 的 `remark-reading-time` 插件
 * 2. `isPost`     —— 对应 Nuxt 的 `stem LIKE 'posts/%'` 查询条件
 *
 * 关于 `isPost`：条目的 `id` 已被 `generateId` 剥掉 `/posts` 前缀
 * （`hidePostPrefix` 生效），因此**无法从 id 判断是否文章**。
 * 磁盘上的 data store 把 `filePath` 存成去重后的字符串索引编号，
 * 运行时也拿不到可读路径，所以只能在 loader 内部（此处 filePath 仍是真实字符串）计算。
 *
 * 关于 `readingTime`：`text` / `minutes` / `time` / `words` 四个字段都由
 * `reading-time` 从同一个 `words` 推出（`lib/reading-time.js:125-136`），
 * 所以只要喂对的文本，四个字段会同时与线上一致。
 *
 * ⚠️ 这里**不能**做标题 id 归一。MDX 条目在 glob loader 里走的是
 * `deferredRender` 分支：`@astrojs/mdx` 注册的 entry type 带
 * `contentModuleTypes` 且**不提供** `getRenderFunction`，于是
 * `store.set()` 写入的条目里**根本没有 `rendered` 字段**
 * （`astro/dist/content/loaders/glob.js:155-163`），
 * 正文 HTML 是运行时由 MDX 编译出的组件产出的。
 * 实测（构建期 `console.error` 打印）：68 个条目 `entry.rendered` 全是 undefined。
 * 归一的正确位置是 rehype 插件，见 `src/plugins/heading-ids.ts`。
 */
export function withArticleMeta(inner: Loader): Loader {
	const wrapped: Loader = {
		name: `${inner.name}-with-article-meta`,
		load: async (context) => {
			await inner.load(context)

			for (const entry of context.store.values()) {
				if (entry.data.isPost !== undefined && entry.data.readingTime && entry.data.hasMath !== undefined)
					continue

				const isPost = /[\\/]posts[\\/]/.test(entry.filePath ?? '')

				// `.md` / `.mdx` 统一走 mdast：Nuxt 侧数的是 mdast 文本节点，
				// 渲染后的 HTML（含 KaTeX 双份表示、标签实体）反而无法对齐；
				// 同一次解析顺带问出 hasMath（remark-math 的节点判决）
				const { text, hasMath } = entry.body
					? analyzeBody(entry.body)
					: { text: '', hasMath: false }

				const data: Record<string, unknown> = { ...entry.data, isPost, hasMath }
				if (text && !entry.data.readingTime)
					data.readingTime = readingTimeOf(text)

				// 同步刷新 digest，否则增量存储会判定为「未变更」而丢弃本次写入
				context.store.set({ ...entry, data, digest: context.generateDigest(data) })
			}
		},
	}

	// 透传 schema / createSchema，保留 glob 对内容类型的默认处理
	if ('schema' in inner && inner.schema)
		Object.assign(wrapped, { schema: inner.schema })
	if ('createSchema' in inner && inner.createSchema)
		Object.assign(wrapped, { createSchema: inner.createSchema })

	return wrapped
}
