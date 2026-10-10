/**
 * prose 增强层的客户端行为：代码块复制/换行/折叠、表格换行切换、
 * 段落引用到评论区、行内代码复制兜底、标题锚点、链接浮层。
 * 构建期形状由 src/plugins/prose.ts 产出，本文件只管行为。
 *
 * ═══ 为什么标题锚点只能在这里做 ═══
 * Astro 的 heading id 由它自己的 rehype 阶段生成，在 `plugins/prose.ts`
 * **之后**才写入，构建期有大量标题还没有 id，所以包不出 `<a href="#id">`。
 * 这里在 DOM 就绪后补，与本项目已有的渐进增强（归档排序、下拉、Tab、模态栈）同一套路。
 *
 * 全部走**事件委托**挂在 document 上：prose 标记是构建期生成的，
 * 没有任何框架在客户端接管它们，逐个 addEventListener 会在
 * Astro 的 view-transition 导航后失效。
 */

/* ═══════════════════════ 标题锚点 ═══════════════════════ */

/**
 * 只处理 h1–h4。
 *
 * 锚点合同的深度是 4（与线上产物一致，见 engineering-inventory §4）：
 * **只把 h1–h4 包进锚点 `<a>`**，h5/h6 不包。侧栏三级导航用的正是 `h5`，
 * 一旦一并包上就会多出几十个锚点、几何门禁全红。
 *
 * 只能在客户端做：Astro 的 heading id 由它自己的 rehype 阶段生成，
 * **晚于** `plugins/prose.ts`，构建期包锚点会漏掉运行时还没有 id 的标题。
 */
const HEADINGS = 'h1[id], h2[id], h3[id], h4[id]'

function linkHeadings() {
	for (const h of document.querySelectorAll<HTMLElement>(HEADINGS)) {
		if (h.querySelector(':scope > a'))
			continue
		const id = h.id
		const anchor = document.createElement('a')
		anchor.href = `#${id}`
		anchor.className = 'heading-anchor'
		while (h.firstChild)
			anchor.appendChild(h.firstChild)
		h.appendChild(anchor)
	}
}

/* ═══════════════════════ 代码块 ═══════════════════════ */

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		return true
	}
	catch {
		// 非安全上下文（http 局域网访问）下 clipboard API 不可用，退回 execCommand。
		const ta = document.createElement('textarea')
		ta.value = text
		ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
		document.body.appendChild(ta)
		ta.select()
		let ok = false
		try {
			ok = document.execCommand('copy')
		}
		catch {
			ok = false
		}
		ta.remove()
		return ok
	}
}

/**
 * 短暂替换按钮文字，给出反馈。
 *
 * ⚠️ 必须把原有子节点存下来再还原。`textContent = …` 会**连图标一起抹掉**，
 * 而还原时写回的是当初捕获的 `textContent`（对只含 `<svg>` 的按钮就是空串）——
 * 于是「引用整段到评论区」按钮闪一次字，图标就永久没了。
 * 代码块那几个按钮只有文字节点，不受影响，但同一个函数不能对它们也成立。
 */
function flash(button: HTMLElement, text: string, ms = 1600) {
	if (button.dataset.flashing === '1')
		return
	const original = [...button.childNodes]
	button.dataset.flashing = '1'
	button.textContent = text
	window.setTimeout(() => {
		button.replaceChildren(...original)
		delete button.dataset.flashing
	}, ms)
}

function codeText(pre: HTMLElement) {
	// 用 textContent 而不是 innerText：后者会受 CSS 换行影响。
	return pre.textContent ?? ''
}

function onCodeAction(event: Event) {
	const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-cb-action]')
	if (!button)
		return
	const figure = button.closest<HTMLElement>('.z-codeblock')
	if (!figure)
		return
	const pre = figure.querySelector('pre')
	const action = button.dataset.cbAction

	if (action === 'copy' && pre) {
		void copyText(codeText(pre)).then((ok) => {
			flash(button, ok ? '已复制' : '复制失败')
		})
		return
	}

	if (action === 'wrap' && pre) {
		const wrapped = pre.classList.toggle('wrap')
		button.textContent = wrapped ? '横向滚动' : '自动换行'
		return
	}

	if (action === 'collapse') {
		const collapsed = figure.classList.toggle('collapsed')
		button.setAttribute('aria-label', collapsed ? '展开代码块' : '折叠代码块')
		button.querySelector('.toggle-icon')?.classList.toggle('is-collapsed', collapsed)
	}
}

/**
 * 超过阈值的代码块默认折叠。构建期已写好 `collapsed` 的会被开头守卫整块跳过——
 * 那是有意的（三件套约束见 plugins/prose.ts 的 collapsible 注释），这里只兜漏网。
 */
function initCodeCollapse() {
	for (const figure of document.querySelectorAll<HTMLElement>('.z-codeblock.collapsible')) {
		if (figure.classList.contains('collapsed'))
			continue
		figure.classList.add('collapsed')
		const button = figure.querySelector<HTMLElement>('[data-cb-action="collapse"]')
		button?.setAttribute('aria-label', '展开代码块')
		button?.querySelector('.toggle-icon')?.classList.add('is-collapsed')
	}
}

/**
 * 行内代码复制按钮的**兜底**。
 *
 * plugins/prose.ts 现在能在构建期认到 MDX 的 `<code lang="sh" copy={true}>`
 * （getAttr 补了 `attributes` 分支），正常情况下按钮已经在那儿了，这里直接跳过。
 * 保留它是因为构建期那条路依赖 MDX 属性被正确解析，万一某个写法没被认出来
 * （比如以后出现 `<code copy>` 裸属性以外的形态），复制按钮不至于整个消失。
 * 运行时 DOM 里它就是一个普通 <code>，补按钮即可。
 */
function initInlineCodeCopy() {
	for (const code of document.querySelectorAll<HTMLElement>('code[copy]')) {
		const lang = code.getAttribute('lang')
		if (lang)
			code.classList.add(`language-${lang}`)
		// ⚠️ 类名必须在这一步**无条件**补上，不能只在「要新建按钮」时顺手加。
		// 按钮可能已经由构建期 src/plugins/prose.ts 的 buildInlineCode 插好了，
		// 但那一侧调的是 hast 的 addClass，写的是 `properties.class`——
		// 对 MDX JSX 元素（属性在 `attributes` 数组里）**不生效**，
		// 于是「按钮在、类名不在」，运行时的守卫又因为按钮已存在而整段跳过。
		// 两边各做一半，正好谁都没补上类名。
		code.classList.add('copyable')
		if (code.querySelector(':scope > .copy-button'))
			continue
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'copy-button'
		button.setAttribute('aria-label', '复制')
		button.setAttribute('data-code-copy', '')
		button.textContent = '⧉'
		code.appendChild(button)
	}
}

function onInlineCodeCopy(event: Event) {
	const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-code-copy]')
	if (!button)
		return
	const code = button.closest('code')
	if (!code)
		return
	// 去掉按钮自身的文字，只复制用户看到的那段代码。
	const clone = code.cloneNode(true) as HTMLElement
	clone.querySelector('.copy-button')?.remove()
	clone.querySelector('.inline-code-check')?.remove()
	void copyText((clone.textContent ?? '').trim()).then((ok) => {
		flash(button, ok ? '已复制' : '复制失败')
		const icon = button.querySelector('.inline-code-icon')
		if (icon && ok) {
			icon.classList.add('is-copied')
			window.setTimeout(() => icon.classList.remove('is-copied'), 1600)
		}
	})
}

/* ═══════════════════════ 表格换行切换 ═══════════════════════ */

/**
 * 切换横向滚动 / 自动换行。
 *
 * 文案与图标都要换（两段文字 + 两个图标一起翻），
 * 所以只改 `.md-table-toggle-text`，整体 `textContent` 会被图标节点冲掉。
 * 图标的显隐由 `.md-table-toggle-box` 上的 `md-table-scroll` 交给 CSS，
 * 这里同步一下这个状态类即可。
 */
function onTableToggle(event: Event) {
	const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-md-table-action="toggle"]')
	if (!button)
		return
	const box = button.closest<HTMLElement>('.md-table-toggle-box')
	const figure = button.closest<HTMLElement>('.md-table')
	const table = figure?.querySelector('table')
	if (!table)
		return
	const nowScroll = table.classList.toggle('scroll')
	box?.classList.toggle('md-table-scroll', nowScroll)
	const label = button.querySelector<HTMLElement>('.md-table-toggle-text')
	if (label)
		label.textContent = nowScroll ? '自动换行' : '横向滚动'
}

/* ═══════════════════════ 链接浮层 ═══════════════════════ */

/**
 * 外链显示域名、内链显示解码后的 href——文案由 plugins/prose.ts 在构建期
 * 算好写进 `data-tip`，这里只做显隐。
 *
 * ⚠️ 不引入 tooltip 第三方库，浮层用 `.tippy-box` / `.tippy-content` 类名复刻
 * 以复用 main.css 既有样式。定位策略：`position: absolute` +
 * 实测偏移，而不是 fixed + 视口翻转。代价是链接贴着视口上沿时浮层会被裁掉
 * 一角——Comment.astro 的浮层也是同样的取舍。
 *
 * ═══ 为什么这 4 处浮层没有抽成共享模块（2026-10-08 复核，别再试一次）═══
 * `partial/Dropdown.astro`、`post/Comment.astro`、`content/FeedCard.astro`
 * 也都用 `.tippy-box` + `.tippy-content`，看着像同一套东西抄了 4 遍，
 * 但逐个读过之后它们的**定位坐标系、宿主元素、markup 形状全都不同**，
 * 抽 `showTip`/`hideTip` 只会得到一个四维配置对象，不是去重：
 *
 *   Dropdown   纯 CSS 定位（`position:absolute; top:100%; left:0`），**没有任何 JS 定位**；
 *              面板留在组件内，不传送到 body。
 *   Comment    JS 定位，但坐标系是 **section 局部**（`rect.bottom - sectionRect.top`），
 *              不传送到 body。
 *   FeedCard   `position: fixed` + 视口上沿翻转 + 左右夹边，且**开时传送到 body、
 *              关时搬回 wrapper**；另外它**没有 `.tippy-content` 这层壳**。
 *   本文件     运行时 `createElement` + `position:absolute` + **页面绝对坐标**
 *              （`scrollX/scrollY`）+ 挂 body + 单例重挂。
 *
 * 真正共享的只有类名与 `hidden` 开关那几行，抽象收益为负。
 * 另：这里的 `data-placement="top"` 与 `plugins/prose.ts` buildTable 里那个一样，
 * 是沿自旧实现的**死属性**——全仓库没有任何 `[data-placement]` 的 CSS 规则
 * （实测 grep 只有这两处赋值、零处消费），改它不影响渲染，故保持原样。
 */
let linkTip: HTMLElement | null = null

function ensureLinkTip() {
	if (!linkTip) {
		linkTip = document.createElement('span')
		linkTip.className = 'tippy-box z-link-tip'
		linkTip.setAttribute('data-placement', 'top')
		linkTip.hidden = true
		const content = document.createElement('span')
		content.className = 'tippy-content'
		linkTip.appendChild(content)
	}
	// 挂 body：absolute 的参照物是初始包含块，偏移量好算，也不会被
	// .z-codeblock 的 `contain: paint` 之类的祖先裁掉。
	//
	// ⚠️ 每次都确认一遍是否还挂在文档里：Astro 的 view-transition 导航会换掉
	// body 的子节点，脚本挂上去的浮层会被一起丢掉（`astro:before-swap` 时
	// 只能把它藏起来，救不回来）。这里补挂一次即可，元素本身复用。
	if (!linkTip.isConnected)
		document.body.appendChild(linkTip)
	return linkTip
}

function showLinkTip(link: HTMLElement) {
	const text = link.dataset.tip
	if (!text)
		return
	const box = ensureLinkTip()
	const content = box.firstElementChild as HTMLElement
	if (content.textContent !== text)
		content.textContent = text
	box.hidden = false
	// offsetWidth 要在 hidden 解除之后才量得到，故先置可见再定位。
	const rect = link.getBoundingClientRect()
	box.style.top = `${rect.top + window.scrollY - box.offsetHeight - 6}px`
	box.style.left = `${rect.left + window.scrollX + rect.width / 2 - box.offsetWidth / 2}px`
}

function hideLinkTip() {
	if (linkTip)
		linkTip.hidden = true
}

/** 全站事件委托：prose 标记是构建期生成的，view-transition 导航后要继续有效。 */
function onLinkPointerOver(event: Event) {
	const link = (event.target as HTMLElement | null)?.closest<HTMLElement>('a.z-link[data-tip]')
	if (link)
		showLinkTip(link)
	else
		hideLinkTip()
}

function onLinkPointerOut(event: Event) {
	const link = (event.target as HTMLElement | null)?.closest<HTMLElement>('a.z-link[data-tip]')
	// 在同一个链接内部移动（文字 ↔ 域名图标）不算离开
	const related = (event as PointerEvent).relatedTarget
	if (link && related instanceof Node && link.contains(related))
		return
	hideLinkTip()
}

/* ═══════════════════════ 段落引用到评论区 ═══════════════════════ */

/** 引用进评论区的口径：剔除按钮自身、折叠行内空白——与线上产物一致，勿改。 */
function paragraphText(paragraph: HTMLElement) {
	const clone = paragraph.cloneNode(true) as HTMLElement
	clone.querySelector('.paragraph-quote-btn')?.remove()
	return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 引用按钮缺失时的兜底形状。
 *
 * ⚠️ 这里**不许**写死图标名。手写 `<use href="#ai:<set>:<name>">` 有两个坑：
 *   1. astro-icon 的 sprite 只包含**本页渲染过**的图标（按页隔离），
 *      引用一个没在本页渲染过的名字就会画出**空白图标**，不报错；
 *   2. 客户端与构建期各写一个名字，两条路各画各的字形，产物里同时出现两种图标。
 * 改成克隆页面上已有的构建期按钮的图标子树：字形只有一个来源，
 * 结构上就不可能分叉，也不依赖 sprite。
 */
function fallbackQuoteIcon() {
	return document.querySelector<HTMLElement>('.paragraph-quote-btn')?.querySelector('svg')?.outerHTML ?? ''
}

function initParagraphQuote() {
	// 启用条件：评论区容器存在 + 桌面指针设备。
	const hasComments = Boolean(document.querySelector('#twikoo'))
	const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches
	if (!hasComments || !desktop)
		return
	for (const p of document.querySelectorAll<HTMLElement>('.prose-paragraph')) {
		/*
		 * ⚠️ 这里**不许**写「已经有按钮就 continue」防重。
		 * 按钮由构建期 `plugins/prose.ts` 写进静态 HTML，每段**本来就有一个**，
		 * 这个防重判断对每一段都为真 → `continue` 掉全部段落：
		 *   - `has-quote-button` 永远不加 → `padding-inline-end: 1.8em` 永不生效
		 *     → 正文右侧不给按钮留位，**贴着行尾的段落会少换一行**（几何门禁红）；
		 *   - `hidden` 永不摘掉 → 按钮始终 display:none，
		 *     **「引用整段到评论区」这个功能等于没有**。
		 *
		 * 防重只需要在**真的缺按钮时补一个**，不能在有按钮时跳过整段。
		 */
		p.classList.add('has-quote-button')
		const btn = p.querySelector<HTMLElement>(':scope > .paragraph-quote-btn')
		if (btn) {
			btn.removeAttribute('hidden')
			continue
		}
		// 构建期没写进来的（理论上不该发生）：按既有形状补一个，
		// 否则该段永远不会触发引用。图标直接克隆构建期那颗按钮的，
		// 全页一个图标来源（见 fallbackQuoteIcon 的注释）。
		p.insertAdjacentHTML('beforeend', `<button type="button" class="paragraph-quote-btn" aria-label="引用整段到评论区" data-paragraph-quote>${fallbackQuoteIcon()}</button>`)
		p.querySelector<HTMLElement>(':scope > .paragraph-quote-btn')?.removeAttribute('hidden')
	}
}

/**
 * 把段落引用写进 Twikoo 的输入框。以下口径是线上既有交互的合同，逐条对齐：
 *
 *   - 引用格式：`> ` + 折叠空白后的正文 + `\n\n`
 *   - 输入框按 textarea → .el-textarea__inner → contenteditable 的顺序找
 *   - 最多等 6s、每 120ms 探一次
 *   - 已有内容则空两行追加，派发 input + change 并聚焦
 *   - 先滚到 #twikoo；6s 还没出现输入框就退回剪贴板
 *
 * ⚠️ 返回值必须**如实反映**有没有插进去——绝不能在没写任何东西时闪「已插入」，
 * 按钮不许骗用户。成功时闪「已插入」，退回剪贴板时另给一句不同的提示。
 */

/** 输入框选择器：按评论编辑器各种形态的回退查找顺序，顺序不能改。 */
const COMMENT_INPUT_SELECTORS = [
	'textarea',
	'.el-textarea__inner',
	'[contenteditable="plaintext-only"]',
	'[contenteditable="true"]',
]

function getCommentInput() {
	const root = document.querySelector('#twikoo')
	if (!root)
		return null
	for (const selector of COMMENT_INPUT_SELECTORS) {
		const target = root.querySelector(selector)
		if (target instanceof HTMLTextAreaElement)
			return target
		if (target instanceof HTMLElement && target.isContentEditable)
			return target
	}
	return null
}

function setInputContent(target: HTMLTextAreaElement | HTMLElement, value: string) {
	if (target instanceof HTMLTextAreaElement)
		target.value = target.value.trim() ? `${target.value.trim()}\n\n${value.trim()}` : value
	else
		target.textContent = target.textContent?.trim() ? `${target.textContent.trim()}\n\n${value.trim()}` : value
	target.dispatchEvent(new Event('input', { bubbles: true }))
	target.dispatchEvent(new Event('change', { bubbles: true }))
	target.focus()
}

/** 等待输入框出现：最多 6s、每 120ms 探一次（慢网络下 Twikoo 加载不完是常态）。 */
async function waitCommentInput(timeout = 6000, step = 120) {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		const target = getCommentInput()
		if (target)
			return target
		await new Promise(resolve => setTimeout(resolve, step))
	}
	return null
}

async function insertQuote(text: string) {
	const normalized = text.replace(/\s+/g, ' ').trim()
	if (!normalized)
		return false
	const quoteText = `> ${normalized}\n\n`

	document.querySelector('#twikoo')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

	const input = await waitCommentInput()
	if (input) {
		setInputContent(input, quoteText)
		return true
	}

	// 输入框 6s 内没出现（Twikoo 还没加载完 / 换了个编辑器）：
	// 退回剪贴板，让用户自己粘。
	//
	// ⚠️ copyText 的结果要如实回传，好让提示能区分「插进去了」和
	// 「只进了剪贴板」。两处都不谎称「已插入」。
	return copyText(quoteText)
}

function onParagraphQuote(event: Event) {
	const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-paragraph-quote]')
	if (!button)
		return
	const paragraph = button.closest<HTMLElement>('.prose-paragraph')
	if (!paragraph)
		return
	const text = paragraphText(paragraph)
	if (!text)
		return

	const twikoo = (window as unknown as { Twikoo?: unknown }).Twikoo
	if (!twikoo) {
		flash(button, '评论未就绪', 1200)
		return
	}
	// Twikoo 全局对象只是「评论区已加载」的信号，插入走的是它的 DOM
	// （查 #twikoo 里的输入框，不调 Twikoo 方法）。
	void insertQuote(text).then((inserted) => {
		// 只有真的写进输入框才说「已插入」；退回剪贴板要说另一句，否则等于骗人。
		// 「已复制」沿用代码块复制按钮的既有说法，不新造词。
		flash(button, inserted ? '已插入' : '已复制', 1200)
	})
}

/* ═══════════════════════ 装配 ═══════════════════════ */

let wired = false

function init() {
	linkHeadings()
	initCodeCollapse()
	initParagraphQuote()
	initInlineCodeCopy()
}

export function initProseEnhance() {
	init()
	if (wired)
		return
	wired = true
	document.addEventListener('click', onCodeAction)
	document.addEventListener('click', onInlineCodeCopy)
	document.addEventListener('click', onTableToggle)
	document.addEventListener('click', onParagraphQuote)
	document.addEventListener('pointerover', onLinkPointerOver)
	document.addEventListener('pointerout', onLinkPointerOut)
	// tippy 不会追着滚动走，这里直接收起；同理切页前也别留着上一页的浮层。
	document.addEventListener('scroll', hideLinkTip, { passive: true, capture: true })
	document.addEventListener('astro:before-swap', hideLinkTip)
	// Astro 的客户端导航（view transition）不会整页重载，重新跑一遍。
	document.addEventListener('astro:page-load', init)
}

if (document.readyState === 'loading')
	document.addEventListener('DOMContentLoaded', initProseEnhance)
else
	initProseEnhance()
