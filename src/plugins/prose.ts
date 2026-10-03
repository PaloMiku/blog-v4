/**
 * prose 层增强：把 Nuxt 侧 `app/components/content/Prose*.vue` 的产物补回 Astro。
 *
 * ═══ 为什么需要这个插件 ═══
 * Nuxt Content 按约定自动把 markdown 产出的 `p` / `a` / `pre` / `code` / `table` /
 * `h1..h6` 映射到 `ProseP` / `ProseA` / `ProsePre` / `ProseCode` / `ProseTable` /
 * `ProseH1..H6`。这 6 个组件此前**从未移植**，于是每个文章页都在裸奔：
 *
 *   - `pre` 少了 `<figure class="z-codeblock">` 外壳 → 没有语言标签、没有
 *     「自动换行 / 复制」按钮、没有长代码块折叠（22 个页面受影响）
 *   - `a` 少了 `z-link` 类与域名图标（40 个页面）
 *   - `p` 少了 `prose-paragraph` 类与「引用整段到评论区」按钮（61 个页面）
 *   - `table` 少了 `<figure class="md-table">` 外壳与换行切换（17 个页面）
 *   - `h1..h6` 少了 `<a href="#id">` 包裹 → `article.css` 里
 *     `&.md-tech > h2 > a::before` 一类规则全部失配
 *
 * ═══ 为什么用 rehype 而不是 MDX 组件映射 ═══
 * 这些是 markdown **生成**的元素，不是 MDX 里手写的组件名，
 * 走 `components` 表覆盖不可靠。rehype 阶段是它们唯一稳定的存在形式。
 *
 * ═══ 结构对齐 ═══
 * Nuxt 的 shiki 输出把 token 直接放进 `<pre class="shiki">`；
 * Astro 输出的是 `<pre class="astro-code"><code><span class="line">`。
 * `main.css` 里既有的 `.shiki > .line` 规则要求 `.line` 是 `pre` 的**直接子元素**，
 * 所以这里把 `<code>` 拆掉，让 DOM 结构与 Nuxt 完全一致——
 * 这样 `main.css` 那段逐字节相同的 CSS 才能原样生效。
 *
 * 本插件的 rehype 阶段跑在 Astro 内建 shiki **之后**（证据：追加的
 * `shiki scrollcheck-x` 排在 `one-dark-pro` 之后，且拆掉的 `<code>`
 * 没有被重新包回来）。
 */
import type { BundledLanguage, HighlighterCore } from 'shiki'
import type { HastNode } from '../lib/prose-icons'
import { readFileSync } from 'node:fs'
import { createHighlighter } from 'shiki'
import { appConfig } from '../lib/app-config'
import { iconElement } from '../lib/prose-icons'
import { formatBytes, getDomain, getDomainIcon, getFileIcon, getLangIcon, isExtLink, safelyDecodeUriComponent } from '../lib/shared'

/* ══════════════════════════ 极简 hast 遍历 ══════════════════════════
 * 不引入 unist-util-visit：它只是传递依赖，且这里只需要深度优先遍历。
 */

function el(tag: string, props: Record<string, unknown> = {}, children: HastNode[] = []): HastNode {
	// 图标查不到时 iconElement 返回 undefined；这里滤掉，
	// 否则 walk 里的 `child.children` 会在 undefined 上炸。
	return { type: 'element', tagName: tag, properties: props, children: children.filter(Boolean) }
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
 * MDX 运行时只认 `attributes`。`getAttr` 早就同时读了两处（它是为
 * `<code lang="js" copy={true}>` 加的），但 `classList` / `addClass` 只读
 * `properties`，于是**任何对 MDX 节点加类的操作都是无声的空操作**。
 *
 * ⚠️⚠️ 新增的属性对象**必须带 `type: 'mdxJsxAttribute'`**。
 * 第一版 push 的是裸 `{ name, value }`，结果 `icon` 属性成功被删掉
 * （那是 splice，不新建对象），而 `class="z-link"` 加了却**没出现在产物里**——
 * MDX 的 hast→estree 只认带 `type` 的属性节点，裸对象被静默丢弃。
 * 症状极有欺骗性：图标渲染了、`icon` 也清掉了，唯独类名没���，
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
 * 原样透传给 MDX 运行时，hast 那一侧什么都不做）。早先的遍历只读 `tagName`，
 * 于是正文里全部 4 处 `` `x`{lang="yy"} ``（codemod 转成的
 * `<code lang="yy">`）整条被跳过：既没有 `language-yy`，也没有复制按钮，
 * 只能靠 src/lib/prose-enhance.ts 在客户端兜。
 *
 * ## 额外认哪些名字
 *
 * `code` 与 `a` 两个，**都是 Nuxt 侧 markdown 会映射到 Prose* 的元素**
 * （`ProseCode` / `ProseA`），而这两者在 MDX 里恰好会被 codemod 转成 JSX：
 * 语料里的 `` `x`{lang="js"} `` 与 `[a](#x){icon="…"}`。
 * 早先只认 `code`，于是 MDX 的 `<a>` 整条绕过 `buildLink`，实测
 * `example.mdx:124` 那个链接缺 `z-link` 类、缺图标，
 * 且 `icon` 属性**原样漏进 DOM**（`icon` 不是合法 HTML 属性）。
 *
 * 其余 MDX 元素（Tab / div / span / img / meta-*）**仍然不认**：
 * Nuxt 那边只有 markdown **生成**的元素才映射到 Prose*，手写组件不映射。
 * 判据是「这个标签在 Nuxt 侧有没有对应的 Prose* 组件」，不是「它是不是小写」。
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
 * 三种拼法都试一遍（第一次移植就栽在这里：语言标签全显示成 text，
 * 而 `<pre data-language="bash">` 明明在输出里）。
 *
 * ⚠️ 还有第三种形态：本插件运行时，MDX 里手写的 `<code lang="js" copy={true}>`
 * 还是 `mdxJsxTextElement`，属性放在 `attributes` 数组里而不是 `properties`。
 * 早先只读 `properties`，于是行内代码的 `lang` / `copy` 一个都取不到——
 * 静态产物里是干净的 `<code lang="js">const a = 1</code>`，既没有 `language-js`，
 * 也没有复制按钮，只能靠 src/lib/prose-enhance.ts 在客户端兜。
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
 * 解析 Nuxt Content 的围栏 info string：`lang [文件名] icon=xx:yy wrap expand`。
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

	for (const line of source.split(/\r?\n/)) {
		/*
		 * 不要写成 `/^\s*(`{3,}|~{3,})(.*)$/`：两个无界量词后面再跟 `(.*)$`，
		 * 在一长串反引号上会退化成多项式回溯（eslint: regexp/no-super-linear-backtracking）。
		 * 去掉 `$` 与尾部组，剩余部分直接用 slice 取——效果完全一样，复杂度线性。
		 */
		const m = /^\s*(`{3,}|~{3,})/.exec(line)
		if (!m)
			continue
		const fence = m[1]
		const info = line.slice(m[0].length)
		if (!openChar) {
			openChar = fence[0]
			openLen = fence.length
			out.push(parseFenceInfo(info))
		}
		else if (fence[0] === openChar && fence.length >= openLen && info.trim() === '') {
			openChar = ''
			openLen = 0
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

/* ══════════════════════════ 2. 补回 Prose* 的标记 ══════════════════════════ */

/**
 * 代码块行为参数。
 *
 * ⚠️ 不要在这里写死数字：从 `app/app.config.ts` 的 `component.codeblock` 读。
 * 之前硬编码的 12 / 6 / 2 / 4 与实际配置（32 / 16 / 4 / 3）全部不符，
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
	 * 而 Nuxt Content 那边是 `text`（见 `[...slug].vue` 的 excerpt→content 链路，
	 * 以及 `ProsePre.vue` 收到的 `language`）。于是：
	 *
	 *   - 代码块图标的语言映射走错分支；
	 *   - `parseFenceInfo` 拿 `plaintext` 去配对 meta，永远配不上；
	 *   - 最直接的是**产物文本就不一样**：线上代码块图注是 `text`，
	 *     Astro 是 `plaintext`。实测 `/2024/08/docker-deploy-outline` 整页差 +26px
	 *     就来自这一批代码块（探针按文本配对时对不上，一次报出 9 对元素）。
	 *
	 * `?? 'text'` 那个兜底因此从未生效——属性一直有值，只是值不对。
	 */
	const rawLang = getAttr(pre, 'data-language')
	const lang = !rawLang || rawLang === 'plaintext' ? 'text' : rawLang
	const meta = takeMeta(metas, lang)
	const file = meta?.filename
	const blockIcon = meta?.icon ?? (file ? getFileIcon(file) : undefined) ?? getLangIcon(lang)
	const hasWrapMeta = meta?.wrap === true
	const expandable = meta?.expand === true

	/* 拆掉 Astro 的 <code> 包裹，让 .line 直接挂在 pre 下，与 Nuxt 结构一致。 */
	const code = pre.children?.find(c => c.tagName === 'code')
	if (code?.children)
		pre.children = code.children

	const source = preText(pre)
	const rows = source.split('\n').length
	const collapsible = !expandable && rows > CODEBLOCK.triggerRows
	/*
	 * Nuxt 侧计的是**围栏原文**，即闭合围栏前那个换行也算进去：
	 * Nuxt Content 把 `node.value` 交给 ProsePre，而 remark 的 mdast `code.value`
	 * 已经把闭合围栏前的换行吃掉了，于是 `props.code` = 这里读到的 `source` + '\n'
	 * （ProsePre.vue:57 还要 `props.code.trimEnd()` 才能喂给 shiki，也印证了那个换行）。
	 *
	 * 三个数字全部按 Nuxt 的口径算，实测 12 个折叠代码块里 11 个逐位相同
	 * （44/996、219/5590、33/423、86/2919 …）。剩下 1 个
	 * `2025/10/clarity-resource-list` 对不上是**内容**不同：
	 * SCSS→CSS 迁移把围栏里的 `<style lang="scss" scoped>` 改成了 `<style scoped>`，
	 * Nuxt 基线量的还是旧内容（3199 + 1 = 3200），不是这里的公式错。
	 * 顺带一提 Astro 这个值更「诚实」——它量的是真正渲染出来的字符数——
	 * 但要求是对齐 Nuxt，所以补回那个换行。
	 */
	const untrimmed = `${source}\n`

	addClass(pre, 'shiki', 'scrollcheck-x')
	/*
	 * `wrap` 类必须真的挂到 pre 上。
	 *
	 * Nuxt 侧 ProsePre.vue:96 是 `:class="[props.class, { wrap: isWrap }]"`，
	 * 内容里写 ```` ```mdc wrap ```` 时 `pre.wrap` 生效，
	 * prose.css 的 `.z-codeblock pre.wrap { white-space: pre-wrap }` 让长行折行。
	 *
	 * 这里原本只把 `hasWrapMeta` 拿去拼按钮文字（`横向滚动` / `自动换行`），
	 * **从没给 pre 加过 wrap 类**——按钮显示得对，行为却没跟上：
	 * 实测线上 `white-space: pre-wrap`、Astro 侧 `pre`，长代码行在两边表现不同。
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
		 * 类名与 Nuxt 的 SSR 产物逐字同序：`z-codeblock collapsed collapsible`
		 * （.output/public 实测）。
		 *
		 * ⚠️ `collapsed` 必须在**构建期**就写上，不能只靠客户端
		 * `prose-enhance.ts:134` 的 `initCodeCollapse()` 补。那样做的话
		 * SSR 产物是「展开」的，首屏要等 JS 跑完才折叠（闪一下全量代码），
		 * 无 JS 时永远展开——而 Nuxt 的 SSR 就是折叠的。
		 *
		 * ⚠️ 代价是 `initCodeCollapse()` 开头 `if (contains('collapsed')) continue`
		 * 会**整块跳过**，所以构建期必须把它的另外两个副作用一起做掉：
		 *   - `aria-label` 用 Nuxt 的 `展开代码块`（ProsePre.vue:103 同款三元）
		 *   - 箭头图标带 `is-collapsed`，否则 `prose.css:247` 的
		 *     `rotate(180deg)` 永远不生效，箭头方向反了。
		 * 这三处是**一个整体**，动其中一处必须同步另两处。
		 */
		figure.properties!.class = 'z-codeblock collapsed collapsible'
		figure.children!.push(
			el('button', { 'type': 'button', 'class': 'toggle-btn', 'aria-label': '展开代码块', 'data-cb-action': 'collapse' }, [
				iconElement('tabler:chevrons-up', 'toggle-icon is-collapsed'),
				/*
				 * 文案必须包一层 `<span>`。
				 *
				 * `main.css:71` 的 `button > .iconify:only-child { display: block }`
				 * 在 Nuxt 侧**逐字存在**，两边都命中；差别只在按钮的 DOM 形状：
				 *   - Nuxt：`<span class="iconify …">`（@nuxt/icon 的 Icon 渲染成 span）
				 *          + `<span>文案</span>` → **两个**元素子节点，
				 *            `:only-child` 不成立，图标保持 inline-block，与文字同一行
				 *   - 原先这里：裸 `<svg>` + 裸文本节点 → 文本节点不算元素子节点，
				 *            `:only-child` **成立** → display:block → 图标独占一行，
				 *            每个折叠块凭空多一行（实测 16.31px，一个块 +16、两个块 +33）
				 *
				 * 包成两个元素子节点后 `:only-child` 不再命中，图标回到
				 * `main.css:87` `:where(.iconify)` 的 inline-block，与 Nuxt 同高。
				 *
				 * ⚠️ 千万别把这条改成 `svg { display: block }` / `> * { display: block }`
				 * 之类的写法来「压住」`:only-child`：`main.css:87` 的 `:where()` 是
				 * **零特异性**，任何裸标签或通配选择器都能盖掉 `.iconify` 的
				 * inline-block，那只会把 16.31px 换成另一种错法（Tip.astro 那个
				 * 图标被永久清空的坑就是同一族）。
				 *
				 * 前置空格一并去掉：Vue 模板的 whitespace:condense 会吃掉 Icon 与
				 * `<span>` 之间的纯空白文本节点，Nuxt 产物里本来就没有这个空格
				 * （`<span>35 lines, …</span>`），间距由 `.toggle-icon` 的
				 * `margin-inline-end: 0.2em` 负责。
				 */
				el('span', {}, [txt(`${rows} lines, ${untrimmed.length} chars, ${formatBytes(new TextEncoder().encode(untrimmed).length)}`)]),
			]),
		)
	}

	return figure
}

function buildLink(node: HastNode): HastNode {
	const href = getAttr(node, 'href') ?? ''
	if (!href)
		return undefined
	// Nuxt 的 ProseA 对**所有**正文链接都加 z-link，含 `#锚点` 内部跳转
	// （example 页 Nuxt 30 个 / 早期实现 16 个，差的就是这批）。
	addClass(node, 'z-link')
	if (isExtLink(href))
		setAttr(node, 'target', '_blank')
	if (isExtLink(href))
		setAttr(node, 'rel', 'nofollow noopener noreferrer')
	// `v-tip` 的文案（ProseA.vue:11）：外链给域名，内链给解码后的 href。
	// 内容在构建期就算好，客户端只负责显隐——和 Nuxt 唯一的差别是
	// 浮层由 src/lib/prose-enhance.ts 用 .tippy-box 复刻，而不是 vue-tippy。
	const tip = isExtLink(href) ? getDomain(href) : safelyDecodeUriComponent(href)
	if (tip)
		setAttr(node, 'data-tip', tip)
	// `icon` 是 MDC 给 ProseA 的 prop（`[a](#x){icon="tabler:color-swatch"}`），
	// 不是合法 HTML 属性——**必须从输出里删掉**，否则它会原样出现在 DOM 上。
	// Nuxt 侧 `const icon = computed(() => props.icon ?? getDomainIcon(props.href))`：
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
 * Nuxt 侧是 `<Tooltip class="md-table" tag="figure" interactive :delay="500">`，
 * 按钮在 **tooltip 内容**里（ProseTable.vue:6-15），也就是静态 HTML 里根本没有它，
 * 首次构建期产物实测：`<figure class="md-table" data-v-tippy><table class="scrollcheck-x scroll">`。
 * 这里把浮层壳子直接产出来，类名沿用 `.tippy-box` / `.tippy-content`，
 * 让 src/styles/main.css:150 既有的 tippy 样式继续生效
 * （同 partial/Dropdown.astro、post/Comment.astro 的做法）。
 *
 * 显隐与 `:delay="500"` 全部交给 CSS 的 transition-delay，不用 JS。
 * 按钮初始是 `opacity: 0` 而不是 `display: none` / `visibility: hidden`：
 * 前者会让 Playwright 的可见性检查失败（scripts/interaction-check.mjs 直接
 * `click('[data-md-table-action]')`，没有 hover 就没有 500ms），后者也一样；
 * `opacity` 还能顺带保住键盘可达性。
 */
function buildTable(node: HastNode): HastNode {
	addClass(node, 'scrollcheck-x', 'scroll')
	// 初始 `scroll` 为真（= 横向滚动），按钮给的是反向操作「自动换行」，
	// 图标同理：scroll ? text-wrap : text-wrap-disabled（ProseTable.vue:11-12）。
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
 * 行内代码着色：对应 Nuxt ProseCode.vue:13-21 的
 * `shiki.mountInline(code, props.code, { language, transformerOptions: ['ignoreColorizedBrackets'] })`。
 *
 * ═══ 为什么走构建期而不是客户端 ═══
 * Nuxt 之所以在 `onMounted` 里跑，是因为它的 shiki 在浏览器里（@bikariya/shiki）。
 * Astro 侧的行内代码**只有 4 处**（`lang` 分别是 js / sh / yaml×2），
 * 为此把一个 shiki 高亮器塞进客户端包完全不划算；而构建期已经因为
 * `astro.config.mjs` 的 `shikiConfig` 引入过 shiki 了，只是它只处理围栏代码块。
 * 于是这里复用同一套主题（catppuccin-latte + one-dark-pro）与
 * `defaultColor: false`，token 拿到 `--shiki-light` / `--shiki-dark`，
 * 正好命中 prose.css / main.css 里既有的 `.shiki > span[style]` 规则。
 * 附带好处：Astro 侧明暗切换是纯 CSS 变量，行内代码也跟着切，
 * 而 Nuxt 那份内联 `color:` 在挂载后就定死了。
 *
 * 代价：多一个 shiki 高亮器实例（约 1~2s，只建一次），以及 `shiki`
 * 成了 astro-site 的**未声明依赖**（它只装在根 node_modules 里，靠向上查找解析）。
 */
const INLINE_THEMES = { light: 'catppuccin-latte', dark: 'one-dark-pro' }

/**
 * 高亮器按需创建、全进程复用。
 *
 * ⚠️ 这里存的是「promise」而不是结果：并发构建时多个页面会同时 await
 * 同一个 promise，谁先到谁先跑，不存在「后到的页面把前一个的结果冲掉」
 * 那类问题（插件顶部记的第二个坑是模块级**队列**被插队冲掉，性质不同）。
 * 整个站点只有 4 处行内代码，语言按需 `loadLanguage`，不做硬编码白名单。
 */
let inlineHighlighter: Promise<HighlighterCore> | undefined

function loadInlineHighlighter() {
	inlineHighlighter ??= createHighlighter({ themes: [INLINE_THEMES.light, INLINE_THEMES.dark], langs: [] })
	return inlineHighlighter
}

/** 返回 token 节点；语言不认识 / 语法炸了就返回 undefined，调用方保留原样。 */
async function highlightInline(highlighter: HighlighterCore, code: string, lang: string): Promise<HastNode[] | undefined> {
	try {
		if (!highlighter.getLoadedLanguages().includes(lang))
			await highlighter.loadLanguage(lang as BundledLanguage)
		return highlighter.codeToHast(code, {
			lang: lang as BundledLanguage,
			// 对齐 useShiki.ts:113-121 的 mountInline：structure: 'inline'
			// 产出的就是一串 <span style="--shiki-light:…;--shiki-dark:…">，
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
		// Nuxt 的 mountInline 第一步就是 `target.classList.add('shiki')`
		// （useShiki.ts:114），靠的就是这个类去接 .shiki 的双主题映射。
		addClass(node, 'shiki')
	}
}

/**
 * 行内代码：对应 Nuxt 的 ProseCode。
 *
 * Nuxt Content 把 markdown 的 `p` / `a` / `pre` / `code` / `table` 映射到
 * Prose* 组件，其中 ProseCode 额外支持 `copy` 属性（正文里写
 * `` `pnpm dev`{lang="sh" copy} ``，codemod 转成 MDX 的
 * `<code lang="sh" copy={true}>`），渲染成：
 *
 *   <code class="copyable language-sh shiki">…<span icon/><button class="copy-button"/></code>
 *
 * `shiki` / `language-*` 由上面的 highlightInlineCode 加，这里只补结构。
 * `<pre>` 里的那个 `<code>` 由 buildCodeFigure 拆掉，不走这里。
 */
function buildInlineCode(node: HastNode): HastNode {
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
 * 把「每项都只包一层 `<p>`」的列表改成紧凑列表（Nuxt Content 的行为）。
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
 * **线上 Nuxt 产出的是 `<li>…</li>`，没有 `<p>`**（2026-10-02 实测
 * `.output/public/2024/08/docker-deploy-outline/index.html` 与线上产物一致）。
 *
 * 后果有两处，都不止是排版：
 *   1. 多出来的 `<p>` 带自己的上下外边距，每个 `<li>` 都变高
 *      —— 实测该页 3 个 `<ul>` 分别高 4 / 13 / 9px，合计 **+26px**；
 *   2. `prose.ts` 会给每个 `.prose-paragraph` 插入「引用整段到评论区」按钮，
 *      于是**列表项里也冒出了引用按钮**，而 Nuxt 侧列表项里没有。
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
					// ⚠️ 图标名：Nuxt 的 ProseP.vue:52 写的是 `tabler:message-circle-quote`，
					// 但**这个图标不存在**——`@iconify-json/tabler@1.2.41` 里既没有它
					// 也没有 `message-quote`／`speech*`，Iconify API 对
					// `tabler/message-circle-quote.svg` 直接 404。也就是说 Nuxt 那颗
					// 「对话气泡」从来就没画出来过（按钮还是 `v-if` 客户端才创建的，
					// SSR 产物里连按钮都没有，见 .output/public）。
					//
					// 这里取同一家族里真实存在、最接近的那个：`tabler:message-circle-2`
					// （圆形 + 左下尾巴的对话气泡，`m3 20l1.3-3.9A9 8 0 1 1 7.7 19z`）。
					// 早先这里写的是 `tabler:quote`（一个引号号），与 Nuxt 的意图
					// 「对话气泡」对不上；又因为客户端兜底那条路写的是 Nuxt 的名字，
					// 两条路各画各的，产物里同时出现两种字形。现在字形只有一处来源：
					// 构建期出内联 SVG，客户端兜底直接克隆构建期那颗按钮的图标。
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
					// 生成，在本插件**之后**才写入（实测 63 篇里 25 个标题在本插件
					// 运行时还没有 id）。见 src/lib/prose-enhance.ts。
					return undefined
			}
		})
	}
}
