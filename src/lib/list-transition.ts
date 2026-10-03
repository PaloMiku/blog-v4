/**
 * 列表 FLIP 过渡的客户端引擎（Astro 版），对应 Nuxt 侧
 * `app/components/util/ListTransition.vue` 的 `<script setup>` 段。
 *
 * ## 为什么单独成文件
 * Vue 版靠 `watch(() => [props.items, props.state])` 拿到「内容变了」这个信号。
 * Astro 只在构建期渲染一次，没有响应式运行时，**同一份代码搬过来永远收不到信号**——
 * 这正是迁移时整块功能静默消失的原因（页面照常渲染，动画永远不触发）。
 * 所以信号来源必须换掉：这里用 `MutationObserver` 观测内容节点的 DOM 变化，
 * 由 `ListTransition.astro` 的 `<script>` 调 `initListTransition` 挂上。
 *
 * ## 「测量在更新之前」这个前提怎么保住（核心难点）
 * Vue 的顺序是「watcher 触发 → 读 rect → nextTick → DOM 已更新 → 再读 rect」。
 * 也就是说 **before 的 rect 一定早于 DOM 变更**。而 MutationObserver 的回调
 * 是在变更**之后**的微任务里触发的，此时新位置已经落到布局上了。
 * 解决办法是维护一份位置缓存，在「可能引发重排的操作之前」先量好：
 *
 *   1. `pointerdown` / `keydown` / `focusin`（捕获阶段、passive）→ 刷新缓存。
 *      任何用户触发的重排都必然先经过这三者之一，这是最稳的取样点。
 *   2. `scroll` / `resize`（passive、rAF 节流）→ 刷新缓存，
 *      否则「先滚动再点排序」会拿到过期的坐标。
 *   3. 元素自己带入场动画或尺寸变化时，公开的 `refresh()` 供页面主动调用。
 *   4. 每轮动画结束后自动刷新一次。
 *
 * 缓存里没有的 key（首次出现的条目）走「新条目」分支，即 Vue 版
 * `previous === undefined` 的同一条路径：短距离淡入。
 *
 * ## 快速连点时从动画当前位置接续
 * WAAPI 的 `fill: 'forwards'` 会让 transform 一直挂着，此时 `getBoundingClientRect()`
 * 返回的**就是动画当前帧的位置**——这正是 Vue 版注释里「快速连续排序也从动画的当前位置接续」
 * 的实现原理。因此**动画进行中再次触发时忽略缓存、直接实时重测**
 * （见下方 `running` 分支），缓存只服务于「尚未开始动画的第一次更新」。
 *
 * ## 序列化：一次用户操作只产生一次动画
 * MutationObserver 对同一批同步变更只回调一次，但 `archive.astro` 的排序脚本
 * 会在一个循环里改很多元素的 `hidden`，之后 `await` 之间还可能夹带新的变更。
 * 故所有触发统一收敛到一个 rAF 里的 `run()`；动画期间到来的变更合并为
 * 「结束后再跑一轮」，不排队、不叠加。
 *
 * ## isomprhic 安全
 * 模块顶层**不触碰** `document` / `window` / `matchMedia`，全部访问都在函数体内。
 * 原因见 `git: a4603b0^:docs/astro-phase1-findings.md` §39：本项目出过「服务端模块被 import 进
 * 客户端产物」的错，`astro build` 的 SSR 阶段会因为顶层 `document` 直接崩。
 * 因此这个模块可以被 `.astro` 的 frontmatter 无条件 import 而不出事。
 *
 * 依赖只用 Web Animations + `es-toolkit`，与 Nuxt 侧一致。
 */
import { once } from 'es-toolkit/function'

/** 条目选择器：与 Nuxt 版逐字一致，页面只需保证条目带 `data-list-key` */
const ITEM_SELECTOR = '[data-list-key]'

/** 运动阈值（px）：位移小于它的条目直接跳过，避免原地抖动 */
const MOVE_THRESHOLD = 0.5

/** 新入场条目的浮现位移，与 Nuxt 版一致 */
const ENTER_TRANSLATE = '0 8px'

/** 离屏判定：只把视口内的元素纳入 FLIP */
function visible(box: DOMRect) {
	return box.bottom > 0 && box.top < window.innerHeight
}

/** CSS 时间转为 WAAPI 使用的毫秒，兼容构建压缩前后的 s / ms。内联自 `app/utils/anim.ts` */
export function parseCssTime(value: string) {
	const time = value.trim()
	return Number.parseFloat(time) * (time.endsWith('ms') ? 1 : 1000)
}

export interface ListTransitionHandle {
	/** 手动刷新位置缓存。页面在自己改 DOM 之前调用可拿到最准的 before */
	refresh: () => void
	/** 立刻跑一轮 FLIP（内部已做 rAF 合并） */
	run: () => void
	/** 解绑观察者与监听器，并取消进行中的动画 */
	destroy: () => void
}

interface ListTransitionOptions {
	/** 覆盖条目选择器，默认 `[data-list-key]` */
	itemSelector?: string
}

/**
 * 挂载一个 FLIP 列表过渡。
 *
 * @param outer `.list-transition` 容器
 * @param inner `.list-transition-content` 内容节点（被观测的子树根）
 */
export function initListTransition(
	outer: HTMLElement,
	inner: HTMLElement,
	options: ListTransitionOptions = {},
): ListTransitionHandle {
	const itemSelector = options.itemSelector ?? ITEM_SELECTOR

	/** key → 最近一次「更新前」的位置 */
	let snapshot = new Map<string, DOMRect>()
	/** 上一轮动画的收尾函数；`once` 包装，重复调用只有第一次生效 */
	let cancel: () => void = () => {}
	/** 是否正处在动画中（决定用缓存还是实时重测） */
	let running = false
	/** 动画进行中到来的变更：合并成结束后的一轮 */
	let queued = false
	/** 一次用户操作只跑一次：rAF 句柄 */
	let frame = 0
	let destroyed = false

	const elements = () => Array.from(inner.querySelectorAll<HTMLElement>(itemSelector))

	/** 批量读取当前屏幕坐标 */
	function measure() {
		const map = new Map<string, DOMRect>()
		for (const element of elements()) {
			const key = element.dataset.listKey
			if (key !== undefined)
				map.set(key, element.getBoundingClientRect())
		}
		return map
	}

	function refresh() {
		if (!destroyed)
			snapshot = measure()
	}

	/**
	 * 偏好减少动效：与 Nuxt 侧的 `usePreferredReducedMotion() === 'reduce'` 等价。
	 * 必须每次现查——用户可以在页面打开后才改系统设置。
	 */
	function prefersReducedMotion() {
		return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
	}

	/**
	 * 文章级过渡进行中：Nuxt 版在 `<html data-article-transition>` 时整体跳过，
	 * 否则列表动画会和整页淡入叠加。判据同源，同样每次现查。
	 */
	function articleTransitioning() {
		return document.documentElement.hasAttribute('data-article-transition')
	}

	async function run() {
		frame = 0
		if (destroyed)
			return

		/*
		 * 动画进行中再次触发 → 从**当前动画位置**接续，故忽略缓存实时重测；
		 * 这也顺带满足 Vue 版的重入要求：先 cancel 掉上一轮。
		 */
		const inFlight = running
		const before = inFlight ? measure() : snapshot
		const height = outer.getBoundingClientRect().height

		cancel()
		running = false
		/*
		 * `cancel()` 触发的旧 cleanup 若看到 queued，会再排一轮。
		 * 但这一轮的需求已经被**本次** run 覆盖，清掉以免多跑一次空动画
		 * （位移全在阈值内、容器高度不变，视觉无差别，但白跑一轮 WAAPI）。
		 * 此行之后到达的变更仍会重新置位，不影响真正的连续触发。
		 */
		queued = false

		// 首次更新后打标记，让条目自带的入场动画让位给 FLIP（见组件 <style>）
		outer.setAttribute('data-list-updated', '')

		if (prefersReducedMotion() || articleTransitioning()) {
			// 立即模式：不播放动画，但内容已经是新状态，只把位置缓存刷成现状
			refresh()
			return
		}

		const animations: Animation[] = []
		let cancelled = false
		const cleanup = once(() => {
			cancelled = true
			running = false
			animations.splice(0).forEach(animation => animation.cancel())
			outer.style.height = ''
			delete outer.dataset.changing
			refresh()
			// 动画期间积压的变更在这里合并成一轮，不排队
			if (queued) {
				queued = false
				schedule()
			}
		})
		cancel = cleanup
		running = true

		outer.style.height = `${height}px`
		outer.dataset.changing = ''

		// 内容已经是新状态（DOM 变更先于本函数发生），直接量目标高度
		const target = inner.getBoundingClientRect().height
		const motion = getComputedStyle(outer)
		const timing = {
			duration: parseCssTime(motion.getPropertyValue('--motion-duration')),
			easing: motion.getPropertyValue('--motion-easing').trim(),
		}

		const after = elements().map(element => ({ element, rect: element.getBoundingClientRect() }))
		animations.push(outer.animate(
			[{ height: `${height}px` }, { height: `${target}px` }],
			{ ...timing, fill: 'forwards' },
		))

		for (const { element, rect } of after) {
			const previous = before.get(element.dataset.listKey!)
			// 离屏条目直接布局，留在原处，不参与 FLIP
			if (!visible(rect))
				continue
			if (previous && visible(previous)) {
				const x = previous.left - rect.left
				const y = previous.top - rect.top
				if (Math.abs(x) + Math.abs(y) > MOVE_THRESHOLD) {
					animations.push(element.animate(
						[{ translate: `${x}px ${y}px` }, { translate: '0 0' }],
						timing,
					))
				}
			}
			else {
				// 首次进入视口的条目：短距离淡入，避免从几屏外飞入
				animations.push(element.animate(
					[{ opacity: 0, translate: ENTER_TRANSLATE }, { opacity: 1, translate: '0 0' }],
					timing,
				))
			}
		}

		await Promise.allSettled(animations.map(animation => animation.finished))
		if (!cancelled)
			cleanup()
	}

	/** 一次用户操作收敛成一次动画：所有触发都走这里的 rAF */
	function schedule() {
		if (destroyed || frame)
			return
		frame = requestAnimationFrame(() => {
			frame = 0
			if (running) {
				// 动画中：记一笔，动画结束后再跑（见 cleanup 里的 queued）
				queued = true
				return
			}
			void run()
		})
	}

	/*
	 * 观测**内容节点**而不是外层容器：本模块自己会写 `outer.style.height` 与
	 * `outer.dataset.changing`，若观测外层就会自触发形成死循环。
	 * 只观测 inner 的子树，故这些自写不会回流到观察器。
	 */
	const observer = new MutationObserver(() => {
		refresh()
		schedule()
	})
	observer.observe(inner, { childList: true, subtree: true, attributes: true })

	// 取样点：任何用户交互都先经过这三者之一
	const onUserIntent = () => refresh()
	// 滚动 / 缩放会让缓存过期，rAF 节流避免滚动时逐帧量全表
	let scrollFrame = 0
	const onViewport = () => {
		if (scrollFrame)
			return
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = 0
			refresh()
		})
	}
	const win = window
	win.addEventListener('pointerdown', onUserIntent, { capture: true, passive: true })
	win.addEventListener('keydown', onUserIntent, { capture: true, passive: true })
	win.addEventListener('focusin', onUserIntent, { capture: true, passive: true })
	win.addEventListener('scroll', onViewport, { capture: true, passive: true })
	win.addEventListener('resize', onViewport, { passive: true })

	refresh()

	return {
		refresh,
		run: schedule,
		destroy() {
			destroyed = true
			cancel()
			observer.disconnect()
			win.removeEventListener('pointerdown', onUserIntent, { capture: true })
			win.removeEventListener('keydown', onUserIntent, { capture: true })
			win.removeEventListener('focusin', onUserIntent, { capture: true })
			win.removeEventListener('scroll', onViewport, { capture: true })
			win.removeEventListener('resize', onViewport)
			if (frame)
				cancelAnimationFrame(frame)
			if (scrollFrame)
				cancelAnimationFrame(scrollFrame)
		},
	}
}
