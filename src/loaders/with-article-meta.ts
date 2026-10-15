import type { Loader } from 'astro/loaders'
import { fileURLToPath } from 'node:url'
import { createProcessor } from '@mdx-js/mdx'
import readingTimeOf from 'reading-time'
import remarkGFM from 'remark-gfm'
import { deriveModelLabel, readSummaries } from '../lib/shared/summaries'

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
 * 正文里的 MDC 指令已全部转为 JSX 组件（内容里 `:::` 指令为 0），
 * 所以这里用 `@mdx-js/mdx` 建解析器并补 GFM 扩展即可，无需 MDC 扩展。
 */
const mdxProcessor = createProcessor({ jsx: true })
	.use(remarkGFM)
	.freeze()

/**
 * 摘要真相源。每次 load 读一次（构建期，开发时会热更到读新内容）。
 * 键 = 条目 id，与 `content-id.ts` 的 `generateId` 同源。
 */
const SUMMARIES_PATH = fileURLToPath(new URL('../data/summaries.json', import.meta.url))
const summaries = readSummaries(SUMMARIES_PATH)
/**
 * 徽章显示用的短名，**构建期**算好，不进 schema 也不进组件。
 *
 * 模型 ID 是路由标识不是产品名（`moonshotai/kimi-k2-0905-preview` 31 字符），
 * 原样塞进 `0.75rem` 的胶囊里既占地方又读不懂。完整 ID 仍留在 JSON 里
 * （复现调用需要那个字符串），界面只显示这个短名。推导规则见
 * `scripts/lib/summary-core.mjs` 的 deriveModelLabel。
 */
const summaryModelLabel = deriveModelLabel(summaries.$meta.model ?? '', summaries.$meta.modelLabel ?? '')

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
 * frontmatter `---` 围栏切分，与 `src/lib/frontmatter.ts` 的同名函数逐字同口径：
 * 只认文件开头的围栏、要求闭合行前后无其它内容。原先直接用 remark-mdc 导出的
 * `parseFrontMatter`，随该依赖摘除而内联（A/B 实测 63 篇正文 62 篇逐字节一致，
 * 唯一差异是示例页脚注定义的 text 节点归属，对阅读时长影响可忽略）。
 */
function splitFrontMatter(body: string): { raw: string, content: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(body)
	if (!match)
		return { raw: '', content: body }
	return { raw: match[1], content: body.slice(match[0].length) }
}

/** 取文本，一次解析；解析失败时按正则兜底（与 reading-time 同口径兜底） */
function analyzeBody(body: string): { text: string } {
	try {
		const { content } = splitFrontMatter(body)
		const tree = mdxProcessor.parse(content) as MdastNode
		const sink: string[] = []
		collectCountableText(tree, sink)
		return { text: sink.join('') }
	}
	catch {
		return { text: toPlainTextByRegex(body) }
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
 * 补齐两类字段：
 * 1. `readingTime` —— 对应 Nuxt 的 `remark-reading-time` 插件
 * 2. `isPost`     —— 对应 Nuxt 的 `stem LIKE 'posts/%'` 查询条件
 * 3. `summary` / `seo` / `summaryModel` —— 来自 `src/data/summaries.json`
 *
 * 关于摘要：它**不在 frontmatter 里**（真相源唯一，见 summaries.json 顶部语义），
 * 所以与其他派生字段不同，它与正文解析无关、在跳过分支之前就挂上。
 * 仍要过 digest 比对，是为了让「只改了 JSON 没改正文」时产物也能跟着变——
 * 否则增量存储会判定条目未变更，摘要改动永远传不到产物（与本函数末尾
 * 「同步刷新 digest」同源的理由）。
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
				const id = entry.id
				const rec = summaries.entries[id]
				// summary / seo 与正文无关（来自 JSON），但仍要在 continue 之前注入：
				// 跳过分支会跳过整个循环体，摘要只在这里挂一次的话会漏。
				const withSummary: Record<string, unknown> = { ...entry.data }
				if (rec?.summary)
					withSummary.summary = rec.summary
				if (rec?.seo)
					withSummary.seo = rec.seo
				withSummary.summaryModel = summaryModelLabel

				if (entry.data.isPost !== undefined && entry.data.readingTime) {
					// 派生字段齐了，但摘要仍要写盘——JSON 可能变了而正文没变。
					// 用 generateDigest(合并后的 data) 比对，摘要变了就落库，没变就跳过。
					const digest = context.generateDigest(withSummary)
					if (entry.digest !== digest)
						context.store.set({ ...entry, data: withSummary, digest })
					continue
				}

				const isPost = /[\\/]posts[\\/]/.test(entry.filePath ?? '')

				// `.md` / `.mdx` 统一走 mdast：Nuxt 侧数的是 mdast 文本节点，
				// 渲染后的 HTML（含标签实体）反而无法对齐。
				const { text } = entry.body
					? analyzeBody(entry.body)
					: { text: '' }

				const data: Record<string, unknown> = { ...withSummary, isPost }
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
