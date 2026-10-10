/**
 * 大屏模式的**持久模式**单例，与 `layout-state.ts` 的抽屉枚举并列、互不覆盖。
 *
 * ## 为什么不住进 layout-state
 * 抽屉是互斥枚举（开一个关其余），大屏模式是整页级的持久状态，寿命长一个量级：
 * 抽屉会被 Esc 关掉，模式只由「进入 / 退出」两个动作改变，手柄断开也不改它。
 * 塞进同一个枚举会出现「抽屉把模式冲掉」这种静默 bug——规格里「断开手柄保留当前
 * 布局」这一条正是被它坑出来的形态。所以这里独立成文件。
 *
 * ## 为什么模式里只有两态
 * `BigPictureMode = 'inactive' | 'active'`，设备连接与「手柄已连接」提示**不进这个
 * 联合**：它们是另一个寿命的状态（设备可以在模式开着时插拔），混进来就会出现
 * 「断开事件把模式改成某种第三态」。下游要提示就自己另记，别改这里。
 *
 * ## 纯度约束（与 `gamepad-input.ts` 同一条纪律）
 * 模块作用域不出现 `window` / `document` / `navigator`。所有浏览器全局都在函数
 * 内部取，且取不到就降级：没有 `document` 只是不贴根属性（SSR 求值安全），
 * 没有可用的 `sessionStorage` 就退回进程内内存（隐私模式 / 存储被禁用）。
 * 规格对这些情形的要求是「退回常规页面和可用的手动入口」，不是抛错。
 */
import type { BigPictureMode, StorageLike } from './big-picture-session'
import {
	readAutoEntrySuppressed,
	readSessionMode,
	writeAutoEntrySuppressed,
	writeSessionMode,
} from './big-picture-session'

/** 联合类型由会话层持有（它决定了存储里能读出什么），这里原样转出去 */
export type { BigPictureMode } from './big-picture-session'

/** 进入原因。`manual` 是规格明确保留的入口（顶部按钮 / 控制面板），抑制不挡它 */
export type BigPictureEntryReason = 'manual' | 'auto' | 'restored'

/**
 * 退出原因。两种的区别就是本函数存在的理由：
 * 只有 `manual` 写「本标签页不再自动进入」，`auto` 不写。
 * 「关闭自动进入」是设置面板里的独立开关，与「手动退出顺带抑制自动进入」是两件事，
 * 混在一起就会出现「用户退出一次就再也进不去」。
 */
export type BigPictureExitReason = 'manual' | 'auto'

let mode: BigPictureMode = 'inactive'
const subscribers = new Set<(mode: BigPictureMode) => void>()

function emit() {
	// 复制一份再遍历：回调里可能会退订自己
	for (const fn of [...subscribers])
		fn(mode)
}

/** 进程内兜底存储。窗口上取不到 `sessionStorage` 时用它 */
function createMemoryStorage(): StorageLike {
	const data = new Map<string, string>()
	return {
		getItem: key => data.get(key) ?? null,
		setItem: (key, value) => { data.set(key, value) },
		removeItem: (key) => { data.delete(key) },
	}
}

let memoryStorage: StorageLike | null = null

/**
 * 每次调用都重新取，不用模块级缓存。
 * 隐私模式是「取属性就抛」而不是「返回一个坏对象」，且测试要能替换它；
 * 缓存下来的引用会把降级路径彻底废掉。
 */
function getSessionStorage(): StorageLike {
	try {
		if (typeof window !== 'undefined' && window.sessionStorage)
			return window.sessionStorage
	}
	catch {
		// 取属性就抛（Safari 无痕 / 策略拦截）：落到下面的内存兜底
	}
	memoryStorage ??= createMemoryStorage()
	return memoryStorage
}

function getDocument(): Document | null {
	// `typeof` 而不是 try/catch：模块作用域不碰全局正是本模块的约束，
	// SSR 求值时它压根不存在，这里要的是「安静地没有」，不是异常
	return typeof document === 'undefined' ? null : document
}

/** 同步根属性。样式与焦点层都以 `:root[data-big-picture]` 为入口，所以这是模式的唯一对外投影 */
function applyModeAttribute(next: BigPictureMode) {
	const root = getDocument()?.documentElement
	if (!root?.dataset)
		return
	// 非大屏模式必须让属性**不存在**（而不是 `="inactive"`）：
	// 交互门禁断言的是「普通模式下不存在 data-big-picture」
	if (next === 'active')
		root.dataset.bigPicture = 'active'
	else
		delete root.dataset.bigPicture
}

/**
 * 从标签页会话恢复模式。
 * 每次换页都跑：`<html>` 是被 swap 换掉的新节点，只在 `setBigPictureMode`
 * 里贴的属性会跟着没，所以贴属性这一步无条件重做。
 */
function restoreFromSession() {
	applyModeAttribute(mode)
	// 抑制闸由 `enterBigPicture` 自己把守，这里不重复判断
	if (readSessionMode(getSessionStorage()) === 'active')
		enterBigPicture('restored')
}

export function getBigPictureMode(): BigPictureMode {
	return mode
}

/**
 * 设置模式。仅在真实变化时落盘并通知。
 * 三步顺序是固定的：先让 DOM 真的变成这个模式，再写会话，最后才 emit——
 * 订阅者被叫醒时读到的根属性与会话值都已经与模式一致。
 */
export function setBigPictureMode(next: BigPictureMode) {
	if (next === mode)
		return
	mode = next
	applyModeAttribute(mode)
	writeSessionMode(getSessionStorage(), mode === 'active')
	emit()
}

/**
 * 进入大屏模式。
 * 只有 `manual` 绕过抑制：规格里「同一标签页不再自动进入」针对的是首次按键与
 * 会话恢复这两条自动路径，顶部动作与常规控制面板仍然必须能手动进。
 */
export function enterBigPicture(reason: BigPictureEntryReason) {
	if (reason !== 'manual' && isAutoEntrySuppressed())
		return
	setBigPictureMode('active')
}

/**
 * 退出大屏模式。`reason` 就是这个函数存在的意义：
 * 手动退出顺手抑制自动进入，非手动退出（视口/设备能力等）不碰用户的开关。
 */
export function exitBigPicture(reason: BigPictureExitReason) {
	if (reason === 'manual')
		setAutoEntrySuppressed(true)
	setBigPictureMode('inactive')
}

/**
 * 订阅模式变化。
 * 回调会**立即以当前模式执行一次**，与 `layout-state.ts` 的 `subscribeLayout` 同约定：
 * 订阅方不必再单独写一次初始化。
 *
 * @returns 取消订阅函数
 */
export function subscribeBigPicture(fn: (mode: BigPictureMode) => void): () => void {
	subscribers.add(fn)
	fn(mode)
	return () => {
		subscribers.delete(fn)
	}
}

/** 设置「本标签页不再自动进入」。设置面板改开关时用，不经过 `exitBigPicture` */
export function setAutoEntrySuppressed(suppressed: boolean) {
	writeAutoEntrySuppressed(getSessionStorage(), suppressed)
}

/** 读抑制标记。自动进入路径先问它 */
export function isAutoEntrySuppressed(): boolean {
	return readAutoEntrySuppressed(getSessionStorage())
}

let globalsBound = false

/**
 * 绑定全局副作用：会话恢复、页面 swap、退出事件委托。幂等，多处调用只挂一份。
 *
 * 三处绑定的理由各不相同，少一处都会留下一个只在特定路由下才复现的洞：
 * - **立即恢复一次**：`astro:page-load` 只在启用 ClientRouter 之后才会发。当前站点
 *   是整页跳转，只等事件等于整页刷新时永不恢复会话模式。
 * - **before-swap**：规格明写「只销毁页面控制器，不清空模式意图」。这里把当前模式
 *   再写一遍盘，是让「意图确实还在」不依赖调用顺序——无论页面控制器在 swap 里做了什么，
 *   swap 之后会话里仍然是当前模式，抑制标记一概不动。
 * - **退出事件委托**：顶部动作区、设置面板、常规控制面板都可能先于其它初始化，
 *   集中在这里就不依赖谁先来（同 `bindLayoutGlobals` 的理由）。
 */
export function bindBigPictureGlobals() {
	// 没有 document 时连幂等标记都不打：同一次运行里若先在无 DOM 环境求值过，
	// 之后在真正的页面里调用仍要能绑上
	if (globalsBound)
		return
	const doc = getDocument()
	if (!doc)
		return
	globalsBound = true

	restoreFromSession()

	doc.addEventListener('astro:page-load', restoreFromSession)
	doc.addEventListener('astro:before-swap', () => {
		writeSessionMode(getSessionStorage(), mode === 'active')
	})
	doc.addEventListener('click', (event) => {
		const target = event.target as Element | null
		if (target?.closest?.('[data-big-picture-exit]'))
			exitBigPicture('manual')
	})
}
