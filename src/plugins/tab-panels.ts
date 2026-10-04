/**
 * 面板语法：`<Tab>` 里的 `#tabN` 段落自动变成第 N 个面板。
 *
 * ═══ 为什么需要 ═══
 *
 * MDX 不支持**运行时计算的动态具名 slot**（`slot={`tab${n}`}`），而 `Tab.astro`
 * 原来在 Vue 时代正是这么用的。试过两条替代方案都不可行：
 * `panels={[<p>a</p>]}` 渲染成 `[object Object]`（MDX 的 JSX 数组元素是 Astro
 * 组件工厂函数，不是可渲染对象）；手写 slot 名字则要每个面板套一层 div。
 *
 * 于是只剩一条路：让作者写 `#tabN`，构建期把它展开成 slot div。产物与手写版
 * 逐字相同，`<Tab>` 与面板内容都不用动。
 *
 *   写：                              展开成：
 *   <Tab tabs={["甲","乙"]}>          <Tab tabs={["甲","乙"]}>
 *                                     <div slot="tab1">
 *   #tab1                             面板一
 *   面板一                            </div>
 *                                     <div slot="tab2">
 *   #tab2                             面板二
 *   面板二                            </div>
 *                                     </Tab>
 *   </Tab>
 *
 * 4 行变 8 行，但省掉的是**每面板一个 div 加一圈空行**，而且面板内容重新变成
 * 裸 markdown（原来被 div 关着，列表/表格的缩进语义会变）。
 *
 * ═══ 为什么用 `#tabN` 而不是 `## tabN` ═══
 *
 * CommonMark 的 ATX 标题要求 `#` 后是空格或行尾，`#tab1` 不是标题而是一段普通
 * 文本——**插件没跑时它在页面上原样可见**，不会静默变成一个「tab1」标题。
 * 用真正的标题则会与「面板里想放一个小标题」这个真实需求冲突。
 *
 * ═══ 为什么整套展开靠「合成文本再重新解析」 ═══
 *
 * 与 `component-fence.ts` 同一个理由：手写 `mdxJsxFlowElement` 节点时，
 * `tabs={["甲","乙"]}` 这类属性表达式、`position` 的形状都可能与「MDX 实际会
 * 接受的写法」漂移，而那种漂移**不会报错**，只会让构建产物悄悄变形。
 * 所以这里也拼一段 MDX 源码交给 MDX 自己的解析器，节点形状由它保证。
 *
 * ⚠️ 面板内容是从**源文件原文**按位置切出来的，不是从 AST 反序列化。AST → 文本
 * 需要序列化器，而序列化器会丢掉原始格式（缩进、换行位置），切出来的内容因此
 * 仍带作者原来的排版。
 */
import { readFileSync } from 'node:fs'
import { createProcessor } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

/**
 * 只 parse 不 run：MDX 的 `run()` 会一路做到 estree 源码，而这里要的是节点树
 * （splice 回页面树，由页面自己的 MDX 编译去求值）。
 *
 * 插件顺序与 `astro.config.mjs` 的 `createProcessor()` 保持一致，否则合成出来的
 * 模板在「组件」栏展示时可能与页面真实渲染不同。
 */
const PROCESSOR = createProcessor({ remarkPlugins: [remarkMath, remarkGfm] })

/** 面板标记段落：整段文本恰好是 `#tab1` / `#tab12` */
const PANEL_RE = /^#tab(\d+)$/

interface MdastNode {
	type: string
	value?: string
	name?: string | null
	position?: { start?: { offset?: number | null } | null, end?: { offset?: number | null } | null } | null
	children?: MdastNode[]
}

export function remarkTabPanels() {
	return (tree: MdastNode, file?: { path?: string }): void => {
		const raw = readRaw(file?.path)
		walk(tree, raw)
	}
}

function walk(node: MdastNode, raw: string | null) {
	const children = node.children
	if (!children)
		return
	for (let i = 0; i < children.length; i++) {
		const child = children[i]
		if (child.type === 'mdxJsxFlowElement' && child.name === 'Tab' && raw !== null) {
			const replaced = expand(child, raw)
			if (replaced) {
				children.splice(i, 1, replaced)
				continue
			}
		}
		walk(child, raw)
	}
}

/**
 * 把带 `#tabN` 标记的 `<Tab>` 展开成带 slot div 的等价节点。
 *
 * 没有 `#tabN` 就返回 null —— 那是**手写 slot**的老写法，必须原样放过。
 * 两种写法共存是有意的：改了插件不必重写 42 处既有内容。
 */
function expand(node: MdastNode, raw: string): MdastNode | null {
	const marks = panelMarks(node)
	if (!marks.length)
		return null

	const openTag = sliceTag(raw, node)
	if (!openTag)
		throw new Error('[tab-panels] 切不出 <Tab> 的开标签')

	// 面板数必须与 tabs 数组长度一致，且编号必须是 1..N 连续。
	// 两条都要查：**只比数量会漏掉编号跳号**（`#tab1` 后面直接 `#tab3`，数量对得上），
	// 而跳号会生成 `slot="tab3"`，Tab 不认识这个槽位 → 第二个页签空白、构建全绿。
	const declared = tabCountFromSource(openTag)
	if (declared !== null && declared !== marks.length) {
		throw new Error(`[tab-panels] <Tab> 声明了 ${declared} 个页签，但正文里只有 ${marks.length} 个 #tabN 标记（${marks.map(m => `#tab${m.n}`).join(', ')}）`)
	}
	const gapped = marks.filter((m, idx) => m.n !== idx + 1)
	if (gapped.length) {
		throw new Error(`[tab-panels] 面板编号必须从 1 连续递增，实际是 ${marks.map(m => `#tab${m.n}`).join(', ')}。跳号会生成 Tab 不认识的 slot="tab${gapped[0].n}"，那个页签会空白而构建照样绿。`)
	}

	const bodies = marks.map((m, idx) => {
		const from = m.markerEnd
		const to = idx + 1 < marks.length ? marks[idx + 1].markerStart : contentEnd(raw, node)
		return slice(raw, from, to).trim()
	})

	const template = [
		openTag,
		...bodies.flatMap((body, idx) => [
			`<div slot="tab${marks[idx].n}">`,
			body,
			'</div>',
		]),
		'</Tab>',
		'',
	].join('\n')

	const parsed = PROCESSOR.parse(template)
	const nodes = parsed.children ?? []
	if (nodes.length !== 1 || nodes[0]?.type !== 'mdxJsxFlowElement' || nodes[0].name !== 'Tab') {
		throw new Error(`[tab-panels] 合成模板解析出来不是单个 <Tab>，实际是 ${nodes.map(n => n.type).join(',') || '(空)'}。\n合成文本：\n${template}`)
	}
	/*
	 * 嵌套 <Tab> 目前不支持，而且失败方式是**静默的**：面板正文是从源文件原文切出来的，
	 * 里面若还有一个带 `#tabN` 的 <Tab>，那个内层 Tab 来自合成文本、不再经过本插件，
	 * 于是它的 `#tabN` 会原样出现在页面上（实测：4 处字面 `#tab1`）。
	 * 与其让人在成品页面里找它，不如在这里失败。
	 */
	const nested = findLeftoverMarks(nodes[0])
	if (nested.length) {
		throw new Error(`[tab-panels] 面板里出现了嵌套的 <Tab>（含 ${nested.join(', ')} 标记）。`
			+ '嵌套暂不支持：内层 Tab 来自合成文本、不再经过本插件，它的 #tabN 会原样漏到页面上。'
			+ '把内层 Tab 改回手写 slot 写法，或把两层拆成两处。')
	}
	return nodes[0]
}

/** 在展开结果里找残留的 `#tabN` 首行（= 没被处理的内层 Tab） */
function findLeftoverMarks(node: MdastNode, out: string[] = []): string[] {
	for (const child of node.children ?? []) {
		if (child.type === 'paragraph') {
			const first = firstLineOf(child).trim()
			if (PANEL_RE.test(first))
				out.push(first)
		}
		findLeftoverMarks(child, out)
	}
	return out
}

interface Mark {
	n: number
	/** 标记段落所在行的行尾偏移，也就是面板正文的起点 */
	markerEnd: number
	/** 标记段落所在行的行首偏移，也就是上一面板正文的终点 */
	markerStart: number
}

/** 收集 `<Tab>` 直接子节点里首行形如 `#tabN` 的段落 */
function panelMarks(node: MdastNode): Mark[] {
	const out: Mark[] = []
	for (const child of node.children ?? []) {
		if (child.type !== 'paragraph')
			continue
		/*
		 * ⚠️ 判据必须落在**首行**，不能要求整段恰好是 `#tab1`。
		 *
		 * 写成
		 *     #tab1
		 *     面板一的内容。
		 * （中间不空行）时，mdast 产出的是**一个** paragraph，里面单个 `text`
		 * 子节点的值是 `"#tab1\n面板一的内容。"`——`value` 为 undefined，段落
		 * position 从 `#` 一直跨到句号。实测见 tests/tab-panels-debug.mjs。
		 * 所以这里拼出首行再判，markerEnd 用 start + 首行长度算，不依赖段落结束。
		 */
		const firstLine = firstLineOf(child)
		const m = PANEL_RE.exec(firstLine.trim())
		if (!m)
			continue
		const start = child.position?.start?.offset
		if (typeof start !== 'number')
			throw new Error('[tab-panels] 拿不到 #tabN 标记的位置信息')
		out.push({ n: Number(m[1]), markerStart: start, markerEnd: start + firstLine.length })
	}
	return out.sort((a, b) => a.markerStart - b.markerStart)
}

/**
 * 段落的首行文本（到第一个换行为止），由子节点的值拼出来。
 *
 * 遇到非文本子节点就返回已拼出的部分——那说明首行不止纯文本，
 * `PANEL_RE` 自然匹配不上，`#tab1 **粗体**` 不会被误当成标记。
 */
function firstLineOf(node: MdastNode): string {
	let s = ''
	for (const child of node.children ?? []) {
		if (child.type !== 'text' || typeof child.value !== 'string')
			return s
		s += child.value
		const nl = s.indexOf('\n')
		if (nl >= 0)
			return s.slice(0, nl)
	}
	return s
}

/**
 * 从 `<Tab …>` 的开标签源码里数出 tabs 数组的长度。
 *
 * 数不出来（tabs 是变量引用而不是字面量数组）时返回 null，此时不做数量校验——
 * 宁可少一道检查，也不要因为作者用了表达式就误报。
 */
function tabCountFromSource(openTag: string): number | null {
	const m = /tabs\s*=\s*\{/.exec(openTag)
	if (!m)
		return null
	// 从 `[` 起做括号配平，数顶层逗号
	let i = openTag.indexOf('[', m.index + m[0].length)
	if (i < 0)
		return null
	let depth = 0
	let count = 1
	let closed = false
	for (; i < openTag.length; i++) {
		const c = openTag[i]
		if (c === '[' || c === '{' || c === '(') {
			depth++
		}
		else if (c === ']' || c === '}' || c === ')') {
			depth--
			if (depth === 0) {
				closed = true
				break
			}
		}
		else if (c === ',' && depth === 1) {
			count++
		}
	}
	if (!closed)
		return null
	return count
}

/** `<Tab` 到第一个 `>` 为止的开标签，逐字取自源文件（属性表达式原样保留） */
function sliceTag(raw: string, node: MdastNode): string | null {
	const start = node.position?.start?.offset
	if (typeof start !== 'number')
		return null
	const m = /^<Tab\b[^>]*>/.exec(raw.slice(start, start + 4000))
	return m ? m[0] : null
}

/** 最后一个面板的正文终点：`<Tab>` 元素最后一个子节点之后、`</Tab>` 之前 */
function contentEnd(raw: string, node: MdastNode): number {
	const kids = node.children ?? []
	const last = kids[kids.length - 1]
	const end = last?.position?.end?.offset
	if (typeof end === 'number')
		return end
	const nodeEnd = node.position?.end?.offset
	return typeof nodeEnd === 'number' ? nodeEnd : 0
}

function slice(raw: string, from: number, to: number): string {
	if (to < from)
		throw new Error(`[tab-panels] 切片区间反了：${from} > ${to}`)
	return raw.slice(from, to)
}

function readRaw(path: string | undefined): string | null {
	if (!path)
		return null
	try {
		// ⚠️ 必须归一成 LF 再按位置切片。unified/mdast 在解析前把 CRLF 归一，
		// 节点 position 的偏移是**归一后**的偏移；直接拿磁盘原文切，每遇到一个
		// CRLF 就整体错位一格——症状是面板建出来了但内容全空，构建完全正常。
		// （`component-fence.ts` 的 `assertBodyIntact` 也有同一条，方向相反：
		//  它先切再 `replace(/\r\n/g, '\n')`。）
		return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
	}
	catch {
		return null
	}
}
