/**
 * 模态栈（Astro 版），对应 Nuxt 侧的 `@bikariya/modals`。
 *
 * ## 为什么不能照搬 `modalStore.use(() => h(Component, props), opts)`
 * Nuxt 侧栈里存的是**组件工厂**，`BikariyaModals` 再用 `<component :is>` 运行时
 * 渲染成 vnode。Astro 是构建期渲染，页面里没有「运行时把另一个组件塞进 DOM」的
 * 能力（没有组件工厂，也没有 Teleport）。所以这里的栈存的是**数据 + key**：
 * `openModal({ key, props })` 广播一个 `modal:open` 事件，由 `ModalHost.astro`
 * 在构建期把每种弹窗都静态渲染好、运行期只切显隐并灌 props。
 * 换句话说：**弹窗内容是构建期决定的，运行期只决定「哪一个开着、带什么参数」**。
 *
 * ## 与 Nuxt 侧的逐条对应
 * | Nuxt | 这里 |
 * | --- | --- |
 * | `modalStore.modals` 数组 | 模块级 `stack` |
 * | `zIndex = (last?.zIndex ?? 510) + 2` | 同 |
 * | 遮罩在 `zIndex - 1`、点击关闭 | `ModalHost` 按同规则渲染 `.modal-scrim` |
 * | `close()` 先 `status='closing'`，`await promiseTimeout(duration)` 再出栈 | 同 |
 * | `onVnodeMounted` 把状态置 `open` | 入栈即 `open`（Astro 无 vnode 挂载时机） |
 * | `unique: true` 已入栈则直接 return | 同 key 不重复入栈 |
 *
 * `unique` 分支比 Nuxt 多做一件事：已在栈里时**重新广播** `modal:open`。
 * Nuxt 是直接 return（此时组件不会重新聚焦），但本站的搜索框要求
 * 「重复点击应聚焦而非叠开」——`stores/search.ts` 用 `unique: true` 正是为此，
 * 所以这里把「已在栈里」也当作一次聚焦信号。
 *
 * ## 与 layout-state 的关系
 * 两者是**并列**的单例，不是主从：模态栈不知道自己为什么被打开。
 * 「侧栏搜索按钮 ↔ 搜索弹窗」这条联动由 `SearchModal.astro` 订阅
 * `subscribeLayout()` 完成，与 `stores/search.ts` 里的 `watch` 位置对等。
 *
 * ## 作用域
 * 只应由 `.astro` 组件的 `<script>`（客户端）import，
 * 与 `layout-state.ts` 同理：模块顶层不碰 `document`，只在函数体内访问。
 */

/** 弹窗的开关状态。`closing` 期间弹窗仍在 DOM 里，播退场动画 */
export type ModalStatus = 'open' | 'closing'

/** 栈里的一项。`props` 是打开方传进来的数据，由对应弹窗组件消费 */
export interface ModalEntry<P = Record<string, unknown>> {
	/** 栈内唯一 id，`closeModal()` 用它定位 */
	id: string
	/** 弹窗种类，`ModalHost` 与各弹窗组件据此对应 */
	key: string
	props: P
	/** 退场动画时长（ms），同时写进根元素的 `--modal-duration` 供 CSS 使用 */
	duration: number
	status: ModalStatus
	/** 入栈时算定的层级，弹出期间不再变动（与 Nuxt 侧一致） */
	zIndex: number
	/** 打开前的焦点元素，关闭后归还；元素已被卸载时跳过 */
	returnFocus: HTMLElement | null
}

export interface ModalOpenOptions<P> {
	/** 弹窗种类 */
	key: string
	/** 传给弹窗组件的数据 */
	props?: P
	/** 同一 key 同时只开一个 */
	unique?: boolean
	/** 退场动画时长（ms） */
	duration?: number
}

/**
 * `ModalHost.astro` 需要为每种弹窗预渲染一块遮罩，
 * 所以「有哪几种弹窗」是一份共享常量，宿主与组件都从这里取，避免两处写错。
 */
export const MODAL_KEYS = ['search', 'lightbox'] as const

export type ModalKey = typeof MODAL_KEYS[number]

/** 与 `BikariyaModals` 一致的起始层级；遮罩占 z-1，故每层 +2 */
const BASE_Z_INDEX = 510

/** 默认退场时长，与 `stores/search.ts` 传入的 200 对齐 */
const DEFAULT_DURATION = 200

let seq = 0
const stack: ModalEntry[] = []
const timers = new Set<number>()
const subscribers = new Set<(stack: readonly ModalEntry[]) => void>()

function emit() {
	// 复制一份再遍历：回调里可能会退订自己
	for (const fn of [...subscribers])
		fn(stack)
}

/**
 * 广播栈变化。`detail` 就是那一项，弹窗组件据此读自己的 props。
 *
 * 用 `document` 而不是 `#modal-root`：宿主只是众多订阅者之一，
 * 各弹窗组件也可以直接监听自己的 key，不必依赖宿主的初始化顺序。
 */
function dispatch(type: 'modal:open' | 'modal:close', entry: ModalEntry) {
	document.dispatchEvent(new CustomEvent(type, { detail: entry }))
}

/** 找到某个 key 在栈里最靠上（最后入栈）的一项 */
export function getModalByKey(key: string): ModalEntry | undefined {
	for (let i = stack.length - 1; i >= 0; i--) {
		if (stack[i].key === key)
			return stack[i]
	}
	return undefined
}

export function isModalOpen(key: string): boolean {
	return stack.some(e => e.key === key && e.status === 'open')
}

/** 只读快照，供调试与断言使用 */
export function getModalStack(): readonly ModalEntry[] {
	return stack
}

/**
 * 打开一个弹窗。
 *
 * @returns 栈内 id。`unique` 命中已有项时返回那一项的 id（而非新 id）
 */
export function openModal<P = Record<string, unknown>>(options: ModalOpenOptions<P>): string {
	const { key, props, unique = false, duration = DEFAULT_DURATION } = options

	if (unique) {
		const existing = getModalByKey(key)
		if (existing) {
			// 退场途中又被打开：撤销这次关闭，回到 open
			existing.status = 'open'
			existing.duration = duration
			// 未显式传 props 时沿用上一次的（与 Nuxt 侧 computed 重新求值的行为一致）
			if (props !== undefined)
				existing.props = props as ModalEntry['props']

			// 先 emit 让订阅者同步好显隐，弹窗组件才能在 modal:open 里立刻聚焦
			emit()
			dispatch('modal:open', existing)
			focusModal(existing)
			return existing.id
		}
	}

	const last = stack.at(-1)
	const entry: ModalEntry<P> = {
		id: `modal-${++seq}`,
		key,
		props: (props ?? {}) as P,
		duration,
		status: 'open',
		zIndex: (last?.zIndex ?? BASE_Z_INDEX) + 2,
		returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
	}

	stack.push(entry as ModalEntry)
	// 顺序同 unique 分支：先同步显隐，再广播事件，最后做通用聚焦。
	// 弹窗组件在 modal:open 里做的是「聚焦输入框」这类事，
	// 若事件早于显隐，元素还处于 visibility: hidden，focus() 会静默失败。
	emit()
	dispatch('modal:open', entry as ModalEntry)
	focusModal(entry as ModalEntry)
	return entry.id
}

/**
 * 关闭一个弹窗：先标记 `closing` 让 CSS 播退场动画，等 `duration` 毫秒再出栈。
 * 与 Nuxt 侧 `await promiseTimeout(duration)` 的时序一致。
 */
export function closeModal(id: string) {
	const entry = stack.find(e => e.id === id)
	if (!entry || entry.status === 'closing')
		return

	entry.status = 'closing'
	dispatch('modal:close', entry)
	emit()

	const timer = window.setTimeout(() => {
		timers.delete(timer)
		const i = stack.indexOf(entry)
		if (i === -1)
			return
		stack.splice(i, 1)
		emit()

		// 栈里还有别的弹窗就交给它保持焦点，否则把焦点还给触发元素
		const top = stack.at(-1)
		if (top)
			focusModal(top)
		else
			restoreFocus(entry)
	}, entry.duration)
	timers.add(timer)
}

/** 关闭某个 key 的所有弹窗（如布局态离开 `'search'` 时） */
export function closeModalByKey(key: string) {
	for (const entry of [...stack]) {
		if (entry.key === key)
			closeModal(entry.id)
	}
}

/** 关闭全部（播退场动画） */
export function closeAllModals() {
	for (const entry of [...stack])
		closeModal(entry.id)
}

/**
 * 立即清空栈，不播动画。
 * 整页跳转（`astro:before-swap`）时用：页面马上就没了，再等 200ms 没有意义，
 * 顺带把挂起的定时器清掉，避免旧页面卸载后仍在回调。
 */
export function resetModals() {
	if (!stack.length && !timers.size)
		return
	for (const timer of timers)
		window.clearTimeout(timer)
	timers.clear()
	stack.length = 0
	emit()
}

/**
 * 订阅模态栈。回调会**立即以当前栈执行一次**，
 * 这样各弹窗组件不必再单独写一次初始化（与 `subscribeLayout` 同语义）。
 *
 * @returns 取消订阅函数
 */
export function subscribeModals(fn: (stack: readonly ModalEntry[]) => void): () => void {
	subscribers.add(fn)
	fn(stack)
	return () => {
		subscribers.delete(fn)
	}
}

/** 把一个弹窗的 props 从触发元素的 data 属性里读出来 */
function readProps(el: Element): Record<string, string> {
	const props: Record<string, string> = {}
	for (const attr of el.attributes) {
		if (attr.name.startsWith('data-modal-prop-'))
			props[attr.name.slice('data-modal-prop-'.length)] = attr.value
	}
	return props
}

function focusModal(entry: ModalEntry) {
	// key 是开发者写死的常量，仍用 CSS.escape 兜住特殊字符
	const root = document.querySelector(`[data-modal="${CSS.escape(entry.key)}"]`)
	if (!(root instanceof HTMLElement))
		return

	const target = root.querySelector<HTMLElement>('[data-modal-autofocus]') ?? root
	target.focus({ preventScroll: true })
}

function restoreFocus(entry: ModalEntry) {
	const el = entry.returnFocus
	// 触发元素可能已经随页面卸载而消失，这时跳过（不强行 focus body）
	if (el && el.isConnected)
		el.focus({ preventScroll: true })
}

let globalsBound = false

/**
 * 绑定全局副作用：Esc 关闭最上层、`[data-modal-open]` / `[data-modal-close]`
 * 事件委托、离开页面时复位。幂等，多个组件各自调用也只挂一份监听。
 *
 * 事件委托集中在这里的理由与 `bindLayoutGlobals()` 相同：
 * 触发按钮分散在 `BlogSidebar`、灯箱触发点等互不相邻的地方，
 * 谁先初始化是不确定的；由模态层统一接管才不会产生隐式顺序依赖。
 */
export function bindModalGlobals() {
	if (globalsBound)
		return
	globalsBound = true

	document.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape')
			return
		const top = stack.at(-1)
		if (!top)
			return
		e.preventDefault()
		closeModal(top.id)
	})

	document.addEventListener('click', (e) => {
		const target = e.target as Element | null

		// 关闭按钮：优先关掉离它最近的那一项
		const closeBtn = target?.closest?.('[data-modal-close]')
		if (closeBtn) {
			const root = closeBtn.closest('[data-modal]')
			const entry = root instanceof HTMLElement ? getModalByKey(root.dataset.modal!) : undefined
			if (entry) {
				e.preventDefault()
				closeModal(entry.id)
			}
			return
		}

		const trigger = target?.closest?.('[data-modal-open]')
		if (trigger) {
			e.preventDefault()
			openModal({
				key: trigger.getAttribute('data-modal-open')!,
				props: readProps(trigger),
				unique: true,
			})
			return
		}

		/*
		 * 点遮罩关闭。等价于 `BikariyaModals` 里遮罩上的 `@click="close.value()"`。
		 * 遮罩的 z-index 是所属弹窗的 -1，所以点在弹窗内容上不会命中这里。
		 * 一个 key 可能叠了多层（unique 关闭时），统一关掉该 key 的全部。
		 */
		const scrim = target?.closest?.('[data-modal-scrim]')
		if (scrim) {
			e.preventDefault()
			closeModalByKey(scrim.getAttribute('data-modal-scrim')!)
			return
		}
	})

	/*
	 * 与 `layout-state.ts` 同一时机：静态站整页跳转由浏览器卸载完成，
	 * 栈自然消失，但先清一次可以避免退场定时器在旧文档上回调。
	 * 若以后接入 ClientRouter 客户端路由，这一行就是对应的复位点。
	 */
	document.addEventListener('astro:before-swap', resetModals)
}
