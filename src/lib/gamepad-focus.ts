import type { Direction } from './gamepad-input'
/**
 * 手柄大屏模式的 DOM 焦点管理器：发现可选目标、算区域、维护当前焦点与 `.gamepad-focus`。
 *
 * ## 与纯几何层的分工
 * `gamepad-navigation.ts` 只收数字矩形，本文件负责把真实 DOM 翻译成那些数字，并在选中之后
 * 调用真实 `focus()` / `scrollIntoView()`。本文件**不做任何几何排序**——一旦排序逻辑在这里
 * 也写一份，纯函数测试就钉不住它了。
 *
 * ## 页面怎么声明（Task 7 按这份契约加属性）
 * - `data-gamepad-focus`：显式声明「这个元素可以被手柄选中」。语义元素（`a[href]`、
 *   `button`、`summary`、`input`、`select`、`textarea`、`[tabindex]`）**不需要**它；
 * - `data-gamepad-region="sidebar|main|aside|footer|overlay"`：区域。**最近的祖先区域生效**
 *   （支持嵌套）。**不在任何区域里的元素不是焦点目标**——这是有意的：区域是页面声明的
 *   布局契约，不是本层推断出来的。Task 7 若漏标区域，那一块就不可达，这比默默猜一个
 *   「默认 main」更早暴露问题；
 * - `data-gamepad-initial-focus`：页面/区域的首选项；
 * - `data-list-key` / `data-gamepad-key`：列表项的稳定身份（两种拼写等价，见下）。
 *
 * ## `data-list-key` 与 `data-gamepad-key` 的别名裁定
 * 计划书的 Task 7 文本里写的是 `data-gamepad-key`，契约清单里写的是 `data-list-key`，
 * 两者指的是同一个东西。本文件**两个都读，`data-list-key` 优先**，并导出两个常量，
 * 让 Task 7 用哪个拼写都能被认。写成两套独立机制会让「同一项被两个属性标注」时行为
 * 取决于属性顺序，不可推理。
 *
 * ## key 为什么带前缀（`list:` / `href:` / `path:`）
 * key 是跨刷新认回「同一个东西」的唯一凭据，**静默认错比认不出更糟**：认错了，焦点会跳到
 * 用户根本没选过的项上，而且没有任何报错。所以两个来源的 key 分处不同命名空间，
 * `data-list-key="2026"` 与 `href="/2026"` 不可能撞成同一个 key。
 *
 * ## 可见性判定：哪些元素永远不可选
 * - `hidden` / `inert` / `aria-hidden="true"` / `disabled` 出现在**自己或任一祖先**上
 *   （走祖先是为了覆盖 `fieldset[disabled]`；`hidden` 在渲染上也是继承的）；
 * - 位于**未展开 `<details>`** 内部（该 `<details>` 的直接 `<summary>` 子元素除外——
 *   那是 UA 自己渲染出来的）；
 * - `getBoundingClientRect()` 为 0（`display: none` 的整棵子树都没有盒子）；
 * - 计算样式 `visibility` 为 `hidden`（该属性继承，所以一次读就够）；
 * - 中心点落在某个**裁剪祖先**（`overflow` 不是 `visible`）的盒子之外。最后一条是
 *   「轮播里当前不可见的卡片不得入选」的通用落法：轮播卡片本身有盒子（只是被 `transform`
 *   移出可视区），只有「相对裁剪容器」才认得出来。**刻意不做视口相交判定**——规格要求
 *   「允许视口之外但已展开的目标」，按视口过滤会把长列表的下半页全灭掉。
 *
 * ## Tab 顺序：为什么不给所有目标补 `tabindex="-1"`
 * 规格明令「不把其他全部目标改为 `tabindex="-1"`」，那会毁掉键盘用户的 Tab 顺序。
 * 因此本文件只在**目标本身不可聚焦**（裸 `<div>` 之类）被聚焦的那一刻临时补一个
 * `tabindex="-1"`，登记在 `temporaryTabIndex` 里，`destroy()` 时逐个撤掉。
 *
 * ## 模块作用域没有浏览器全局
 * `window` / `document` / `MutationObserver` / `queueMicrotask` 全部在
 * `createGamepadFocusManager()` 调用时取，模块顶层只有常量与纯函数。Node 直接 import
 * 本文件不会因为「没有 document」而炸。
 */
import type { FocusRect, FocusRegion, FocusTarget } from './gamepad-navigation'
import { chooseNextFocus, chooseRegionTarget, isFocusRegion } from './gamepad-navigation'

export type { FocusRect, FocusRegion, FocusTarget }

/** 当前焦点落在目标上的标记类。样式由 Task 6 写，本层只负责增删 */
export const GAMEPAD_FOCUS_CLASS = 'gamepad-focus'

export const FOCUS_ATTRIBUTE = 'data-gamepad-focus'
export const REGION_ATTRIBUTE = 'data-gamepad-region'
export const INITIAL_FOCUS_ATTRIBUTE = 'data-gamepad-initial-focus'
export const SCROLL_ATTRIBUTE = 'data-gamepad-scroll'

/**
 * 列表项稳定身份的两个拼写。`data-list-key` 是契约清单里的写法，`data-gamepad-key`
 * 是计划书 Task 7 文本里的写法；两者等价，`data-list-key` 优先。
 */
export const LIST_KEY_ATTRIBUTE = 'data-list-key'
export const LIST_KEY_ALIAS_ATTRIBUTE = 'data-gamepad-key'

/**
 * 可选目标的发现选择器。
 * 语义标签 + `[tabindex]` 覆盖了绝大多数原生控件，`[data-gamepad-focus]` 覆盖裸元素。
 * 不写 `:not([disabled])` 之类的过滤：过滤条件里混了祖先判定与计算样式，放在选择器里既
 * 表达不全，也会让「这个目标为什么没被选中」变得难查——统一在 `isSelectable()` 里做。
 */
export const FOCUS_SELECTOR = [
	'a[href]',
	'button',
	'summary',
	'input',
	'select',
	'textarea',
	'[tabindex]',
	`[${FOCUS_ATTRIBUTE}]`,
].join(',')

/**
 * 需要触发刷新的属性。
 * **刻意不含 `class`**：本层自己就要增删 `GAMEPAD_FOCUS_CLASS`，若观察 `class`，
 * 每移动一次焦点就会排一次刷新，形成自激循环。`tabindex` 同理——本层临时补它也是自己干的。
 */
const OBSERVED_ATTRIBUTES: readonly string[] = ['hidden', 'disabled', 'inert', 'aria-hidden', 'open']

/** 本层自己会改的属性。它们的变更不触发刷新——与上面的 `OBSERVED_ATTRIBUTES` 互为对照 */
const SELF_OWNED_ATTRIBUTES: readonly string[] = ['class', 'tabindex']

/** 天生可聚焦的标签。与选择器里的语义标签基本一致，`a[href]` / `area[href]` 另判 */
const NATIVELY_FOCUSABLE = new Set(['a', 'button', 'summary', 'input', 'select', 'textarea', 'iframe', 'area'])

/** 天生可聚焦但**还差一个属性**才算的标签 */
const NEEDS_ATTRIBUTE = new Set(['a', 'area'])

/**
 * A 键「只聚焦、不点」的文本输入类型。
 * 其余（`range`、`number`、`checkbox`、`submit`…）走原生 `click()`；
 * `range` / `select` 的值变化由 Task 5 在控件内用方向键处理。
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password'])

export interface GamepadFocusManagerOptions {
	/**
	 * 每次刷新跑完后调一次。**存在的理由是可观测**：刷新被合并到「每微任务一次」，
	 * 不给出入口就没法在测试里断言「这一批变更只刷了一次」，只能去数
	 * `getBoundingClientRect()` 的调用次数——那是在测 double，不是测行为。
	 */
	readonly onRefresh?: () => void
}

export interface GamepadFocusManager {
	/**
	 * 重新发现全部目标并对账：当前目标仍在则原地不动；已被重排/移除则按
	 * `key` → 同序号邻近项 → 区域首选项的顺序恢复。
	 * 页面重排列表后由调用方显式调一次（规格：首页/归档改完后调用）。
	 */
	refresh: () => void
	/**
	 * 定位首选项。不传区域 = 页面级：全页找 `data-gamepad-initial-focus`，找不到则在
	 * `main` 里取（`main` 也没有就退到第一个出现的区域）。传了区域却那一区没有目标时
	 * **什么都不做**，不跨区兜底。
	 */
	focusInitial: (region?: FocusRegion) => void
	/**
	 * 沿方向移动焦点。返回 `true` 表示焦点确实换了。
	 * `false` 表示该方向在本区域内没有候选——**此时保留当前焦点**，不回绕、不跨区。
	 */
	move: (direction: Direction) => boolean
	/** A 键：文本输入框聚焦，其余调原生 `click()`（沿用组件已有事件，不合成新动作） */
	activate: () => void
	/** 切到另一个区域：恢复该区域上一次仍有效的目标，否则首选项、再否则第一项 */
	setRegion: (region: FocusRegion) => void
	getCurrent: () => HTMLElement | null
	/**
	 * 销毁：断观察者、解监听、撤焦点类、撤临时 `tabindex`，
	 * 并把焦点还给进入前那个元素（它仍然可见时）。
	 */
	destroy: () => void
}

function readTrimmed(value: string | null | undefined): string | null {
	if (typeof value !== 'string')
		return null
	const trimmed = value.trim()
	return trimmed === '' ? null : trimmed
}

/** `href` → 站内路由：去尾斜杠（`/` 自身除外），保留 `?query` 与 `#hash` */
function normalizeHref(raw: string, element: Element): string {
	const base = element.ownerDocument?.baseURI
	try {
		const url = new URL(raw, base)
		const path = url.pathname.length > 1 && url.pathname.endsWith('/')
			? url.pathname.slice(0, -1)
			: url.pathname
		return `${path}${url.search}${url.hash}`
	}
	catch {
		// 解析不了（`javascript:` 之类）就用原串：宁可 key 难看，也不要因为规范化失败
		// 就把这一项排除在恢复之外
		return raw
	}
}

/**
 * 目标在 DOM 里的位置路径。`data-list-key` 与 `href` 都没有时用它兜底。
 * 路径在结构不变时稳定；结构一变（正是需要恢复的时刻）它本来就不可靠，
 * 但它保证**同一页面上两个不同元素不会拿到同一个 key**。
 */
function domPath(element: Element): string {
	const segments: string[] = []
	let node: Element | null = element
	while (node) {
		const parent: Element | null = node.parentElement
		// `children` 是 HTMLCollection，没有 indexOf；先摊成数组再数下标
		const index = parent ? Array.from(parent.children).indexOf(node) : 0
		segments.unshift(`${node.localName}[${index}]`)
		node = parent
	}
	return `path:${segments.join('/') || '/'}`
}

/**
 * 读目标的稳定 key。返回值带来源前缀，原因见文件头「key 为什么带前缀」。
 * @returns `null` 表示这个元素拿不到任何可用身份（只可能是 `<html>` 之类，不会成为目标）
 */
export function readFocusTargetKey(element: Element): string | null {
	const explicit = readTrimmed(element.getAttribute(LIST_KEY_ATTRIBUTE))
		?? readTrimmed(element.getAttribute(LIST_KEY_ALIAS_ATTRIBUTE))
	if (explicit)
		return `list:${explicit}`
	const href = readTrimmed(element.getAttribute('href'))
	if (href)
		return `href:${normalizeHref(href, element)}`
	return domPath(element)
}

function isNativeFocusable(element: Element): boolean {
	if (element.hasAttribute('tabindex'))
		return true
	if (element.hasAttribute('contenteditable'))
		return true
	if (!NATIVELY_FOCUSABLE.has(element.localName))
		return false
	// `a` / `area` 没有 href 就不是链接（`a[href]` 才是选择器里的那一档），也不可聚焦
	return NEEDS_ATTRIBUTE.has(element.localName) ? element.hasAttribute('href') : true
}

/** key 的来源命名空间（`list:` / `href:` / `path:`）。恢复时的「同序号」只在同一类目标之间比 */
function keyNamespace(key: string): string {
	const colon = key.indexOf(':')
	return colon < 0 ? key : key.slice(0, colon)
}

function rectOf(element: Element): FocusRect {
	const rect = element.getBoundingClientRect()
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** 元素自身或任一祖先上是否压着「不可见 / 不可操作」的属性 */
function blockedByAttribute(element: Element): boolean {
	for (let node: Element | null = element; node; node = node.parentElement) {
		if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.hasAttribute('disabled'))
			return true
		if (node.getAttribute('aria-hidden') === 'true')
			return true
	}
	return false
}

/**
 * 是否落在**未展开**的 `<details>` 里。
 *
 * UA 规则是「关闭的 `<details>` 只渲染它的第一个 `<summary>` 子元素」，因此从元素往上走，
 * 每遇一个未展开的 `<details>`，看当前路径上的节点是不是那个 `<details>` 的直接
 * `<summary>` 子元素；不是就说明这一整支都被 UA 收起了。
 */
function insideClosedDetails(element: Element): boolean {
	for (let node: Element | null = element; node; node = node.parentElement) {
		const parent = node.parentElement
		if (parent && parent.localName === 'details' && !parent.hasAttribute('open')) {
			if (node.localName !== 'summary')
				return true
		}
	}
	return false
}

/**
 * 计算样式里本层要读的那几项。
 * 只声明用到的字段：`getComputedStyle()` 返回的是活的 CSSStyleDeclaration，
 * 这里只当它读，用最小视图免得以后为了一个字段去扩声明。
 */
interface ComputedStyleView {
	readonly visibility: string
	readonly overflow: string
	readonly getPropertyValue?: (property: string) => string
}

/** 计算样式。取不到窗口（脱离文档的节点、裸对象夹具）时返回 `null`，判据退化为「不拦」 */
function styleOf(element: Element): ComputedStyleView | null {
	const view = element.ownerDocument?.defaultView
	if (!view || typeof view.getComputedStyle !== 'function')
		return null
	const style = view.getComputedStyle(element)
	return style ? style as unknown as ComputedStyleView : null
}

function visibilityOf(element: Element): string {
	const style = styleOf(element)
	if (!style)
		return 'visible'
	// 计算样式本身已经继承了祖先的 visibility；元素自己写 `visible` 时也会覆盖回来，
	// 这正是 CSS 的语义，这里不做二次推断
	return style.visibility || 'visible'
}

/**
 * 中心点是否还在所有裁剪祖先之内。
 * 「裁剪祖先」= 计算样式里 `overflow-x` 或 `overflow-y` 不是 `visible` 的祖先。
 *
 * 这一条**不**参与视口判定：页面滚动不是裁剪，视口之外的目标仍然合法。
 *
 * `getPropertyValue` 而不是 `style['overflow-x']`：后者在没设该属性时返回**空串**而不是
 * `undefined`，用 `??` 收不到兜底值，裁剪判定会在真实浏览器里整条静默失效。
 */
function insideClippingAncestors(element: Element, rect: FocusRect): boolean {
	const centerX = rect.x + rect.width / 2
	const centerY = rect.y + rect.height / 2
	const root = element.ownerDocument?.documentElement
	for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
		const style = styleOf(node)
		if (!style)
			continue
		const base = style.overflow || 'visible'
		const overflowX = style.getPropertyValue?.('overflow-x') || base
		const overflowY = style.getPropertyValue?.('overflow-y') || base
		const clipsX = overflowX !== 'visible'
		const clipsY = overflowY !== 'visible'
		if (!clipsX && !clipsY)
			continue
		const box = node.getBoundingClientRect()
		if (clipsX && (centerX < box.left || centerX > box.right))
			return false
		if (clipsY && (centerY < box.top || centerY > box.bottom))
			return false
	}
	return true
}

/**
 * 这个元素现在能不能被手柄选中。**不查视口**——规格允许视口之外但已展开的目标。
 */
function isSelectable(element: Element): boolean {
	if (blockedByAttribute(element))
		return false
	if (insideClosedDetails(element))
		return false
	const visibility = visibilityOf(element)
	if (visibility === 'hidden' || visibility === 'collapse')
		return false
	const rect = element.getBoundingClientRect()
	if (!(rect.width > 0) || !(rect.height > 0))
		return false
	return insideClippingAncestors(element, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
}

/** 文本输入框（`input` 的文本类、`textarea`、可编辑元素）。A 键只聚焦，不点 */
function isTextEntry(element: Element): boolean {
	if (element.localName === 'textarea')
		return true
	if (element.localName === 'input') {
		const type = (element.getAttribute('type') ?? 'text').toLowerCase()
		return TEXT_INPUT_TYPES.has(type)
	}
	return element.hasAttribute('contenteditable')
}

interface FocusEnvironment {
	readonly owner: ParentNode
	readonly document: Document | null
	readonly MutationObserver: typeof MutationObserver
	readonly queue: (callback: () => void) => void
}

function readEnvironment(root: ParentNode): FocusEnvironment | null {
	const doc = (root as Document).nodeType === 9
		? root as Document
		: (root as Element).ownerDocument ?? null
	const view = doc?.defaultView ?? null
	if (!doc || !view)
		return null
	const ObserverCtor = (view as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver
		?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver)
	const queue = typeof queueMicrotask === 'function'
		? queueMicrotask
		: (callback: () => void) => { Promise.resolve().then(callback) }
	if (!ObserverCtor || typeof view.getComputedStyle !== 'function')
		return null
	return { owner: root, document: doc, MutationObserver: ObserverCtor, queue: callback => queue(callback) }
}

/** `root` 是否包含 `node`。`root` 是 Document 时不做过滤（整篇文档就是一个范围） */
function ownerContains(root: ParentNode, node: Element): boolean {
	if (root === node || (root as Document).nodeType === 9)
		return true
	const container = root as Element
	return typeof container.contains !== 'function' ? true : container.contains(node)
}

/** 元素所属区域：最近的 `data-gamepad-region` 祖先，值必须是合法区域名 */
function resolveRegion(element: Element, owner: ParentNode): { region: FocusRegion, host: Element } | null {
	const host = element.closest(`[${REGION_ATTRIBUTE}]`)
	if (!host)
		return null
	if (!ownerContains(owner, host))
		return null
	const value = host.getAttribute(REGION_ATTRIBUTE)
	return isFocusRegion(value) ? { region: value, host } : null
}

interface CollectResult {
	readonly targets: FocusTarget[]
	readonly byKey: Map<string, HTMLElement>
	readonly byElement: Map<HTMLElement, FocusTarget>
	readonly regions: Map<FocusRegion, Element>
}

function emptyCollect(): CollectResult {
	return { targets: [], byKey: new Map(), byElement: new Map(), regions: new Map() }
}

/**
 * 创建焦点管理器。
 *
 * `root` 一般传 `document.body` 或页面容器。传给它的元素必须**真的包含**那些
 * `data-gamepad-region` 宿主：区域宿主落在 `root` 之外会被判为无效，那一片就不可达。
 *
 * **永不抛错**：取不到浏览器能力面（无 `MutationObserver` / 无 `defaultView`）时返回一个
 * 所有方法都是 no-op 的管理器，页面照常用鼠标键盘。
 */
export function createGamepadFocusManager(
	root: ParentNode,
	options: GamepadFocusManagerOptions = {},
): GamepadFocusManager {
	const env = readEnvironment(root)
	const doc = env?.document ?? null
	const focusinHost = env && typeof (env.owner as Element).addEventListener === 'function'
		? env.owner as Element
		: doc

	let targets: FocusTarget[] = []
	let elementByKey = new Map<string, HTMLElement>()
	let targetByElement = new Map<HTMLElement, FocusTarget>()
	let currentElement: HTMLElement | null = null
	let currentRegion: FocusRegion | null = null
	const lastKeyByRegion = new Map<FocusRegion, string>()
	let regionElements = new Map<FocusRegion, Element>()
	const temporaryTabIndex = new Set<HTMLElement>()
	/** 进入前的焦点。规格：退出模式时「恢复进入前仍可见的焦点」 */
	const previousActive = doc && doc.activeElement && doc.activeElement !== doc.body
		? doc.activeElement as HTMLElement
		: null

	let destroyed = false
	let refreshScheduled = false
	let childObserver: MutationObserver | null = null
	let attributeObserver: MutationObserver | null = null

	function collect(): CollectResult {
		const result = emptyCollect()
		if (!env)
			return result
		const used = new Set<string>()
		let order = 0
		for (const node of env.owner.querySelectorAll(FOCUS_SELECTOR)) {
			const element = node as HTMLElement
			const region = resolveRegion(element, env.owner)
			if (!region || !isSelectable(element))
				continue
			// 同名 key 只可能是「同一项被标了两次」或「兜底路径撞了」。追加序号保证 key
			// 唯一——key 撞了会把焦点恢复到别人身上，而且不会报任何错
			let key = readFocusTargetKey(element) ?? `path:${order}`
			if (used.has(key)) {
				let suffix = 2
				while (used.has(`${key}#${suffix}`))
					suffix++
				key = `${key}#${suffix}`
			}
			used.add(key)
			const target: FocusTarget = {
				key,
				region: region.region,
				rect: rectOf(element),
				order: order++,
				initial: element.hasAttribute(INITIAL_FOCUS_ATTRIBUTE) ? true : undefined,
			}
			result.targets.push(target)
			result.byKey.set(key, element)
			result.byElement.set(element, target)
			if (!result.regions.has(region.region))
				result.regions.set(region.region, region.host)
		}
		return result
	}

	function clearFocusClass() {
		currentElement?.classList.remove(GAMEPAD_FOCUS_CLASS)
	}

	/** 逻辑上把当前目标换成 `element`，**不**调用真实 `focus()` */
	function adopt(element: HTMLElement, target: FocusTarget) {
		if (currentElement && currentElement !== element)
			clearFocusClass()
		currentElement = element
		currentRegion = target.region
		lastKeyByRegion.set(target.region, target.key)
		element.classList.add(GAMEPAD_FOCUS_CLASS)
	}

	function dropCurrent() {
		clearFocusClass()
		currentElement = null
		currentRegion = null
	}

	/**
	 * 补 `tabindex="-1"` 让非原生可聚焦的裸元素能被 `focus()`。
	 * 只补在**即将聚焦的那一个**上，并登记以便 `destroy()` 撤销。
	 */
	function ensureFocusable(element: HTMLElement) {
		if (isNativeFocusable(element) || temporaryTabIndex.has(element))
			return
		element.setAttribute('tabindex', '-1')
		temporaryTabIndex.add(element)
	}

	/** 真实聚焦：`focus({ preventScroll: true })` 先，`scrollIntoView({ block: 'nearest' })` 后 */
	function focusTarget(target: FocusTarget): boolean {
		const element = elementByKey.get(target.key)
		if (!element || destroyed)
			return false
		adopt(element, target)
		ensureFocusable(element)
		element.focus({ preventScroll: true })
		element.scrollIntoView({ block: 'nearest' })
		return true
	}

	/**
	 * 当前目标消失后的恢复顺序：
	 * 1. **同一个 key**（元素换了但项没换——整份重渲染的常态）；
	 * 2. **同命名空间里的同序号邻近项**（那一项真的被删了）；
	 * 3. 区域首选项，再区域第一项。
	 *
	 * 第 2 条为什么限定「同命名空间」而不是整个区域：区域里除了列表项还有排序/分类按钮。
	 * 拿**区域内**下标去钳位，删掉第 2 张卡片会让焦点跳到第 3 张——前两个控件把下标顶偏了
	 * 一格，用户看到的是「焦点莫名往后跳了一项」。限定到同一类目标（`list:` 对 `list:`）之后，
	 * 下标 1 被删就落到新的下标 1，才是规格说的「旧序号对应的邻近项」。
	 *
	 * 列表整段被清空时 `nextList` 为空，落到第 3 条——也就是页面标了
	 * `data-gamepad-initial-focus` 的那个分类/排序控件。
	 */
	function pickReplacement(previousTargets: readonly FocusTarget[], previousKey: string | null, region: FocusRegion | null): FocusTarget | undefined {
		if (!region || !previousKey)
			return undefined
		const inRegion = (target: FocusTarget) => target.region === region
		const pool = targets.filter(inRegion)
		const sameKey = pool.find(target => target.key === previousKey)
		if (sameKey)
			return sameKey
		const namespace = keyNamespace(previousKey)
		const previousList = previousTargets.filter(target => inRegion(target) && keyNamespace(target.key) === namespace)
		const nextList = pool.filter(target => keyNamespace(target.key) === namespace)
		// index < 0 只可能是「上一轮它就不在这一类里」，那就不猜，退回区域首选项
		const index = previousList.findIndex(target => target.key === previousKey)
		if (index >= 0 && nextList.length > 0)
			return nextList[Math.min(index, nextList.length - 1)]
		return chooseRegionTarget(region, targets, null)
	}

	function runRefresh(notify: boolean) {
		if (destroyed || !env)
			return
		const previousTargets = targets
		const previousElement = currentElement
		const previousKey = previousElement ? (targetByElement.get(previousElement)?.key ?? null) : null
		const previousRegion = currentRegion

		const next = collect()
		targets = next.targets
		elementByKey = next.byKey
		targetByElement = next.byElement
		syncObservers(next.regions)

		if (previousElement && !targetByElement.has(previousElement)) {
			const restored = pickReplacement(previousTargets, previousKey, previousRegion)
			if (restored)
				focusTarget(restored)
			else
				dropCurrent()
		}
		if (notify)
			options.onRefresh?.()
	}

	function refresh() {
		runRefresh(true)
	}

	function scheduleRefresh() {
		if (destroyed || refreshScheduled || !env)
			return
		refreshScheduled = true
		// 每个微任务只刷一次：一次列表重排会连着产生几十条 mutation 记录，
		// 逐条重算等于把「每个目标 × 每个祖先」的几何测量放大几十倍
		env.queue(() => {
			refreshScheduled = false
			if (!destroyed)
				runRefresh(true)
		})
	}

	function onMutations(records: MutationRecord[]) {
		const relevant = records.some((record) => {
			if (record.type !== 'attributes')
				return true
			// 本层自己增删的 class / 临时 tabindex 不触发刷新，否则每移动一次焦点就自激一轮
			return !SELF_OWNED_ATTRIBUTES.includes(record.attributeName ?? '')
		})
		if (relevant)
			scheduleRefresh()
	}

	function onFocusIn(event: Event) {
		if (destroyed)
			return
		const element = event.target as HTMLElement | null
		const target = element ? targetByElement.get(element) : undefined
		// 用户点了 / Tab 到了非目标元素（含 body）：把当前目标让出去。之后方向键再动，
		// 会从首选项重新起步——**绝不会**把焦点抢回来
		if (!target || !element)
			dropCurrent()
		else
			adopt(element, target)
	}

	function syncObservers(regions: Map<FocusRegion, Element>) {
		regionElements = regions
		if (!attributeObserver)
			return
		attributeObserver.disconnect()
		for (const element of regions.values()) {
			attributeObserver.observe(element, {
				attributes: true,
				subtree: true,
				attributeFilter: [...OBSERVED_ATTRIBUTES],
			})
		}
	}

	function bind() {
		if (!env || !focusinHost)
			return
		// 节点增删：只观察 root 自己的子树。新弹层（新区域）靠这一条才能被发现
		childObserver = new env.MutationObserver(onMutations)
		childObserver.observe(env.owner, { childList: true, subtree: true })
		// 属性变化：只观察已注册区域，且只观察那五个与可见性/开关有关的属性
		attributeObserver = new env.MutationObserver(onMutations)
		syncObservers(regionElements)
		focusinHost.addEventListener('focusin', onFocusIn)
	}

	function unbind() {
		childObserver?.disconnect()
		childObserver = null
		attributeObserver?.disconnect()
		attributeObserver = null
		focusinHost?.removeEventListener('focusin', onFocusIn)
	}

	function focusInitial(region?: FocusRegion) {
		if (destroyed)
			return
		// 不传区域 = 页面级：全页先找 initial，再退到 main，再退到第一个出现的区域。
		// 传了区域就只看那一个区域，找不到则什么都不做（不跨区兜底）
		const target = chooseRegionTarget(region ?? null, targets, null)
			?? (region === undefined ? chooseRegionTarget(defaultRegion(), targets, null) : undefined)
		if (target)
			focusTarget(target)
	}

	function defaultRegion(): FocusRegion | null {
		if (targets.some(target => target.region === 'main'))
			return 'main'
		return targets[0]?.region ?? null
	}

	function move(direction: Direction): boolean {
		if (destroyed)
			return false
		if (!currentElement) {
			// 没有当前目标（首次进入、或用户刚接管到非目标元素）：退化成「定位首选项」。
			// 什么都不做的话，第一次方向键会静默失败，用户以为手柄坏了
			focusInitial()
			return currentElement !== null
		}
		const currentTarget = targetByElement.get(currentElement)
		if (!currentTarget) {
			focusInitial()
			return currentElement !== null
		}
		const next = chooseNextFocus(currentTarget, targets, direction)
		// 没有候选：保留当前焦点。不回绕、不跨区、不跳页
		if (!next)
			return false
		return focusTarget(next)
	}

	function activate() {
		const element = currentElement
		if (destroyed || !element)
			return
		if (isTextEntry(element)) {
			element.focus({ preventScroll: true })
			return
		}
		element.click()
	}

	function setRegion(region: FocusRegion) {
		if (destroyed)
			return
		const target = chooseRegionTarget(region, targets, lastKeyByRegion.get(region) ?? null)
		if (target)
			focusTarget(target)
	}

	function getCurrent(): HTMLElement | null {
		return currentElement
	}

	function destroy() {
		if (destroyed)
			return
		destroyed = true
		unbind()
		dropCurrent()
		for (const element of temporaryTabIndex)
			element.removeAttribute('tabindex')
		temporaryTabIndex.clear()
		targets = []
		elementByKey = new Map()
		targetByElement = new Map()
		regionElements = new Map()
		lastKeyByRegion.clear()
		// 退出模式把焦点还给进来之前那个元素；它已经不可见就不还（会白跳一次）
		if (previousActive && previousActive.isConnected && isSelectable(previousActive))
			previousActive.focus()
	}

	if (env) {
		bind()
		// 建库时就发现一次：否则第一次 focusin 早于任何 refresh 时，targetByElement 还是空的，
		// 用户的一次点击会被当成「接管到非目标元素」而把状态清掉
		runRefresh(false)
	}

	return { refresh, focusInitial, move, activate, setRegion, getCurrent, destroy }
}
