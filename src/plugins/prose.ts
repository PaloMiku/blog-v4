/**
 * prose 层增强（rehype）：给 markdown **生成**的 `p` / `a` / `pre` / `code` /
 * `table` 元素补上 prose CSS、客户端脚本与门禁共同依赖的 DOM 形状：
 *
 *   - `pre` → `<figure class="z-codeblock">` 外壳：语言标签、
 *     「自动换行 / 复制」按钮、长代码块折叠
 *   - `a` → `z-link` 类与域名图标、`data-tip` 浮层文案
 *   - `p` → `prose-paragraph` 类与「引用整段到评论区」按钮（显隐由客户端定）
 *   - `table` → `<figure class="md-table">` 外壳与换行切换
 *   - 行内 `code` → `language-*` / `copyable` / 复制按钮 + 构建期着色
 *   - `h1..h6` 的 `<a href="#id">` 包裹留到客户端（id 在本插件之后才写入）
 *
 * ═══ 为什么用 rehype 而不是 MDX 组件映射 ═══
 * 这些是 markdown **生成**的元素，不是 MDX 里手写的组件名，
 * 走 `components` 表覆盖不可靠。rehype 阶段是它们唯一稳定的存在形式。
 *
 * ═══ 结构合同 ═══
 * `main.css` 里 `.shiki > .line` 一类规则要求 `.line` 是 `pre` 的**直接子元素**，
 * 所以这里必须把 Astro shiki 产出的 `<code>` 包裹拆掉；类名与嵌套形状是线上一致
 * 的内容合同（CSS、客户端脚本、门禁都按它匹配），勿单方面改动——背景见
 * docs/plan/analysis/engineering-inventory.md §4。
 *
 * 本插件的 rehype 阶段跑在 Astro 内建 shiki **之后**（证据：追加的
 * `shiki scrollcheck-x` 排在 `one-dark-pro` 之后，且拆掉的 `<code>`
 * 没有被重新包回来）。
 */
import type { BundledLanguage, Highlighter } from 'shiki'
import type { HastNode } from '../lib/prose-icons'
import { readFileSync } from 'node:fs'
import { createHighlighter } from 'shiki'
import { appConfig } from '../lib/app-config'
import { iconElement } from '../lib/prose-icons'
import { formatBytes, getDomain, getDomainIcon, getFileIcon, getLangIcon, isExtLink, safelyDecodeUriComponent } from '../lib/shared'
import { COMPONENT_FENCE_LANG, componentFenceInfos } from './component-fence'

/* ══════════════════════════ 极简 hast 遍历 ══════════════════════════
 * 不引入 unist-util-visit：它只是传递依赖，且这里只需要深度优先遍历。
 */

function el(tag: string, props: Record<string, unknown> = {}, children: Array<HastNode | undefined> = []): HastNode {
	// 图标查不到时 iconElement 返回 undefined；这里滤掉，
	// 否则 walk 里的 `child.children` 会在 undefined 上炸。
	return { type: 'element', tagName: tag, properties: props, children: children.filter((c): c is HastNode => Boolean(c)) }
}

function txt(value: string): HastNode {
	return { type: 'text', value }
}

function classList(node: HastNode): string[] {
	const c = node.properties?.class
	if (Array.isArray(c))
		return c.map(String)
	if (typeof c === 'string')
		return c.split(/\s+/).filter(Boolean)
	const mdx = mdxAttr(node, 'class')
	return mdx === undefined ? [] : mdx.split(/\s+/).filter(Boolean)
}

/**
 * 读写 MDX 元素的属性。
 *
 * ⚠️ MDX 手写的元素（`mdxJsxTextElement` / `mdxJsxFlowElement`）**没有**
 * `properties`，属性在 `attributes` 数组里，而且**写 `properties` 完全无效**——
 * MDX 运行时只认 `attributes`。因此加类 / 设属性必须走 `setAttr`，
 * 直接操作 `properties` 对 MDX 节点是无声的空操作。
 *
 * ⚠️⚠️ 新增的属性对象**必须带 `type: 'mdxJsxAttribute'`**。
 * MDX 的 hast→estree 只认带 `type` 的属性节点，裸 `{ name, value }` 被**静默丢弃**。
 * 症状极有欺骗性：删属性（splice，不新建对象）生效、加属性不生效，
 * 看起来像「`addClass` 没被调用」而不是「属性对象形状不对」。
 */
interface MdxAttr {
	type?: string
	name: string
	value: unknown
}

function mdxAttrs(node: HastNode): MdxAttr[] | undefined {
	if (!String(node.type ?? '').startsWith('mdx'))
		return undefined
	const attrs = (node as { attributes?: MdxAttr[] }).attributes
	return Array.isArray(attrs) ? attrs : []
}

function mdxAttr(node: HastNode, name: string): string | undefined {
	const attrs = mdxAttrs(node)
	if (!attrs)
		return undefined
	const hit = attrs.find(a => a.name === name)
	if (!hit || hit.value === undefined || hit.value === null || hit.value === false)
		return undefined
	return typeof hit.value === 'object' ? String((hit.value as { value?: unknown }).value ?? '') : String(hit.value)
}

/** 给 MDX 节点设置属性（覆盖同名）；非 MDX 节点走 `properties` */
function setAttr(node: HastNode, name: string, value: unknown): void {
	const attrs = mdxAttrs(node)
	if (attrs) {
		const hit = attrs.find(a => a.name === name)
		if (hit)
			hit.value = value
		else attrs.push({ type: 'mdxJsxAttribute', name, value })
		return
	}
	node.properties = { ...node.properties, [name]: value }
}

/** 删掉一个属性。MDC 的 `icon` 之类只给组件消费，不是合法 HTML 属性 */
function dropAttr(node: HastNode, name: string): void {
	const attrs = mdxAttrs(node)
	if (attrs) {
		const idx = attrs.findIndex(a => a.name === name)
		if (idx >= 0)
			attrs.splice(idx, 1)
		return
	}
	if (node.properties && name in node.properties) {
		const next = { ...node.properties }
		delete next[name]
		node.properties = next
	}
}

function addClass(node: HastNode, ...names: string[]) {
	const current = classList(node)
	for (const n of names) {
		if (!current.includes(n))
			current.push(n)
	}
	setAttr(node, 'class', current.join(' '))
}

/**
 * 取标签名。
 *
 * ⚠️ MDX 手写的元素**没有** `tagName`——标签名在 `name` 上（`mdxJsxTextElement`
 * 原样透传给 MDX 运行时，hast 那一侧什么都不做）。只读 `tagName` 会整条跳过
 * 正文里以 JSX 形态出现的行内代码与链接。
 *
 * ## 额外认哪些名字
 *
 * 只认 `code` 与 `a`：这两个在 prose 合同里有各自的产物形状（行内代码着色/
 * 复制按钮、链接的 z-link+图标），而语料里的 `` `x`{lang="yy"} `` 与
 * `[a](#x){icon="…"}` 在 MDX 里恰好会被写成 JSX 元素，绕开它们就等于
 * `buildLink` / `buildInlineCode` 对这批节点静默失效（类名缺失、
 * `icon` 这类非 HTML 属性原样漏进 DOM）。
 *
 * 其余 MDX 元素（Tab / div / span / img / meta-*）**仍然不认**：只有
 * markdown 生成的元素参与 prose 增强，手写组件不参与。
 * 判据是「这个标签有没有 prose 合同」，不是「它是不是小写」。
 */
function tagOf(node: HastNode): string | undefined {
	if (node.tagName)
		return node.tagName
	const name = (node as { name?: string }).name
	if (!String(node.type).startsWith('mdx'))
		return undefined
	return name === 'code' || name === 'a' ? name : undefined
}

/**
 * hast 的属性键名有两种约定：有的地方写 `data-language`，
 * 也有地方经 hast 的属性名归一化变成 `dataLanguage` 后再序列化回 `data-language`。
 * 三种拼法都要试——只读一种会让语言标签全显示成 text，而
 * `<pre data-language="bash">` 明明在输出里。
 *
 * ⚠️ 还有第三种形态：本插件运行时，MDX 里手写的 `<code lang="js" copy={true}>`
 * 还是 `mdxJsxTextElement`，属性放在 `attributes` 数组里而不是 `properties`，
 * 两处都要读——只读 `properties` 时行内代码的 `lang` / `copy` 一个都取不到，
 * 产物里既没有 `language-js` 也没有复制按钮，且不会报错。
 */
function getAttr(node: HastNode, name: string): string | undefined {
	const props = node.properties
	if (props) {
		const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
		const dashed = name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
		for (const key of new Set([name, camel, dashed])) {
			const v = props[key]
			if (v !== undefined && v !== null && v !== false)
				return String(v)
		}
	}

	const attrs = (node as { attributes?: Array<{ name?: string, value?: unknown }> }).attributes
	if (!Array.isArray(attrs))
		return undefined
	for (const attr of attrs) {
		if (attr?.name !== name)
			continue
		const v = attr.value
		if (v === undefined || v === null || v === false)
			return undefined
		// `copy={true}` 的 value 是表达式节点 { type, value: 'true' }
		if (typeof v === 'object')
			return String((v as { value?: unknown }).value ?? '')
		return String(v)
	}
	return undefined
}

/**
 * 深度优先遍历，子节点先于父节点处理。
 *
 * `visit` 返回替换节点即就地替换，返回 `null` 删除，返回 `undefined` 不动。
 * **替换产生的新子树不会被再遍历**——否则 figcaption 里生成的 `<button>`、
 * 表格里生成的切换按钮会被二次加工。
 */
function walk(node: HastNode, visit: (n: HastNode, parent: HastNode) => HastNode | null | undefined) {
	const children = node.children
	if (!children)
		return
	for (let i = 0; i < children.length; i++) {
		const child = children[i]
		if (!child)
			continue
		if (child.children)
			walk(child, visit)
		const next = visit(child, node)
		if (next === null) {
			children.splice(i, 1)
			i--
		}
		else if (next !== undefined) {
			children[i] = next
		}
	}
}

/* ══════════════════════════ 1. 围栏 meta ══════════════════════════ */

interface CodeMeta {
	lang: string
	filename?: string
	icon?: string
	wrap?: boolean
	expand?: boolean
}

/**
 * 解析围栏 info string：`lang [文件名] icon=xx:yy wrap expand`
 * （语料沿用内容层的围栏语法，这是内容合同的一部分）。
 */
function parseFenceInfo(info: string): CodeMeta {
	const trimmed = info.trim()
	const spaceAt = trimmed.search(/\s/)
	const lang = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)) || 'text'
	const out: CodeMeta = { lang }
	let rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt).trim()

	const bracketed = rest.match(/^\[([^\]]*)\]/)
	if (bracketed) {
		if (bracketed[1])
			out.filename = bracketed[1]
		rest = rest.slice(bracketed[0].length).trim()
	}

	for (const token of rest.split(/\s+/).filter(Boolean)) {
		const eq = token.indexOf('=')
		if (eq > 0) {
			if (token.slice(0, eq) === 'icon')
				out.icon = token.slice(eq + 1)
		}
		else if (token === 'wrap') {
			out.wrap = true
		}
		else if (token === 'expand') {
			out.expand = true
		}
	}

	return out
}

/** 扫源文件里所有围栏的 info string；闭合围栏的 info 为空，不计入。 */
export function scanFences(source: string): CodeMeta[] {
	const out: CodeMeta[] = []
	let openChar = ''
	let openLen = 0
	/** 围栏内的正文行。Component 围栏关掉时要拿它再扫一遍 */
	let body: string[] = []
	/** 当前围栏是不是 `Component` 围栏；是的话它的 meta 推迟到关掉时才推 */
	let componentFilename: string | null = null

	for (const line of source.split(/\r?\n/)) {
		/*
		 * 不要写成 `/^\s*(`{3,}|~{3,})(.*)$/`：两个无界量词后面再跟 `(.*)$`，
		 * 在一长串反引号上会退化成多项式回溯（eslint: regexp/no-super-linear-backtracking）。
		 * 去掉 `$` 与尾部组，剩余部分直接用 slice 取——效果完全一样，复杂度线性。
		 */
		const m = /^\s*(`{3,}|~{3,})/.exec(line)
		if (!m) {
			if (openChar)
				body.push(line)
			continue
		}
		const fence = m[1]
		const info = line.slice(m[0].length)
		if (!openChar) {
			openChar = fence[0]
			openLen = fence.length
			body = []
			const meta = parseFenceInfo(info)
			/*
			 * `Component` 围栏在**树**里展开成两个代码块（用法、源码），
			 * 源文件里却只有一个围栏——所以它必须算成**两个** CodeMeta，
			 * 否则后面两个 `<pre>` 会去配别的围栏的 meta（文件名/图标张冠李戴，
			 * 而且不会报错）。
			 *
			 * ⚠️ 缺 `[文件名]` 时这里**不能抛错**：`readFenceMetas()` 把异常吞成 `[]`，
			 * 一抛就是「整份文件的 meta 全丢」，症状离病因十万八千里。
			 * 那种情况由 remark 阶段的插件抛——它在 rehype 之前跑，一定拦得住。
			 */
			componentFilename = meta.lang === COMPONENT_FENCE_LANG && meta.filename ? meta.filename : null
			if (componentFilename)
				continue
			out.push(meta)
		}
		else if (fence[0] === openChar && fence.length >= openLen && info.trim() === '') {
			if (componentFilename) {
				/*
				 * 顺序必须与树里 code 节点的顺序一致，而树里是
				 *   tab1（围栏正文，含正文里的围栏）→ tab2 用法 → tab3 源码。
				 * 所以**正文里的围栏 meta 要排在最前面**：漏掉它们的话，
				 * 正文里那个 ` ```md wrap expand ` 的 wrap/expand 会静默失效
				 * （围栏照常渲染，只是少了那两个标记）。
				 */
				out.push(...scanFences(body.join('\n')))
				out.push(...componentFenceInfos().map(parseFenceInfo))
			}
			openChar = ''
			openLen = 0
			body = []
			componentFilename = null
		}
		else {
			// 围栏内的一行、且不是闭合围栏 → 正文
			body.push(line)
		}
	}

	return out
}

/** 顺序取用；lang 对不上就跳过（说明顺序已错位，宁可不要也不要错配）。 */
function takeMeta(metas: CodeMeta[], lang: string): CodeMeta | undefined {
	for (let i = 0; i < metas.length; i++) {
		if (metas[i].lang === lang) {
			const [hit] = metas.splice(i, 1)
			return hit
		}
	}
	return undefined
}

/**
 * 从 VFile 拿源文件并扫围栏。
 *
 * ⚠️ meta 从 remark 阶段往 rehype 阶段传的三条路都实测走过，全部不通：
 *   1. hProperties → Astro 的 shiki **重建** `<pre>` 节点，只保留它自己的属性；
 *   2. 模块级队列 → Astro 并行构建多页，别的页面插队冲掉；
 *   3. `tree.data` → mdast 的 data 不过到 hast 阶段。
 * 唯一稳定的通道是 VFile 的 `path`。
 */
function readFenceMetas(file: unknown): CodeMeta[] {
	const path = (file as { path?: string } | undefined)?.path
	if (!path || !/\.mdx?$/.test(path))
		return []
	try {
		return scanFences(readFileSync(path, 'utf8'))
	}
	catch {
		return []
	}
}

/* ══════════════════════════ 2. 补 prose 结构标记 ══════════════════════════ */

/**
 * 代码块行为参数。
 *
 * ⚠️ 不要在这里写死数字：从 `src/lib/app-config.ts` 的 `component.codeblock` 读。
 * 曾经硬编码的一组数字与实际配置全部不符，
 * 会让几乎所有代码块都不折叠、折叠高度也不对。
 */
export const CODEBLOCK = appConfig.component.codeblock

/** meta 未指定时，语言属于「天然需要缩进」的那批。 */
function resolveIndent(lang: string) {
	if (['md', 'mdc', 'json', 'jsonc', 'yaml', 'yml'].includes(lang))
		return String(CODEBLOCK.indent)
	return String(CODEBLOCK.tabSize)
}

/** pre 里的纯文本（Shiki 拆成一行一个 span）。 */
function preText(pre: HastNode): string {
	const read = (nodes: HastNode[] = []): string =>
		nodes
			.map((n) => {
				if (n.type === 'text')
					return n.value ?? ''
				if (n.children)
					return read(n.children)
				return ''
			})
			.join('')
	return read(pre.children)
}

function buildCodeFigure(pre: HastNode, metas: CodeMeta[]): HastNode {
	/*
	 * Astro 的 shiki 对**没有标语言**的围栏会写 `data-language="plaintext"`，
	 * 而本仓库的图标映射、图注文本与围栏 meta 配对用的约定值是 `text`。不归一化：
	 *
	 *   - 代码块图标的语言映射走错分支；
	 *   - `parseFenceInfo` 拿 `plaintext` 去配对 meta，永远配不上；
	 *   - 产物图注文本变成 `plaintext`，与线上内容合同不符，按文本配对的探针也会失配。
	 *
	 * 光靠 `?? 'text'` 的兜底不够——属性一直有值，只是值不对，必须显式归一化。
	 */
	const rawLang = getAttr(pre, 'data-language')
	const lang = !rawLang || rawLang === 'plaintext' ? 'text' : rawLang
	const meta = takeMeta(metas, lang)
	const file = meta?.filename
	const blockIcon = meta?.icon ?? (file ? getFileIcon(file) : undefined) ?? getLangIcon(lang)
	const hasWrapMeta = meta?.wrap === true
	const expandable = meta?.expand === true

	/* 拆掉 Astro 的 <code> 包裹，让 .line 直接挂在 pre 下——main.css 的 `.shiki > .line` 要求这一形状。 */
	const code = pre.children?.find(c => c.tagName === 'code')
	if (code?.children)
		pre.children = code.children

	const source = preText(pre)
	const rows = source.split('\n').length
	const collapsible = !expandable && rows > CODEBLOCK.triggerRows
	/*
	 * 图注里的行数 / 字符数 / 字节数按「围栏原文」口径算：闭合围栏前那个换行
	 * 也算进去，所以补 `${source}\n`。这个口径与线上图注数字一致（内容合同，
	 * 背景见 engineering-inventory §4），几何门禁按图注文本配对——改口径会连锁红。
	 */
	const untrimmed = `${source}\n`

	addClass(pre, 'shiki', 'scrollcheck-x')
	/*
	 * `wrap` 类必须真的挂到 pre 上。
	 *
	 * 内容里写 ```` ```mdc wrap ```` 时，prose.css 的
	 * `.z-codeblock pre.wrap { white-space: pre-wrap }` 才能让长行折行。
	 * 只把 `hasWrapMeta` 拿去拼按钮文字（`横向滚动` / `自动换行`）是不够的——
	 * 按钮显示得对、行为没跟上，且没有任何报错。
	 */
	if (hasWrapMeta)
		addClass(pre, 'wrap')
	// 横向滚动交给 CSS 的 .scrollcheck-x；Astro 内联的 overflow-x:auto 会双写。
	const style = pre.properties?.style
	if (typeof style === 'string') {
		const cleaned = style.replace(/;?overflow-x:\s*auto/g, '').replace(/;\s*$/, '')
		pre.properties = { ...pre.properties, style: cleaned || undefined }
	}
	pre.properties = { ...pre.properties, tabIndex: undefined }

	const fileIcon = file && blockIcon ? iconElement(blockIcon, 'iconify') : undefined

	const figure = el(
		'figure',
		{
			class: 'z-codeblock',
			style: `--collapsed-rows:${CODEBLOCK.collapsedRows};--tab-size:${resolveIndent(lang)}`,
		},
		[
			el('figcaption', {}, [
				file ? el('span', { class: 'filename' }, [fileIcon, txt(` ${file}`)]) : el('span', {}),
				el('span', { class: 'language' }, [txt(lang)]),
				el('div', { class: 'operations' }, [
					el('button', { 'type': 'button', 'data-cb-action': 'wrap' }, [txt(hasWrapMeta ? '横向滚动' : '自动换行')]),
					el('button', { 'type': 'button', 'data-cb-action': 'copy' }, [txt('复制')]),
				]),
			]),
			pre,
		],
	)

	if (collapsible) {
		/*
		 * 类名固定为逐字同序的 `z-codeblock collapsed collapsible`
		 * （CSS、门禁与客户端脚本都按这一形状匹配）。
		 *
		 * ⚠️ `collapsed` 必须在**构建期**就写上，不能只靠客户端
		 * `prose-enhance.ts` 的 `initCodeCollapse()` 补。那样做的话
		 * SSR 产物是「展开」的，首屏要等 JS 跑完才折叠（闪一下全量代码），
		 * 无 JS 时永远展开——线上的初始形态就是折叠的。
		 *
		 * ⚠️ 代价是 `initCodeCollapse()` 开头 `if (contains('collapsed')) continue`
		 * 会**整块跳过**，所以构建期必须把它的另外两个副作用一起做掉：
		 *   - `aria-label` 用 `展开代码块`
		 *   - 箭头图标带 `is-collapsed`，否则 prose.css 的
		 *     `rotate(180deg)` 永远不生效，箭头方向反了。
		 * 这三处是**一个整体**，动其中一处必须同步另两处。
		 */
		figure.properties!.class = 'z-codeblock collapsed collapsible'
		figure.children!.push(
			el('button', { 'type': 'button', 'class': 'toggle-btn', 'aria-label': '展开代码块', 'data-cb-action': 'collapse' }, [
				iconElement('tabler:chevrons-up', 'toggle-icon is-collapsed'),
				/*
				 * 文案必须包一层 `<span>`，让按钮有**两个元素子节点**（图标 + 文字）。
				 *
				 * `main.css` 的 `button > .iconify:only-child { display: block }`：
				 * 裸 `<svg>` + 裸文本节点时，文本不算元素子节点，`:only-child`
				 * **成立** → 图标 display:block 独占一行，每个折叠块凭空多一行
				 * （实测 16.31px，一个块 +16、两个块 +33）。两个元素子节点时
				 * `:only-child` 不命中，图标回到 `:where(.iconify)` 的
				 * inline-block，与文字同一行。
				 *
				 * ⚠️ 千万别把 main.css 那条改成 `svg { display: block }` /
				 * `> * { display: block }` 之类的写法来「压住」`:only-child`：
				 * `:where(.iconify)` 是**零特异性**，任何裸标签或通配选择器都能
				 * 盖掉它的 inline-block，那只会把 16.31px 换成另一种错法
				 * （Tip.astro 那个图标被永久清空的坑就是同一族）。
				 *
				 * 前置空格一并去掉：产物里 toggle 按钮的形状是「图标 + 文字 span」，
				 * 中间没有空白文本节点；间距由 `.toggle-icon` 的
				 * `margin-inline-end: 0.2em` 负责。
				 */
				el('span', {}, [txt(`${rows} lines, ${untrimmed.length} chars, ${formatBytes(new TextEncoder().encode(untrimmed).length)}`)]),
			]),
		)
	}

	return figure
}

function buildLink(node: HastNode): HastNode | undefined {
	const href = getAttr(node, 'href') ?? ''
	if (!href)
		return undefined
	// **所有**正文链接都加 z-link，含 `#锚点` 内部跳转——这是 prose.css
	// 与 check-anchor-classes 门禁依赖的产物合同。
	addClass(node, 'z-link')
	if (isExtLink(href))
		setAttr(node, 'target', '_blank')
	if (isExtLink(href))
		setAttr(node, 'rel', 'nofollow noopener noreferrer')
	// 浮层文案：外链给域名，内链给解码后的 href。内容在构建期就算好写进
	// `data-tip`，客户端只负责显隐（src/lib/prose-enhance.ts，浮层壳子是
	// `.tippy-box` 复刻，不依赖任何 tooltip 库）。
	const tip = isExtLink(href) ? getDomain(href) : safelyDecodeUriComponent(href)
	if (tip)
		setAttr(node, 'data-tip', tip)
	// `icon` 是内容语法给链接的 prop（`[a](#x){icon="tabler:color-swatch"}`），
	// 不是合法 HTML 属性——**必须从输出里删掉**，否则它会原样出现在 DOM 上。
	// 显式 icon **覆盖**域名图标，且两者都用 `domain-icon` 类渲染。
	const explicitIcon = getAttr(node, 'icon')
	if (explicitIcon !== undefined)
		dropAttr(node, 'icon')
	const hasIcon = node.children?.some(c => classList(c).includes('domain-icon'))
	const iconName = explicitIcon ?? getDomainIcon(href)
	if (iconName && !hasIcon) {
		const icon = iconElement(iconName, 'iconify domain-icon')
		if (icon)
			node.children = [icon, ...(node.children ?? [])]
	}
	return node
}

/**
 * 表格的换行切换。
 *
 * 浮层壳子在构建期直接产出，类名沿用 `.tippy-box` / `.tippy-content`，
 * 让 main.css 既有的 tippy 样式继续生效
 * （同 partial/Dropdown.astro、post/Comment.astro 的做法）。
 *
 * 显隐与 500ms 延迟全部交给 CSS 的 transition-delay，不用 JS。
 * 按钮初始是 `opacity: 0` 而不是 `display: none` / `visibility: hidden`：
 * 前者会让 Playwright 的可见性检查失败（scripts/interaction-check.mjs 直接
 * `click('[data-md-table-action]')`，没有 hover 就没有 500ms），后者也一样；
 * `opacity` 还能顺带保住键盘可达性。
 */
function buildTable(node: HastNode): HastNode {
	addClass(node, 'scrollcheck-x', 'scroll')
	// 初始 `scroll` 为真（= 横向滚动），按钮给的是反向操作「自动换行」，
	// 图标同理：scroll ? text-wrap : text-wrap-disabled。
	const button = el(
		'button',
		{ 'type': 'button', 'class': 'md-table-toggle', 'data-md-table-action': 'toggle', 'aria-label': '切换表格换行' },
		[
			iconElement('tabler:text-wrap', 'md-table-icon md-table-icon-wrap'),
			iconElement('tabler:text-wrap-disabled', 'md-table-icon md-table-icon-scroll'),
			el('span', { class: 'md-table-toggle-text' }, [txt('自动换行')]),
		],
	)
	const box = el('span', { 'class': 'tippy-box md-table-toggle-box md-table-scroll', 'data-placement': 'top' }, [
		el('span', { class: 'tippy-content' }, [button]),
	])
	return el('figure', { class: 'md-table' }, [node, box])
}

/**
 * 行内代码着色（构建期）。
 *
 * ═══ 为什么走构建期而不是客户端 ═══
 * 站点里带 `lang` 的行内代码很少，为此把一个 shiki 高亮器塞进客户端包完全不
 * 划算；而构建期已经因为 `astro.config.mjs` 的 `shikiConfig` 引入过 shiki 了，
 * 只是它只处理围栏代码块。
 * 于是这里复用同一套主题（catppuccin-latte + one-dark-pro）与
 * `defaultColor: false`，token 拿到 `--shiki-light` / `--shiki-dark`，
 * 正好命中 prose.css / main.css 里既有的 `.shiki > span[style]` 规则；
 * 明暗切换是纯 CSS 变量，行内代码也跟着切。
 *
 * 代价：多一个 shiki 高亮器实例（约 1~2s，只建一次）。
 */
const INLINE_THEMES = { light: 'catppuccin-latte', dark: 'one-dark-pro' }

/**
 * 高亮器按需创建、全进程复用。
 *
 * ⚠️ 这里存的是「promise」而不是结果：并发构建时多个页面会同时 await
 * 同一个 promise，谁先到谁先跑，不存在「后到的页面把前一个的结果冲掉」
 * 那类问题（模块级**队列**会被并行构建插队冲掉，性质不同，见 readFenceMetas）。
 * 行内代码着色点很少，语言按需 `loadLanguage`，不做硬编码白名单。
 */
let inlineHighlighter: Promise<Highlighter> | undefined

function loadInlineHighlighter() {
	inlineHighlighter ??= createHighlighter({ themes: [INLINE_THEMES.light, INLINE_THEMES.dark], langs: [] })
	return inlineHighlighter
}

/** 返回 token 节点；语言不认识 / 语法炸了就返回 undefined，调用方保留原样。 */
async function highlightInline(highlighter: Highlighter, code: string, lang: string): Promise<HastNode[] | undefined> {
	try {
		if (!highlighter.getLoadedLanguages().includes(lang))
			await highlighter.loadLanguage(lang as BundledLanguage)
		return highlighter.codeToHast(code, {
			lang: lang as BundledLanguage,
			// structure: 'inline' 产出的就是一串
			// <span style="--shiki-light:…;--shiki-dark:…">，
			// 没有 <pre> / <code> / .line 外壳，可以直接当 code 的 children。
			structure: 'inline',
			themes: INLINE_THEMES,
			defaultColor: false,
		}).children as HastNode[]
	}
	catch {
		return undefined
	}
}

/**
 * 必须在正式 walk **之前**跑：行内代码的原文只在替换前还是纯文本，
 * 一旦被 token 拆成若干 span 就再也拼不回「这一段代码是什么」。
 * 走 walk 收集而不是就地改，是为了不在同一次遍历里既收集又重写子树。
 */
async function highlightInlineCode(tree: HastNode) {
	const targets: Array<{ node: HastNode, lang: string }> = []
	walk(tree, (node, parent) => {
		if (tagOf(node) !== 'code' || parent.tagName === 'pre')
			return undefined
		const lang = getAttr(node, 'lang')
		if (lang)
			targets.push({ node, lang })
		return undefined
	})
	if (targets.length === 0)
		return

	const highlighter = await loadInlineHighlighter()
	for (const { node, lang } of targets) {
		const tokens = await highlightInline(highlighter, preText(node), lang)
		if (!tokens)
			continue
		node.children = tokens
		// `shiki` 类是双主题 CSS 变量映射（.shiki > span[style]）的挂载点，缺了它
		// token 颜色不随明暗切换。
		addClass(node, 'shiki')
	}
}

/**
 * 行内代码：补 `copy` 行为与结构类。
 *
 * 语料里写 `` `pnpm dev`{lang="sh" copy} ``，在 MDX 里是
 * `<code lang="sh" copy={true}>`，产物形状（CSS 与 interaction-check 都按它匹配）：
 *
 *   <code class="copyable language-sh shiki">…<span icon/><button class="copy-button"/></code>
 *
 * `shiki` / `language-*` 由上面的 highlightInlineCode 加，这里只补结构。
 * `<pre>` 里的那个 `<code>` 由 buildCodeFigure 拆掉，不走这里。
 */
function buildInlineCode(node: HastNode): HastNode | undefined {
	const lang = getAttr(node, 'lang')
	if (lang)
		addClass(node, `language-${lang}`)

	const wantsCopy = getAttr(node, 'copy') !== undefined
	if (!wantsCopy)
		return undefined

	addClass(node, 'copyable')
	const check = iconElement('tabler:check', 'inline-code-check')
	const copyIcon = iconElement('tabler:copy', 'inline-code-icon')
	const button = el(
		'button',
		{ 'type': 'button', 'class': 'copy-button', 'aria-label': '复制', 'data-code-copy': '' },
		copyIcon ? [copyIcon] : [txt('复制')],
	)
	node.children = [...(node.children ?? []), ...(check ? [check] : []), button]
	return undefined
}

/**
 * 把「每项都只包一层 `<p>`」的列表改成紧凑列表。
 *
 * ## 为什么需要
 *
 * CommonMark 规定：列表项之间**有空行**就是 loose list，每个 `<li>` 的内容会被
 * 包进 `<p>`。本仓库大量列表正是这么写的，例如：
 *
 *     - 一台服务器（建议至少1c2g）并安装Docker和Docker Compose
 *
 *     - 一个域名，建议为顶级域名
 *
 * 于是 Astro 产出 `<li><p class="prose-paragraph">…</p></li>`，而
 * **线上产物合同是 `<li>…</li>`，列表项里没有 `<p>`**。
 *
 * 后果有两处，都不止是排版：
 *   1. 多出来的 `<p>` 带自己的上下外边距，每个 `<li>` 都变高（几何门禁会红）；
 *   2. 本插件会给每个 `.prose-paragraph` 插入「引用整段到评论区」按钮，
 *      于是**列表项里也冒出了引用按钮**，而产物合同里列表项没有。
 *
 * ## 判据
 *
 * 只在「该列表项的唯一元素子节点就是那一个 `<p>`」时拆包——
 * 也就是内容本来就只是单独一段，拆掉不丢语义。
 * 真正包含多个块（段落 + 列表 + 代码）的列表项保持原样。
 *
 * 必须排在下面的 `walk` **之前**：拆完之后 `<li>` 里不再有 `<p>`，
 * 也就不会再被当成段落加上引用按钮。
 */
function tightenLooseLists(node: HastNode) {
	const kids = node.children
	if (!Array.isArray(kids))
		return
	if (node.tagName === 'ul' || node.tagName === 'ol') {
		for (const li of kids) {
			if (li.type !== 'element' || li.tagName !== 'li')
				continue
			const elements = (li.children ?? []).filter(c => c.type === 'element')
			const meaningful = (li.children ?? []).filter(c => !(c.type === 'text' && !String(c.value).trim()))
			if (elements.length !== 1 || meaningful.length !== 1)
				continue
			const only = elements[0]
			if (only.tagName !== 'p' || !Array.isArray(only.children))
				continue
			li.children = only.children
		}
	}
	for (const child of kids)
		tightenLooseLists(child)
}

export function rehypeProseChrome() {
	// 异步：行内代码着色要 await 一个按需创建的 shiki 高亮器。
	// unified 会 await 插件的返回值，所以这里安全（见 highlightInlineCode 的注释）。
	return async (tree: HastNode, file: unknown) => {
		const metas = readFenceMetas(file)
		await highlightInlineCode(tree)
		tightenLooseLists(tree)
		walk(tree, (node, parent) => {
			// ⚠️ 不能只认 `type === 'element'` / 只读 `tagName`：MDX 里手写的
			// `<code lang="sh" copy={true}>` 在本插件运行时还是 mdxJsxTextElement
			// （尚未被转成 hast element，标签名在 `name` 上），早先两处都判错，
			// `copyable` / `language-sh` / 复制按钮一个都没加上。见 tagOf。
			//
			// ⚠️ 也**不能**把它规范化成 hast element 再改类名：`items={[...]}`
			// 这类 JSX 表达式属性不是合法 JSON，还原会退化成字符串，
			// 下游 `items.map` 直接炸。MDX 节点保持原样，类名与按钮
			// 由 src/lib/prose-enhance.ts 在客户端补（见 initInlineCodeCopy）。
			const tag = tagOf(node)
			if (!tag)
				return undefined
			switch (tag) {
				case 'pre':
					return buildCodeFigure(node, metas)
				case 'code':
					// <pre> 内的 <code> 由 buildCodeFigure 拆掉，不当作行内代码
					if (parent.tagName === 'pre')
						return undefined
					return buildInlineCode(node)
				case 'a':
					return buildLink(node)
				case 'p':
					addClass(node, 'prose-paragraph')
					// 引用按钮依赖评论组件（#twikoo）运行时才出现，
					// 无法在构建期判定，故统一输出标记，由客户端脚本决定显隐。
					//
					// ⚠️ 图标名：`tabler:message-circle-quote` 在 `@iconify-json/tabler`
					// 里**不存在**（Iconify API 直接 404），别照任何旧文档用它；
					// 这里取同一家族里真实存在、最接近意图（对话气泡）的那个：
					// `tabler:message-circle-2`。字形只允许一处来源：构建期出内联 SVG，
					// 客户端兜底直接克隆这颗按钮的图标（prose-enhance.ts 的
					// fallbackQuoteIcon），不要在客户端脚本另写图标名——两条路各画
					// 各的，产物里会同时出现两种字形。
					node.children = [
						...(node.children ?? []),
						el(
							'button',
							{ 'type': 'button', 'class': 'paragraph-quote-btn', 'aria-label': '引用整段到评论区', 'data-paragraph-quote': '', 'hidden': true },
							[iconElement('tabler:message-circle-2')],
						),
					]
					return undefined
				case 'table':
					return buildTable(node)
				default:
					// 标题锚点留到客户端：Astro 的 heading id 由它自己的 rehype 阶段
					// 生成，在本插件**之后**才写入——构建期有大量标题在运行时还没有
					// id，构建期包锚点会漏掉它们。见 src/lib/prose-enhance.ts。
					return undefined
			}
		})
	}
}
