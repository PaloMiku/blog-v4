/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：大屏模式的「标签页会话」与「模式状态单例」合同单测。
// 手柄大屏最难在 CI 里验的正是这两层：它们决定「同一标签页里模式能不能续上」
// 与「手柄断开后模式会不会被悄悄改掉」。所以这里逐条钉死：
//   会话   —— 模式 / 抑制开关的往返；存储抛错时降级到内存而不是把页面带崩；
//             坏 JSON、站外来源、超过 30 分钟的记录、落地页与来源同路径一律判废；
//             来源记录是一次性的（读走即清）。
//   状态   —— 订阅立即拿到当前值；进入写根属性 + 会话；退出移除根属性，
//             且**只有手动退出**写抑制；抑制挡自动进入、不挡手动进入；
//             模式与抽屉状态互不覆盖；astro 生命周期绑定幂等，
//             before-swap 不清模式意图，page-load 从会话恢复。
//   动作   —— B 键层级优先级表（设置 → 最上层 modal → 下拉 → 抽屉 → 页面返回）、
//             退场动画期间吞掉 B、页面级返回的来源优先与四类兜底、
//             来源恢复的一次性、设置面板的 localStorage 往返与内存降级、
//             以及「首次按键只进入、松开再按才执行」在真实模式单例上的表现。
// 另钉两条「不该存在」：不导出可变的订阅者集合；模式联合里不含设备连接状态。
import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import * as bigPictureSession from '../src/lib/big-picture-session.ts'
import * as bigPictureState from '../src/lib/big-picture-state.ts'
import { createGamepadController } from '../src/lib/gamepad.ts'
import * as layoutState from '../src/lib/layout-state.ts'

const {
	AUTO_ENTRY_SUPPRESSED_KEY,
	SESSION_KEY,
	SOURCE_KEY,
	consumeNavigationSource,
	readAutoEntrySuppressed,
	readSessionMode,
	recordNavigationSource,
	writeAutoEntrySuppressed,
	writeSessionMode,
} = bigPictureSession

const {
	AUTO_ENTRY_ENABLED_KEY,
	RESTORE_FOCUS_KEY,
	bindBigPictureGlobals,
	enterBigPicture,
	exitBigPicture,
	getBigPictureState,
	isAutoEntrySuppressed,
	readAutoEntryEnabled,
	readRestoreFocusKey,
	resolveBackLayer,
	resolvePageReturn,
	resolveShellView,
	setAutoEntrySuppressed,
	setBigPictureState,
	subscribeBigPicture,
	writeAutoEntryEnabled,
	writeRestoreFocusKey,
} = bigPictureState

/** 规格：过期来源（超过 30 分钟）不再用于返回 */
const TTL = 30 * 60 * 1000

/** 合规的 Storage double：签名与浏览器 Storage 一致，可直接当参数传 */
function createStorage() {
	const data = new Map()
	return {
		getItem: key => (data.has(key) ? data.get(key) : null),
		setItem: (key, value) => { data.set(key, String(value)) },
		removeItem: (key) => { data.delete(key) },
		clear: () => data.clear(),
		peek: key => (data.has(key) ? data.get(key) : null),
	}
}

/**
 * 无痕模式 / 用户禁用存储时的 storage：`getItem` / `setItem` / `removeItem` 全抛。
 * calls 用来断言「坏存储不会被反复触碰」。
 */
function createThrowingStorage() {
	const calls = { get: 0, set: 0, remove: 0 }
	const boom = bump => () => {
		bump()
		throw new Error('SecurityError')
	}
	return {
		calls,
		getItem: boom(() => { calls.get++ }),
		setItem: boom(() => { calls.set++ }),
		removeItem: boom(() => { calls.remove++ }),
	}
}

/** 最小 document double：只提供本模块真正用到的那两个面（根属性 + 事件） */
function createDocument() {
	const listeners = new Map()
	return {
		documentElement: { dataset: {} },
		addEventListener(type, fn) {
			const list = listeners.get(type) ?? []
			list.push(fn)
			listeners.set(type, list)
		},
		dispatch(type, event = {}) {
			for (const fn of listeners.get(type) ?? [])
				fn(event)
		},
		/** 全部类型的监听总数，用于钉死「绑定幂等」 */
		count() {
			let total = 0
			for (const list of listeners.values())
				total += list.length
			return total
		},
		reset() {
			this.documentElement.dataset = {}
		},
	}
}

/** 造一个「点了某个选择器」的点击事件；matched=false 模拟点到别处 */
function clickOn(selector, matched = true) {
	return { target: { closest: sel => (matched && sel === selector ? {} : null) } }
}

const sessionStorage = createStorage()
const documentDouble = createDocument()

// 本模块在模块作用域不碰任何浏览器全局（见两个源文件的头注释），所以这里可以
// 在 import 之后才装上替身：装上之前调用任何导出函数都应是安全的 no-op。
globalThis.document = documentDouble
globalThis.window = { sessionStorage }

before(() => {
	// 只绑一次（幂等守卫在模块里），后续用例靠 dispatch 复用同一批监听
	bindBigPictureGlobals()
})

beforeEach(() => {
	sessionStorage.clear()
	documentDouble.reset()
	setAutoEntrySuppressed(false)
	setBigPictureState('inactive')
	layoutState.closeLayout()
})

describe('会话模式读写', () => {
	it('空存储一律 inactive（会话缺省不是「上次进过模式」）', () => {
		assert.equal(readSessionMode(createStorage()), 'inactive')
	})

	it('active 往返；再写 inactive 会覆盖掉上一次的 active', () => {
		const storage = createStorage()

		writeSessionMode(storage, true)
		assert.equal(readSessionMode(storage), 'active')

		writeSessionMode(storage, false)
		assert.equal(readSessionMode(storage), 'inactive')
	})

	it('存了无法识别的值一律按 inactive 解析（不把脏值变成第三种模式）', () => {
		for (const value of ['true', 'ACTIVE', 'on', '1', ''])
			assert.equal(readSessionMode({ getItem: () => value, setItem: () => {}, removeItem: () => {} }), 'inactive')
	})

	it('抑制开关往返', () => {
		const storage = createStorage()

		assert.equal(readAutoEntrySuppressed(storage), false)

		writeAutoEntrySuppressed(storage, true)
		assert.equal(readAutoEntrySuppressed(storage), true)
		assert.equal(storage.peek(AUTO_ENTRY_SUPPRESSED_KEY), 'true')

		writeAutoEntrySuppressed(storage, false)
		assert.equal(readAutoEntrySuppressed(storage), false)
	})

	it('抑制键存了非 true 的值一律按未抑制解析', () => {
		assert.equal(readAutoEntrySuppressed({ getItem: () => '1', setItem: () => {}, removeItem: () => {} }), false)
	})
})

describe('存储不可用时降级到内存（抛错 / 为 null），页面不崩', () => {
	it('读取不抛，且模式回落到 inactive', () => {
		const storage = createThrowingStorage()

		assert.equal(readSessionMode(storage), 'inactive')
		assert.equal(readAutoEntrySuppressed(storage), false)
	})

	it('写入不抛，且本次会话内读得回来（内存兜底）', () => {
		const storage = createThrowingStorage()

		writeSessionMode(storage, true)
		writeAutoEntrySuppressed(storage, true)

		assert.equal(readSessionMode(storage), 'active')
		assert.equal(readAutoEntrySuppressed(storage), true)
	})

	it('来源记录的写入与消费同样不抛：写进内存也读得回来（本次标签页内一致）', () => {
		const storage = createThrowingStorage()

		recordNavigationSource(storage, { path: '/a', destination: '/b', key: 'k', page: 'home' })

		const consumed = consumeNavigationSource(storage, '/b')
		assert.equal(consumed?.path, '/a')
		assert.equal(consumed?.key, 'k')
	})

	it('同一个坏存储只被触碰一次：首次失败后不再反复试错', () => {
		const storage = createThrowingStorage()

		writeSessionMode(storage, true)
		assert.equal(storage.calls.set, 1, '第一次 setItem 抛错后应转为内存')

		writeSessionMode(storage, false)
		readSessionMode(storage)
		consumeNavigationSource(storage, '/x')

		assert.deepEqual(storage.calls, { get: 0, set: 1, remove: 0 })
	})

	it('storage 为 null 时五个公开入口全部存活（WeakMap 拿非对象当键会抛 TypeError）', () => {
		assert.equal(readSessionMode(null), 'inactive')
		assert.equal(readAutoEntrySuppressed(null), false)
		assert.equal(consumeNavigationSource(null, '/b'), null)

		assert.doesNotThrow(() => writeSessionMode(null, true))
		assert.doesNotThrow(() => writeAutoEntrySuppressed(null, true))
		assert.doesNotThrow(() => recordNavigationSource(null, { path: '/a', destination: '/b', key: 'k', page: 'home' }))

		// 共享同一个兜底，所以这些读写在本次运行内自洽（与「压根没存储」可分辨）
		assert.equal(readSessionMode(null), 'active')
		assert.equal(readAutoEntrySuppressed(null), true)
		assert.equal(consumeNavigationSource(null, '/b')?.path, '/a')
	})
})

describe('导航来源记录', () => {
	it('往返：写入什么就读回什么', () => {
		const storage = createStorage()

		recordNavigationSource(storage, { path: '/', destination: '/posts/a', key: 'posts/a', page: 'reading' }, 1000)

		assert.deepEqual(consumeNavigationSource(storage, '/posts/a', 1000), {
			path: '/',
			destination: '/posts/a',
			key: 'posts/a',
			page: 'reading',
			timestamp: 1000,
		})
	})

	it('目的地必须是当前页：冲别的页面写的旧记录不得被这里捡走', () => {
		// 规格那句是合取：「目标与当前路径匹配」且「来源属于核心页面」。
		// 只判来源的话，一条最长 30 分钟的记录会被任意页面捡走当来源
		for (const current of ['/x', '/x/', '/posts/b']) {
			const storage = createStorage()
			recordNavigationSource(storage, { path: '/', destination: '/posts/a', key: 'k', page: 'home' }, 1000)

			assert.equal(consumeNavigationSource(storage, current, 1000), null, current)
			assert.equal(storage.peek(SOURCE_KEY), null, current)
		}
	})

	it('目的地比较走归一化（build.format: directory，尾斜杠不算不同页）', () => {
		// 不含 `['/', '/']`：来源与落地页同路径时按「没有返回来源」处理，
		// 那条规则由下面那条用例单独钉着
		for (const [recorded, current] of [['/posts/a', '/posts/a/'], ['/posts/a/', '/posts/a']]) {
			const storage = createStorage()
			recordNavigationSource(storage, { path: '/', destination: recorded, key: 'k', page: 'home' }, 1000)

			assert.notEqual(consumeNavigationSource(storage, current, 1000), null, `${recorded} → ${current}`)
		}
	})

	it('一次性：读走即清，第二次拿不到', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/', destination: '/b', key: 'k', page: 'home' }, 1000)

		assert.notEqual(consumeNavigationSource(storage, '/b', 1000), null)
		assert.equal(consumeNavigationSource(storage, '/b', 1000), null)
		assert.equal(storage.peek(SOURCE_KEY), null)
	})

	it('时间戳来自注入的 now，不读墙钟', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/a', destination: '/b' }, 1234)

		assert.equal(consumeNavigationSource(storage, '/b', 1234)?.timestamp, 1234)
	})

	it('key / page 缺省补空串（焦点恢复与页面类型判定各自有兜底）', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/a', destination: '/b' }, 1000)

		assert.deepEqual(consumeNavigationSource(storage, '/b', 1000), {
			path: '/a',
			destination: '/b',
			key: '',
			page: '',
			timestamp: 1000,
		})
	})

	it('站外来源根本不写入（每个 storage 各自断言，不借读端共用逻辑）', () => {
		for (const path of ['https://evil.example/a', '//evil.example/a', '/\\evil.example/a', 'posts/a']) {
			const storage = createStorage()
			recordNavigationSource(storage, { path, destination: '/b' }, 1000)

			assert.equal(storage.peek(SOURCE_KEY), null, path)
		}
	})

	it('站外目的地同样不写入（否则等于记录一个永远不会命中的来源）', () => {
		for (const destination of ['https://evil.example/a', '//evil.example/a', '/\\evil.example/a', 'posts/a']) {
			const storage = createStorage()
			recordNavigationSource(storage, { path: '/a', destination }, 1000)

			assert.equal(storage.peek(SOURCE_KEY), null, destination)
		}
	})

	it('path / destination 不合型时早退而不抛（下游是内联点击处理器）', () => {
		for (const source of [
			{ path: 42, destination: '/b' },
			{ path: null, destination: '/b' },
			{ path: '/a' },
			{ path: '/a', destination: 42 },
			{ path: '/a', destination: null },
			{},
			null,
			undefined,
		]) {
			const storage = createStorage()

			assert.doesNotThrow(() => recordNavigationSource(storage, source, 1000))
			assert.equal(storage.peek(SOURCE_KEY), null, JSON.stringify(source))
		}
	})

	it('坏 JSON 不抛，按没有来源处理并清掉这条记录', () => {
		for (const raw of ['', '{', 'null', '"str"', '42', '[]']) {
			const storage = createStorage()
			storage.setItem(SOURCE_KEY, raw)

			assert.equal(consumeNavigationSource(storage, '/b', 1000), null, raw)
			assert.equal(storage.peek(SOURCE_KEY), null, raw)
		}
	})

	it('字段不合型一律判废：缺 path / 缺 destination / timestamp 缺失·非有限·非正', () => {
		const cases = [
			{ key: 'k', page: 'home', timestamp: 1000 },
			{ path: '/a', key: 'k', page: 'home', timestamp: 1000 },
			{ destination: '/b', key: 'k', page: 'home', timestamp: 1000 },
			{ path: '/a', destination: 'https://evil.example/b', timestamp: 1000 },
			{ path: '/a', destination: '//evil.example/b', timestamp: 1000 },
			{ path: '/a', destination: 42, timestamp: 1000 },
			{ path: '/a', destination: '/b', timestamp: '1000' },
			{ path: '/a', destination: '/b', timestamp: Number.NaN },
			{ path: '/a', destination: '/b', timestamp: Number.POSITIVE_INFINITY },
			// 0 与负数是「没有时间」的写法：放行会让一条永远算不出年龄的记录
			// 变成永久有效的返回来源
			{ path: '/a', destination: '/b', timestamp: 0 },
			{ path: '/a', destination: '/b', timestamp: -1 },
		]

		for (const payload of cases) {
			const storage = createStorage()
			storage.setItem(SOURCE_KEY, JSON.stringify(payload))

			assert.equal(consumeNavigationSource(storage, '/b', 1000), null, JSON.stringify(payload))
		}
	})

	it('存进去的站外路径读出来仍然是 null', () => {
		for (const path of ['https://evil.example/a', '//evil.example/a', '/\\evil.example/a']) {
			const storage = createStorage()
			storage.setItem(SOURCE_KEY, JSON.stringify({ path, destination: '/b', key: '', page: '', timestamp: 1000 }))

			assert.equal(consumeNavigationSource(storage, '/b', 1000), null, path)
		}
	})

	it('超过 30 分钟判废；恰好 30 分钟仍然有效', () => {
		const stale = createStorage()
		stale.setItem(SOURCE_KEY, JSON.stringify({ path: '/a', destination: '/b', key: '', page: '', timestamp: 1000 }))
		assert.equal(consumeNavigationSource(stale, '/b', 1000 + TTL + 1), null)

		const edge = createStorage()
		edge.setItem(SOURCE_KEY, JSON.stringify({ path: '/a', destination: '/b', key: '', page: '', timestamp: 1000 }))
		assert.notEqual(consumeNavigationSource(edge, '/b', 1000 + TTL), null)
	})

	it('落地页与来源同路径时没有「返回来源」的含义，判为无来源', () => {
		for (const current of ['/a', '/a/', '/']) {
			const storage = createStorage()
			storage.setItem(SOURCE_KEY, JSON.stringify({
				path: current === '/' ? '/' : '/a',
				destination: current,
				key: '',
				page: '',
				timestamp: 1000,
			}))

			assert.equal(consumeNavigationSource(storage, current, 1000), null, current)
		}
	})

	it('记录只落在传入的 storage 上（模块内不留跨标签页的隐藏状态）', () => {
		const tab = createStorage()
		const otherTab = createStorage()

		recordNavigationSource(tab, { path: '/', destination: '/b', key: 'k', page: 'home' }, 1000)

		assert.notEqual(tab.peek(SOURCE_KEY), null, '写进传入的 storage')
		assert.equal(otherTab.peek(SOURCE_KEY), null, '写入不得外溢到别的 storage')
		assert.equal(consumeNavigationSource(otherTab, '/b', 1000), null)
		// 别的标签页的消费动不了这一份：若模块内藏着单例存储，这里会是 null
		assert.equal(consumeNavigationSource(tab, '/b', 1000)?.path, '/')
	})
})

describe('模式状态单例', () => {
	it('订阅者立即拿到当前值（同 layout-state 的「订阅立即执行一次」）', () => {
		const seen = []
		const unsubscribe = subscribeBigPicture(mode => seen.push(mode))

		try {
			assert.deepEqual(seen, [getBigPictureState()])

			setBigPictureState('active')
			assert.deepEqual(seen, ['inactive', 'active'])

			// 同值赋值不通知：只有真实变化才 emit
			setBigPictureState('active')
			assert.deepEqual(seen, ['inactive', 'active'])
		}
		finally {
			unsubscribe()
		}
	})

	it('退订后不再收到通知', () => {
		const seen = []
		const unsubscribe = subscribeBigPicture(mode => seen.push(mode))
		unsubscribe()

		setBigPictureState('active')

		assert.deepEqual(seen, ['inactive'])
		assert.equal(getBigPictureState(), 'active')
	})

	it('进入写入根属性与会话', () => {
		enterBigPicture('manual')

		assert.equal(getBigPictureState(), 'active')
		assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')
		assert.equal(sessionStorage.peek(SESSION_KEY), 'active')
	})

	it('退出移除根属性（普通模式下不存在 data-big-picture）', () => {
		enterBigPicture('manual')
		exitBigPicture('auto')

		assert.equal(getBigPictureState(), 'inactive')
		assert.equal('bigPicture' in documentDouble.documentElement.dataset, false)
		assert.equal(sessionStorage.peek(SESSION_KEY), 'inactive')
	})

	it('只有手动退出写抑制', () => {
		enterBigPicture('manual')
		exitBigPicture('auto')
		assert.equal(isAutoEntrySuppressed(), false)
		assert.equal(sessionStorage.peek(AUTO_ENTRY_SUPPRESSED_KEY), 'false')

		enterBigPicture('manual')
		exitBigPicture('manual')
		assert.equal(isAutoEntrySuppressed(), true)
		assert.equal(sessionStorage.peek(AUTO_ENTRY_SUPPRESSED_KEY), 'true')
	})

	it('非手动退出不动已经为真的抑制（不碰用户已经做过的选择）', () => {
		setAutoEntrySuppressed(true)

		enterBigPicture('manual')
		exitBigPicture('auto')

		assert.equal(isAutoEntrySuppressed(), true)
		assert.equal(sessionStorage.peek(AUTO_ENTRY_SUPPRESSED_KEY), 'true')
	})

	it('模式本来就是 inactive 时退出仍写回 inactive（陈旧的 active 不得复活模式）', () => {
		// `beforeEach` 已把模式复位成 inactive，这里只往会话里塞一条陈旧记录，
		// 模拟「上一次进过模式、之后由别的路径退出」留下的痕迹
		sessionStorage.setItem(SESSION_KEY, 'active')

		exitBigPicture('auto')
		assert.equal(sessionStorage.peek(SESSION_KEY), 'inactive')

		// 抑制解除后重新加载，那条陈旧记录也拉不回模式
		setAutoEntrySuppressed(false)
		documentDouble.dispatch('astro:page-load')
		assert.equal(getBigPictureState(), 'inactive')
	})

	it('抑制生效时自动进入被拒绝', () => {
		setAutoEntrySuppressed(true)

		enterBigPicture('auto')

		assert.equal(getBigPictureState(), 'inactive')
		assert.equal('bigPicture' in documentDouble.documentElement.dataset, false)
	})

	it('抑制挡不住手动进入（规格明确保留的入口）', () => {
		setAutoEntrySuppressed(true)

		enterBigPicture('manual')

		assert.equal(getBigPictureState(), 'active')
	})

	it('进入不解除抑制：解除是设置面板开关的事，不是进入的副作用', () => {
		enterBigPicture('manual')
		exitBigPicture('manual')
		enterBigPicture('manual')

		assert.equal(isAutoEntrySuppressed(), true)
	})

	it('模式与抽屉状态互不覆盖', () => {
		enterBigPicture('manual')
		layoutState.setLayoutState('sidebar')
		assert.equal(getBigPictureState(), 'active')
		assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')

		layoutState.toggleLayout('search')
		assert.equal(layoutState.isLayoutOpen('search'), true)
		assert.equal(layoutState.getLayoutState(), 'search')
		assert.equal(getBigPictureState(), 'active')

		layoutState.closeLayout()
		assert.equal(layoutState.getLayoutState(), 'none')
		assert.equal(layoutState.isLayoutOpen('search'), false)
		assert.equal(getBigPictureState(), 'active')
	})

	it('sessionStorage 抛错时进入与退出仍可用（页面不崩）', () => {
		const original = globalThis.window
		globalThis.window = { sessionStorage: createThrowingStorage() }

		try {
			enterBigPicture('manual')
			assert.equal(getBigPictureState(), 'active')
			assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')

			exitBigPicture('manual')
			assert.equal(getBigPictureState(), 'inactive')
			assert.equal(isAutoEntrySuppressed(), true)
		}
		finally {
			globalThis.window = original
		}
	})

	it('没有 document 时模式仍然可切换（不把 SSR 求值带崩）', () => {
		const original = globalThis.document
		globalThis.document = undefined

		try {
			enterBigPicture('manual')
			assert.equal(getBigPictureState(), 'active')

			exitBigPicture('manual')
			assert.equal(getBigPictureState(), 'inactive')
		}
		finally {
			globalThis.document = original
		}
	})
})

describe('astro 页面生命周期', () => {
	it('绑定幂等：多次调用只挂一份监听', () => {
		const before = documentDouble.count()
		bindBigPictureGlobals()
		bindBigPictureGlobals()

		assert.equal(documentDouble.count(), before)
		assert.ok(before > 0, '首次绑定应至少挂上 page-load / before-swap / click')
	})

	it('astro:page-load 从会话意图恢复模式，并重新贴上根属性', () => {
		sessionStorage.setItem(SESSION_KEY, 'active')

		documentDouble.dispatch('astro:page-load')

		assert.equal(getBigPictureState(), 'active')
		assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')
	})

	it('astro:page-load 不恢复已被手动退出的标签页', () => {
		sessionStorage.setItem(SESSION_KEY, 'active')
		setAutoEntrySuppressed(true)

		documentDouble.dispatch('astro:page-load')

		assert.equal(getBigPictureState(), 'inactive')
		assert.equal('bigPicture' in documentDouble.documentElement.dataset, false)
	})

	it('会话里的外来状态不会变成第三种模式（设备状态不得写进模式键）', () => {
		// 连接/提示一类状态若被写进模式键，恢复路径只能把它读成 inactive，
		// 而不是把它认作一个模式；否则「手柄断开」就会顺手改掉模式
		for (const foreign of ['connected', 'disconnected', 'prompted', 'true', '1'])
			sessionStorage.setItem(SESSION_KEY, foreign)

		documentDouble.dispatch('astro:page-load')

		assert.equal(getBigPictureState(), 'inactive')
		assert.equal('bigPicture' in documentDouble.documentElement.dataset, false)
	})

	it('astro:before-swap 只到页面控制器为止，模式意图留在会话里', () => {
		enterBigPicture('manual')

		documentDouble.dispatch('astro:before-swap')

		assert.equal(getBigPictureState(), 'active')
		assert.equal(sessionStorage.peek(SESSION_KEY), 'active')
		assert.equal(sessionStorage.peek(AUTO_ENTRY_SUPPRESSED_KEY), 'false')
		assert.equal(isAutoEntrySuppressed(), false)
	})

	it('退出按钮事件委托：点中即手动退出并写抑制', () => {
		enterBigPicture('manual')

		documentDouble.dispatch('click', clickOn('[data-big-picture-exit]'))

		assert.equal(getBigPictureState(), 'inactive')
		assert.equal(isAutoEntrySuppressed(), true)
	})

	it('点别处不动模式', () => {
		enterBigPicture('manual')

		documentDouble.dispatch('click', clickOn('[data-big-picture-exit]', false))
		documentDouble.dispatch('click', clickOn('[data-theme-set]'))

		assert.equal(getBigPictureState(), 'active')
		assert.equal(isAutoEntrySuppressed(), false)
	})
})

/* ══════════════════════════════════════════════════════════════════════════
   Task 5 追加：B 键层级优先级、页面级返回目标、设置面板持久化，
   以及「首次输入被消耗」这条链在真实模式单例上的表现。

   为什么这些纯函数住在 `big-picture-state.ts`：Shell 的协调器写在 `.astro` 的
   `<script>` 里，Node 导入不了它。把「B 该关哪一层」「返回去哪」做成对快照求值的
   纯函数，规格里最硬的两条验收项才进得了单测，而 `.astro` 只剩 DOM 接线。
   ══════════════════════════════════════════════════════════════════════════ */

/** 全部层都开着的快照。逐个关掉一层，B 的目标就应当顺次落到下一层 */
function openBackSnapshot(overrides = {}) {
	return {
		settings: 'open',
		modalStack: [{ key: 'search', status: 'open' }],
		dropdownOpen: true,
		drawerOpen: true,
		...overrides,
	}
}

describe('B 键层级优先级（纯函数）', () => {
	it('优先级表：设置面板 → 最上层 modal → 下拉 → 抽屉 → 页面返回', () => {
		assert.equal(resolveBackLayer(openBackSnapshot()), 'settings')
		assert.equal(resolveBackLayer(openBackSnapshot({ settings: 'closed' })), 'modal')
		assert.equal(resolveBackLayer(openBackSnapshot({ settings: 'closed', modalStack: [] })), 'dropdown')
		assert.equal(
			resolveBackLayer(openBackSnapshot({ settings: 'closed', modalStack: [], dropdownOpen: false })),
			'drawer',
		)
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'closed',
				modalStack: [],
				dropdownOpen: false,
				drawerOpen: false,
			})),
			'page',
		)
	})

	it('一次只关一层：上层开着时 B 不会顺手把下层也关掉', () => {
		// 抽屉与下拉都开着、但设置面板也开着 → 只关设置面板，其余两层原样不动
		const snapshot = openBackSnapshot()
		assert.equal(resolveBackLayer(snapshot), 'settings')
		assert.equal(snapshot.modalStack.length, 1)
		assert.equal(snapshot.dropdownOpen, true)
		assert.equal(snapshot.drawerOpen, true)
	})

	it('退场动画期间吞掉 B（否则第二次 B 会一路穿透到页面返回）', () => {
		// 只剩页面层可退时也一样吞掉：穿透出去就是离页
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'closing',
				modalStack: [],
				dropdownOpen: false,
				drawerOpen: false,
			})),
			null,
		)
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'closed',
				modalStack: [{ key: 'search', status: 'closing' }],
				dropdownOpen: false,
				drawerOpen: false,
			})),
			null,
		)
	})

	it('叠层时只看栈顶：下面那层正在退场不拦住对上面那层的关闭', () => {
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'closed',
				modalStack: [
					{ key: 'search', status: 'closing' },
					{ key: 'lightbox', status: 'open' },
				],
			})),
			'modal',
		)
	})

	it('设置面板的优先级高于 modal，与 modal 此刻是否在退场无关', () => {
		// 曾经的缺陷：两个 closing 守卫都排在设置面板判定之前，
		// 于是「设置面板开着 + 底下那层 modal 正在淡出」会返回 null ——
		// 用户按 B 什么都不发生，正是规格禁止的那种失效
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'open',
				modalStack: [{ key: 'search', status: 'closing' }],
				dropdownOpen: false,
				drawerOpen: false,
			})),
			'settings',
		)
	})

	it('抽屉与下拉之间：打开的下拉压过「还没关掉的抽屉」，两者都没有退场态', () => {
		// `closeLayout()` 同步生效、`Dropdown.astro` 直接改 `hidden`，
		// 所以这两层不存在「正在收起」这个瞬间，也就不需要守卫
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'closed',
				modalStack: [],
				dropdownOpen: true,
				drawerOpen: true,
			})),
			'dropdown',
		)
		assert.equal(
			resolveBackLayer(openBackSnapshot({
				settings: 'closed',
				modalStack: [],
				dropdownOpen: false,
				drawerOpen: true,
			})),
			'drawer',
		)
	})

	it('输入快照不被改写（纯函数，Shell 复用同一份快照渲染提示条与派发动作）', () => {
		const snapshot = openBackSnapshot()
		const before = JSON.stringify(snapshot)
		resolveBackLayer(snapshot)
		assert.equal(JSON.stringify(snapshot), before)
	})
})

describe('页面级返回：先来源，后兜底，永不 history.back', () => {
	it('来源属于核心页面 → 回来源并带上焦点 key', () => {
		for (const from of ['home', 'archive', 'games', 'links', 'reading']) {
			assert.deepEqual(
				resolvePageReturn({
					page: 'reading',
					currentPath: '/posts/a/',
					source: { path: '/', destination: '/posts/a', key: 'list:featured', page: from },
				}),
				{ kind: 'source', path: '/', key: 'list:featured' },
				from,
			)
		}
	})

	it('目的地不是当前页就不算来源（规格那句合取的前一半）', () => {
		// 来源记录最长活 30 分钟；书签直达、粘贴 URL、脚本跳转都不留记录，
		// 只判来源的话一条旧记录会被任意页面捡走，B 于是把人送到陌生页面
		for (const source of [
			{ path: '/', destination: '/posts/b', key: 'k', page: 'home' },
			{ path: '/', key: 'k', page: 'home' },
			{ path: '/', destination: 'https://evil.example/posts/a', key: 'k', page: 'home' },
		]) {
			assert.deepEqual(
				resolvePageReturn({ page: 'reading', currentPath: '/posts/a/', source }),
				{ kind: 'route', path: '/' },
				JSON.stringify(source),
			)
		}
	})

	it('目的地比较同样走归一化：落地页带尾斜杠也算命中', () => {
		for (const [destination, currentPath] of [['/posts/a', '/posts/a/'], ['/posts/a/', '/posts/a']]) {
			assert.deepEqual(
				resolvePageReturn({
					page: 'reading',
					currentPath,
					source: { path: '/', destination, key: 'k', page: 'home' },
				}),
				{ kind: 'source', path: '/', key: 'k' },
				`${destination} → ${currentPath}`,
			)
		}
	})

	it('来源页不是核心页面（off / 缺失）时不用它返回', () => {
		for (const page of ['off', '', undefined]) {
			assert.deepEqual(
				resolvePageReturn({ page: 'reading', currentPath: '/posts/a/', source: { path: '/drive/x', destination: '/posts/a', page } }),
				{ kind: 'route', path: '/' },
				String(page),
			)
		}
	})

	it('站外来源绝不返回（协议相对与反斜杠写法都算站外）', () => {
		for (const path of ['https://evil.example/', '//evil.example/', '/\\evil.example/', 'posts/a']) {
			assert.deepEqual(
				resolvePageReturn({ page: 'reading', currentPath: '/posts/a/', source: { path, destination: '/posts/a', page: 'home' } }),
				{ kind: 'route', path: '/' },
				path,
			)
		}
	})

	it('缺少来源：文章、归档、友链、游戏栏目回首页', () => {
		for (const [page, currentPath] of [
			['reading', '/posts/a/'],
			['archive', '/archive/'],
			['links', '/link/'],
			['games', '/games/'],
		]) {
			assert.deepEqual(resolvePageReturn({ page, currentPath, source: null }), { kind: 'route', path: '/' })
		}
	})

	it('具体游戏页返回上一级游戏栏目（带不带尾斜杠都算栏目首页）', () => {
		assert.deepEqual(
			resolvePageReturn({ page: 'games', currentPath: '/games/galgames/', source: null }),
			{ kind: 'route', path: '/games' },
		)
		assert.deepEqual(
			resolvePageReturn({ page: 'games', currentPath: '/games/2024/game/', source: null }),
			{ kind: 'route', path: '/games' },
		)
	})

	it('首页 B 退出大屏模式，而不是去找一个不存在的上一层', () => {
		assert.deepEqual(
			resolvePageReturn({ page: 'home', currentPath: '/', source: null }),
			{ kind: 'exit' },
		)
	})

	it('off 页面不接管返回（本页停用增强）', () => {
		assert.equal(resolvePageReturn({ page: 'off', currentPath: '/404/', source: null }), null)
		assert.equal(
			resolvePageReturn({ page: 'off', currentPath: '/404/', source: { path: '/', destination: '/404', key: 'k', page: 'home' } }),
			null,
		)
	})

	it('来源恢复是一次性的：同一趟往返里第二次 B 拿不到来源，改走页面兜底', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/', destination: '/posts/a', key: 'list:featured', page: 'home' }, 1000)

		// 落地页消费一次
		const first = resolvePageReturn({
			page: 'reading',
			currentPath: '/posts/a/',
			source: consumeNavigationSource(storage, '/posts/a/', 1000),
		})
		assert.deepEqual(first, { kind: 'source', path: '/', key: 'list:featured' })

		// 已经返回到来源页：再来一次 B 时来源已被消费掉
		const second = resolvePageReturn({
			page: 'reading',
			currentPath: '/posts/a/',
			source: consumeNavigationSource(storage, '/posts/a/', 1000),
		})
		assert.deepEqual(second, { kind: 'route', path: '/' })
		assert.equal(storage.peek(SOURCE_KEY), null)
	})
})

describe('设置面板的持久化（localStorage，存储不可用时退回内存）', () => {
	it('缺省开启；只有恰好写入 false 才算关掉', () => {
		const storage = createStorage()

		assert.equal(readAutoEntryEnabled(storage), true)

		for (const raw of ['0', 'no', '', 'null']) {
			const dirty = createStorage()
			dirty.setItem(AUTO_ENTRY_ENABLED_KEY, raw)
			assert.equal(readAutoEntryEnabled(dirty), true, raw)
		}
	})

	it('往返：关掉再读得回来', () => {
		const storage = createStorage()

		writeAutoEntryEnabled(storage, false)
		assert.equal(readAutoEntryEnabled(storage), false)
		assert.equal(storage.peek(AUTO_ENTRY_ENABLED_KEY), 'false')

		writeAutoEntryEnabled(storage, true)
		assert.equal(readAutoEntryEnabled(storage), true)
	})

	it('存储抛错时不抛，且本次运行内往返一致（内存兜底）', () => {
		const storage = createThrowingStorage()

		assert.equal(readAutoEntryEnabled(storage), true)
		assert.doesNotThrow(() => writeAutoEntryEnabled(storage, false))
		// 关键：兜底状态跨调用共享，否则「关掉开关」写进去的值下一次读看不到，
		// 用户点了复选框却像没反应
		assert.equal(readAutoEntryEnabled(storage), false)
	})

	it('storage 为 null 时读写都存活（WeakMap 拿非对象当键会抛）', () => {
		assert.equal(readAutoEntryEnabled(null), true)
		assert.doesNotThrow(() => writeAutoEntryEnabled(null, false))
		assert.equal(readAutoEntryEnabled(null), false)
	})

	it('焦点恢复键：写入→读出，空串即清除', () => {
		const storage = createStorage()

		assert.equal(readRestoreFocusKey(storage), '')

		writeRestoreFocusKey(storage, 'href:/posts/a')
		assert.equal(readRestoreFocusKey(storage), 'href:/posts/a')

		writeRestoreFocusKey(storage, '')
		assert.equal(readRestoreFocusKey(storage), '')
		assert.equal(storage.peek(RESTORE_FOCUS_KEY), null)
	})
})

describe('状态区文案与手动进入入口（纯函数）', () => {
	/** 默认：一台接上了的手柄、模式未激活、两个开关都允许自动进入 */
	function view(overrides = {}) {
		return resolveShellView({
			page: 'home',
			support: 'supported',
			device: 'ready',
			active: false,
			suppressed: false,
			autoEntryEnabled: true,
			everConnected: true,
			...overrides,
		})
	}

	it('常规状态：提示「按任意键进入」，没有手动入口', () => {
		assert.deepEqual(view(), {
			prompt: '手柄已连接，按任意键进入大屏模式',
			status: '',
			manualEntry: false,
		})
	})

	it('被手动退出抑制：不再承诺任何按键，给出控制面板上的手动入口', () => {
		// 这一格就是缺陷现场：抑制态下轮询门禁是关的，Menu 键按了没反应，
		// 而文案却让用户去按它。规格：「顶部或常规控制面板仍允许手动进入」
		assert.deepEqual(view({ suppressed: true }), {
			prompt: '手柄已连接，已退出大屏模式',
			status: '',
			manualEntry: true,
		})
	})

	it('设置关掉了自动进入但未被抑制：轮询仍在跑，Menu 键提示成立', () => {
		assert.deepEqual(view({ autoEntryEnabled: false }), {
			prompt: '手柄已连接，按 Menu 键打开设置',
			status: '',
			manualEntry: false,
		})
	})

	it('任何状态下都不提示一个此刻做不到的动作', () => {
		// 枚举整张表：凡是 suppressed 为真的行，提示里不得出现「按…键」
		const states = []
		for (const active of [false, true]) {
			for (const suppressed of [false, true]) {
				for (const autoEntryEnabled of [false, true]) {
					states.push({ active, suppressed, autoEntryEnabled })
				}
			}
		}
		for (const state of states) {
			const result = view(state)
			// 只在「未进模式」时才有「怎么进」这件事；已进模式时抑制标记不参与
			if (state.suppressed && !state.active) {
				assert.equal(result.manualEntry, true, JSON.stringify(state))
				assert.doesNotMatch(result.prompt, /按.+键/, JSON.stringify(state))
			}
			if (result.manualEntry)
				assert.equal(state.suppressed, true, '手动入口只服务于「被抑制」这一种锁死状态')
		}
	})

	it('没接手柄的普通模式页面：一行字都不出现（今天的视觉必须一模一样）', () => {
		assert.deepEqual(view({ device: 'none', everConnected: false }), {
			prompt: '',
			status: '',
			manualEntry: false,
		})
		// 设备坏掉也不能给手动入口：进去了也没有输入可用
		for (const device of ['unsupported-mapping', 'insufficient-buttons']) {
			const result = view({ device })
			assert.equal(result.manualEntry, false, device)
			assert.equal(result.prompt, '', device)
			assert.notEqual(result.status, '', device)
		}
	})

	it('断开之后说的是「已断开」，但从未接过设备时不凭空多一句提示', () => {
		assert.equal(view({ device: 'none', everConnected: true }).status, '手柄已断开')
		assert.equal(view({ device: 'none', everConnected: false }).status, '')
	})

	it('浏览器没有能力面：只给一条可读提示，且不给手动入口', () => {
		assert.deepEqual(view({ support: 'unsupported' }), {
			prompt: '',
			status: '当前浏览器不支持手柄增强，已保留普通浏览',
			manualEntry: false,
		})
	})

	it('模式里：提示条让位给状态条', () => {
		assert.deepEqual(view({ active: true }), { prompt: '', status: '手柄已连接', manualEntry: false })
	})

	it('off 页面什么都不显示（停用本页增强）', () => {
		assert.deepEqual(view({ page: 'off', support: 'unsupported' }), {
			prompt: '',
			status: '',
			manualEntry: false,
		})
	})
})

/**
 * 手柄控制器的浏览器能力面 double。
 *
 * 只提供控制器真正取用的那几项：rAF 两兄弟、window/document 的事件目标、
 * 页面可见性与焦点。断言与实现读的是**同一个** `globalThis`，各造各的会出现
 * 「控制器在跑、夹具说没跑」这种自相矛盾的现象。
 */
function createControllerEnvironment() {
	const frames = new Map()
	const windowListeners = new Map()
	const documentListeners = new Map()
	let nextHandle = 0

	const listen = (map, type, fn, drop) => {
		if (drop) {
			const list = map.get(type) ?? []
			const index = list.indexOf(fn)
			if (index >= 0)
				list.splice(index, 1)
			return
		}
		const list = map.get(type) ?? []
		list.push(fn)
		map.set(type, list)
	}

	const win = {
		addEventListener: (type, fn) => { listen(windowListeners, type, fn, false) },
		removeEventListener: (type, fn) => { listen(windowListeners, type, fn, true) },
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
		hidden: false,
		hasFocus: () => true,
		addEventListener: (type, fn) => { listen(documentListeners, type, fn, false) },
		removeEventListener: (type, fn) => { listen(documentListeners, type, fn, true) },
	}
	return {
		win,
		doc,
		/** 执行一个已排期的 rAF 回调；没有排期返回 false */
		runFrame() {
			const entry = frames.entries().next().value
			if (!entry)
				return false
			frames.delete(entry[0])
			entry[1]()
			return true
		},
	}
}

/** 标准映射设备：0–16 共 17 个按钮 */
function createStandardPad(pressed = []) {
	return {
		mapping: 'standard',
		buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
		axes: [0, 0, 0, 0],
	}
}

describe('Shell 边界：首次输入被消耗，模式激活后才发布动作', () => {
	let environment
	let pads
	let intents
	let actions
	let controller
	let originalWindow
	let originalDocument

	beforeEach(() => {
		pads = [createStandardPad()]
		intents = []
		actions = []
		environment = createControllerEnvironment()
		originalWindow = globalThis.window
		originalDocument = globalThis.document
		// 模式单例仍在跑，所以 window 上必须留着 sessionStorage
		globalThis.window = { ...environment.win, sessionStorage }
		globalThis.document = environment.doc
		controller = createGamepadController({
			getGamepads: () => pads.slice(),
			now: () => 0,
			onEntryIntent: action => intents.push(action),
			onAction: action => actions.push(action),
		})
		controller.start()
		environment.runFrame()
		environment.runFrame()
	})

	afterEach(() => {
		controller.stop()
		globalThis.window = originalWindow
		globalThis.document = originalDocument
	})

	it('模式未激活时第一次按键只请求进入，一个动作都不发布', () => {
		pads[0] = createStandardPad([0])
		environment.runFrame()

		assert.deepEqual(intents, ['confirm'])
		assert.deepEqual(actions, [], '进入用的那次按键必须被消耗')

		// 一直按住：既不重复请求进入，也不发布动作
		environment.runFrame()
		assert.deepEqual(intents, ['confirm'])
		assert.deepEqual(actions, [])
	})

	it('松开 + 完成进入之后，下一次按下才执行为动作', () => {
		pads[0] = createStandardPad([0])
		environment.runFrame()
		assert.deepEqual(intents, ['confirm'])

		// 松开：门闩解开，但模式仍未激活
		pads[0] = createStandardPad()
		environment.runFrame()
		assert.deepEqual(actions, [])

		// Shell 在 onEntryIntent 里做的就是这个
		enterBigPicture('auto')
		assert.equal(getBigPictureState(), 'active')
		controller.refresh()
		assert.equal(controller.isRunning(), true, '抑制态下循环本来停着，进入后必须恢复')

		pads[0] = createStandardPad([0])
		environment.runFrame()
		assert.deepEqual(actions, ['confirm'])
		assert.deepEqual(intents, ['confirm'], '进入意图不会被第二次按键再触发一次')
	})

	it('摇杆漂移不触发进入（规格：进入由有效按钮按键发起）', () => {
		pads[0] = { ...createStandardPad(), axes: [0.1, 0.1, 0, 0] }
		environment.runFrame()

		assert.deepEqual(intents, [])
		assert.deepEqual(actions, [])
		assert.equal(getBigPictureState(), 'inactive')
	})
})

describe('不该外泄的东西', () => {
	it('两个模块都不导出可变的订阅者集合', () => {
		assert.equal('subscribers' in bigPictureState, false)
		assert.equal('subscribers' in layoutState, false)
	})

	it('模式访问器只有一个拼写（规格的 getBigPictureState / setBigPictureState）', () => {
		// 两个名字指一件事就是 CLAUDE.md 说的第二份真相，所以不留别名
		assert.equal(typeof bigPictureState.getBigPictureState, 'function')
		assert.equal(typeof bigPictureState.setBigPictureState, 'function')
		assert.equal('getBigPictureMode' in bigPictureState, false)
		assert.equal('setBigPictureMode' in bigPictureState, false)
	})
})
