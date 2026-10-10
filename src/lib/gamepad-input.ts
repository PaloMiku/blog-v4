/**
 * 手柄「原始帧 → 语义动作」的纯映射层。
 *
 * ## 为什么单独一层、且必须零 DOM
 * 设计文档把手柄拆成本文件（纯函数）与 `src/lib/gamepad.ts`（浏览器生命周期）两层，
 * 判据是**可测性**：按钮编号、摇杆阈值、重复节流这些最容易在真机上「差不多能用」
 * 却悄悄错掉的规则，必须能在没有手柄、没有 DOM 的 Node 里逐条钉死。真机上反复试错
 * 既慢又不可复现，而这里全部退化成「给一帧输入，断言一组动作」。
 *
 * ## 纯度约束（下游 Task 很容易破坏，所以写在最前面）
 * - 模块作用域不出现 `window` / `navigator` / `document` / `Gamepad`；
 * - 不读 `Date.now()` / `performance.now()`：**时间一律来自 `frame.timestamp`**，
 *   否则同一条时间线在测试里无法复现，节流规则也就没法断言；
 * - 没有模块级可变状态。跨帧记忆（按住的方向、计时、上一帧按键）由调用方持有的
 *   `GamepadInputState` 显式传进来再显式拿回去，函数只依赖入参。
 *
 * ## 为什么 `normalizeGamepadFrame` 返回 `{ actions, state }`
 * 350ms/120ms 的重复节流与 0.35 的释放滞回天然跨帧。若沿用「只返回动作」，
 * 调用方要么自己重算一份状态（两处实现必然漂移），要么模块内部持有模块级变量
 * （直接违反上面的纯度约束，也让测试之间互相污染）。把新状态与动作一起返回，
 * 调用方只需 `state = result.state`，一个变量就完成闭环。
 *
 * ## 动作流的四条约定
 * 1. **顺序**：按键边沿（按按钮号升序）→ 方向（若触发）→ 滚动（若触发）。下游
 *    焦点管理器可以依赖这个顺序，但它不该依赖顺序做语义判断。
 * 2. **按键是边沿**：确认 / 返回 / 肩键 / 菜单只在「本帧按下且上帧未按下」时产出，
 *    按住不动不再重复（规格：确认、返回和肩键仅按下边沿触发）。
 * 3. **方向与滚动是电平**：方向按节流重复产出；滚动只要摇杆越过死区就**每帧**产出，
 *    动作本身**不含像素**——连续滚动的位移由 `getScrollDelta()` 单独算。
 *    两条路径不叠加：要么用动作驱动固定步长，要么用 `getScrollDelta()` 驱动比例位移。
 * 4. **换来源即新按下**：`GamepadInputState.source` 记下当前方向来自方向键还是左摇杆。
 *    方向相同但来源变了（补按了同向方向键，或松开方向键时摇杆已经偏在同侧）同样是
 *    新的一次操作：立刻产出方向动作并重置计时，不能静默吞掉或沿用上一段的计时。
 */

/** 方向（同时也是 `GamepadAction` 的一部分） */
export type Direction = 'up' | 'down' | 'left' | 'right'

/** 方向的输入来源。区分它是因为方向键与左摇杆的交接必须能被当成一次新的按下 */
export type DirectionSource = 'd-pad' | 'stick'

/** 按键类动作：只在按下边沿产出 */
export type ButtonAction = 'confirm' | 'back' | 'previous-region' | 'next-region' | 'menu'

/** 归一化后的语义动作。Shell / 焦点管理器只认这些名字，不认按钮号与轴号 */
export type GamepadAction = ButtonAction | Direction | 'scroll-up' | 'scroll-down'

/**
 * 一帧的纯数据快照。
 * 刻意只收三个字段：真实 `Gamepad` 对象每帧都要重新取（对象可能被浏览器复用），
 * 在这里立刻降级成快照，测试才能用字面量构造同样的输入。
 */
export interface StandardGamepadFrame {
	/** 按下为 `true`。长度随手柄而异，缺失下标一律当作未按下 */
	readonly buttons: readonly boolean[]
	/** axes[0]/[1] = 左摇杆 X/Y，axes[3] = 右摇杆 Y（**负值朝上**） */
	readonly axes: readonly number[]
	/** 帧时间戳（毫秒，单调）。节流全部以它为准，不用挂钟时间 */
	readonly timestamp: number
}

/**
 * 跨帧记忆。
 * 五个字段缺一不可：没有 `activeSince` 就算不出「按住多久」，没有 `lastRepeatAt`
 * 就分不清「第一次重复」和「第二次重复」，没有 `buttons` 就做不了边沿判定；
 * `source` 则用来识别「方向没变但换了输入来源」——那是用户的一次新操作，不是延续。
 */
export interface GamepadInputState {
	/** 当前保持的方向（方向键优先于左摇杆），未保持时为 `null` */
	readonly direction: Direction | null
	/** 当前方向来自方向键还是左摇杆；未保持方向时为 `null` */
	readonly source: DirectionSource | null
	/** `direction` 开始保持的时间戳；未保持时为 0 */
	readonly activeSince: number
	/** 上一次产出重复动作的时间戳；未保持时为 0 */
	readonly lastRepeatAt: number
	/** 上一帧的按键状态，用于边沿判定 */
	readonly buttons: readonly boolean[]
}

/** 本帧的产出：动作 + 下一次调用要传回来的新状态 */
export interface NormalizedFrame {
	readonly actions: readonly GamepadAction[]
	readonly state: GamepadInputState
}

/** 可调参数；缺省即规格里的值。留出它是为了让下游测试不必改写常量 */
export interface GamepadInputOptions {
	/** 进入方向所需的摇杆幅度，规格 0.55 */
	readonly stickThreshold?: number
	/** 保持方向所需的摇杆幅度，规格 0.35（滞回下沿，必须小于 stickThreshold） */
	readonly releaseThreshold?: number
	/** 首次重复前的按住时长，规格 350ms */
	readonly repeatDelayMs?: number
	/** 后续重复间隔，规格 120ms */
	readonly repeatIntervalMs?: number
	/** 右摇杆滚动死区，规格 0.25 */
	readonly scrollDeadZone?: number
}

/** 标准映射的字符串值；非此值一律不做增强（规格：只对 `mapping === 'standard'` 启用） */
const STANDARD_MAPPING = 'standard'

/**
 * 启用增强所需的最小按钮数。
 * 标准映射实际有 0–16 共 17 个按钮，这里把门槛定在 16：低于它的设备按下标 12–15
 * 取到的多半不是方向键，与其给一个错的提示，不如判定为「按钮数量不足」并停用增强。
 *
 * 导出是因为 Task 2 的「不支持该手柄」提示要引用这个数字，
 * 下游不该再手写一个 16。下面的调优常量则不需要导出——调用方要么走默认值，
 * 要么通过 `GamepadInputOptions` 覆盖，写死数字反而让测试失去「默认值就是规格值」的钉。
 */
export const MIN_STANDARD_BUTTONS = 16

const DEFAULT_STICK_THRESHOLD = 0.55
const DEFAULT_RELEASE_THRESHOLD = 0.35
const DEFAULT_REPEAT_DELAY_MS = 350
const DEFAULT_REPEAT_INTERVAL_MS = 120
const SCROLL_DEAD_ZONE = 0.25
const DEFAULT_MAX_SCROLL_PIXELS_PER_SECOND = 900

/** 按键 → 动作。顺序即动作流里的产出顺序（见文件头「动作流的三条约定」） */
const BUTTON_ACTIONS: readonly (readonly [index: number, action: GamepadAction])[] = [
	[0, 'confirm'],
	[1, 'back'],
	[4, 'previous-region'],
	[5, 'next-region'],
	[9, 'menu'],
]

/** 方向键 12–15。同时按下多个时按本表顺序取第一个（上下优先于左右） */
const DPAD_DIRECTIONS: readonly (readonly [index: number, direction: Direction])[] = [
	[12, 'up'],
	[13, 'down'],
	[14, 'left'],
	[15, 'right'],
]

const LEFT_STICK_X_AXIS = 0
const LEFT_STICK_Y_AXIS = 1
/** 右摇杆纵轴。规格里 Y 轴负值朝上，故「负值 → 向上滚」 */
const RIGHT_STICK_Y_AXIS = 3

const NO_BUTTONS: readonly boolean[] = Object.freeze([])

/**
 * 造一份中性初值。
 * 调用方不该手搓这个字面量：五个字段两两耦合（`direction` 与 `source` 必须同时非空，
 * `activeSince` 与 `lastRepeatAt` 在保持方向时必须同步推进），手搓出来的半初始化状态
 * 会让节流时序难以推理。
 */
export function createInputState(): GamepadInputState {
	return { direction: null, source: null, activeSince: 0, lastRepeatAt: 0, buttons: NO_BUTTONS }
}

function readAxis(frame: StandardGamepadFrame, index: number): number {
	const value = frame.axes[index]
	// 驱动异常/热插拔瞬间偶尔读到 NaN。让它落回 0 而不是把比较结果全部变成 false，
	// 否则「上一帧朝右」这种状态永远解不掉，手柄会卡在按住不放。
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isPressed(buttons: readonly boolean[], index: number): boolean {
	return buttons[index] === true
}

function axisMagnitude(direction: Direction, x: number, y: number): number {
	return Math.abs(direction === 'left' || direction === 'right' ? x : y)
}

/** 幅度更大的那根轴；完全相同时偏向 X，让同一帧的判定保持确定性 */
function pickDominantDirection(x: number, y: number): Direction {
	if (Math.abs(x) >= Math.abs(y))
		return x < 0 ? 'left' : 'right'
	return y < 0 ? 'up' : 'down'
}

/**
 * 左摇杆 → 方向，带滞回。
 *
 * 两条不对称规则是这一层的全部手感来源：
 * - **换向**必须越过进入阈值（0.55）。若换向也用释放阈值，斜推摇杆时会在两轴之间
 *   反复横跳，焦点每帧跳一次。
 * - **保持**只要不低于释放阈值（0.35）。两个阈值之间的那段就是滞回带：手指稍微回中
 *   时焦点不会突然丢失。
 */
function resolveStickDirection(
	x: number,
	y: number,
	held: Direction | null,
	stickThreshold: number,
	releaseThreshold: number,
): Direction | null {
	const dominant = pickDominantDirection(x, y)
	if (held === null)
		return axisMagnitude(dominant, x, y) >= stickThreshold ? dominant : null
	if (dominant !== held && axisMagnitude(dominant, x, y) >= stickThreshold)
		return dominant
	return axisMagnitude(held, x, y) >= releaseThreshold ? held : null
}

function resolveOptions(options: GamepadInputOptions): Required<GamepadInputOptions> {
	return {
		stickThreshold: options.stickThreshold ?? DEFAULT_STICK_THRESHOLD,
		releaseThreshold: options.releaseThreshold ?? DEFAULT_RELEASE_THRESHOLD,
		repeatDelayMs: options.repeatDelayMs ?? DEFAULT_REPEAT_DELAY_MS,
		repeatIntervalMs: options.repeatIntervalMs ?? DEFAULT_REPEAT_INTERVAL_MS,
		scrollDeadZone: options.scrollDeadZone ?? SCROLL_DEAD_ZONE,
	}
}

/**
 * 归一化一帧手柄输入。
 *
 * @param frame 本帧快照，时间取自 `frame.timestamp`
 * @param previous 上一帧产出的状态；首帧传 `createInputState()`
 * @param options 阈值覆盖项，缺省即规格值
 * @returns 本帧动作 + 下一帧要传回的状态。函数不改写入参
 */
export function normalizeGamepadFrame(
	frame: StandardGamepadFrame,
	previous: GamepadInputState,
	options: GamepadInputOptions = {},
): NormalizedFrame {
	const { stickThreshold, releaseThreshold, repeatDelayMs, repeatIntervalMs, scrollDeadZone } = resolveOptions(options)
	const timestamp = frame.timestamp
	const actions: GamepadAction[] = []

	// 按键：只认按下边沿
	for (const [index, action] of BUTTON_ACTIONS) {
		if (isPressed(frame.buttons, index) && !isPressed(previous.buttons, index))
			actions.push(action)
	}

	// 方向：方向键优先于左摇杆（规格：方向键优先）
	let next: Direction | null = null
	let source: DirectionSource | null = null
	for (const [index, direction] of DPAD_DIRECTIONS) {
		if (isPressed(frame.buttons, index)) {
			next = direction
			source = 'd-pad'
			break
		}
	}
	if (next === null) {
		next = resolveStickDirection(
			readAxis(frame, LEFT_STICK_X_AXIS),
			readAxis(frame, LEFT_STICK_Y_AXIS),
			previous.direction,
			stickThreshold,
			releaseThreshold,
		)
		source = next === null ? null : 'stick'
	}

	// 节流：首次立刻，之后 350ms 起每 120ms 重复一次。
	// `next === null` 时两个计时保持 0：松手后下次按下必须立刻触发，
	// 不能继承上一段「已经按够 350ms」的资格。
	let directionAction: Direction | null = null
	let activeSince = 0
	let lastRepeatAt = 0
	// 换方向**或换来源**都算一次新的按下。方向键与左摇杆指向同一方时，
	// 用户仍然做了新操作：按下方向键的那一下必须被认出来，反之亦然。
	// 只比 `direction` 会把这两种交接静默吞掉——要么整帧无动作，
	// 要么沿用上一段的计时，在交接瞬间吐出一个时机不可预测的重复。
	if (next !== null && (next !== previous.direction || source !== previous.source)) {
		directionAction = next
		activeSince = timestamp
		lastRepeatAt = timestamp
	}
	else if (next !== null) {
		activeSince = previous.activeSince
		lastRepeatAt = previous.lastRepeatAt
		if (timestamp - activeSince >= repeatDelayMs && timestamp - lastRepeatAt >= repeatIntervalMs) {
			directionAction = next
			lastRepeatAt = timestamp
		}
	}
	if (directionAction !== null)
		actions.push(directionAction)

	// 滚动：电平量，每帧产出；像素量交给 getScrollDelta()
	const rightStickY = readAxis(frame, RIGHT_STICK_Y_AXIS)
	if (Math.abs(rightStickY) > scrollDeadZone)
		actions.push(rightStickY < 0 ? 'scroll-up' : 'scroll-down')

	return {
		actions,
		state: { direction: next, source, activeSince, lastRepeatAt, buttons: frame.buttons },
	}
}

/**
 * 右摇杆纵轴 → **本帧**的滚动像素。
 *
 * ## 线性映射
 * 刚出死区时速度极低、推到底才满速，比例是「超出死区的部分 ÷ 剩余量程」：
 * `(abs(v) - 0.25) / 0.75`。不归一的话 `v = 1` 只到 75% 速度，规格里的
 * 「最大 900px/s」就永远达不到。
 *
 * ## 为什么是「本帧增量」而不是目标速度交给平滑滚动
 * 规格要求松手立刻停。若把速度交给 `scroll-behavior: smooth` 或惯性动画，
 * 松手后页面还会继续滑行，用户会以为手柄失灵。调用方应当 `scrollBy(delta)`。
 *
 * ## 符号约定
 * 规格里 Y 轴负值朝上，因此**负轴 → 负增量 → scroll-up**（上滚），与浏览器
 * `scrollBy` 的正负号一致，不需要调用方再翻一次符号。
 *
 * @param axisValue axes[3] 的原始值
 * @param deltaMs 距上一帧的毫秒数。非有限或非正数一律按 0 处理
 * @param maxPixelsPerSecond 速度上限，规格 900。非有限或非正数同样按 0 处理，
 *   不会反向滚动
 * @param deadZone 死区，规格 0.25。若调用方改了 `GamepadInputOptions.scrollDeadZone`，
 *   必须把同一个值传进来，否则会出现「动作流说有滚动、像素却是 0」的不一致
 */
export function getScrollDelta(
	axisValue: number,
	deltaMs: number,
	maxPixelsPerSecond = DEFAULT_MAX_SCROLL_PIXELS_PER_SECOND,
	deadZone = SCROLL_DEAD_ZONE,
): number {
	// 提前返回有两个理由：非有限的帧间隔（NaN / Infinity）不能流进 scrollBy，
	// 而 `Math.max(0, NaN)` 仍是 NaN，光靠比较抓不住；顺带避免 `sign * 0` 产出 -0。
	if (!Number.isFinite(deltaMs) || deltaMs <= 0)
		return 0
	if (!Number.isFinite(maxPixelsPerSecond) || maxPixelsPerSecond <= 0)
		return 0
	const magnitude = Math.abs(axisValue)
	if (!Number.isFinite(magnitude) || magnitude <= deadZone)
		return 0
	const travel = Math.min(1, (magnitude - deadZone) / (1 - deadZone))
	// `travel` 已被夹在 0..1，`travel * max` 天然不超过 `max`，
	// 再套一层 Math.min 只会掩盖「上限传了负数」这种配置错误（它会翻成反向滚动）。
	return Math.sign(axisValue) * travel * maxPixelsPerSecond * (deltaMs / 1000)
}

/**
 * 是否可以套用标准映射。
 *
 * 接受的是**快照**而不是 `Gamepad`：本模块不碰浏览器类型，Node 里也能测。
 * 两个条件缺一不可——`mapping` 决定按钮号和轴号有没有意义，按钮数不够则 12–15
 * 的方向键根本不存在（规格：「按钮数量不足」必须停用增强并显示不支持提示）。
 */
export function isStandardGamepad(gamepad: { mapping?: string, buttons?: readonly unknown[] }): boolean {
	return gamepad.mapping === STANDARD_MAPPING && (gamepad.buttons?.length ?? 0) >= MIN_STANDARD_BUTTONS
}
