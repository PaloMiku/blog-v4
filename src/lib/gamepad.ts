/**
 * 浏览器侧的手柄生命周期：把真实 `navigator.getGamepads()` 变成语义动作。
 *
 * ## 分层与职责边界
 * 纯映射（按钮号、摇杆阈值、350/120ms 节流）全在 `gamepad-input.ts`，本文件只做
 * 四件纯函数做不了的事：读设备、记住跨帧的「哪个设备在说话」、决定**要不要轮询**、
 * 以及把动作交给回调。本文件**不查 DOM、不碰 focus、不碰 history**——那是焦点层与
 * Shell 的事。规格把这条写成硬约束：输入模块只通过回调发布语义输入。
 *
 * ## 滚动像素归谁（Task 3 的裁定）
 * `scroll-up` / `scroll-down` 是**电平信号，不带像素**，而且本文件**绝不**把它换算成
 * 步长：两条路径叠加会让滚动双倍速。像素由消费方（Task 5 的 Shell）自己算——
 * `onAction` 第二个参数 `context` 带上 `axisY`（axes[3] 原始值）与 `deltaMs`，
 * 消费方调 `getScrollDelta(context.axisY, context.deltaMs)` 后 `scrollBy`。
 * 本文件只保证 `deltaMs` 是可信的帧间隔（过长会被夹到 `MAX_FRAME_DELTA_MS`，
 * 见该常量注释）。
 *
 * ## 为什么每帧重读设备、按 index 定位
 * `navigator.getGamepads()` 返回的数组**有空洞**（未连接的槽位是 `null`），
 * 而且断开后 index 会被下一个手柄复用。任何「记住 index 之后就信它」的写法，
 * 都会在热插拔瞬间把 B 手柄的按键算成 A 手柄的。规则因此是硬的：
 * 每帧重新取数组，再按 index 重新取对象，取不到就当它不存在。
 *
 * ## 为什么「第一条按键」与「按住的按键」都要门闩
 * 两条规则形状相同、目的不同，因此共用一个 `awaitingRelease` 门闩：
 * - 模式未激活时的第一次按键：只请求进入，**吞掉**，必须松开再按才执行动作
 *   （规格：防止首次 A 意外打开文章、首次 B 意外离站）；
 * - 失焦 / 页面隐藏 / 设备断开后重新可见：已经按住的按钮必须先松开才被认。
 * 两者若不设门闩，表现都是「按钮明明还按着，焦点却已经跳走了」。
 *
 * ## 轮询门禁
 * 规格：页面失焦、隐藏、离开、无可用手柄或自动进入被抑制时停止轮询；
 * 未连接时仅保留连接监听，不空跑 rAF。故 `requestAnimationFrame` 只在
 * 「已 start + 页面可用 + 有标准映射设备 +（模式已激活 或 自动进入未被抑制）」
 * 时才排期，其余情况一律**不留挂起的 rAF**（`stop()` 之后队列必须为空）。
 *
 * ## 与模式单例的关系
 * 门闩要分清「首次进入」与「已在模式中」，因此默认读 `big-picture-state.ts` 的
 * `getBigPictureState()` 与 `isAutoEntrySuppressed()`。两条都做成了可注入的缝
 * （`isModeActive` / `isAutoEntryAllowed`）：本模块仍然不 import 任何 DOM 依赖，
 * 测试也不必去动那个单例的进程内状态。**本模块不改变模式**——进入模式是 Shell
 * 在 `onEntryIntent` 里调 `enterBigPicture()` 的事。
 *
 * ## 纯度约束
 * 模块作用域不出现 `window` / `document` / `navigator` / `requestAnimationFrame`，
 * 全部在 `readEnvironment()` 内部取，取不到就返回 `null`，由 `createGamepadController`
 * 交出一个**永不启动**的控制器并把能力状态报成 `unsupported`（规格：API 不存在、
 * 非安全上下文时退回常规页面，不抛错）。
 */
import type { GamepadAction, GamepadInputState, NormalizedFrame, StandardGamepadFrame } from './gamepad-input'
import { getBigPictureState, isAutoEntrySuppressed } from './big-picture-state'
import { createInputState, isStandardGamepad, MIN_STANDARD_BUTTONS, normalizeGamepadFrame } from './gamepad-input'

/** 标准映射的 `GamepadButton.pressed`。只取按下与否，其余字段（value / touched）无关 */
interface GamepadButtonLike {
	readonly pressed?: boolean
}

/**
 * `Gamepad` 的最小结构视图。
 * 刻意只声明用到的字段：测试用字面量造设备、SSR 求值不需要 DOM 类型，
 * 也不会因为浏览器给 `Gamepad` 加字段而让这份定义过期。
 */
export interface GamepadLike {
	readonly index?: number
	readonly mapping?: string
	readonly axes?: readonly number[]
	readonly buttons?: readonly GamepadButtonLike[]
}

/** `navigator.getGamepads()` 的返回形状：稀疏数组，未连接的槽位是 `null` / `undefined` */
export type GamepadSnapshot = readonly (GamepadLike | null | undefined)[]

/**
 * 设备状态。只有 `ready` 会启用增强，其余三种都要在界面上有话可说：
 * 规格把「无标准映射」和「按钮数量不足」写成两条独立的失败路径，提示语也不同，
 * 所以这里不合并成一个 `unsupported`。
 */
export type GamepadDeviceStatus = 'none' | 'ready' | 'unsupported-mapping' | 'insufficient-buttons'

/** 环境能力。`getGamepads`、事件目标、rAF 三项缺一即为 `unsupported` */
export type GamepadSupportStatus = 'supported' | 'unsupported'

/** 控制器当前对外可见的全部状态。Shell 靠它显示「手柄已连接 / 已断开 / 不支持」 */
export interface GamepadStatus {
	readonly support: GamepadSupportStatus
	readonly device: GamepadDeviceStatus
}

/**
 * 动作发布时附带的帧上下文。
 * 存在的唯一理由是滚动像素：**本文件不算像素**，消费方需要 `axes[3]` 与帧间隔
 * 才能调 `getScrollDelta`。若只发动作名，Shell 就得自己再去读一次设备，
 * 那正好是本文件立下「不许凭记忆 index 取输入」规则要避免的事。
 */
export interface GamepadActionContext {
	/** 触发本帧的设备 index。断开后 index 会被复用，故只作诊断，不可长期持有 */
	readonly index: number
	/** 右摇杆纵轴原始值（axes[3]，负值朝上）。交给 `getScrollDelta` 用 */
	readonly axisY: number
	/** 距上一帧的毫秒数，已夹到 `[0, MAX_FRAME_DELTA_MS]` */
	readonly deltaMs: number
	/** 本帧时间戳（毫秒，单调） */
	readonly timestamp: number
}

export interface GamepadControllerOptions {
	/**
	 * 发现可用设备时调用一次。`status` 说明它是「标准映射可用」还是「连上了但不支持」。
	 * 同一连接期间设备能力变化（映射或按钮数变了）也会再报一次。
	 */
	readonly onConnection?: (status: GamepadDeviceStatus) => void
	/** 已知的设备全部消失时调用一次。**断开手柄不改变大屏模式**，模式由 Shell 决定 */
	readonly onDisconnection?: () => void
	/** 每个语义动作一次。只在模式已激活时发布 */
	readonly onAction?: (action: GamepadAction, context: GamepadActionContext) => void
	/**
	 * 模式未激活时，用户第一次按下**有效按钮**。
	 * 这次按键被消耗（不发布动作），调用方应当在这里 `enterBigPicture()`。
	 * 纯摇杆漂移、未映射按钮（按下却没有任何动作）都不触发。
	 * @param action 被消耗掉的那条动作，仅用于提示条显示
	 */
	readonly onEntryIntent?: (action: GamepadAction) => void
	/** 帧时钟。默认 `performance.now()`；测试注入 */
	readonly now?: () => number
	/** 读设备。默认 `navigator.getGamepads()`；测试注入 */
	readonly getGamepads?: () => GamepadSnapshot
	/** 模式是否已激活。默认读 `getBigPictureState()`；未激活时只发进入意图、不发动作 */
	readonly isModeActive?: () => boolean
	/**
	 * 自动进入是否被允许（规格：手动退出后本标签页不再自动进入）。
	 * 默认读 `isAutoEntrySuppressed()`；**模式尚未激活**且被抑制时不轮询——
	 * 这段时间里既进不去模式、动作也没有意义。模式一旦激活（哪怕是手动进入的）
	 * 就恢复轮询，因此抑制标记只挡自动进入，不挡已经进入的用户。
	 *
	 * ⚠️ 抑制态下循环是**停着**的：从非激活进入激活时，调用方需要再调一次 `start()`
	 * （`start()` 幂等，这正是它幂等的原因之一）。
	 */
	readonly isAutoEntryAllowed?: () => boolean
}

export interface GamepadController {
	/**
	 * 开始工作。幂等；重复调用只是重新读一次设备并重新裁决轮询。
	 * 模式从「非激活」变成「激活」时也要调一次（抑制态下循环本来是停的）。
	 */
	readonly start: () => void
	/** 停止：取消 rAF、解绑监听、作废按住的按钮。幂等，且不留下任何挂起的 rAF */
	readonly stop: () => void
	/** 重新读设备并重新裁决轮询（连接事件、可见性变化、调用方主动同步都用它） */
	readonly refresh: () => void
	/** 是否真的在轮询（即已排期下一帧）。门禁不满足时为 `false` */
	readonly isRunning: () => boolean
	/** 读当前能力与设备状态，Shell 的提示条靠它，不靠猜 */
	readonly getStatus: () => GamepadStatus
}

/** 标准映射的映射名。与 `gamepad-input.ts` 内部同值，这里只为判定「不是标准映射」 */
const STANDARD_MAPPING = 'standard'

/** 右摇杆纵轴。动作流用同一个下标，交给 `getScrollDelta` 的也必须是它 */
const RIGHT_STICK_Y_AXIS = 3

/**
 * 帧间隔上限。
 * 后台标签页被浏览器冻结后再恢复、`performance.now()` 的跨度可能有几秒；
 * 原样交给 `getScrollDelta` 会让一帧滚过好几屏（900px/s × 数秒）。夹到 250ms
 * 等于「按一帧算」，视觉上是一次正常的滚动。
 */
const MAX_FRAME_DELTA_MS = 250

/** 设备状态的优先级：多个设备在线时，报告**最能说明问题**的那一个 */
const STATUS_RANK: Readonly<Record<GamepadDeviceStatus, number>> = {
	'none': 0,
	'unsupported-mapping': 1,
	'insufficient-buttons': 2,
	'ready': 3,
}

/** 只认这几个动作来自「按钮」而不是「摇杆」，用于判定进入意图的触发源 */
const BUTTON_ACTIONS: readonly GamepadAction[] = ['confirm', 'back', 'previous-region', 'next-region', 'menu']

function isButtonAction(action: GamepadAction): boolean {
	return BUTTON_ACTIONS.includes(action)
}

/**
 * 本帧是否有**按钮**输入。
 * 用 `state.source === 'd-pad'` 判定方向键是为了不把方向键下标抄一份到本文件——
 * `normalizeGamepadFrame` 已经把「这一帧方向来自方向键还是左摇杆」算清楚了，
 * 方向键按下时它必然是 `d-pad`。抄下标就会在纯映射层加按钮时静默过期。
 */
function hasButtonInput(result: NormalizedFrame): boolean {
	if (result.state.source === 'd-pad')
		return true
	return result.actions.some(isButtonAction)
}

function readAxisValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 已经确定不可用的设备，**为什么**不可用。
 *
 * 两条失败路径在界面上必须是两句话：非标准映射的设备按钮号没有意义（提示「不支持该手柄」），
 * 而标准映射却只有几个按钮的设备更可能是驱动异常或手柄暴露不全（提示「按钮数量不足」）。
 * 判定按钮数门槛时直接引用 `MIN_STANDARD_BUTTONS`——门槛是 `gamepad-input.ts` 定的，
 * 在这里再写一个 16 就会出现两处数字漂移。
 */
function describeUnsupported(pad: GamepadLike): GamepadDeviceStatus {
	if (pad.mapping !== STANDARD_MAPPING)
		return 'unsupported-mapping'
	return (pad.buttons?.length ?? 0) < MIN_STANDARD_BUTTONS ? 'insufficient-buttons' : 'unsupported-mapping'
}

function isPressed(pad: GamepadLike | null | undefined): boolean {
	const buttons = pad?.buttons
	if (!buttons)
		return false
	for (const button of buttons) {
		if (button?.pressed === true)
			return true
	}
	return false
}

/** 是否有**标准映射**设备的任意按钮正被按住。门闩取值与每帧的放行检查都用它 */
function anyStandardButtonDown(pads: GamepadSnapshot): boolean {
	for (const pad of pads) {
		if (pad && isStandardGamepad(pad) && isPressed(pad))
			return true
	}
	return false
}

/**
 * 真机 `Gamepad` 的按钮数组与轴数组是**活对象**（浏览器每帧可能整体复用同一批），
 * 所以立刻降级成快照。这一步不是洁癖：若把 `pad.buttons` 原样交给纯映射层，
 * 它返回的 `state.buttons` 与上一帧可能是同一个数组，边沿判定会整个失效。
 */
function snapshotFrame(pad: GamepadLike, timestamp: number): StandardGamepadFrame {
	const buttons: boolean[] = []
	for (const button of pad.buttons ?? [])
		buttons.push(button?.pressed === true)
	const axes: number[] = []
	for (const axis of pad.axes ?? [])
		axes.push(readAxisValue(axis))
	return { buttons, axes, timestamp }
}

/** 一次扫描的结果。`ready` 是标准映射设备的 index，按 index 升序（多个手柄时的「首个」判据） */
interface DeviceScan {
	readonly ready: readonly number[]
	readonly status: GamepadDeviceStatus
}

/** 浏览器能力面。任一项取不到就整体为 `null`，控制器保持停止 */
interface GamepadEnvironment {
	readonly getGamepads: () => GamepadSnapshot
	readonly addEventListener: (type: string, listener: () => void) => void
	readonly removeEventListener: (type: string, listener: () => void) => void
	readonly addDocumentEventListener: (type: string, listener: () => void) => void
	readonly removeDocumentEventListener: (type: string, listener: () => void) => void
	readonly isHidden: () => boolean
	readonly isFocused: () => boolean
	readonly now: () => number
	readonly requestFrame: (callback: () => void) => number
	readonly cancelFrame: (handle: number) => void
}

/**
 * 取浏览器能力面。三项缺一即整体不可用：
 * `getGamepads` 没有就永远读不到设备，事件目标没有就收不到连接通知，
 * rAF 没有就没有轮询载体。与其逐项降级出半可用状态，不如一次性报 `unsupported`。
 */
function readEnvironment(options: GamepadControllerOptions): GamepadEnvironment | null {
	const win = typeof window !== 'undefined' ? window : undefined
	const doc = typeof document !== 'undefined' ? document : undefined
	const requestFrame = win?.requestAnimationFrame?.bind(win)
		?? (typeof requestAnimationFrame === 'undefined' ? undefined : requestAnimationFrame)
	const cancelFrame = win?.cancelAnimationFrame?.bind(win)
		?? (typeof cancelAnimationFrame === 'undefined' ? undefined : cancelAnimationFrame)
	if (!requestFrame || !cancelFrame)
		return null
	if (typeof win?.addEventListener !== 'function' || typeof win?.removeEventListener !== 'function')
		return null
	if (typeof doc?.addEventListener !== 'function' || typeof doc?.removeEventListener !== 'function')
		return null
	const getGamepads = options.getGamepads
		?? (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
			? () => navigator.getGamepads()
			: undefined)
	if (!getGamepads)
		return null
	return {
		getGamepads,
		addEventListener: (type, listener) => win.addEventListener(type, listener),
		removeEventListener: (type, listener) => win.removeEventListener(type, listener),
		addDocumentEventListener: (type, listener) => doc.addEventListener(type, listener),
		removeDocumentEventListener: (type, listener) => doc.removeEventListener(type, listener),
		isHidden: () => doc.hidden === true,
		isFocused: () => (typeof doc.hasFocus === 'function' ? doc.hasFocus() : true),
		now: options.now
			?? (typeof performance !== 'undefined'
				? () => performance.now()
				: () => Date.now()),
		requestFrame: callback => requestFrame(() => callback()),
		cancelFrame: handle => cancelFrame(handle),
	}
}

/**
 * 创建控制器。**永不抛错**：不支持的环境下返回一个 `start()` 后也不会动的控制器，
 * 并把 `getStatus().support` 报成 `unsupported`。
 *
 * 不建议每个组件各建一个：`stop()` 会解绑监听，多个实例会互相踩状态。
 */
export function createGamepadController(options: GamepadControllerOptions = {}): GamepadController {
	const env = readEnvironment(options)
	const support: GamepadSupportStatus = env ? 'supported' : 'unsupported'
	const isModeActive = options.isModeActive ?? (() => getBigPictureState() === 'active')
	const isAutoEntryAllowed = options.isAutoEntryAllowed ?? (() => !isAutoEntrySuppressed())

	let deviceStatus: GamepadDeviceStatus = 'none'
	/** 当前唯一被响应的设备。多手柄时只回应一个 */
	let activeIndex: number | null = null
	let inputState: GamepadInputState = createInputState()
	/** 门闩：进入意图 / 可见性变化 / 断连之后，必须先看到「全部松开」 */
	let awaitingRelease = false
	/** 上一帧的时间戳。`null` 表示还没有可用的上一帧（此时 `deltaMs` 记 0） */
	let lastTimestamp: number | null = null
	let frameHandle = 0
	let started = false
	let bound = false
	let hidden = false
	let left = false
	let focused = true

	function readPads(): GamepadSnapshot {
		// 读失败（策略禁止、安全上下文缺失）一律当「没有设备」：控制器停轮询而不是崩页面
		try {
			return env ? (env.getGamepads() ?? []) : []
		}
		catch {
			return []
		}
	}

	function scanDevices(pads: GamepadSnapshot): DeviceScan {
		const ready: number[] = []
		let present = false
		let unsupported: GamepadDeviceStatus = 'none'
		for (let index = 0; index < pads.length; index++) {
			// 空洞与 null 一视同仁：未连接的槽位永远是空的，且 index 随时会被复用
			const pad = pads[index]
			if (!pad)
				continue
			present = true
			if (isStandardGamepad(pad)) {
				ready.push(index)
				continue
			}
			const status = describeUnsupported(pad)
			if (STATUS_RANK[status] > STATUS_RANK[unsupported])
				unsupported = status
		}
		return { ready, status: ready.length > 0 ? 'ready' : (present ? unsupported : 'none') }
	}

	/**
	 * 作废「当前状态」，把门闩置成**此刻是否真有按钮按住**。
	 *
	 * 置成条件而不是无条件，是「已保持按下的按钮必须先松开」这条规则的准确形式：
	 * 门闩要拦的是恢复瞬间**还按着**的那些按钮。若无条件置位，重新获得焦点之后
	 * 新按下的第一次也会被吞掉，手柄看起来像失灵。
	 */
	function resetInput() {
		inputState = createInputState()
		lastTimestamp = null
		awaitingRelease = anyStandardButtonDown(readPads())
	}

	/** 门闩的强制版：进入意图那次按键按定义就是按住的 */
	function latch() {
		awaitingRelease = true
	}

	function dropDevice() {
		activeIndex = null
		resetInput()
	}

	function applyScan(scan: DeviceScan) {
		if (scan.status !== deviceStatus) {
			deviceStatus = scan.status
			// 从无到有、以及同一连接期间能力变化都报连接；全部消失报断开。
			// 「不支持」变「支持」也算一次连接：提示条要改文案，那不是一次断开。
			if (scan.status === 'none')
				options.onDisconnection?.()
			else
				options.onConnection?.(scan.status)
		}
		// 当前设备这一帧读不到了（热插拔 / 被复用）：按断开处理
		if (activeIndex !== null && !scan.ready.includes(activeIndex))
			dropDevice()
	}

	/**
	 * 轮询门禁。前四条任一不满足就不排期 rAF。
	 * 最后一条的语义是「还有没有理由去读设备」：模式已激活时**总是**读——用户
	 * 从顶部按钮手动进入之后，即使本标签页的自动进入仍被抑制，输入也必须立刻可用；
	 * 尚未激活时才受抑制标记约束（规格：自动进入被抑制时停止轮询）。
	 */
	function canPoll(scan: DeviceScan): boolean {
		if (!started || left || hidden || !focused)
			return false
		if (scan.ready.length === 0)
			return false
		return isModeActive() || isAutoEntryAllowed()
	}

	function cancelFrame() {
		if (frameHandle === 0 || !env)
			return
		env.cancelFrame(frameHandle)
		frameHandle = 0
	}

	function schedule() {
		if (frameHandle !== 0 || !env)
			return
		frameHandle = env.requestFrame(tick)
	}

	function anyPressed(pads: GamepadSnapshot, scan: DeviceScan): boolean {
		for (const index of scan.ready) {
			if (isPressed(pads[index]))
				return true
		}
		return false
	}

	/**
	 * 选出这一帧要响应的设备。
	 * 已在响应中的设备：按 index **重新取**，取不到就放弃（让别的设备用新按键接管）。
	 * 只有一个可用设备时直接用它——否则「插上就推摇杆」会毫无反应，
	 * 而规格把「首个按下按钮」写在**多手柄**那一节，它要解决的是选谁，不是不选。
	 * 有多个可用设备时才需要按键来指认：index 升序里第一个按下的接管，
	 * 没被按过的设备保持沉默（静置的设备不白占名额）。
	 */
	function selectDevice(pads: GamepadSnapshot, scan: DeviceScan): number | null {
		if (activeIndex !== null) {
			if (pads[activeIndex] && scan.ready.includes(activeIndex))
				return activeIndex
			dropDevice()
			return null
		}
		if (scan.ready.length === 1) {
			activeIndex = scan.ready[0]
			return activeIndex
		}
		for (const index of scan.ready) {
			if (isPressed(pads[index])) {
				activeIndex = index
				return index
			}
		}
		return null
	}

	function step(pads: GamepadSnapshot, scan: DeviceScan) {
		if (!env)
			return
		// 门闩：先于选设备判断。按住期间这一帧什么都不做，也不选设备——
		// 若放在选设备之后，首次进入时就会死锁（进入那次按键正是选设备的条件）
		if (awaitingRelease) {
			if (anyPressed(pads, scan))
				return
			awaitingRelease = false
		}
		const index = selectDevice(pads, scan)
		if (index === null)
			return
		const pad = pads[index]
		if (!pad)
			return
		const timestamp = env.now()
		const frame = snapshotFrame(pad, timestamp)
		const result = normalizeGamepadFrame(frame, inputState)
		inputState = result.state
		const deltaMs = lastTimestamp === null
			? 0
			: Math.min(Math.max(0, timestamp - lastTimestamp), MAX_FRAME_DELTA_MS)
		lastTimestamp = timestamp
		if (result.actions.length === 0)
			return
		if (!isModeActive()) {
			// 模式未激活：这一帧只用来请求进入，动作全部不发布（规格第一条输入只进入）
			if (hasButtonInput(result)) {
				latch()
				options.onEntryIntent?.(result.actions[0])
			}
			return
		}
		const context: GamepadActionContext = {
			index,
			axisY: readAxisValue(frame.axes[RIGHT_STICK_Y_AXIS]),
			deltaMs,
			timestamp,
		}
		for (const action of result.actions)
			options.onAction?.(action, context)
	}

	function tick() {
		frameHandle = 0
		if (!started)
			return
		// 每帧重读：数组有空洞、index 会被复用，记住 index 就等于生成幽灵输入
		const pads = readPads()
		const scan = scanDevices(pads)
		applyScan(scan)
		if (!canPoll(scan))
			return
		step(pads, scan)
		schedule()
	}

	/** 重新读设备 + 重新裁决轮询。不重置按住状态（由调用点决定是否 `resetInput`） */
	function sync() {
		if (!env || !started)
			return
		const pads = readPads()
		const scan = scanDevices(pads)
		applyScan(scan)
		if (canPoll(scan))
			schedule()
		else
			cancelFrame()
	}

	const onConnected = () => refresh()
	const onDisconnected = () => refresh()
	const onVisibilityChange = () => {
		hidden = env?.isHidden() ?? false
		if (!hidden)
			focused = env?.isFocused() ?? true
		refresh()
	}
	const onFocus = () => {
		focused = true
		refresh()
	}
	const onBlur = () => {
		focused = false
		refresh()
	}
	// 离开页面（含 BFCache）：停轮询但**保留监听**，否则 pageshow 回来时没人重启
	const onPageHide = () => {
		left = true
		refresh()
	}
	const onPageShow = () => {
		left = false
		refresh()
	}

	function bind() {
		if (bound || !env)
			return
		bound = true
		env.addEventListener('gamepadconnected', onConnected)
		env.addEventListener('gamepaddisconnected', onDisconnected)
		env.addEventListener('focus', onFocus)
		env.addEventListener('blur', onBlur)
		env.addEventListener('pagehide', onPageHide)
		env.addEventListener('pageshow', onPageShow)
		// visibilitychange 挂在 document 上而不是 window 上
		env.addDocumentEventListener('visibilitychange', onVisibilityChange)
	}

	function unbind() {
		if (!bound || !env)
			return
		bound = false
		env.removeEventListener('gamepadconnected', onConnected)
		env.removeEventListener('gamepaddisconnected', onDisconnected)
		env.removeEventListener('focus', onFocus)
		env.removeEventListener('blur', onBlur)
		env.removeEventListener('pagehide', onPageHide)
		env.removeEventListener('pageshow', onPageShow)
		env.removeDocumentEventListener('visibilitychange', onVisibilityChange)
	}

	function start() {
		if (!env)
			return
		if (started) {
			sync()
			return
		}
		started = true
		bound = false
		hidden = env.isHidden()
		focused = env.isFocused()
		left = false
		bind()
		resetInput()
		sync()
	}

	function stop() {
		started = false
		cancelFrame()
		unbind()
		dropDevice()
	}

	function refresh() {
		resetInput()
		sync()
	}

	return {
		start,
		stop,
		refresh,
		isRunning: () => frameHandle !== 0,
		getStatus: () => ({ support, device: deviceStatus }),
	}
}
