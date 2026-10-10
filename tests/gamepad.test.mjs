/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`src/lib/gamepad-input.ts` 的纯映射合同单测。
// 手柄是没法在 CI 里插上真设备的输入源，所以这里的每个数字都必须钉死：
//   按钮   —— 标准映射 0/1/4/5/9 与方向键 12–15，且只在按下边沿触发；
//   方向   —— 进入阈值 0.55、释放滞回 0.35、只取幅度更大的轴、方向键优先于左摇杆；
//              方向键 ↔ 左摇杆的交接（来源变化）按一次新的按下处理，立刻触发；
//   节流   —— 首次立刻，之后 350ms 起每 120ms 重复；换向立刻重置计时；
//   滚动   —— 0.25 死区、负轴向上（scroll-up）、线性映射、900px/s 封顶，
//              非有限的帧间隔与上限一律 0。
// 另外钉住纯度：穿插其它调用后结果不变（模块内没有隐藏的「上一帧」）、
// 不改写入参（否则下游无法用状态回灌）、以及多按键同帧时的产出顺序。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	createInputState,
	getScrollDelta,
	isStandardGamepad,
	normalizeGamepadFrame,
} from '../src/lib/gamepad-input.ts'

/** 造一帧：只写按下（或轴有值）的下标，其余默认 0 / false */
function frame({ pressed = [], axes = [], timestamp = 0 } = {}) {
	const buttons = Array.from({ length: 17 }, (_, i) => pressed.includes(i))
	const list = [...axes]
	while (list.length < 4)
		list.push(0)
	return { buttons, axes: list, timestamp }
}

/** 跑一帧并返回动作（多数断言只关心动作） */
function actions(input, previous = createInputState(), options) {
	return normalizeGamepadFrame(input, previous, options).actions
}

describe('标准映射：按钮 → 语义动作', () => {
	const cases = [
		[[0], 'confirm'],
		[[1], 'back'],
		[[4], 'previous-region'],
		[[5], 'next-region'],
		[[9], 'menu'],
	]

	for (const [pressed, expected] of cases) {
		it(`按钮 ${pressed[0]} → ${expected}`, () => {
			assert.deepEqual(actions(frame({ pressed })), [expected])
		})
	}

	it('未映射的按钮（2/3/6/7/8/10/11/16）不产出任何动作', () => {
		assert.deepEqual(actions(frame({ pressed: [2, 3, 6, 7, 8, 10, 11, 16] })), [])
	})

	it('方向键 12/13/14/15 → 上/下/左/右', () => {
		for (const [index, expected] of [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']])
			assert.deepEqual(actions(frame({ pressed: [index] })), [expected])
	})

	it('多个映射按钮同帧按下：按按钮号升序产出（顺序是下游可依赖的契约）', () => {
		assert.deepEqual(actions(frame({ pressed: [1, 4] })), ['back', 'previous-region'])
		assert.deepEqual(actions(frame({ pressed: [9, 0] })), ['confirm', 'menu'])
		assert.deepEqual(actions(frame({ pressed: [5, 1, 9, 4, 0] })), [
			'confirm',
			'back',
			'previous-region',
			'next-region',
			'menu',
		])
	})
})

describe('按键只触发按下边沿', () => {
	it('按住不放：只有第一帧产出动作，之后全空', () => {
		const held = frame({ pressed: [0], timestamp: 0 })
		let state = createInputState()

		state = normalizeGamepadFrame(held, state).state
		assert.deepEqual(normalizeGamepadFrame({ ...held, timestamp: 100 }, state).actions, [])
		assert.deepEqual(normalizeGamepadFrame({ ...held, timestamp: 200 }, state).actions, [])
	})

	it('松开后再按：重新产出一次', () => {
		const down = frame({ pressed: [0], timestamp: 0 })
		let state = normalizeGamepadFrame(down, createInputState()).state

		state = normalizeGamepadFrame(frame({ timestamp: 10 }), state).state // 松开
		state = normalizeGamepadFrame(frame({ pressed: [0], timestamp: 20 }), state).state // 再按
		assert.deepEqual(normalizeGamepadFrame(frame({ pressed: [0], timestamp: 30 }), state).actions, [])
		assert.deepEqual(actions(frame({ pressed: [1], timestamp: 40 }), state), ['back'])
	})

	it('初始状态里没有上一帧按键时按下即为边沿', () => {
		// 上一帧的 buttons 为空数组，缺下标一律视作未按下
		assert.deepEqual(actions(frame({ pressed: [9], timestamp: 5 })), ['menu'])
	})

	it('长度不齐的 buttons 数组按各自分量判定边沿', () => {
		// 上一帧只报告到下标 1，本帧报告到下标 2：多出来的下标 2 视为新按下
		const previous = { ...createInputState(), buttons: [false, false] }
		assert.deepEqual(actions(frame({ pressed: [2], timestamp: 0 }), previous), [])

		const current = { buttons: [false, true], axes: [], timestamp: 0 }
		assert.deepEqual(normalizeGamepadFrame(current, { ...createInputState(), buttons: [false] }).actions, ['back'])

		// 本帧比上一帧短：缺失下标视为已松开，不产生边沿
		const shrunk = { buttons: [true], axes: [], timestamp: 0 }
		assert.deepEqual(normalizeGamepadFrame(shrunk, { ...createInputState(), buttons: [true, true] }).actions, [])
		assert.deepEqual(normalizeGamepadFrame(shrunk, { ...createInputState(), buttons: [] }).actions, ['confirm'])
	})
})

describe('左摇杆：阈值、滞回与主轴', () => {
	it('进入阈值 0.55：0.54 不动，0.55 恰好进入', () => {
		assert.deepEqual(actions(frame({ axes: [0.54, 0] })), [])
		assert.deepEqual(actions(frame({ axes: [0.55, 0] })), ['right'])
		assert.deepEqual(actions(frame({ axes: [-0.55, 0] })), ['left'])
		assert.deepEqual(actions(frame({ axes: [0, 0.55] })), ['down'])
		assert.deepEqual(actions(frame({ axes: [0, -0.55] })), ['up'])
	})

	it('只取幅度更大的轴', () => {
		assert.deepEqual(actions(frame({ axes: [-0.9, 0.2] })), ['left'])
		assert.deepEqual(actions(frame({ axes: [0.2, -0.9] })), ['up'])
		// 对角等幅时偏向 X，保证同一帧的判定是确定的
		assert.deepEqual(actions(frame({ axes: [-0.9, -0.9] })), ['left'])
		assert.deepEqual(actions(frame({ axes: [0.9, -0.9] })), ['right'])
	})

	it('释放滞回 0.35：回落到 0.4 仍然保持，不产出新动作', () => {
		const state = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState()).state
		const relaxed = normalizeGamepadFrame(frame({ axes: [0.4], timestamp: 20 }), state)

		assert.deepEqual(relaxed.actions, [])
		assert.equal(relaxed.state.direction, 'right')
	})

	it('跌破 0.35 即释放；重新推过 0.55 立刻再次触发', () => {
		let state = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState()).state

		state = normalizeGamepadFrame(frame({ axes: [0.34], timestamp: 20 }), state).state
		assert.equal(state.direction, null)

		// 已释放时没有「保持方向」可依：滞回带内的 0.4 既不重新触发也不保持
		const inBand = normalizeGamepadFrame(frame({ axes: [0.4], timestamp: 500 }), state)
		assert.deepEqual(inBand.actions, [])
		assert.equal(inBand.state.direction, null)

		assert.deepEqual(actions(frame({ axes: [0.56], timestamp: 900 }), state), ['right'])
	})

	it('换向必须越过进入阈值：滞回带内的更大轴不足以夺权', () => {
		const state = normalizeGamepadFrame(frame({ axes: [0.9, 0], timestamp: 0 }), createInputState()).state

		// 幅度更大的 Y 只有 0.5，未过 0.55：保持 right
		const held = normalizeGamepadFrame(frame({ axes: [0.4, -0.5], timestamp: 20 }), state)
		assert.equal(held.state.direction, 'right')
		assert.deepEqual(held.actions, [])

		// 过 0.55：立刻换向
		const turned = normalizeGamepadFrame(frame({ axes: [0.4, -0.6], timestamp: 40 }), state)
		assert.equal(turned.state.direction, 'up')
		assert.deepEqual(turned.actions, ['up'])
	})

	it('摇杆回中（两轴都为 0）释放方向', () => {
		const state = normalizeGamepadFrame(frame({ axes: [0, -0.9], timestamp: 0 }), createInputState()).state
		const centered = normalizeGamepadFrame(frame({ axes: [0, 0], timestamp: 30 }), state)

		assert.equal(centered.state.direction, null)
		assert.deepEqual(centered.actions, [])
	})

	it('轴值为 NaN 视作 0，不会让上一帧的方向永远解不掉', () => {
		const state = normalizeGamepadFrame(frame({ axes: [0.9, 0], timestamp: 0 }), createInputState()).state
		const broken = normalizeGamepadFrame(frame({ axes: [Number.NaN, 0], timestamp: 30 }), state)

		assert.equal(broken.state.direction, null)
	})
})

describe('方向键优先于左摇杆', () => {
	it('方向键按下时忽略左摇杆的相反方向', () => {
		assert.deepEqual(actions(frame({ pressed: [13], axes: [0, -0.95] })), ['down'])
		assert.deepEqual(actions(frame({ pressed: [15], axes: [-0.95, 0] })), ['right'])
	})

	it('方向键与摇杆同向时只产出一个动作（不重复）', () => {
		assert.deepEqual(actions(frame({ pressed: [12], axes: [0, -0.95] })), ['up'])
	})

	it('多个方向键同时按下：按上下先于左右的固定顺序取一个', () => {
		assert.deepEqual(actions(frame({ pressed: [13, 15] })), ['down'])
		assert.deepEqual(actions(frame({ pressed: [14, 12] })), ['up'])
	})

	it('方向键松开、摇杆已经偏在同一侧：交接帧立刻产出方向动作并重置计时', () => {
		const held = normalizeGamepadFrame(frame({ pressed: [12], timestamp: 0 }), createInputState()).state
		assert.deepEqual([held.direction, held.source], ['up', 'd-pad'])

		const handoff = normalizeGamepadFrame(frame({ axes: [0, -0.9], timestamp: 100 }), held)
		assert.deepEqual(handoff.actions, ['up'])
		assert.deepEqual([handoff.state.direction, handoff.state.source], ['up', 'stick'])
		assert.equal(handoff.state.activeSince, 100)

		// 计时从交接帧重新开始：120ms 时不该吐出上一次的「重复」
		assert.deepEqual(actions(frame({ axes: [0, -0.9], timestamp: 120 }), handoff.state), [])
	})

	it('摇杆保持某方向时补按同向方向键：这次按下不被吞掉', () => {
		const stick = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState()).state
		assert.deepEqual([stick.direction, stick.source], ['right', 'stick'])

		const dpad = normalizeGamepadFrame(frame({ pressed: [15], axes: [0.9], timestamp: 40 }), stick)
		assert.deepEqual(dpad.actions, ['right'])
		assert.deepEqual([dpad.state.direction, dpad.state.source], ['right', 'd-pad'])
		assert.equal(dpad.state.activeSince, 40)

		// 计时按方向键重新起算：40+349 不重复，40+350 重复
		assert.deepEqual(actions(frame({ pressed: [15], axes: [0.9], timestamp: 389 }), dpad.state), [])
		assert.deepEqual(actions(frame({ pressed: [15], axes: [0.9], timestamp: 390 }), dpad.state), ['right'])
	})

	it('方向键长按后松开、摇杆已偏同向：交接帧立刻触发而不是补一个时机不可预测的重复', () => {
		// 0→950ms 一直按住方向键右（期间在 350/470/590 各重复过一次）
		let state = createInputState()
		for (const timestamp of [0, 350, 470, 590, 950])
			state = normalizeGamepadFrame(frame({ pressed: [15], timestamp }), state).state
		assert.equal(state.lastRepeatAt, 950)

		const handoff = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 1150 }), state)
		assert.deepEqual(handoff.actions, ['right'])
		assert.deepEqual([handoff.state.direction, handoff.state.source], ['right', 'stick'])
		// 计时归零到交接帧，而不是继承方向键那 1150ms
		assert.deepEqual([handoff.state.activeSince, handoff.state.lastRepeatAt], [1150, 1150])
	})

	it('方向键按住不放、摇杆同侧偏着：不会每帧重复（按住即静默）', () => {
		const state = normalizeGamepadFrame(frame({ pressed: [15], axes: [0.9], timestamp: 0 }), createInputState()).state
		assert.deepEqual(actions(frame({ pressed: [15], axes: [0.9], timestamp: 100 }), state), [])
		assert.deepEqual(actions(frame({ pressed: [15], axes: [0.9], timestamp: 200 }), state), [])
	})
})

describe('方向重复节流：350ms 起，每 120ms 一次', () => {
	it('首次移动立刻触发', () => {
		assert.deepEqual(actions(frame({ axes: [0.9], timestamp: 0 })), ['right'])
	})

	it('349ms 不重复，350ms 首次重复，之后每 120ms 一次', () => {
		let state = createInputState()
		// 必须逐帧回灌状态：重复间隔是相对**上一次触发**的，
		// 拿同一份初始状态反复求值只会重复测到「距按下 350ms」这一条
		const emit = (timestamp) => {
			const result = normalizeGamepadFrame(frame({ axes: [0.9], timestamp }), state)
			state = result.state
			return result.actions
		}

		assert.deepEqual(emit(0), ['right'])
		assert.deepEqual(emit(349), [])
		assert.deepEqual(emit(350), ['right'])
		assert.deepEqual(emit(469), [])
		assert.deepEqual(emit(470), ['right'])
		assert.deepEqual(emit(589), [])
		assert.deepEqual(emit(590), ['right'])
	})

	it('状态回灌推进 lastRepeatAt：未触发时保持上一次的时间戳', () => {
		let state = createInputState()
		const at = (timestamp) => {
			const result = normalizeGamepadFrame(frame({ axes: [0.9], timestamp }), state)
			state = result.state
			return result.state
		}

		assert.equal(at(0).lastRepeatAt, 0)
		assert.equal(at(350).lastRepeatAt, 350)
		assert.equal(at(469).lastRepeatAt, 350)
		assert.equal(at(470).lastRepeatAt, 470)
		assert.equal(at(590).lastRepeatAt, 590)
	})

	it('释放后 activeSince / lastRepeatAt 归零', () => {
		let state = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState()).state
		state = normalizeGamepadFrame(frame({ axes: [0], timestamp: 900 }), state).state

		assert.deepEqual([state.direction, state.activeSince, state.lastRepeatAt], [null, 0, 0])
	})

	it('换向重置计时：没到 350ms 也立刻触发新方向', () => {
		const state = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState()).state
		const turned = normalizeGamepadFrame(frame({ axes: [0, -0.9], timestamp: 100 }), state)

		assert.deepEqual(turned.actions, ['up'])
		assert.equal(turned.state.activeSince, 100)
		assert.equal(turned.state.lastRepeatAt, 100)

		// 计时已重置：再过 350ms 才重复
		assert.deepEqual(actions(frame({ axes: [0, -0.9], timestamp: 449 }), turned.state), [])
		assert.deepEqual(actions(frame({ axes: [0, -0.9], timestamp: 450 }), turned.state), ['up'])
	})

	it('方向键同样走节流', () => {
		const state = normalizeGamepadFrame(frame({ pressed: [14], timestamp: 0 }), createInputState()).state
		assert.deepEqual(actions(frame({ pressed: [14], timestamp: 349 }), state), [])
		assert.deepEqual(actions(frame({ pressed: [14], timestamp: 350 }), state), ['left'])
	})

	it('阈值可覆盖，便于下游测试', () => {
		assert.deepEqual(actions(frame({ axes: [0.3], timestamp: 0 }), createInputState(), { stickThreshold: 0.25 }), ['right'])
		const fast = { repeatDelayMs: 100, repeatIntervalMs: 100 }
		const state = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState(), fast).state
		assert.deepEqual(actions(frame({ axes: [0.9], timestamp: 99 }), state, fast), [])
		assert.deepEqual(actions(frame({ axes: [0.9], timestamp: 100 }), state, fast), ['right'])
	})
})

describe('右摇杆滚动动作', () => {
	it('死区内不产出滚动动作；超出后负轴为 scroll-up、正轴为 scroll-down', () => {
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, 0.2] })), [])
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, -0.9] })), ['scroll-up'])
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, 0.9] })), ['scroll-down'])
	})

	it('恰好等于死区 0.25 视为死区内', () => {
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, 0.25] })), [])
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, -0.25] })), [])
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, -0.26] })), ['scroll-up'])
	})

	it('滚动是电平量：与方向、按键同帧时按固定顺序一并产出', () => {
		const result = normalizeGamepadFrame(frame({ pressed: [0], axes: [0.9, 0, 0, -0.9], timestamp: 0 }), createInputState())
		assert.deepEqual(result.actions, ['confirm', 'right', 'scroll-up'])
	})

	it('滚动不受上一帧状态影响（同状态连帧结果一致）', () => {
		const state = normalizeGamepadFrame(frame({ axes: [0, 0, 0, -0.9], timestamp: 0 }), createInputState()).state
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, -0.9], timestamp: 16 }), state), ['scroll-up'])
	})
})

describe('getScrollDelta：本帧像素', () => {
	it('死区内（含边界 0.25）返回 0', () => {
		assert.equal(getScrollDelta(0, 16), 0)
		assert.equal(getScrollDelta(0.24, 16), 0)
		assert.equal(getScrollDelta(-0.25, 16), 0)
	})

	it('符号约定：负轴（Y 轴朝上）产生负增量，即向上滚', () => {
		assert.ok(getScrollDelta(-0.9, 16) < 0, '负轴应给出负增量')
		assert.ok(getScrollDelta(0.9, 16) > 0, '正轴应给出正增量')
	})

	it('线性映射：刚出死区极慢，推到底恰好 900px/s', () => {
		// travel = (0.625 - 0.25) / 0.75 = 0.5 → 450px/s → 500ms 即 225px
		assert.equal(getScrollDelta(0.625, 500), 225)
		assert.equal(getScrollDelta(-0.625, 500), -225)
		assert.equal(getScrollDelta(1, 1000), 900)
		assert.equal(getScrollDelta(-1, 1000), -900)
	})

	it('速度上限由 maxPixelsPerSecond 控制', () => {
		assert.equal(getScrollDelta(-1, 1000, 300), -300)
		// travel = (0.4 - 0.25) / 0.75 = 0.2 → 60px/s → 1000ms 即 60px。
		// 用近似比较：0.4 - 0.25 在二进制浮点下不精确，硬等会把实现钉死在具体舍入上
		assert.ok(Math.abs(getScrollDelta(-0.4, 1000, 300) - -60) < 1e-9)
	})

	it('帧间隔线性换算：16ms 帧给的是位移而不是速度', () => {
		assert.equal(getScrollDelta(-1, 16), -14.4)
		assert.equal(getScrollDelta(-1, 32), -28.8)
	})

	it('死区可用第 4 参覆盖，且必须与 options.scrollDeadZone 同值', () => {
		assert.equal(getScrollDelta(-0.3, 1000, 900, 0.5), 0)
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, -0.3] }), createInputState(), { scrollDeadZone: 0.5 }), [])
		assert.deepEqual(actions(frame({ axes: [0, 0, 0, -0.6] }), createInputState(), { scrollDeadZone: 0.5 }), ['scroll-up'])
	})

	it('帧间隔为负或非有限值时不产生反向滚动', () => {
		assert.equal(getScrollDelta(-1, -50), 0)
		assert.equal(getScrollDelta(Number.NaN, 16), 0)
		assert.equal(getScrollDelta(Number.POSITIVE_INFINITY, 16), 0)
	})

	it('帧间隔或上限非法时返回 0，绝不把 NaN / Infinity / 反向量交给 scrollBy', () => {
		// Math.max(0, NaN) 仍是 NaN，只靠大小比较抓不住，必须显式判有限性
		assert.equal(getScrollDelta(0.9, Number.NaN), 0)
		assert.equal(getScrollDelta(0.9, Number.POSITIVE_INFINITY), 0)
		assert.equal(getScrollDelta(0.9, Number.NEGATIVE_INFINITY), 0)
		// 上限传负数曾经会把滚动方向整个翻过来
		assert.equal(getScrollDelta(0.9, 16, -300), 0)
		assert.equal(getScrollDelta(-0.9, 16, 0), 0)
		assert.equal(getScrollDelta(0.9, 16, Number.NaN), 0)
	})
})

describe('isStandardGamepad', () => {
	const standard = { mapping: 'standard', buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }

	it('标准映射且按钮数达标 → 可用', () => {
		assert.equal(isStandardGamepad(standard), true)
	})

	it('非标准映射 → 停用', () => {
		assert.equal(isStandardGamepad({ mapping: '', buttons: standard.buttons }), false)
		assert.equal(isStandardGamepad({ mapping: 'non-standard', buttons: standard.buttons }), false)
		assert.equal(isStandardGamepad({ buttons: standard.buttons }), false)
	})

	it('按钮数量不足 → 停用（标准映射需要 16 个）', () => {
		assert.equal(isStandardGamepad({ mapping: 'standard', buttons: standard.buttons.slice(0, 15) }), false)
		assert.equal(isStandardGamepad({ mapping: 'standard', buttons: [] }), false)
		assert.equal(isStandardGamepad({ mapping: 'standard' }), false)
	})
})

describe('纯度', () => {
	it('穿插其它调用后同输入结果不变（模块里没有藏着「上一帧」）', () => {
		const input = frame({ pressed: [0], axes: [0.9, 0, 0, -0.9], timestamp: 1000 })
		const previous = normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 800 }), createInputState()).state
		const expected = normalizeGamepadFrame(input, previous)

		// 若模块内持有模块级变量（上一帧 / 上次时间戳），这几次穿插就会污染结果
		for (const noise of [
			frame({ pressed: [9], axes: [0, -0.9], timestamp: 1001 }),
			frame({ pressed: [1], timestamp: 1002 }),
			frame({ pressed: [0], axes: [-0.9, 0], timestamp: 5000 }),
		])
			normalizeGamepadFrame(noise, createInputState())

		assert.deepEqual(normalizeGamepadFrame(input, previous), expected)
	})

	it('不改写入参：frame 与 previous 保持原样', () => {
		const input = frame({ pressed: [0, 12], axes: [0.9, 0, 0, -0.9], timestamp: 1000 })
		const inputSnapshot = structuredClone(input)
		const previous = Object.freeze(normalizeGamepadFrame(frame({ axes: [0.9], timestamp: 0 }), createInputState()).state)
		const previousSnapshot = structuredClone(previous)

		normalizeGamepadFrame(input, previous)

		assert.deepEqual(input, inputSnapshot)
		assert.deepEqual(previous, previousSnapshot)
	})

	it('createInputState 给出的是可安全复用的中性初值', () => {
		const a = createInputState()
		const b = createInputState()

		assert.deepEqual(a, { direction: null, source: null, activeSince: 0, lastRepeatAt: 0, buttons: [] })
		assert.deepEqual(a, b)
		assert.notEqual(a, b)
	})

	it('状态记下了方向的来源（d-pad / stick），供下游区分交接', () => {
		const dpad = normalizeGamepadFrame(frame({ pressed: [14], timestamp: 0 }), createInputState()).state
		const stick = normalizeGamepadFrame(frame({ axes: [-0.9], timestamp: 10 }), createInputState()).state
		const idle = normalizeGamepadFrame(frame({ timestamp: 20 }), createInputState()).state

		assert.deepEqual([dpad.direction, dpad.source], ['left', 'd-pad'])
		assert.deepEqual([stick.direction, stick.source], ['left', 'stick'])
		assert.deepEqual([idle.direction, idle.source], [null, null])
	})
})
