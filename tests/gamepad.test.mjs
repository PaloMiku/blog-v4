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
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
	createInputState,
	getScrollDelta,
	isStandardGamepad,
	normalizeGamepadFrame,
} from '../src/lib/gamepad-input.ts'
import { createGamepadController } from '../src/lib/gamepad.ts'

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

// ---------------------------------------------------------------------------
// EC-005：`src/lib/gamepad.ts`（浏览器生命周期）的假设备夹具。
//
// 上面的用例钉的是**纯映射**；这一段钉的是纯映射管不到、却最容易在真机上
// 「差不多能用」地错掉的那部分：设备热插拔、index 被复用、页面隐藏/失焦，
// 以及「没有东西可读时还在空跑 rAF」。这些在 CI 里插不上真手柄，于是把浏览器
// 能力面（window 的事件与 rAF、document 的 hidden/hasFocus、getGamepads、时钟）
// 做成 double 去驱动**真实实现**——不改生产代码里的 `typeof` 守卫，也不新加依赖。
//
// 两条夹具纪律：
// - `getGamepads()` 每次返回**新的**稀疏数组。真机每次调用都是新快照，
//   若实现靠引用相等蒙混过关，这里就抓不到它。
// - 时钟由夹具推进，实现里的 `now()` 是注入的缝。见下方 `rig.frame()`。

/** 事件监听表：只存回调，够驱动 add / remove / dispatch 与「绑定是否幂等」的计数 */
function createListeners() {
	const table = new Map()
	return {
		add(type, fn) {
			const list = table.get(type) ?? []
			list.push(fn)
			table.set(type, list)
		},
		remove(type, fn) {
			const list = table.get(type) ?? []
			const at = list.indexOf(fn)
			if (at >= 0)
				list.splice(at, 1)
		},
		dispatch(type) {
			// 复制一份再遍历：实现里的回调可能反过来摘监听
			for (const fn of [...(table.get(type) ?? [])])
				fn({ type })
		},
		count: () => [...table.values()].reduce((sum, list) => sum + list.length, 0),
	}
}

/**
 * 浏览器能力面 double。
 * `pending()` 是这一段的核心断言口：控制器停摆时挂起的 rAF 必须是 0，
 * 「不空跑 rAF」是规格里的一句硬要求，靠「跑几帧看有没有回调」是钉不死的。
 */
function createEnvironment({ hidden = false, focused = true } = {}) {
	const windowListeners = createListeners()
	const documentListeners = createListeners()
	const frames = new Map()
	let nextHandle = 0
	let focusedState = focused
	const win = {
		addEventListener: (type, fn) => windowListeners.add(type, fn),
		removeEventListener: (type, fn) => windowListeners.remove(type, fn),
		requestAnimationFrame(fn) {
			const handle = ++nextHandle
			frames.set(handle, fn)
			return handle
		},
		cancelAnimationFrame(handle) {
			frames.delete(handle)
		},
	}
	const doc = {
		hidden,
		hasFocus: () => focusedState,
		addEventListener: (type, fn) => documentListeners.add(type, fn),
		removeEventListener: (type, fn) => documentListeners.remove(type, fn),
	}
	return {
		win,
		doc,
		pending: () => frames.size,
		listeners: () => windowListeners.count() + documentListeners.count(),
		/** 执行一个已排期的 rAF 回调。一帧一个回调，所以取最早排期的那个 */
		runFrame() {
			const entry = frames.entries().next().value
			if (!entry)
				return false
			frames.delete(entry[0])
			entry[1]()
			return true
		},
		hide: () => {
			doc.hidden = true
			documentListeners.dispatch('visibilitychange')
		},
		show: () => {
			doc.hidden = false
			documentListeners.dispatch('visibilitychange')
		},
		focus: () => {
			focusedState = true
			windowListeners.dispatch('focus')
		},
		blur: () => {
			focusedState = false
			windowListeners.dispatch('blur')
		},
		connect: () => windowListeners.dispatch('gamepadconnected'),
		disconnect: () => windowListeners.dispatch('gamepaddisconnected'),
		leave: () => windowListeners.dispatch('pagehide'),
		back: () => windowListeners.dispatch('pageshow'),
	}
}

/** 标准映射设备：0–16 共 17 个按钮，与真机标准布局的按钮数一致 */
function createDevice({ pressed = [], axes = [], mapping = 'standard', buttons = 17 } = {}) {
	return {
		mapping,
		buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: pressed.includes(i) })),
		axes: [...axes],
	}
}

/**
 * 稀疏设备表：未连接的槽位保持 `null` 或干脆留空洞，模拟 `getGamepads()`
 * 的空洞与 index 复用。`read()` 每次返回**新的**数组（`slice` 保留空洞），
 * 见上面的夹具纪律——真机每次调用都是新快照。
 */
function createDevices(initial = []) {
	const slots = [...initial]
	return {
		slots,
		read: () => slots.slice(),
		connect: (index, options) => {
			slots[index] = createDevice(options)
		},
		disconnect: (index) => {
			slots[index] = null
		},
		press: (index, pressed) => {
			const pad = slots[index]
			if (pad)
				pad.buttons = Array.from({ length: pad.buttons.length }, (_, i) => ({ pressed: pressed.includes(i) }))
		},
		axes: (index, axes) => {
			if (slots[index])
				slots[index].axes = [...axes]
		},
	}
}

/**
 * 已装上的浏览器能力面。
 * 实现是从 `globalThis.window` / `globalThis.document` 上取能力的，所以夹具必须
 * 装全局、断言也必须看**同一个**环境——各造各的会得到「控制器在跑、夹具说没跑」
 * 这种自相矛盾的现象（第一版就踩过）。
 */
let installed = null

/** 一整套可驱动的夹具：浏览器能力面 + 设备表 + 时钟 + 控制器 */
function createRig(devices, overrides = {}) {
	const environment = installed ?? createEnvironment()
	const clock = { value: 0 }
	const events = { actions: [], intents: [], connected: [], disconnections: 0 }
	const modes = { active: false, autoEntryAllowed: true }
	const controller = createGamepadController({
		getGamepads: () => devices.read(),
		now: () => clock.value,
		isModeActive: () => modes.active,
		isAutoEntryAllowed: () => modes.autoEntryAllowed,
		onAction: (action, context) => events.actions.push({ action, context }),
		onEntryIntent: action => events.intents.push(action),
		onConnection: status => events.connected.push(status),
		onDisconnection: () => events.disconnections++,
		...overrides,
	})
	/** 推进一帧：先走时钟再执行 rAF 回调（实现是在回调里读 `now()`） */
	const frame = (ms = 16) => {
		clock.value += ms
		return environment.runFrame()
	}
	return {
		controller,
		events,
		environment,
		status: () => controller.getStatus(),
		frame,
		/** 连跑若干帧，返回真的跑了几帧。返回 0 即「根本没有循环在跑」 */
		frames(count, ms = 16) {
			let ran = 0
			for (let i = 0; i < count; i++) {
				if (environment.pending() === 0)
					break
				if (frame(ms))
					ran++
			}
			return ran
		},
		actions: () => events.actions.map(item => item.action),
		contexts: () => events.actions.map(item => item.context),
		/** 模拟 Shell 完成 `enterBigPicture()` */
		enter: () => {
			modes.active = true
		},
		suppress: (value = true) => {
			modes.autoEntryAllowed = !value
		},
	}
}

/** 装上浏览器能力面 double。每个用例块自己装、自己拆，块与块之间不串味 */
function installEnvironment() {
	installed = createEnvironment()
	globalThis.window = installed.win
	globalThis.document = installed.doc
	return installed
}

function uninstallEnvironment() {
	installed = null
	delete globalThis.window
	delete globalThis.document
}

describe('手柄生命周期：连接与设备选择', () => {
	beforeEach(installEnvironment)
	afterEach(uninstallEnvironment)

	it('标准映射设备接入：报一次连接、开始轮询，状态可读', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)

		rig.controller.start()

		assert.deepEqual(rig.events.connected, ['ready'])
		assert.deepEqual(rig.status(), { support: 'supported', device: 'ready' })
		assert.equal(rig.controller.isRunning(), true)
		assert.equal(rig.environment.pending(), 1)
	})

	it('状态不变时不重复报连接', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)

		rig.controller.start()
		rig.frames(5)
		rig.controller.refresh()
		rig.controller.refresh()

		assert.deepEqual(rig.events.connected, ['ready'])
	})

	it('设备全部消失：报一次断开并停轮询（模式由 Shell 决定，本层不动它）', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.frames(2)

		devices.disconnect(0)
		rig.environment.disconnect()

		assert.equal(rig.events.disconnections, 1)
		assert.deepEqual(rig.status(), { support: 'supported', device: 'none' })
		assert.equal(rig.controller.isRunning(), false)
		assert.equal(rig.environment.pending(), 0)
		assert.equal(rig.frames(3), 0, '断开后不应留下空跑的 rAF')
	})

	it('非标准映射：报不支持、继续正常浏览（不轮询）', () => {
		const devices = createDevices([createDevice({ mapping: '' })])
		const rig = createRig(devices)

		rig.controller.start()

		assert.deepEqual(rig.events.connected, ['unsupported-mapping'])
		assert.equal(rig.controller.isRunning(), false)
		assert.equal(rig.environment.pending(), 0)
	})

	it('标准映射但按钮数不足：与「非标准映射」区分开（门槛来自 MIN_STANDARD_BUTTONS）', () => {
		const insufficient = createRig(createDevices([createDevice({ buttons: 15 })]))
		insufficient.controller.start()
		assert.deepEqual(insufficient.events.connected, ['insufficient-buttons'])
		assert.equal(insufficient.controller.isRunning(), false)

		// 恰好 16 个按钮即达标
		const enough = createRig(createDevices([createDevice({ buttons: 16 })]))
		enough.controller.start()
		assert.deepEqual(enough.events.connected, ['ready'])
		assert.equal(enough.controller.isRunning(), true)
	})

	it('稀疏数组里的空洞与 null 不算设备，index 从真实槽位读起', () => {
		// 下标 0 是 null、1 是真正的空洞（没有这个槽位）、2 才是设备
		const slots = [null, createDevice(), createDevice()]
		delete slots[1]
		const devices = createDevices(slots)
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		devices.press(2, [13])
		rig.frame()

		assert.deepEqual(rig.actions(), ['down'])
		assert.equal(rig.contexts().at(-1).index, 2)
	})

	it('未连接时只保留连接监听，不空跑 rAF；插上后自动开始', () => {
		const devices = createDevices([])
		const rig = createRig(devices)

		rig.controller.start()

		assert.equal(rig.environment.pending(), 0)
		assert.equal(rig.frames(3), 0)
		// 6 个 window 监听（连接/断开/焦点/失焦/pagehide/pageshow）+ 1 个 visibilitychange
		assert.equal(rig.environment.listeners(), 7)

		devices.connect(0)
		rig.environment.connect()

		assert.deepEqual(rig.events.connected, ['ready'])
		assert.equal(rig.controller.isRunning(), true)
	})

	it('静置的设备不白占名额：按下按钮的那个才成为输入来源', () => {
		const devices = createDevices([createDevice(), createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		// 只有 index 1 被按下
		devices.press(1, [5])
		rig.frame()

		assert.deepEqual(rig.actions(), ['next-region'])
		assert.equal(rig.contexts().at(-1).index, 1)
	})

	it('多个手柄同时按下：只回应 index 最小的那个', () => {
		const devices = createDevices([createDevice(), createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		devices.press(0, [13])
		devices.press(1, [13])
		rig.frame()

		assert.deepEqual(rig.actions(), ['down'])
		assert.equal(rig.contexts().at(-1).index, 0)

		// 松开 1 再按 0：被忽略的那个设备全程没有产生任何动作
		devices.press(1, [])
		rig.frame()
		assert.deepEqual(rig.actions(), ['down'])
	})

	it('当前设备断开、仍有其它可用设备：不报断开，另一设备可用新按键接管', () => {
		const devices = createDevices([createDevice(), createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm'])

		// 0 号拔掉，同时 1 号已经按住
		devices.disconnect(0)
		devices.press(1, [13])
		rig.environment.disconnect()

		assert.deepEqual(rig.events.connected, ['ready'])
		assert.equal(rig.events.disconnections, 0)

		// 接管前必须看到「全部松开」
		rig.frames(3)
		assert.deepEqual(rig.actions(), ['confirm'])

		devices.press(1, [])
		rig.frame()
		devices.press(1, [13])
		rig.frame()

		assert.deepEqual(rig.actions(), ['confirm', 'down'])
		assert.equal(rig.contexts().at(-1).index, 1)
	})

	it('index 被复用：槽位换人后仍按住的按钮不会被当成新按下', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm'])

		// 旧设备拔掉，新设备立刻占住同一个槽位，A 仍然是按下的
		devices.disconnect(0)
		devices.connect(0, { pressed: [0] })
		rig.environment.disconnect()
		rig.environment.connect()
		rig.frames(4)

		assert.deepEqual(rig.actions(), ['confirm'], '不得凭记住的 index 生成输入')

		devices.press(0, [])
		rig.frame()
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm', 'confirm'])
	})
})

describe('手柄生命周期：首次输入只进入，且要松开再按', () => {
	beforeEach(installEnvironment)
	afterEach(uninstallEnvironment)

	it('模式未激活：第一次按键只请求进入，**不**发布动作', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.frames(2)

		devices.press(0, [0])
		rig.frame()

		assert.deepEqual(rig.events.intents, ['confirm'])
		assert.deepEqual(rig.actions(), [], '进入用的那次按键必须被消耗')

		// 一直按住：不再请求进入，也不发布动作
		rig.frames(5)
		assert.deepEqual(rig.events.intents, ['confirm'])
		assert.deepEqual(rig.actions(), [])
	})

	it('进入后必须松开再按，下一次按下才执行为动作', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.frames(2)

		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.events.intents, ['confirm'])

		// 松开：门闩解开，但模式尚未激活，仍不发布动作
		devices.press(0, [])
		rig.frame()
		assert.deepEqual(rig.actions(), [])

		// Shell 完成进入；重新按下才是「确认」
		rig.enter()
		devices.press(0, [0])
		rig.frame()

		assert.deepEqual(rig.actions(), ['confirm'])
		assert.deepEqual(rig.events.intents, ['confirm'])
	})

	it('方向键也能请求进入（它同样是按钮），摇杆漂移则不能', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.frames(2)

		// 左摇杆漂移：既不进入也不动作
		devices.axes(0, [0.9])
		rig.frame()
		assert.deepEqual(rig.events.intents, [])
		assert.deepEqual(rig.actions(), [])

		// 摇杆回中后按方向键：请求进入
		devices.axes(0, [0])
		devices.press(0, [12])
		rig.frame()
		assert.deepEqual(rig.events.intents, ['up'])
		assert.deepEqual(rig.actions(), [])
	})

	it('未映射的按钮按下：不进入也不动作', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.frames(2)

		devices.press(0, [2, 3])
		rig.frames(3)

		assert.deepEqual(rig.events.intents, [])
		assert.deepEqual(rig.actions(), [])

		// 随后按下真正的动作键，进入意图照常
		devices.press(0, [2, 3, 1])
		rig.frame()
		assert.deepEqual(rig.events.intents, ['back'])
	})
})

describe('手柄生命周期：可见性、失焦与离开', () => {
	beforeEach(installEnvironment)
	afterEach(uninstallEnvironment)

	it('页面隐藏：停轮询；重新可见：重新读设备后恢复', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)
		assert.equal(rig.environment.pending(), 1)

		rig.environment.hide()
		assert.equal(rig.controller.isRunning(), false)
		assert.equal(rig.environment.pending(), 0)
		assert.equal(rig.frames(3), 0, '隐藏期间确实没有 rAF 在跑')

		rig.environment.show()
		assert.equal(rig.controller.isRunning(), true)
		rig.frames(2)
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm'])
	})

	it('重新可见时仍按住的按钮必须先松开才被认', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm'])

		rig.environment.hide()
		rig.environment.show()
		rig.frames(4)

		assert.deepEqual(rig.actions(), ['confirm'], '恢复时不得把「仍按住」当成新按下')

		devices.press(0, [])
		rig.frame()
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm', 'confirm'])
	})

	it('失焦停轮询，重新聚焦后恢复', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		rig.environment.blur()
		assert.equal(rig.environment.pending(), 0)
		assert.equal(rig.frames(2), 0)

		rig.environment.focus()
		assert.equal(rig.environment.pending(), 1)
		devices.press(0, [1])
		rig.frame()
		assert.deepEqual(rig.actions(), ['back'])
	})

	it('页面离开：停轮询但保留监听；回到页面时自动恢复', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		rig.environment.leave()
		assert.equal(rig.controller.isRunning(), false)
		assert.equal(rig.environment.pending(), 0)
		assert.equal(rig.environment.listeners(), 7, '离开页面不能把监听也摘掉，否则 pageshow 没人接')

		rig.environment.back()
		assert.equal(rig.controller.isRunning(), true)
		devices.press(0, [1])
		rig.frame()
		assert.deepEqual(rig.actions(), ['back'])
	})

	it('start / stop / refresh 幂等；stop 之后不留任何挂起的 rAF 与监听', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)

		rig.controller.start()
		rig.controller.start()
		assert.equal(rig.environment.pending(), 1, '重复 start 不得出现两条循环')
		assert.equal(rig.environment.listeners(), 7, '重复 start 不得重复绑监听')

		rig.controller.refresh()
		assert.equal(rig.environment.pending(), 1)

		rig.controller.stop()
		assert.equal(rig.controller.isRunning(), false)
		assert.equal(rig.environment.pending(), 0)
		assert.equal(rig.environment.listeners(), 0)

		rig.controller.stop()
		assert.equal(rig.environment.pending(), 0)

		// stop 之后事件不再影响它，重新 start 可以复活
		devices.press(0, [0])
		rig.environment.connect()
		assert.equal(rig.environment.pending(), 0)

		rig.controller.start()
		assert.equal(rig.environment.pending(), 1)
	})

	it('自动进入被抑制且模式未激活时不轮询；进入模式后由调用方再次 start 恢复', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.suppress(true)

		rig.controller.start()
		assert.equal(rig.environment.pending(), 0)

		rig.enter()
		rig.controller.start()
		assert.equal(rig.environment.pending(), 1)
		devices.press(0, [0])
		rig.frame()
		assert.deepEqual(rig.actions(), ['confirm'])
	})
})

describe('手柄生命周期：帧上下文与跨帧状态', () => {
	beforeEach(installEnvironment)
	afterEach(uninstallEnvironment)

	it('滚动是电平动作，像素由消费方用 getScrollDelta 算（控制器不产生像素）', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		devices.axes(0, [0, 0, 0, -0.625])
		rig.frame()
		devices.axes(0, [0, 0, 0, -0.625])
		rig.frame()

		assert.deepEqual(rig.actions(), ['scroll-up', 'scroll-up'], '电平量每帧都报')
		const [first, second] = rig.contexts()
		assert.deepEqual([first.axisY, second.axisY], [-0.625, -0.625])
		// 帧间隔量的是「距上一帧」，与上一帧有没有动作无关：两帧都是真实的 16ms
		assert.deepEqual([first.deltaMs, second.deltaMs], [16, 16])
		assert.ok(second.timestamp > first.timestamp)
		// travel = (0.625 - 0.25) / 0.75 = 0.5 → 450px/s → 16ms 即 7.2px
		assert.equal(getScrollDelta(second.axisY, second.deltaMs), -7.2)
	})

	it('帧间隔被夹到 250ms：标签页解冻后的第一帧不会一次滚掉好几屏', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		devices.axes(0, [0, 0, 0, -1])
		rig.frame()
		rig.frame(5000)

		assert.equal(rig.contexts().at(-1).deltaMs, 250)
	})

	it('按住方向时跨帧维持节流状态：350ms 后第一次重复', () => {
		const devices = createDevices([createDevice()])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		devices.axes(0, [0.9])
		rig.frame() // 首次立刻
		rig.frame(349) // 距按下 349ms：不重复
		rig.frame() // 365ms ≥ 350：重复

		assert.deepEqual(rig.actions(), ['right', 'right'])
	})

	it('真机 Gamepad 对象被浏览器复用时，按键边沿判定仍然成立', () => {
		// 同一个对象原地改写按钮数组（真机就是这样复用 Gamepad 的）
		const pad = createDevice()
		const devices = createDevices([pad])
		const rig = createRig(devices)
		rig.controller.start()
		rig.enter()
		rig.frames(2)

		pad.buttons[0].pressed = true
		rig.frame()
		rig.frame()
		pad.buttons[0].pressed = false
		rig.frame()
		pad.buttons[0].pressed = true
		rig.frame()

		assert.deepEqual(rig.actions(), ['confirm', 'confirm'])
	})

	it('getGamepads 抛错：当作没有设备，不把异常抛给页面', () => {
		const rig = createRig(createDevices([]), {
			getGamepads: () => {
				throw new Error('SecurityError')
			},
		})

		rig.controller.start()

		assert.deepEqual(rig.status(), { support: 'supported', device: 'none' })
		assert.equal(rig.environment.pending(), 0)
	})
})

describe('手柄生命周期：能力回退', () => {
	afterEach(uninstallEnvironment)

	it('没有 window / document / getGamepads：给出可读的不支持状态，且不抛', () => {
		globalThis.window = undefined
		globalThis.document = undefined

		const controller = createGamepadController()

		assert.deepEqual(controller.getStatus(), { support: 'unsupported', device: 'none' })
		assert.doesNotThrow(() => {
			controller.start()
			controller.refresh()
			controller.stop()
		})
		assert.equal(controller.isRunning(), false)
	})

	it('有设备源但没有 rAF：同样判为不支持（没有轮询载体）', () => {
		globalThis.window = { addEventListener() {}, removeEventListener() {} }
		globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }

		const controller = createGamepadController({ getGamepads: () => [] })

		assert.equal(controller.getStatus().support, 'unsupported')
		assert.equal(controller.isRunning(), false)
	})

	it('有 rAF 与事件但浏览器没有 getGamepads：判为不支持', () => {
		// Node 的 navigator 上没有 getGamepads，正好模拟旧浏览器 / 非安全上下文
		const environment = installEnvironment()
		const controller = createGamepadController()

		assert.equal(controller.getStatus().support, 'unsupported')
		controller.start()
		assert.equal(environment.pending(), 0)
	})

	it('回调全部缺省也能跑：只注入 getGamepads 即可', () => {
		const environment = installEnvironment()
		const controller = createGamepadController({ getGamepads: () => [createDevice({ pressed: [0] })] })

		assert.doesNotThrow(() => {
			controller.start()
			environment.runFrame()
			controller.stop()
		})
	})
})
