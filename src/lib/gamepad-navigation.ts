/**
 * 手柄大屏模式的**纯几何**焦点导航层。
 *
 * ## 为什么必须零 DOM
 * 设计文档把焦点导航拆成本文件（纯函数）与 `src/lib/gamepad-focus.ts`（读真实 DOM）两层。
 * 判据和 `gamepad-input.ts` 同一条：**几何排序是最容易「看起来能用」却悄悄错掉的规则**——
 * 半平面的开闭、交叉轴重叠的判据、距离用中心还是用边缘、同分怎么破，每一处都能在真机上
 * 表现为「偶尔跳错一项」，而真机复现一次要几分钟。收成「给几组矩形，断言选中了谁」之后，
 * 同一批判据可以在 Node 里一次钉死几百种排布。
 *
 * ## 纯度约束（下游很容易破坏，所以写在最前面）
 * - 模块作用域不出现 `window` / `document` / `navigator` / `Element` / `HTMLElement`；
 * - 输入只收**数字矩形**（`x` / `y` / `width` / `height`）与一个**稳定序号**（`order`），
 *   不收元素对象、classList、getBoundingClientRect；
 * - 没有模块级可变状态，没有随机数，没有时间。
 *
 * ## 排序的四级键（规格原句的逐字展开）
 * 「按方向半平面过滤，优先选择在交叉轴上重叠的候选，再按主轴距离、交叉轴距离排序，
 *   同分按 DOM 顺序」。所以比较器是四级，前一级分胜负就不再看后面：
 * 1. **交叉轴是否重叠**（重叠优先）；
 * 2. **主轴距离**（沿移动方向的中心距，越近越优先）；
 * 3. **交叉轴距离**（沿交叉方向的中心距）；
 * 4. **`order`**（DOM 顺序，即发现顺序）。
 *
 * 距离一律用**中心距**而非边缘距：规格开篇就是「比较元素中心」。边缘距在一行卡片高度
 * 不齐时会把「同一行里左边那个」判成比「下一行正上方那个」更远，视觉上说不通。
 *
 * ## 两条不做什么（规格写死的负向约束）
 * - **不跨区域**：候选必须在 `current.region` 同一个区域内。这是「方向移动仅在当前区域计算」
 *   的直接落法，也是「不跨页」的前提——跨区域必然跨页。
 * - **不回绕**：没有候选就返回 `undefined`，由调用方保留当前焦点。
 *   回绕会让「再按一下右键」把焦点甩回屏幕另一端，与「没有候选则保留焦点」互斥。
 */
import type { Direction } from './gamepad-input'

/**
 * 区域标识。取值与页面上 `data-gamepad-region` 的属性值一一对应，
 * 由 Task 7 逐页声明，**本层不做任何推断**（不按标签名猜侧栏、不按 URL 猜正文）。
 */
export type FocusRegion = 'sidebar' | 'main' | 'aside' | 'footer' | 'overlay'

/** 全部合法区域值。默认区域选择与属性校验共用它，避免两处各写一份名单 */
export const FOCUS_REGIONS: readonly FocusRegion[] = ['sidebar', 'main', 'aside', 'footer', 'overlay']

/**
 * 目标的几何。只取四个数字。
 * 刻意**不**用 `DOMRect`：`DOMRect` 带 `left/right/top/bottom/x/y/width/height`，
 * 拿它当参数会让本层重新依赖 DOM 类型，Node 里也就构造不出「任意矩形」了。
 */
export interface FocusRect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

/**
 * 一个可选中的焦点目标。
 * `key` 是**稳定身份**：列表重排、翻页、区域重新发现之后，靠它把「用户当时选中的那一项」
 * 认回来（规格：「动态列表按 `data-list-key` 或规范化 href 恢复当前目标」）。
 * `order` 是发现顺序，即 DOM 顺序，用来在所有距离都相同时破同分。
 */
export interface FocusTarget {
	readonly key: string
	readonly region: FocusRegion
	readonly rect: FocusRect
	readonly order: number
	/** 该区域/页面的首选项（页面上的 `data-gamepad-initial-focus`）。缺省即非首选项 */
	readonly initial?: boolean
}

/** 把 `unknown` 收窄成 `FocusRegion`。**不**做别名映射：属性值拼错就是拼错 */
export function isFocusRegion(value: unknown): value is FocusRegion {
	return typeof value === 'string' && (FOCUS_REGIONS as readonly string[]).includes(value)
}

function centerX(rect: FocusRect): number {
	return rect.x + rect.width / 2
}

function centerY(rect: FocusRect): number {
	return rect.y + rect.height / 2
}

/** 四个比较键的一次性算完。返回 `null` 表示该候选不在方向的半平面里 */
interface CandidateScore {
	/** 交叉轴上是否与当前目标重叠 */
	readonly overlaps: boolean
	readonly mainDistance: number
	readonly crossDistance: number
}

function scoreCandidate(current: FocusTarget, candidate: FocusTarget, direction: Direction): CandidateScore | null {
	const horizontal = direction === 'left' || direction === 'right'
	const fromX = centerX(current.rect)
	const fromY = centerY(current.rect)
	const toX = centerX(candidate.rect)
	const toY = centerY(candidate.rect)

	// 半平面用**严格**不等号：中心恰好齐平的候选不进候选集。把它算进来会让「上下两行
	// 完全对齐的卡片」在按下和松开之间反复抢焦点。
	const ahead = horizontal
		? (direction === 'right' ? toX > fromX : toX < fromX)
		: (direction === 'down' ? toY > fromY : toY < fromY)
	if (!ahead)
		return null

	const mainDistance = horizontal ? Math.abs(toX - fromX) : Math.abs(toY - fromY)
	const crossDistance = horizontal ? Math.abs(toY - fromY) : Math.abs(toX - fromX)
	// 交叉轴重叠 = 两个投影区间相交。取闭区间：恰好边贴边（重叠长度 0）也算对齐，
	// 否则「同一行紧挨着的两格」会因为「没有真正压住对方」被降级到第二档。
	const crossHalf = horizontal
		? (current.rect.height + candidate.rect.height) / 2
		: (current.rect.width + candidate.rect.width) / 2
	return { overlaps: crossDistance <= crossHalf, mainDistance, crossDistance }
}

/**
 * 沿 `direction` 选出下一个目标。
 *
 * @param current 当前目标。没有当前目标时返回 `undefined`（由调用方决定初始焦点，
 * 本层不猜「第一次方向键该去哪」）
 * @param candidates 同区域的候选集合。函数自己按区域过滤，外部不必先筛
 * @param direction 移动方向
 * @returns 选中的目标；**没有候选时返回 `undefined`**，调用方据此保留当前焦点
 */
export function chooseNextFocus(
	current: FocusTarget | null | undefined,
	candidates: readonly FocusTarget[],
	direction: Direction,
): FocusTarget | undefined {
	if (!current)
		return undefined
	// 目标与它的四个键绑在一个变量里：分开两个变量既要同步维护，
	// 又会让「打分存在但目标不存在」这种半初始化状态写进类型里
	let best: { target: FocusTarget, score: CandidateScore } | null = null
	for (const candidate of candidates) {
		// 当前目标自己、与其同 key 的目标（同 key 即同一项，换了元素也还是那一项）
		if (candidate === current || candidate.key === current.key)
			continue
		// 不跨区域：跨区域必然跨页，规格明令禁止
		if (candidate.region !== current.region)
			continue
		const score = scoreCandidate(current, candidate, direction)
		if (!score)
			continue
		if (!best || beats(score, candidate, best.score, best.target)) {
			best = { target: candidate, score }
		}
	}
	return best?.target
}

/** 四级比较键。`true` 表示 `a` 严格优于 `b` */
function beats(score: CandidateScore, a: FocusTarget, bestScore: CandidateScore, b: FocusTarget): boolean {
	if (score.overlaps !== bestScore.overlaps)
		return score.overlaps
	if (score.mainDistance !== bestScore.mainDistance)
		return score.mainDistance < bestScore.mainDistance
	if (score.crossDistance !== bestScore.crossDistance)
		return score.crossDistance < bestScore.crossDistance
	return a.order < b.order
}

/**
 * 进入一个区域（或整页）时该选中谁。
 *
 * 偏好顺序就是规格那一行的直译，**顺序不可交换**：
 * 1. `previousKey` 命中的那一项——**上次在这儿停过的地方**优先于任何首选项，
 *    否则用户每次进区域都被拽回第一项，等于「恢复」这个功能不存在；
 * 2. `data-gamepad-initial-focus`；
 * 3. 区域内第一项（`order` 最小）。
 *
 * @param region 目标区域。传 `null` 表示**不限区域**（页面级首焦：全页找 `initial`，
 * 找不到再退全页第一项）。传 `undefined` 等同 `null`。
 * @param targets 当前可用的全部目标
 * @param previousKey 该区域上一次选中的 key。`null` / 未命中即退回上面第 2、3 条
 */
export function chooseRegionTarget(
	region: FocusRegion | null | undefined,
	targets: readonly FocusTarget[],
	previousKey: string | null | undefined,
): FocusTarget | undefined {
	// 过滤已经产生新数组，所以下面排序不会打乱调用方传进来的顺序
	const pool = targets
		.filter(target => region === null || region === undefined || target.region === region)
		.sort((a, b) => a.order - b.order)
	if (pool.length === 0)
		return undefined
	if (previousKey) {
		const remembered = pool.find(target => target.key === previousKey)
		if (remembered)
			return remembered
	}
	return pool.find(target => target.initial === true) ?? pool[0]
}
