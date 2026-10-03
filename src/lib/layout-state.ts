/**
 * 站点外壳的布局状态（Astro 版），对应 Nuxt 侧的 `app/stores/layout.ts`。
 *
 * ## 为什么需要它
 * `useLayoutStore` 是 Pinia store，Nuxt 侧靠它把「左侧栏 / 右侧栏 / 搜索 / 灯箱」
 * 四个抽屉的开关状态共享给 `BlogSidebar`、`BlogAside`、`BlogPanel`、`Mask` 四个组件。
 * Astro 没有响应式运行时，但这四个组件必须在客户端保持一致状态
 * （例如 Panel 点开右侧栏 → Aside 要加 `.show` → Mask 要显示），
 * 所以这里提供一个零依赖的发布订阅单例。
 *
 * ## 为什么不用 Vue 岛
 * 这层状态只有一个枚举值，桥接成本远大于收益；且各组件的 DOM 更新都是
 * 「加/减一个 class」，几十行原生 JS 即可（见各组件的 `<script>`）。
 *
 * ## 作用域
 * 只应由 `.astro` 组件的 `<script>`（客户端）import。
 * frontmatter 是构建期代码，import 本模块会把 `document` 访问带进 SSR 阶段。
 *
 * ## 遗留取舍
 * - `avoidTargets` / `useAvoidTransform` 未移植。Nuxt 侧只有 `pages/archive.vue`
 *   和 `partial/Pagination.vue` 注册避让目标。这**不是**因为「外壳自身从不注册」
 *   （origin 是面板、注册的是目标方，原先的注释把两者搞混了），
 *   而是因为面板与这些目标**几何上永不重叠**——已用 CDP 在
 *   1600×1000 与 390×844 两个视口、四个滚动状态、七个页面上量过，
 *   `#blog-panel` 的 transform 恒为 `none`。逐条数字见 `BlogPanel.astro` 顶部注释。
 *   结论：在当前站点上省略它与线上不可区分，但这是几何巧合而非不变式。
 * - 搜索态 `'search'` 是**联动**，不是「只切状态、不打开任何 UI」。此前的注释
 *   说真正的搜索弹层要等 Phase 4，那是错的：`popover/SearchModal.astro` 已经
 *   订阅本状态，进入时调 `openModal({ key: 'search' })`、离开时调
 *   `closeModalByKey('search')`（双向，见该文件「与布局状态的双向联动」一段，
 *   `lib/modal.ts:198` 的注释也记着这条关系）。模态栈已是实装，Phase 4 剩下的
 *   是 vue-tippy 一类浮层，与这条链路无关。
 */
export type LayoutState = 'none' | 'sidebar' | 'aside' | 'search' | 'lightbox'

let state: LayoutState = 'none'
const subscribers = new Set<(state: LayoutState) => void>()

function emit() {
	// 复制一份再遍历：回调里可能会退订自己
	for (const fn of [...subscribers])
		fn(state)
}

export function setLayoutState(next: LayoutState) {
	if (next === state)
		return
	state = next
	emit()
}

/** 与 Nuxt 侧 `layoutStore.toggle` 同语义：重复点击同一个键则关闭 */
export function toggleLayout(key: LayoutState) {
	setLayoutState(state === key ? 'none' : key)
}

export function closeLayout() {
	setLayoutState('none')
}

/**
 * 订阅布局状态变化。
 * 回调会**立即以当前状态执行一次**，这样各组件不必再单独写一次初始化
 * （等价于 Vue 侧 computed 首次求值就拿到 store 初值）。
 *
 * @returns 取消订阅函数
 */
export function subscribeLayout(fn: (state: LayoutState) => void): () => void {
	subscribers.add(fn)
	fn(state)
	return () => {
		subscribers.delete(fn)
	}
}

let globalsBound = false

/**
 * 绑定全局副作用：Esc 关闭、离开页面时复位、`[data-layout-toggle]` 事件委托。
 * 幂等，多个组件各自调用也只挂一份监听。
 *
 * 事件委托放在这里（而不是各自的组件里）是有意的：
 * BlogPanel、BlogSidebar、BlogAside、Mask 是同级的兄弟组件，
 * 任何一个都可能先于其它初始化。若各自绑 `[data-layout-toggle]`，
 * 「侧栏里的搜索按钮」就会依赖 BlogPanel 是否已初始化——这种隐式顺序依赖
 * 在拆分组件或调整布局顺序时会静默失效。集中在这里就没有这个问题。
 */
export function bindLayoutGlobals() {
	if (globalsBound)
		return
	globalsBound = true

	document.addEventListener('keydown', (e) => {
		if (state !== 'none' && e.key === 'Escape') {
			e.preventDefault()
			closeLayout()
		}
	})

	document.addEventListener('click', (e) => {
		const target = e.target as Element | null
		const btn = target?.closest?.('[data-layout-toggle]')
		if (btn)
			toggleLayout(btn.getAttribute('data-layout-toggle') as LayoutState)
	})

	/*
	 * Nuxt 侧是 `router.beforeEach(close)`。静态站整页跳转由浏览器卸载完成，
	 * 状态自然复位；但若以后接入 Astro 的 ClientRouter 客户端路由，
	 * 这一行就是对应的复位时机。两种情况都安全，故保留。
	 */
	document.addEventListener('astro:before-swap', closeLayout)
}
