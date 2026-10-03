/**
 * `metaSlots[*].content` 的解析。
 *
 * ═══ 这个模块为什么存在 ═══
 *
 * `rehype-meta-slots` 在 Nuxt 侧把正文里的 `::meta-aside-xxx` 整块抽进
 * `file.data.slots`，存的是**MDC AST 节点**；
 * `useWidgets()` 用 `h(ContentRenderer, { value: slotsTree })` 把它**求值**渲染。
 *
 * Astro 侧的 codemod 把同一块转成了**字符串**（frontmatter 的
 * `metaSlots.<name>.content`），而 `BlogWidget.astro` 原来用 `set:html` 注入。
 * ⇒ 字符串里的 `<LinkCard … />` 变成一个浏览器**不认识的未知元素**，
 * 整个侧栏 widget 渲染成空白。实测 `/previews/example` 线上有一个
 * `a.link-card[href="…/docs/files/markdown"]`，本地是
 * `<linkcard title="…" …></linkcard>`（原样输出、从未求值），
 * 连带另一条 `img[src$="/favicon.ico"]` 的计数差异——**两条差异同一个根因**。
 *
 * 页高看不见它（空白也是合法盒子），计算样式看不见它（压根没有元素），
 * 语义签名探针只报两条数量差，不指出根因。
 *
 * ═══ 判据：能解析什么、不能解析什么 ═══
 *
 * **只支持** `content-components.ts` 里注册过的 PascalCase 组件，
 * 外加纯文本。组件可以有纯文本 children（`::meta-aside-foo` 里的 `<Blur>`）。
 *
 * 其余形态（小写 HTML 标签、属性里的 `{…}` 表达式、组件嵌套组件）
 * 一律**抛错**，让构建失败。原因与 `content-components.ts` 的注释同一条：
 * **静默渲染成空白是最坏的失败方式**——它让一个 widget 消失，
 * 而所有门禁都只会报「数量差 1」。
 *
 * 真要支持小写标签（例如槽位里写 `[a](#x){icon=…}`，Nuxt 侧会走 `ProseA`
 * 拿到 `z-link` 类与域名图标）时，正确的做法是**显式加一条分支**并补测试，
 * 而不是把未知输入原样吐出去。
 */

/** `content-components.ts` 里注册过的组件名集合，由调用方注入以免这里反向依赖 */
export interface SlotNodeBase {
	kind: 'text' | 'component'
}

/** 纯文本节点 */
export interface TextNode extends SlotNodeBase {
	kind: 'text'
	value: string
}

/** 已注册组件节点。`attrs` 的值已按字面量类型解析（string / number / boolean） */
export interface ComponentNode extends SlotNodeBase {
	kind: 'component'
	name: string
	attrs: Record<string, string | number | boolean>
	children: SlotNode[]
}

export type SlotNode = TextNode | ComponentNode

/**
 * 标签与属性：只认不带表达式的字面量形态。
 *
 * ⚠️ 开闭标签在**同一条**正则里（`(\/?)` 捕获 `</` 的那个斜杠）。
 * 第一版只匹配开标签，于是在真数据上立刻炸了
 * 「`<Blur>` 没有闭合」——因为 `</Blur>` 根本没被匹配上，
 * 被当成普通文本吞掉了。**报错方向是对的**（栈顶确实没闭合），
 * 但根因在正则而不是数据：这正是本文件选择「响亮失败」的价值，
 * 否则这一版会安静地渲染出一个缺 children 的 `<Blur>`。
 */
const TAG = /<(\/?)([A-Z][\w.-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>/gi
const ATTR = /([\w:-]+)(?:="([^"]*)")?/g

/** 属性值的字面量类型还原。`link-card` 的 `title` 是字符串、`Pic` 的 `size` 是数字，都走过这条路 */
function literal(raw: string | undefined): string | number | boolean {
	if (raw === undefined)
		return true
	if (raw === 'true')
		return true
	if (raw === 'false')
		return false
	if (raw !== '' && !Number.isNaN(Number(raw)))
		return Number(raw)
	return raw
}

function parseAttrs(src: string): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {}
	for (const m of src.matchAll(ATTR)) out[m[1]] = literal(m[2])
	return out
}

/**
 * 解析槽位内容。
 *
 * @param src       frontmatter 里的 `content` 字符串
 * @param isKnown   判断组件名是否已注册（由调用方传 `content-components.ts` 的 key 集合）
 * @throws 遇到未注册组件 / 小写标签 / 未闭合标签 / 组件嵌组件时抛出，
 *         消息里带上出错的原文片段，便于直接定位到 frontmatter 那一行。
 */
export function parseMetaSlotContent(src: string, isKnown: (name: string) => boolean): SlotNode[] {
	const root: SlotNode[] = []
	/** 栈顶是当前组件节点；`null` 表示在根层 */
	const stack: (ComponentNode | null)[] = [null]
	let cursor = 0

	const push = (node: SlotNode) => {
		const top = stack[stack.length - 1]
		if (top)
			top.children.push(node)
		else root.push(node)
	}

	for (const m of src.matchAll(TAG)) {
		const [whole, close, name, attrSrc, selfClose] = m
		const at = m.index ?? 0

		// 标签之间的纯文本
		const text = src.slice(cursor, at)
		if (text.trim())
			push({ kind: 'text', value: text })
		cursor = at + whole.length

		// 闭合标签
		if (close) {
			const top = stack.pop()
			if (!top || top.name !== name)
				throw new Error(`metaSlots.content 里的 </${name}> 没有对应的开标签，原文片段：${JSON.stringify(src.slice(Math.max(0, at - 60), at + whole.length + 20))}`)
			continue
		}

		// 小写标签：Nuxt 侧会走 Prose* 组件（ProseA 会加 z-link / 域名图标），
		// 本模块不冒充那个行为，直接报错而不是原样吐出
		if (/^[a-z]/.test(name))
			throw new Error(`metaSlots.content 暂不支持小写标签 <${name}>（Nuxt 侧走 Prose* 组件，会加 z-link / 域名图标）。原文片段：${JSON.stringify(whole)}`)

		if (!isKnown(name))
			throw new Error(`metaSlots.content 引用了未注册的组件 <${name}>；先在 src/lib/content-components.ts 里注册（Nuxt Content 对未注册组件是构建期报错，不是静默空白）`)

		const node: ComponentNode = { kind: 'component', name, attrs: parseAttrs(attrSrc ?? ''), children: [] }
		push(node)
		if (selfClose)
			continue
		stack.push(node)
	}

	const tail = src.slice(cursor)
	if (tail.trim())
		push({ kind: 'text', value: tail })

	if (stack.length > 1) {
		const unclosed = stack[stack.length - 1]!
		throw new Error(`metaSlots.content 里的 <${unclosed.name}> 没有闭合`)
	}

	// 组件里再嵌组件：递归渲染会多一层组件边界，样式与 slot 语义都不同，
	// 与其半吊子支持，不如现在就说清楚
	const hasNested = root.some(n => n.kind === 'component' && n.children.some(c => c.kind === 'component'))
	if (hasNested)
		throw new Error('metaSlots.content 暂不支持组件嵌套组件（children 里还有已注册组件）')

	return root
}
