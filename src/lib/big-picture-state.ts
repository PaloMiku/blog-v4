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
 * 每次换页都跑：`<html>` 是被 swap 换掉的新节点，只在 `setBigPictureState`
 * 里贴的属性会跟着没，所以贴属性这一步无条件重做。
 */
function restoreFromSession() {
	applyModeAttribute(mode)
	// 抑制闸由 `enterBigPicture` 自己把守，这里不重复判断
	if (readSessionMode(getSessionStorage()) === 'active')
		enterBigPicture('restored')
}

/** 读当前模式。名字按规格（spec §模式与布局状态），联合类型才叫 `BigPictureMode` */
export function getBigPictureState(): BigPictureMode {
	return mode
}

/**
 * 设置模式。仅在真实变化时落盘并通知。
 * 三步顺序是固定的：先让 DOM 真的变成这个模式，再写会话，最后才 emit——
 * 订阅者被叫醒时读到的根属性与会话值都已经与模式一致。
 */
export function setBigPictureState(next: BigPictureMode) {
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
	setBigPictureState('active')
}

/**
 * 退出大屏模式。`reason` 就是这个函数存在的意义：
 * 手动退出顺手抑制自动进入，非手动退出（视口/设备能力等）不碰用户的开关。
 */
export function exitBigPicture(reason: BigPictureExitReason) {
	if (reason === 'manual')
		setAutoEntrySuppressed(true)
	setBigPictureState('inactive')
	// 会话模式**无条件**再写一遍，不靠 `setBigPictureState` 顺带写：
	// 模式本来就是 inactive 时它是彻底的 no-op，而会话里可能还留着上一次进模式
	// 时写下的 `'active'`。那条陈旧记录会在抑制后来被解除时把模式凭空复活。
	writeSessionMode(getSessionStorage(), false)
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

/**
 * 写**手动退出的副作用**：本标签页内不再自动进入大屏模式（`sessionStorage`）。
 *
 * ⚠️ 它**不是**设置面板里「首次按键自动进入」那个开关。规格把两者写成两件事：
 * - 本标志：手动退出时随 `exitBigPicture('manual')` 一起写，作用域是**本标签页**，
 *   关掉标签页即结束；手动进入、恢复会话这两条路径都会看它。
 * - 设置面板的开关：用户可主动开/关、跨会话保留、落在 `localStorage`，默认开启。
 *   调用方若从面板调本函数，会把用户「我不想自动进」的意图整个抹掉。
 *
 * 因此下游只应通过 `exitBigPicture('manual')` 与 `enterBigPicture` 的抑制闸间接触碰它；
 * 设置面板的开关由 Task 5 自带存储实现，不走这里。
 */
export function setAutoEntrySuppressed(suppressed: boolean) {
	writeAutoEntrySuppressed(getSessionStorage(), suppressed)
}

/**
 * 读「本标签页不再自动进入」标记。自动进入路径先问它。
 * 与 `setAutoEntrySuppressed` 同一条标志：手动退出的副作用，不是设置面板的开关。
 */
export function isAutoEntrySuppressed(): boolean {
	return readAutoEntrySuppressed(getSessionStorage())
}

/* ══════════════════════════════════════════════════════════════════════════
   以下是 Task 5 追加的部分：动作协调器的**纯优先级层**与设置面板的持久化。

   ## 为什么纯逻辑要住在这个模块里
   Shell 的协调器写在 `.astro` 的 `<script>` 里，而 `.astro` 无法被 Node 测试导入。
   若把「B 键该关哪一层」「返回该去哪」写成那里的 DOM 遍历，这两条规格里最硬的
   验收项就只能靠浏览器手测。于是这里把两者都写成**对快照求值**的纯函数：
   入参是布局状态、模态栈、页面类型这类普通数据，`.astro` 只负责把真实 DOM
   翻译成快照、再按返回值去调用 `closeModal()` / `closeLayout()` / 导航。
   规格要求「不能仅修改根属性」在两侧都成立：优先级由纯函数裁决，执行仍然走
   现有单例的公开入口。
   ══════════════════════════════════════════════════════════════════════════ */

/** 页面声明的大屏页面类型（spec §模式与布局状态）。`'off'` = 本页停用增强 */
export type BigPicturePage = 'home' | 'archive' | 'games' | 'links' | 'reading' | 'off'

/**
 * 合法取值列表。导出成运行时数组而不只是类型：Shell 在构建期用它把页面传进来的
 * 字符串收敛回合法值（写错一个拼写就静默降级成 `'off'`，而不是把一个非法页面类型
 * 带进客户端）。写成第二份手抄的联合类型就正是 CLAUDE.md 说的「第二份真相」。
 */
export const BIG_PICTURE_PAGES: readonly BigPicturePage[] = ['home', 'archive', 'games', 'links', 'reading', 'off']

/** 增强核心页面：这些页面类型可以互相作为返回来源 */
const CORE_PAGES: readonly string[] = ['home', 'archive', 'games', 'links', 'reading']

/** 游戏栏目的站内根路径。具体游戏页的兜底返回目标 */
const GAMES_ROOT = '/games'

/**
 * B 键要关掉的层级，按规格的优先级从高到低。
 * `'page'` 是最后一层（页面级返回），不是「某一层 UI」。
 */
export type BigPictureBackLayer = 'settings' | 'modal' | 'dropdown' | 'drawer' | 'page'

/** 模态栈项的最小形状。只取键与开合状态，其余字段（props / 层级 / 回调元素）用不上 */
export interface BigPictureModalSnapshot {
	readonly key: string
	readonly status: 'open' | 'closing'
}

/**
 * B 键的输入快照。**全部是普通数据**，不引用任何 DOM 节点，
 * 所以 Node 里可以直接用字面量构造出任意层级的组合。
 */
export interface BigPictureBackSnapshot {
	/** 设置面板的形态。`'closing'` 是退场动画期间那一档，它的存在本身就是一条规则 */
	readonly settings: 'closed' | 'open' | 'closing'
	readonly modalStack: readonly BigPictureModalSnapshot[]
	/** 是否有一个打开的下拉控件（`Dropdown.astro` 的开合状态只落在 DOM 上） */
	readonly dropdownOpen: boolean
	/** 侧栏 / 右栏 / 搜索 / 灯箱抽屉是否开着 */
	readonly drawerOpen: boolean
}

/**
 * 裁决 B 键应该关闭哪一层。
 *
 * 优先级逐条对应规格那一行：设置面板 → 最上层 modal → 打开的下拉 → 抽屉 → 页面返回。
 * 「只关一层」由**早退**保证：一旦命中就不再往下看，所以弹层开着时 B 永远不会顺手
 * 把抽屉也关掉。
 *
 * ## 两个「退场中」的守卫各自站在哪一层
 * 「动画退场期间阻止再次 B 导致离页」要求退场期间吞掉 B，但守卫的位置必须**低于**
 * 它所保护的那一层的判定：
 * - 设置面板自己播退场动画，所以 `settings === 'closing'` 的守卫排在**最前**——
 *   它保护的是设置面板这一层，面板正在收起时不能让 B 穿透到下面任何一层；
 * - 模态的守卫排在设置面板**之后**：设置面板开着时 B 归设置面板管，
 *   底下那层 modal 正在淡出与否与这次 B 无关。若把它放在前面，
 *   `{settings:'open', modalStack:[{status:'closing'}]}` 会返回 `null`——
 *   用户按 B 什么都不发生，正是规格禁止的那种失效。
 * - 抽屉与下拉**没有**退场态：`closeLayout()` 是同步的、`Dropdown.astro` 的开合
 *   也直接改 `hidden`，两者都没有「正在收起」这个瞬间，因此不需要守卫，
 *   也就不存在「收起的抽屉吞掉本该给下拉的那一下 B」这种组合。
 *
 * @returns 该关的层级；`null` 表示「这一下 B 什么都不做」
 */
export function resolveBackLayer(snapshot: BigPictureBackSnapshot): BigPictureBackLayer | null {
	if (snapshot.settings === 'closing')
		return null
	// 设置面板的优先级高于 modal，与它此刻是否在播退场无关
	if (snapshot.settings === 'open')
		return 'settings'
	// 只看栈顶：叠了两层 modal 时，下面那层正在退场不该拦住对上面那层的关闭
	const top = snapshot.modalStack.at(-1)
	if (top?.status === 'closing')
		return null
	if (top)
		return 'modal'
	if (snapshot.dropdownOpen)
		return 'dropdown'
	if (snapshot.drawerOpen)
		return 'drawer'
	return 'page'
}

/**
 * 页面级返回的目标。`'source'` 会恢复焦点，`'route'` 只是换个页面，`'exit'` 退出大屏模式。
 *
 * 入参是**具名的对象类型**而不是位置参数：三个字段（页面类型、当前路径、来源）
 * 都不是必填的，且调用点全在同一处，位置参数会让「忘了传来源」变成一个静默的错值。
 */
export type PageReturnAction
	= | { readonly kind: 'source', readonly path: string, readonly key: string }
		| { readonly kind: 'route', readonly path: string }
		| { readonly kind: 'exit' }

/**
 * 来源记录的最小形状。与 `big-picture-session.ts` 的 `NavigationSource` 对齐但更宽松：
 * `key` / `page` 可缺省，缺省由本函数补空串——调用方传进来的是 `consumeNavigationSource()`
 * 的结果，它的 `key` / `page` 已经是字符串，这里只是不把它绑死成那个类型。
 */
export interface PageReturnSource {
	readonly path: string
	/**
	 * 这条记录要去的落地路径。缺省即视为「对不上」：
	 * 规格把返回的前提写成合取（「目标与当前路径匹配**且**来源属于核心页面」），
	 * 缺了目的地这一半就无法当场判定「这条记录是不是冲着我写的」。
	 */
	readonly destination?: string
	readonly key?: string
	readonly page?: string
}

/**
 * 去尾斜杠再比较。
 * 与 `big-picture-session.ts` 里那份同名私有函数**同规则不同实现**：那份不在导出面上，
 * 而这里是纯函数、不能为了共用一条规则把会话层拖进来。改一处必须改另一处，
 * 注释即契约。
 */
function normalizeRoute(path: string): string {
	if (path === '/')
		return '/'
	return path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * 是否是站内路径。
 * 与 `big-picture-session.ts` 的私有同名函数同规则：`//host/x` 与 `/\host/x` 都会被浏览器
 * 解析成站外地址，只看「以 `/` 开头」会把协议相对 URL 当成站内路径放回去。
 * 这里是**纵深防御**：来源记录在读端已经验过一遍，但本函数会被单独测试、
 * 也可能拿到别的调用方传来的数据，返回目标是会真的导航出去的。
 */
function isSameOriginPath(path: string): boolean {
	if (!path.startsWith('/'))
		return false
	return !path.startsWith('//') && !path.startsWith('/\\')
}

/**
 * 页面级返回该去哪。
 *
 * ## 顺序：先来源，后兜底
 * 规格：「目标与当前路径匹配且来源属于核心页面时返回来源并恢复焦点；
 * 缺少来源时，文章返回首页，具体游戏页返回上一级游戏栏目，栏目页返回首页；
 * 首页 B 退出大屏模式。」那句合取拆成三个条件，缺一不可：
 * 1. **目的地就是当前页**（`destination` 归一化后等于 `currentPath`）；
 * 2. **来源路径是站内路径**；
 * 3. **来源页属于核心页面**——来源页是 `'off'`（云盘、预览、404）时它没开过增强，
 *    拿它当返回目标会把用户送进一个没有大屏外壳的页面。
 *
 * 第 1 条最容易被省掉、后果也最直接：来源记录最长活 30 分钟，而书签直达、
 * 粘贴 URL、非 `<a>` 的脚本跳转都不会留下记录，于是一条旧记录会被**任意页面**
 * 捡走当自己的来源，B 就把用户送到一个他压根不记得去过的页面。
 * `consumeNavigationSource()` 会查同一件事，那不是冗余——这一份才是能被 Node 单测钉住的。
 *
 * ## 永远不会出现的返回值
 * `'history.back()` 在这条链路上不存在。规格把它明令禁止：直接打开的文章页
 * `history.length` 为 1，浏览器自己的后退会把用户送出站外。浏览器自己的后退按钮
 * 仍按浏览器规则工作，不受本函数影响。
 *
 * @returns 目标；`null` 表示本页不接管返回（`'off'` 页面）
 */
export function resolvePageReturn(input: {
	readonly page: BigPicturePage
	readonly currentPath: string
	readonly source: PageReturnSource | null
}): PageReturnAction | null {
	const { page, currentPath, source } = input
	// `'off'` 页面停用本页增强，返回链也不接管
	if (page === 'off')
		return null

	const here = normalizeRoute(currentPath)
	const landedHere = Boolean(
		source
		&& typeof source.destination === 'string'
		&& isSameOriginPath(source.destination)
		&& normalizeRoute(source.destination) === here,
	)
	if (source && landedHere && isSameOriginPath(source.path) && CORE_PAGES.includes(source.page ?? '')) {
		return {
			kind: 'source',
			path: source.path,
			key: typeof source.key === 'string' ? source.key : '',
		}
	}

	// 首页：没有任何「上一层」可退，B 就是退出大屏模式本身
	if (page === 'home')
		return { kind: 'exit' }

	// 具体游戏页返回上一级游戏栏目；游戏栏目自己返回首页
	if (page === 'games' && here !== GAMES_ROOT)
		return { kind: 'route', path: GAMES_ROOT }

	// 文章、归档、友链、游戏栏目统一回首页
	return { kind: 'route', path: '/' }
}

/**
 * 过程内兜底。**与 `big-picture-session.ts` 里的同名函数刻意平行而非复用**：
 * 那份的 `guarded()` 是私有的（会话键由它成对提供读/写），而设置面板的开关与
 * 焦点恢复键是跨会话的（`localStorage`），语义不同、寿命不同，合成一处会让
 * 「哪一批键属于哪个存储」变得不可推理。
 */
/**
 * 取 `localStorage`，**取不到就返回 `null`**（而不是造一个内存 storage 顶上去）。
 *
 * 与 `getSessionStorage()` 的差别是有意的：会话键（模式、抑制、来源）必须跨调用往返，
 * 所以那一层自己兜一份内存；而这里返回 `null` 后由 `guardedLocal()` 统一接管降级，
 * 少一个「内存 storage 是共享还是每次新建」的变量要推理。取属性就抛（Safari 无痕）
 * 与压根没有 `window`（SSR 求值）都走这条路。
 */
export function getBigPictureLocalStorage(): StorageLike | null {
	try {
		if (typeof window !== 'undefined' && window.localStorage)
			return window.localStorage
	}
	catch {
		// 隐私模式是「取属性就抛」，不是返回一个坏对象
	}
	return null
}

/** 某个 storage 的兜底状态。以 storage 对象为键：不同标签页/不同替身互不污染 */
interface LocalFallback {
	/** 一旦某次访问抛错就永久降级到内存，不再回头碰坏存储 */
	broken: boolean
	data: Map<string, string>
}

const localFallbacks = new WeakMap<StorageLike, LocalFallback>()

/** 压根没拿到 storage 时用的共享兜底。`broken` 直接为真：没有对象可试错 */
let missingLocalFallback: LocalFallback | null = null

/**
 * 给一个 storage 包一层「永不抛」（**包括 storage 本身为 `null`**）。
 *
 * 读：能读真存储就读真存储；已降级或抛错则读内存。
 * 写/删：成功即止（不同时写内存，避免真存储一旦恢复又被陈旧值盖回去）；抛错则标记降级并落到内存。
 *
 * 兜底状态存在模块级表里而不是每次调用新建闭包：`readAutoEntryEnabled()` 与
 * `writeAutoEntryEnabled()` 是两次独立调用，各建一份内存的话「关掉开关」写进去的值
 * 下一次读根本看不到，用户点了复选框却像没反应。
 */
function guardedLocal(storage: StorageLike | null): StorageLike {
	// `typeof storage !== 'object' || storage === null` 走共享兜底：
	// WeakMap 拿 null 当键会抛 `Invalid value used as weak map key`，
	// 而「拿不到存储」恰恰是本模块声明要扛住的情形之一
	if (typeof storage !== 'object' || storage === null) {
		missingLocalFallback ??= { broken: true, data: new Map() }
		return wrapLocal(null, missingLocalFallback)
	}
	let entry = localFallbacks.get(storage)
	if (!entry) {
		entry = { broken: false, data: new Map() }
		localFallbacks.set(storage, entry)
	}
	return wrapLocal(storage, entry)
}

function wrapLocal(storage: StorageLike | null, entry: LocalFallback): StorageLike {
	return {
		getItem(key: string): string | null {
			if (storage && !entry.broken) {
				try {
					return storage.getItem(key)
				}
				catch {
					entry.broken = true
				}
			}
			return entry.data.get(key) ?? null
		},
		setItem(key: string, value: string): void {
			if (storage && !entry.broken) {
				try {
					storage.setItem(key, value)
					return
				}
				catch {
					entry.broken = true
				}
			}
			entry.data.set(key, value)
		},
		removeItem(key: string): void {
			if (storage && !entry.broken) {
				try {
					storage.removeItem(key)
					return
				}
				catch {
					entry.broken = true
				}
			}
			entry.data.delete(key)
		},
	}
}

/** 设置面板「首次按键自动进入」开关的键。`localStorage`，跨会话保留，与抑制标记是两件事 */
export const AUTO_ENTRY_ENABLED_KEY = 'blog-big-picture:auto-entry-enabled'

/** 返回来源的焦点恢复键。一次导航往返里只该用一次 */
export const RESTORE_FOCUS_KEY = 'blog-big-picture:restore-focus'

/**
 * 读「首次按键自动进入」开关。
 *
 * 缺省为 `true`（规格：默认开启），并且只有恰好写入 `'false'` 才算关闭：
 * 与会话层同一判据——「键不存在」「值是脏数据」「存储抛错」都退回落回默认，
 * 而不是被读成「关掉了」。读成关掉的后果是用户莫名其妙再也进不去模式且没有任何提示。
 *
 * @param storage `localStorage`；取不到时传 `null`，走内存兜底
 */
export function readAutoEntryEnabled(storage: StorageLike | null): boolean {
	return guardedLocal(storage).getItem(AUTO_ENTRY_ENABLED_KEY) !== 'false'
}

/**
 * 写「首次按键自动进入」开关。
 * 存储不可用时写进内存：本次标签页内往返一致，刷新即失效——
 * 这正是规格要的降级（页面功能正常可用），而不是让开关看起来按不动。
 */
export function writeAutoEntryEnabled(storage: StorageLike | null, enabled: boolean): void {
	guardedLocal(storage).setItem(AUTO_ENTRY_ENABLED_KEY, enabled ? 'true' : 'false')
}

/**
 * 读「返回来源后要恢复焦点的条目 key」。`''` 表示没有待恢复的焦点。
 * 一次性语义由调用方在消费后写空串实现（本函数不删），与 `consumeNavigationSource`
 * 把「读走即清」和「判废」合在一起不同：这里要在**已经解析出匹配目标之后**才清，
 * 否则页面还没渲染完就清会把这趟恢复彻底丢掉。
 */
export function readRestoreFocusKey(storage: StorageLike | null): string {
	const value = guardedLocal(storage).getItem(RESTORE_FOCUS_KEY)
	return typeof value === 'string' ? value : ''
}

/** 写焦点恢复键；`key` 为空串即清除 */
export function writeRestoreFocusKey(storage: StorageLike | null, key: string): void {
	if (key)
		guardedLocal(storage).setItem(RESTORE_FOCUS_KEY, key)
	else
		guardedLocal(storage).removeItem(RESTORE_FOCUS_KEY)
}

/**
 * 设备状态。
 * 与 `gamepad.ts` 的 `GamepadDeviceStatus` **同值但分开声明**：那边是浏览器侧模块，
 * 从这里 `import type` 会让状态层与设备层互相引用（同文件不同层），
 * 而这一组取值只出现在提示文案里，值的漂移只可能是「多一个提示分支」，
 * 不会反向影响任何行为。改那边时同步这里即可。
 */
export type BigPictureDevice = 'none' | 'ready' | 'unsupported-mapping' | 'insufficient-buttons'

/** 能力面。与 `gamepad.ts` 的 `GamepadSupportStatus` 同值，理由同上 */
export type BigPictureSupport = 'supported' | 'unsupported'

/**
 * Shell 状态区要显示什么。
 *
 * 做成纯函数是因为这里有一条**规格级的硬要求**：「同一标签页不再自动进入」之后
 * 「顶部或常规控制面板仍允许手动进入」。手动退出把自动进入关掉了，而输入层的轮询门禁
 * 在抑制态下是停着的——也就是说菜单键此时按了没反应。这条路径一旦留在 `.astro` 里
 * 就只能靠手测，而它恰好是最容易被「提示文案说得通」掩盖过去的一类缺陷：
 * 文案说「按 Menu 键」，而那个键在当前状态下什么都不做。
 */
export interface BigPictureShellView {
	/** 连接提示文案。`''` 表示不显示 */
	readonly prompt: string
	/** 状态条文案。`''` 表示不显示 */
	readonly status: string
	/**
	 * 是否显示「进入大屏模式」按钮。
	 *
	 * 它是**不依赖轮询、更不依赖任何按键**的手动进入入口。未进模式时所有按键都被
	 * 输入层吞成进入意图（`onAction` 一次都不发），因此这颗按钮是「设备在 + 还没进模式」
	 * 这一格里**唯一**能进去的路——被手动退出抑制时如此，把「首次按键自动进入」关掉时
	 * 也如此（规格：「关闭自动进入只改变后续进入行为」）。
	 */
	readonly manualEntry: boolean
}

/**
 * 由「页面类型 + 能力面 + 设备状态 + 两个进入开关」算出状态区该显示什么。
 *
 * ## 一条压倒一切的规则：未进模式时，**没有任何按键是有效的**
 * `gamepad.ts` 在模式未激活时会把这一帧的全部按钮动作当作进入意图吞掉
 * （`step()` 里 `if (!isModeActive()) { latch(); onEntryIntent(...); return }`），
 * `onAction` 一次都不会被调用。因此在未进模式的任何一格里，
 * **A / B / 菜单键 / 肩键全部到不了 Shell**。
 * 这条事实直接决定了下面两件事：
 * - 未进模式时的文案不得让用户去按任何键（唯一例外是「按任意键进入」——
 *   那次按键确实会被当作进入意图，且只在允许自动进入时成立）；
 * - 未进模式时的入口只能是控制面板上那颗**不经过输入层**的按钮。
 *
 * ## 每一条文案都对应一个「这个状态下真的做得到」的动作
 * - 未抑制 + 允许自动进入 → 「按任意键进入」：第一次按键会被消耗并进入模式；
 * - 被抑制（手动退出过）→ 按键路径被门禁关掉，只剩那颗按钮；
 * - 设置关掉了自动进入 → 同样只剩那颗按钮。**这一格曾被写成「按 Menu 键打开设置」，
 *   那是假的**：菜单键在未进模式时到不了 `onAction`，面板永远打不开；
 *   规格另一句也说了「关闭自动进入只改变后续进入行为」，它不该拿走进入的力；
 * - 任何文案都只在「确实有设备」时出现：没接手柄的页面上不该出现任何一行字
 *   （普通模式的视觉必须与今天完全一致）。
 */
export function resolveShellView(input: {
	readonly page: BigPicturePage
	readonly support: BigPictureSupport
	readonly device: BigPictureDevice
	/** 模式是否已激活 */
	readonly active: boolean
	/** 本标签页已被手动退出（不再自动进入） */
	readonly suppressed: boolean
	/** 设置面板的「首次按键自动进入」 */
	readonly autoEntryEnabled: boolean
	/** 本次页面生命周期内是否真的见到过设备（用于区分「没接过」与「刚断开」） */
	readonly everConnected: boolean
}): BigPictureShellView {
	const { page, support, device, active, suppressed, autoEntryEnabled, everConnected } = input
	// `'off'` 页面停用本页增强，也就没有任何话可说
	if (page === 'off')
		return { prompt: '', status: '', manualEntry: false }

	// 浏览器能力面缺失（无 `navigator.getGamepads`、非安全上下文、策略禁止）。
	// 规格要求这一档「显示可读提示」，所以它是唯一一条与设备状态无关的文案
	if (support === 'unsupported')
		return { prompt: '', status: '当前浏览器不支持手柄增强，已保留普通浏览', manualEntry: false }

	if (device === 'unsupported-mapping')
		return { prompt: '', status: '不支持该手柄，已保留普通浏览', manualEntry: false }
	if (device === 'insufficient-buttons')
		return { prompt: '', status: '手柄按钮数量不足，暂不支持大屏模式', manualEntry: false }

	// 还没进模式：提示条讲「怎么进」，状态条讲设备
	if (!active) {
		if (device === 'ready') {
			// 只要设备在且还没进模式，入口**恒定**是那颗按钮：
			// 被抑制与「关掉了自动进入」这两格都没有任何可用的按键路径，
			// 少一颗按钮就等于把用户锁在模式外
			if (suppressed) {
				return {
					prompt: '手柄已连接，已退出大屏模式',
					status: '',
					manualEntry: true,
				}
			}
			if (!autoEntryEnabled) {
				// 菜单键在这里按了没反应（到不了 onAction），所以不提任何键
				return {
					prompt: '手柄已连接，已关闭首次按键自动进入',
					status: '',
					manualEntry: true,
				}
			}
			return {
				prompt: '手柄已连接，按任意键进入大屏模式',
				status: '',
				manualEntry: true,
			}
		}
		// 从没见到过设备就什么都不说；见到过又消失了才说「已断开」
		return { prompt: '', status: everConnected ? '手柄已断开' : '', manualEntry: false }
	}

	return { prompt: '', status: '手柄已连接', manualEntry: false }
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
