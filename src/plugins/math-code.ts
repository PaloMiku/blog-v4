/**
 * `$$` 行间公式的补救插件（必须排在 `rehypeProseChrome` **之前**）。
 *
 * ═══ 为什么需要它 ═══
 *
 * remark-math 6 只注册 micromark / fromMarkdown / toMarkdown 扩展，自己不做
 * `math` → markup 的转换（那是 v5 的行为）。所以行间公式走的是
 * `mdast-util-math` 给出的兜底 hast 形状：
 *
 *   <pre><code class="language-math math-display">…TeX…</code></pre>
 *
 * `rehypeKatex` 本来认识这个形状（`code.language-math` 且父节点是 `pre` → 按
 * `math-display` class 决定 displayMode），但前提是 `code` 还挂在 `pre` 里面。
 * 而 `rehypeProseChrome` 排在 `rehypeKatex` 之前，它给 `pre` 补
 * `<figure class="z-codeblock">` 外壳时会执行 `pre.children = code.children`
 * —— 等于把这个带数学类的 `code` 整个丢弃。`rehypeKatex` 随后再也认不出它，
 * 行间公式就退化成一段裸 TeX 代码块（Nuxt 基线 `katex-display` 2 个，迁移后 0 个）。
 *
 * 行内公式不受影响：它是不带 `pre` 的独立 `code`，`rehypeProseChrome` 根本不碰，
 * 所以迁移后行内 `$…$` 一直是好的 —— 这正是「行内正常、行间不渲染」的分界线。
 *
 * ═══ 做法 ═══
 *
 * 把这类 `pre` 外壳摘掉，只留下 `code`，让紧随其后的 `rehypeKatex` 按 class 里的
 * `math-display` 决定行内 / 行间。这样不用改 `rehypeProseChrome` 的插件顺序，
 * prose 那侧的 `a` → `z-link` 处理顺序也原样保留。
 *
 * 连 ```math 围栏一起处理：它同样长成 `pre > code.language-math`，同样会被
 * prose 拆散。摘掉 `pre` 后 `rehypeKatex` 按行内模式渲染，产物是**不带**
 * `.katex-display` 外壳的裸 `.katex` —— 与 Nuxt 基线一致，`main.css` 里
 * `article > .katex { display: block }`（注释已写明是给 ```math 用的）照旧生效。
 *
 * 探针实测（真实 `createMdxRenderer` 跑 example.mdx，Nuxt 基线 7 个公式 /
 * 2 个 katex-display）：摘壳后 7 个公式 / 2 个 katex-display，逐项对齐。
 */

interface HastNode {
	type?: string
	tagName?: string
	properties?: Record<string, unknown>
	children?: HastNode[]
}

/**
 * remark-math 的兜底形状 `<pre><code class="language-math …">`。
 * `math-display` 是 `$$` 行间围栏带上的类；` ```math ` 围栏只有 `language-math`。
 */
function isMathPre(node: HastNode | undefined): boolean {
	if (node?.type !== 'element' || node.tagName !== 'pre')
		return false
	const children = node.children
	if (children?.length !== 1)
		return false
	const code = children[0]
	if (code?.type !== 'element' || code.tagName !== 'code')
		return false
	const className = code.properties?.className
	return Array.isArray(className) && className.includes('language-math')
}

export function rehypeMathCode() {
	return (tree: HastNode) => {
		unwrap(tree)
	}
}

function unwrap(node: HastNode) {
	const children = node.children
	if (!Array.isArray(children))
		return
	for (let i = 0; i < children.length; i++) {
		const child = children[i]
		if (!child || typeof child !== 'object')
			continue
		if (isMathPre(child))
			children.splice(i, 1, child.children![0])
		else
			unwrap(child)
	}
}
