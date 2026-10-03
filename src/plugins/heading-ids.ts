/**
 * rehype 插件：把标题锚点 id 写成与 Nuxt Content **逐字一致**的写法。
 *
 * ═══ 差异 ═══
 *
 * 线上（`@nuxtjs/mdc`）在 `compileHast` 里给每个标题写 id，
 * 规则是 **github-slugger + 三个后处理**
 * （`@nuxtjs/mdc/dist/runtime/parser/compiler.js`）：
 *
 * ```js
 * node.properties.id = String(node.properties?.id || slugs.slug(toString(node)))
 *   .replace(/-+/g, "-")      // 折叠连续短横
 *   .replace(/^-|-$/g, "")    // 去首尾短横
 *   .replace(/^(\d)/, "_$1")  // 首位数字补 _
 * ```
 *
 * Astro 侧只有 `rehypeHeadingIds`，也就是**光秃秃的 github-slugger**，
 * 三个后处理一个都没有。同一段标题文字在两站得到不同的 id：
 *
 * | 标题文字 | 线上 id | 修之前的 Astro id | 触发的后处理 |
 * |---|---|---|---|
 * | `123 网盘会员直链` | `_123-网盘会员直链` | `123-网盘会员直链` | 首位数字补 `_` |
 * | `Distrobox & DistroShelf（可选）` | `distrobox-distroshelf可选` | `distrobox--distroshelf可选` | 折叠连续短横 |
 * | `今天是他们的生日（ 今天是他们的生日 ）` | `今天是他们的生日-今天是他们的生日` | `…-今天是他们的生日-` | 去尾短横 |
 *
 * **为什么这不是「id 长得不一样」的小事**：目录链接与标题自链接都指向 id。
 * 线上分享出去的 `…/2025/12/oss-prepare-list#_123-网盘会员直链`
 * 在 Astro 上点不动，反之亦然。而**页高与计算样式两道门禁都看不见它**——
 * 一个 `<a href="#…">` 指向不存在的 id，盒子尺寸一点不变。
 * 是语义签名探针（`live:ui-parity`）把它抓出来的。
 *
 * ═══ 为什么必须排在 `rehypeHeadingIds` **之前** ═══
 *
 * `@astrojs/markdown-remark` 的管线顺序（`dist/index.js`）：
 *
 * ```js
 * parser.use(remarkRehype, …)
 * parser.use(rehypeShiki | rehypePrism, …)
 * for (const [plugin, opts] of loadedRehypePlugins) parser.use(plugin, opts)  // ← 我们在这
 * parser.use(rehypeImages)
 * parser.use(rehypeHeadingIds)   // ← 它在最后
 * parser.use(rehypeRaw).use(rehypeStringify, …)
 * ```
 *
 * `rehypeHeadingIds` 是**最后**一个写 id 的，所以「在它之后改」这条路不存在。
 * 但它有一行关键实现（`dist/rehype-collect-headings.js`）：
 *
 * ```js
 * node.properties = node.properties || {};
 * if (typeof node.properties.id !== "string") {     // ← 已有 string id 就不动
 *   node.properties.id = slugger.slug(text);
 * }
 * headings.push({ depth, slug: node.properties.id, text });   // ← 元数据取的就是这个 id
 * ```
 *
 * 即**它尊重已经存在的 id**。所以本插件只要在它之前把 id 写好：
 * - 正文 DOM 的 `id` 是我们的（Nuxt 写法）
 * - `file.data.astro.headings[].slug` 也是我们的（同一个字段）
 * - `Toc.astro` 消费的就是这份元数据 ⇒ 目录链接自动跟着对
 *
 * 一处改完，**两条独立数据通路（DOM id 与 headings 元数据）同时对齐**。
 *
 * ═══ 为什么文本提取要照抄 `rehypeHeadingIds` ═══
 *
 * slug 是从**标题文字**算出来的，所以本插件必须用和 `rehypeHeadingIds`
 * **完全一样**的规则取那段文字，否则同一个标题两边算出不同 slug。
 * `rehypeHeadingIds` 的取法不是「所有子节点文本拼起来」，它有四处分支：
 *  1. 跳过 `element` 子节点（标题里的 `code` / `em` / `a` 只取它们的**后代**文本）
 *  2. `raw` 节点若形如 `\n?<…>\n$` 则整体跳过
 *  3. 非 MDX 文件里，`{` 要先替换成 `${`（防 MDX 表达式语义泄漏）
 *  4. MDX 文本表达式 `{frontmatter.x}` 要回查 frontmatter 取真值
 *
 * 抄的代价是本文件有一坨看似多余的 estree 解析；不抄的代价是
 * 「我简化了实现」在某篇带表达式的标题上静默产生不同 slug——
 * 那种缺陷**没有任何门禁看得见**，而这正是本项目反复吃过的亏
 * （见 CLAUDE.md 坑位 11：把 Vue 的组件边界换成 CSS 里的近似表达）。
 * 所以照抄，并在下面逐条标出对应关系。
 */
import GithubSlugger from 'github-slugger'
import { visit } from 'unist-util-visit'
import { nuxtHeadingId } from '../lib/slug'

interface HastNode {
	type?: string
	tagName?: string
	value?: unknown
	properties?: Record<string, unknown>
	children?: HastNode[]
	data?: { estree?: any }
}

interface VFileLike {
	history?: string[]
	data?: { astro?: { frontmatter?: Record<string, any> } }
}

/** 与 `rehype-collect-headings.js` 的 `rawNodeTypes` 一致 */
const RAW_NODE_TYPES = new Set(['text', 'raw', 'mdxTextExpression'])
/** 与 `rehype-collect-headings.js` 的 `codeTagNames` 一致 */
const CODE_TAG_NAMES = new Set(['code', 'pre'])

/**
 * 与 `@astrojs/internal-helpers` 的 `FORBIDDEN_PATH_KEYS` 一致。
 * 照抄这 3 个字符串而不是 import：`@astrojs/internal-helpers` 是
 * `@astrojs/markdown-remark` 的**传递依赖**，不在本项目 package.json 里，
 * import 它的内部路径在 pnpm 严格 node_modules 下会直接解析失败。
 */
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isMdxTextExpression(node: HastNode): boolean {
	return node.type === 'mdxTextExpression'
}

/** 取 `{frontmatter.a.b}` 这种表达式里的路径；形状不符返回 Error（与上游同） */
function getMdxFrontmatterVariablePath(node: HastNode): string[] | Error {
	const estree = node.data?.estree
	if (!estree || estree.body?.length !== 1)
		return new Error('mdxTextExpression 的 estree 形状不符，取不到 frontmatter 路径')
	const statement = estree.body[0]
	if (statement?.type !== 'ExpressionStatement' || statement.expression?.type !== 'MemberExpression')
		return new Error('mdxTextExpression 的 estree 形状不符，取不到 frontmatter 路径')
	let expression = statement.expression
	const path: string[] = []
	while (
		expression.type === 'MemberExpression'
		&& expression.property?.type === (expression.computed ? 'Literal' : 'Identifier')
	) {
		path.push(expression.computed ? String(expression.property.value) : expression.property.name)
		expression = expression.object
	}
	if (expression?.type !== 'Identifier' || expression.name !== 'frontmatter')
		return new Error('mdxTextExpression 的 estree 形状不符，取不到 frontmatter 路径')
	return path.reverse()
}

/** 照抄上游：带原型链防护地回查 frontmatter */
function getMdxFrontmatterVariableValue(frontmatter: Record<string, any>, path: string[]): unknown {
	let value = frontmatter
	for (const key of path) {
		if (FORBIDDEN_PATH_KEYS.has(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key))
			return undefined
		value = value[key]
	}
	return value
}

function isMdxFile(file: VFileLike): boolean {
	return Boolean(file.history?.[0]?.endsWith('.mdx'))
}

/**
 * 从标题节点里取出用于算 slug 的那段文字。
 *
 * 与 `rehype-collect-headings.js` 的内层 `visit` 逐行对应，注释标了每一处。
 */
function headingText(node: HastNode, file: VFileLike, isMDX: boolean, frontmatter: Record<string, any> | undefined): string {
	let text = ''
	// `index` 标注成 `number | undefined`：unist-util-visit 的 BuildVisitor
	// 就是这么声明的（visitor 可能被当成退出函数复用），写成 `number` 会报 TS2345。
	// 该参数本身不用，纯类型层面的事。
	visit(node as any, (child: any, _index: number | undefined, parent: any) => {
		// ① 跳过 element 子节点：标题里的 code/em/a 只取后代文本，不取标签自身
		if (child.type === 'element' || parent == null)
			return
		// ② 形如 `\n?<…>\n$` 的 raw 是 MDX 里的裸 JSX 包裹，整体跳过
		if (child.type === 'raw') {
			if (/^\n?<.*>\n?$/.test(child.value))
				return
		}
		if (RAW_NODE_TYPES.has(child.type) && 'value' in child) {
			if (isMDX || ('tagName' in parent && CODE_TAG_NAMES.has(parent.tagName))) {
				let value = child.value
				// ④ MDX 文本表达式 `{frontmatter.x}`：回查 frontmatter 取真值
				if (isMdxTextExpression(child) && frontmatter) {
					const frontmatterPath = getMdxFrontmatterVariablePath(child)
					if (Array.isArray(frontmatterPath) && frontmatterPath.length > 0) {
						const frontmatterValue = getMdxFrontmatterVariableValue(frontmatter, frontmatterPath)
						if (typeof frontmatterValue === 'string')
							value = frontmatterValue
					}
				}
				text += value
			}
			else {
				// ③ 非 MDX：`{` 先换成 `${`，避免被当成 MDX 表达式
				text += String(child.value).replace(/\{/g, '${')
			}
		}
	})
	return text
}

/**
 * 把标题 id 归一成 Nuxt Content 的写法。
 *
 * 挂在 `createProcessor()` 的 `rehypePlugins` **最前面**：既然
 * `rehypeHeadingIds` 在所有用户插件之后，那这批插件里谁先谁后就决定了
 * 「谁看到最终的 id」。放最前，后面每个插件（包括 `rehypeProseChrome`、
 * `rehypeKatex`）拿到的都是成品 id。
 */
export function rehypeNuxtHeadingIds() {
	return function transform(tree: HastNode, file: VFileLike) {
		const slugger = new GithubSlugger()
		const isMDX = isMdxFile(file)
		const frontmatter = file.data?.astro?.frontmatter

		visit(tree as any, (node: any) => {
			if (node.type !== 'element')
				return
			const { tagName } = node
			if (tagName?.[0] !== 'h')
				return
			const [, level] = /h([0-6])/.exec(tagName) ?? []
			if (!level)
				return

			const text = headingText(node, file, isMDX, frontmatter)
			node.properties = node.properties || {}
			// 与 `rehypeHeadingIds` 同一套判定：源文里写死的 `{#custom}` 优先。
			// ⚠️ 这里**必须**保持一致——若改判「一律覆盖」，源文自定义 id 会被吞掉；
			// 若无条件调 slugger.slug()，重复标题的去重计数会和上游错位。
			if (typeof node.properties.id !== 'string')
				node.properties.id = nuxtHeadingId(slugger.slug(text))
		})
	}
}
