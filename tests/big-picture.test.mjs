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
// 另钉两条「不该存在」：不导出可变的订阅者集合；模式联合里不含设备连接状态。
import assert from 'node:assert/strict'
import { before, beforeEach, describe, it } from 'node:test'
import * as bigPictureSession from '../src/lib/big-picture-session.ts'
import * as bigPictureState from '../src/lib/big-picture-state.ts'
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
	bindBigPictureGlobals,
	enterBigPicture,
	exitBigPicture,
	getBigPictureMode,
	isAutoEntrySuppressed,
	setAutoEntrySuppressed,
	setBigPictureMode,
	subscribeBigPicture,
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
	setBigPictureMode('inactive')
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

describe('存储抛错时降级到内存，页面不崩', () => {
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

		recordNavigationSource(storage, { path: '/a', key: 'k', page: 'home' })

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
})

describe('导航来源记录', () => {
	it('往返：写入什么就读回什么', () => {
		const storage = createStorage()

		recordNavigationSource(storage, { path: '/posts/a', key: 'posts/a', page: 'reading' }, 1000)

		assert.deepEqual(consumeNavigationSource(storage, '/posts/b', 1000), {
			path: '/posts/a',
			key: 'posts/a',
			page: 'reading',
			timestamp: 1000,
		})
	})

	it('一次性：读走即清，第二次拿不到', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/a', key: 'k', page: 'home' }, 1000)

		assert.notEqual(consumeNavigationSource(storage, '/b', 1000), null)
		assert.equal(consumeNavigationSource(storage, '/b', 1000), null)
		assert.equal(storage.peek(SOURCE_KEY), null)
	})

	it('时间戳来自注入的 now，不读墙钟', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/a' }, 1234)

		assert.equal(consumeNavigationSource(storage, '/b', 1234)?.timestamp, 1234)
	})

	it('key / page 缺省补空串（焦点恢复与页面类型判定各自有兜底）', () => {
		const storage = createStorage()
		recordNavigationSource(storage, { path: '/a' }, 1000)

		assert.deepEqual(consumeNavigationSource(storage, '/b', 1000), {
			path: '/a',
			key: '',
			page: '',
			timestamp: 1000,
		})
	})

	it('站外来源根本不写入（读端也再验一次，两头都不放行）', () => {
		for (const path of ['https://evil.example/a', '//evil.example/a', '/\\evil.example/a', 'posts/a'])
			recordNavigationSource(createStorage(), { path }, 1000)
		assert.equal(createStorage().peek(SOURCE_KEY), null)

		const storage = createStorage()
		recordNavigationSource(storage, { path: 'https://evil.example/a' }, 1000)
		assert.equal(storage.peek(SOURCE_KEY), null, '站外路径不得落到存储里')
	})

	it('坏 JSON 不抛，按没有来源处理并清掉这条记录', () => {
		for (const raw of ['', '{', 'null', '"str"', '42', '[]']) {
			const storage = createStorage()
			storage.setItem(SOURCE_KEY, raw)

			assert.equal(consumeNavigationSource(storage, '/b', 1000), null, raw)
			assert.equal(storage.peek(SOURCE_KEY), null, raw)
		}
	})

	it('字段不合型一律判废：缺 path、缺 timestamp、timestamp 非有限', () => {
		const cases = [
			{ key: 'k', page: 'home', timestamp: 1000 },
			{ path: '/a', timestamp: '1000' },
			{ path: '/a', timestamp: Number.NaN },
			{ path: '/a', timestamp: Number.POSITIVE_INFINITY },
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
			storage.setItem(SOURCE_KEY, JSON.stringify({ path, key: '', page: '', timestamp: 1000 }))

			assert.equal(consumeNavigationSource(storage, '/b', 1000), null, path)
		}
	})

	it('超过 30 分钟判废；恰好 30 分钟仍然有效', () => {
		const stale = createStorage()
		stale.setItem(SOURCE_KEY, JSON.stringify({ path: '/a', key: '', page: '', timestamp: 1000 }))
		assert.equal(consumeNavigationSource(stale, '/b', 1000 + TTL + 1), null)

		const edge = createStorage()
		edge.setItem(SOURCE_KEY, JSON.stringify({ path: '/a', key: '', page: '', timestamp: 1000 }))
		assert.notEqual(consumeNavigationSource(edge, '/b', 1000 + TTL), null)
	})

	it('落地页与来源同路径时没有「返回来源」的含义，判为无来源', () => {
		for (const current of ['/a', '/a/', '/']) {
			const storage = createStorage()
			storage.setItem(SOURCE_KEY, JSON.stringify({ path: current === '/' ? '/' : '/a', key: '', page: '', timestamp: 1000 }))

			assert.equal(consumeNavigationSource(storage, current, 1000), null, current)
		}
	})

	it('不同标签页互不可见（各自的 sessionStorage）', () => {
		const otherTab = createStorage()
		recordNavigationSource(otherTab, { path: '/a', key: 'k', page: 'home' }, 1000)

		assert.equal(consumeNavigationSource(createStorage(), '/b', 1000), null)
	})
})

describe('模式状态单例', () => {
	it('订阅者立即拿到当前值（同 layout-state 的「订阅立即执行一次」）', () => {
		const seen = []
		const unsubscribe = subscribeBigPicture(mode => seen.push(mode))

		try {
			assert.deepEqual(seen, [getBigPictureMode()])

			setBigPictureMode('active')
			assert.deepEqual(seen, ['inactive', 'active'])

			// 同值赋值不通知：只有真实变化才 emit
			setBigPictureMode('active')
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

		setBigPictureMode('active')

		assert.deepEqual(seen, ['inactive'])
		assert.equal(getBigPictureMode(), 'active')
	})

	it('进入写入根属性与会话', () => {
		enterBigPicture('manual')

		assert.equal(getBigPictureMode(), 'active')
		assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')
		assert.equal(sessionStorage.peek(SESSION_KEY), 'active')
	})

	it('退出移除根属性（普通模式下不存在 data-big-picture）', () => {
		enterBigPicture('manual')
		exitBigPicture('auto')

		assert.equal(getBigPictureMode(), 'inactive')
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

	it('抑制生效时自动进入被拒绝', () => {
		setAutoEntrySuppressed(true)

		enterBigPicture('auto')

		assert.equal(getBigPictureMode(), 'inactive')
		assert.equal('bigPicture' in documentDouble.documentElement.dataset, false)
	})

	it('抑制挡不住手动进入（规格明确保留的入口）', () => {
		setAutoEntrySuppressed(true)

		enterBigPicture('manual')

		assert.equal(getBigPictureMode(), 'active')
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
		assert.equal(getBigPictureMode(), 'active')
		assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')

		layoutState.toggleLayout('search')
		assert.equal(layoutState.isLayoutOpen('search'), true)
		assert.equal(layoutState.getLayoutState(), 'search')
		assert.equal(getBigPictureMode(), 'active')

		layoutState.closeLayout()
		assert.equal(layoutState.getLayoutState(), 'none')
		assert.equal(layoutState.isLayoutOpen('search'), false)
		assert.equal(getBigPictureMode(), 'active')
	})

	it('sessionStorage 抛错时进入与退出仍可用（页面不崩）', () => {
		const original = globalThis.window
		globalThis.window = { sessionStorage: createThrowingStorage() }

		try {
			enterBigPicture('manual')
			assert.equal(getBigPictureMode(), 'active')
			assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')

			exitBigPicture('manual')
			assert.equal(getBigPictureMode(), 'inactive')
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
			assert.equal(getBigPictureMode(), 'active')

			exitBigPicture('manual')
			assert.equal(getBigPictureMode(), 'inactive')
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

		assert.equal(getBigPictureMode(), 'active')
		assert.equal(documentDouble.documentElement.dataset.bigPicture, 'active')
	})

	it('astro:page-load 不恢复已被手动退出的标签页', () => {
		sessionStorage.setItem(SESSION_KEY, 'active')
		setAutoEntrySuppressed(true)

		documentDouble.dispatch('astro:page-load')

		assert.equal(getBigPictureMode(), 'inactive')
		assert.equal('bigPicture' in documentDouble.documentElement.dataset, false)
	})

	it('astro:before-swap 只到页面控制器为止，模式意图留在会话里', () => {
		enterBigPicture('manual')

		documentDouble.dispatch('astro:before-swap')

		assert.equal(getBigPictureMode(), 'active')
		assert.equal(sessionStorage.peek(SESSION_KEY), 'active')
		assert.equal(sessionStorage.peek(AUTO_ENTRY_SUPPRESSED_KEY), 'false')
		assert.equal(isAutoEntrySuppressed(), false)
	})

	it('退出按钮事件委托：点中即手动退出并写抑制', () => {
		enterBigPicture('manual')

		documentDouble.dispatch('click', clickOn('[data-big-picture-exit]'))

		assert.equal(getBigPictureMode(), 'inactive')
		assert.equal(isAutoEntrySuppressed(), true)
	})

	it('点别处不动模式', () => {
		enterBigPicture('manual')

		documentDouble.dispatch('click', clickOn('[data-big-picture-exit]', false))
		documentDouble.dispatch('click', clickOn('[data-theme-set]'))

		assert.equal(getBigPictureMode(), 'active')
		assert.equal(isAutoEntrySuppressed(), false)
	})
})

describe('不该存在的导出', () => {
	it('两个模块都不导出可变的订阅者集合', () => {
		assert.equal('subscribers' in bigPictureState, false)
		assert.equal('subscribers' in layoutState, false)
	})

	it('模式联合里没有设备连接状态（断开不得改模式）', () => {
		const values = new Set()
		for (const source of [sessionStorage, createStorage()]) {
			values.add(readSessionMode(source))
			writeSessionMode(source, true)
			values.add(readSessionMode(source))
		}
		assert.deepEqual([...values].sort(), ['active', 'inactive'])
	})
})
