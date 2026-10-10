/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// 焦点导航层（Task 4）的三层合同：
//   1. `src/lib/gamepad-navigation.ts` —— 纯几何。半平面过滤、交叉轴重叠优先、主轴距离、
//      交叉轴距离、DOM 顺序破同分、无候选保留、区域恢复的偏好顺序。
//   2. `src/lib/gamepad-focus.ts` 的 DOM 行为 —— 发现、可见性过滤、初始焦点、
//      `.gamepad-focus` 唯一性、真实 focus/scrollIntoView 的调用顺序、MutationObserver 刷新、
//      `data-list-key` / `data-gamepad-key` 恢复、`focusin` 接管、destroy 还原。
//   3. `tests/stubs/mini-dom.mjs` 自检 —— double 自己也必须先被证明是对的，
//      否则第 2 层里任何一条断言都可能只是 double 在说谎（CLAUDE.md 坑位 6 / 7）。
//
// 几何判据刻意全部放在第 1 层：mini-dom 没有排版引擎，它给的盒子只够表达「谁在上谁在下」
// 与「谁被裁掉了」。第 2 层只钉「哪些元素进得了候选集」与「选中之后调了什么」。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	createGamepadFocusManager,
	GAMEPAD_FOCUS_CLASS,
	LIST_KEY_ALIAS_ATTRIBUTE,
	LIST_KEY_ATTRIBUTE,
	readFocusTargetKey,
	REGION_ATTRIBUTE,
} from '../src/lib/gamepad-focus.ts'
import {
	chooseNextFocus,
	chooseRegionTarget,
	FOCUS_REGIONS,
	isFocusRegion,
} from '../src/lib/gamepad-navigation.ts'
import { createDocument, el } from './stubs/mini-dom.mjs'

/** 造一个焦点目标：矩形写成 `[x, y, w, h]`，省得每次写对象字面量 */
function target(key, region, [x, y, width = 100, height = 40], options = {}) {
	return { key, region, rect: { x, y, width, height }, order: options.order ?? 0, initial: options.initial }
}

/** 一排同区域目标，`order` 即下标 */
function row(region, specs) {
	return specs.map(([key, rect], index) => target(key, region, rect, { order: index }))
}

// ── 1. 纯几何层 ─────────────────────────────────────────────────────────────

describe('几何：方向半平面过滤', () => {
	it('右：只取中心在当前右侧的候选；左侧的即使更近也不选', () => {
		const current = target('a', 'main', [300, 100])
		const candidates = row('main', [
			['left', [0, 100]],
			['far-right', [900, 100]],
			['near-right', [420, 100]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'near-right')
	})

	it('左 / 上 / 下三向各自只看自己那一侧', () => {
		const current = target('a', 'main', [300, 300])
		const candidates = row('main', [
			['x-left', [0, 300]],
			['x-right', [600, 300]],
			['y-up', [300, 0]],
			['y-down', [300, 600]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'left')?.key, 'x-left')
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'x-right')
		assert.equal(chooseNextFocus(current, candidates, 'up')?.key, 'y-up')
		assert.equal(chooseNextFocus(current, candidates, 'down')?.key, 'y-down')
	})

	it('中心恰好齐平的候选不进半平面（否则对齐的两行会互相抢焦点）', () => {
		const current = target('a', 'main', [300, 100])
		const candidates = row('main', [
			['same-x', [300, 400]],
			['further', [500, 100]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'further')
	})

	it('不跨区域：同方向上别的区域里的候选一律不选', () => {
		const current = target('a', 'main', [300, 100])
		const candidates = [
			target('sidebar', 'sidebar', [310, 100], { order: 0 }),
			target('main-next', 'main', [320, 100], { order: 1 }),
		]
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'main-next')
	})

	it('没有候选时返回 undefined，调用方据此保留当前焦点（不回绕、不跨页）', () => {
		const current = target('a', 'main', [300, 100])
		assert.equal(chooseNextFocus(current, row('main', [['b', [0, 100]]]), 'right'), undefined)
		assert.equal(chooseNextFocus(current, [], 'down'), undefined)
		assert.equal(chooseNextFocus(null, row('main', [['b', [400, 100]]]), 'right'), undefined)
	})

	it('当前目标自己（以及同 key 的另一个元素）不参与候选', () => {
		const current = target('a', 'main', [300, 100])
		const candidates = [
			target('a', 'main', [300, 100], { order: 0 }),
			target('a', 'main', [310, 100], { order: 1 }),
			target('b', 'main', [400, 100], { order: 2 }),
		]
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'b')
	})
})

describe('几何：交叉轴重叠优先', () => {
	it('主轴更远但交叉轴重叠的候选，胜过主轴更近但不重叠的候选', () => {
		const current = target('a', 'main', [300, 300])
		const candidates = row('main', [
			['near-but-off', [340, 100]], // 主轴 40，交叉轴差 200 → 不重叠
			['far-but-overlap', [500, 290]], // 主轴 200，但交叉轴只差 10 → 重叠
		])
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'far-but-overlap')
	})

	it('恰好边贴边（重叠长度 0）算对齐', () => {
		// 当前 y 中心 320、区间 [300,340]；候选 y 中心 360、区间 [340,380]。两者只在 340 相接
		const current = target('a', 'main', [300, 300])
		const candidates = row('main', [
			['gapped', [400, 200]],
			['touching', [420, 340]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'touching')
	})

	it('上下方向的重叠判据看 X 轴，不是 Y 轴', () => {
		const current = target('a', 'main', [300, 300])
		const candidates = row('main', [
			['same-column', [300, 500]],
			['other-column', [900, 400]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'down')?.key, 'same-column')
	})
})

describe('几何：主轴距离、交叉轴距离、DOM 顺序', () => {
	it('主轴距离：同重叠前提下先取主轴更近的', () => {
		const current = target('a', 'main', [0, 300])
		const candidates = row('main', [
			['far', [900, 300]],
			['near', [120, 300]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'near')
	})

	it('距离用中心距而非边缘距：贴着右边的大块元素比隔一格的小块更近', () => {
		const current = target('a', 'main', [0, 300])
		const candidates = [
			// 中心 x = 700，与当前中心 50 相距 650
			target('wide', 'main', [100, 200, 1200, 40], { order: 0 }),
			// 中心 x = 420，与当前中心 50 相距 370
			target('narrow', 'main', [400, 0, 40, 40], { order: 1 }),
		]
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'narrow')
	})

	it('主轴相同时按交叉轴距离排', () => {
		const current = target('a', 'main', [300, 300])
		const candidates = row('main', [
			['off-2', [400, 320]],
			['off-1', [400, 310]],
			['off-0', [400, 300]],
		])
		assert.equal(chooseNextFocus(current, candidates, 'right')?.key, 'off-0')
	})

	it('四个键全相同时按 DOM 顺序（order）破同分，且结果与传入顺序无关', () => {
		const current = target('a', 'main', [0, 300])
		const first = target('first', 'main', [400, 300], { order: 7 })
		const second = target('second', 'main', [400, 300], { order: 9 })
		assert.equal(chooseNextFocus(current, [first, second], 'right')?.key, 'first')
		assert.equal(chooseNextFocus(current, [second, first], 'right')?.key, 'first')
	})
})

describe('几何：区域进入与恢复', () => {
	const targets = [
		target('s1', 'sidebar', [0, 0], { order: 0 }),
		target('s2', 'sidebar', [0, 100], { order: 1 }),
		target('m-initial', 'main', [500, 0], { order: 2, initial: true }),
		target('m1', 'main', [500, 100], { order: 3 }),
		target('m2', 'main', [500, 200], { order: 4 }),
	]

	it('previousKey 命中时恢复那一项，优先于首选项与第一项', () => {
		assert.equal(chooseRegionTarget('main', targets, 'm2')?.key, 'm2')
	})

	it('previousKey 已失效时退到 data-gamepad-initial-focus', () => {
		assert.equal(chooseRegionTarget('main', targets, 'gone')?.key, 'm-initial')
		assert.equal(chooseRegionTarget('main', targets, null)?.key, 'm-initial')
	})

	it('既没有历史键也没有首选项时取区域内第一项', () => {
		const plain = [target('a', 'sidebar', [0, 0], { order: 0 }), target('b', 'sidebar', [0, 50], { order: 1 })]
		assert.equal(chooseRegionTarget('sidebar', plain, 'gone')?.key, 'a')
	})

	it('空区域返回 undefined；region 传 null 表示不限区域（页面级首焦）', () => {
		assert.equal(chooseRegionTarget('footer', targets, null), undefined)
		assert.equal(chooseRegionTarget(null, targets, null)?.key, 'm-initial')
		assert.equal(chooseRegionTarget(undefined, [], null), undefined)
	})

	it('不打乱调用方传进来的数组顺序', () => {
		const input = [
			target('b', 'main', [0, 200], { order: 1 }),
			target('a', 'main', [0, 100], { order: 0 }),
		]
		const snapshot = input.map(item => item.key)
		chooseRegionTarget('main', input, null)
		assert.deepEqual(input.map(item => item.key), snapshot)
	})

	it('区域内两个首选项时取 order 更小的那个', () => {
		const two = [
			target('second-initial', 'main', [0, 100], { order: 1, initial: true }),
			target('first-initial', 'main', [0, 0], { order: 0, initial: true }),
		]
		assert.equal(chooseRegionTarget('main', two, null)?.key, 'first-initial')
	})
})

describe('几何：区域名单', () => {
	it('只有五个规格值算合法区域；拼错与大小写错都不算', () => {
		assert.deepEqual([...FOCUS_REGIONS], ['sidebar', 'main', 'aside', 'footer', 'overlay'])
		for (const value of FOCUS_REGIONS)
			assert.equal(isFocusRegion(value), true)
		for (const value of ['Main', 'drawer', '', null, undefined, 1])
			assert.equal(isFocusRegion(value), false)
	})
})

// ── 2. DOM double 自检（先证明仪器本身是对的）────────────────────────────────

describe('mini-dom 自检：double 自己得先是对的', () => {
	it('选择器：类型 / 属性存在 / 属性取值 / :not / 后代 / 子代 / 并列', () => {
		const anchor = el('a', { href: '/a', class: 'card' })
		const plain = el('a', {})
		const nested = el('div', {}, [el('span', { 'data-x': '' }, [el('b', {}, [anchor])])])
		const doc = createDocument([el('main', {}, [plain, nested])])

		assert.equal(anchor.matches('a[href]'), true)
		assert.equal(anchor.matches('a[href="/a"]'), true)
		assert.equal(anchor.matches('a[href="/b"]'), false)
		assert.equal(plain.matches('a[href]'), false)
		assert.equal(anchor.matches('a:not([tabindex])'), true)
		// anchor 的父级是 b、不是 span，所以只有整条链都对得上才算命中
		assert.equal(anchor.matches('div > span > b > a'), true)
		assert.equal(anchor.matches('div > span > a'), false)
		assert.equal(anchor.matches('span > a'), false)
		assert.equal(anchor.matches('div span b'), false)
		// 文档序：plain 的 a 没有 href 不入选，b 与带 href 的 anchor 入选
		assert.deepEqual(doc.body.querySelectorAll('a[href], b').map(node => node.localName), ['b', 'a'])
		assert.equal(anchor.closest('[data-x]')?.localName, 'span')
	})

	it('遇到不支持的选择器语法直接抛错，不会静默返回空集', () => {
		const node = el('div', {})
		assert.throws(() => node.matches('div:has(a)'), /不支持的伪类/)
		assert.throws(() => node.matches('div + a'), /不支持的组合符/)
	})

	it('祖先的 visibility:hidden 会继承；元素自己写 visible 能覆盖回来', () => {
		const hiddenParent = el('div', { style: 'visibility: hidden' }, [el('button', {}, [])])
		const override = el('div', { style: 'visibility: hidden' }, [el('button', { style: 'visibility: visible' }, [])])
		const doc = createDocument([hiddenParent, override])
		assert.equal(doc.defaultView.getComputedStyle(hiddenParent.children[0]).visibility, 'hidden')
		assert.equal(doc.defaultView.getComputedStyle(override.children[0]).visibility, 'visible')
	})

	it('overflow 没设时 getPropertyValue 返回空串（不是 undefined）——真实 CSSOM 就是这个形状', () => {
		const doc = createDocument([el('div', {}, [])])
		const style = doc.defaultView.getComputedStyle(doc.body.children[0])
		assert.equal(style.getPropertyValue('overflow-x'), 'visible')
		assert.equal(style.getPropertyValue('margin-top'), '')
	})

	it('display: none 让该元素与整棵子树都没有盒子', () => {
		const child = el('button', {}, [])
		const parent = el('div', { style: 'display: none' }, [child])
		const sibling = el('button', {}, [])
		createDocument([el('div', {}, [parent, sibling])])
		const zero = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }
		assert.deepEqual(child.getBoundingClientRect(), zero, '子树里的元素也没有盒子')
		assert.deepEqual(parent.getBoundingClientRect(), zero, 'display:none 的元素自身也没有盒子')
		assert.ok(sibling.getBoundingClientRect().width > 0, '不受影响的兄弟节点照常有盒子')
		assert.equal(child.getClientRects().length, 0)
	})

	it('tagName 是大写（生产代码忘了 toLowerCase 就会在这里露馅）', () => {
		assert.equal(el('details', {}).tagName, 'DETAILS')
		assert.equal(el('details', {}).localName, 'details')
	})

	it('属性变更会通知 MutationObserver，且按 attributeFilter 过滤', async () => {
		const node = el('button', {})
		const doc = createDocument([el('div', {}, [node])])
		const filtered = []
		const unfiltered = []
		const ObserverCtor = doc.defaultView.MutationObserver
		const filteredObserver = new ObserverCtor(records => filtered.push(...records))
		filteredObserver.observe(node, { attributes: true, attributeFilter: ['hidden'] })
		const wideObserver = new ObserverCtor(records => unfiltered.push(...records))
		wideObserver.observe(node, { attributes: true })

		node.classList.add('x')
		node.setAttribute('hidden', '')
		await Promise.resolve()

		assert.deepEqual(filtered.map(record => record.attributeName), ['hidden'])
		// 宽观察器**看得见** class 变更：若这里也是空，说明「生产代码观察不到 class」这条
		// 断言其实是 double 的假阴性，不是生产代码做对了
		assert.deepEqual(unfiltered.map(record => record.attributeName), ['class', 'hidden'])
	})
})

// ── 3. DOM 焦点层 ───────────────────────────────────────────────────────────

/**
 * 搭一份页面夹具。`refreshes` 计数是 MutationObserver 合并刷新唯一的可观测出口
 * （通过 `onRefresh` 注入缝暴露）；不看这个数就没法断言「一批变更只刷一次」。
 */
function createPage(build) {
	const doc = createDocument()
	const nodes = {}
	const root = el('div', { id: 'page' })
	doc.body.append(root)
	build(root, nodes)
	doc.invalidate()
	let refreshes = 0
	const manager = createGamepadFocusManager(root, {
		onRefresh: () => {
			refreshes++
		},
	})
	return {
		doc,
		root,
		nodes,
		manager,
		/** 跑完微任务队列，让 MutationObserver 交付那一批 */
		async settle() {
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
		},
		refreshes: () => refreshes,
		/** 当前在文档里的 `.gamepad-focus`，必须恰好 0 或 1 个 */
		marked: () => root.querySelectorAll(`.${GAMEPAD_FOCUS_CLASS}`),
		/** doc.log 里与某个元素相关的调用序列，用来钉 focus → scroll 的先后 */
		calls: element => doc.log.filter(entry => entry.element === element).map(entry => entry.type),
	}
}

/** 始终可用的参照项：放在区域最后，用来证明它前面的候选都被正确滤掉了 */
function probeLink() {
	return el('a', { href: '/probe' }, ['probe'])
}

/**
 * 断言用的元素身份：优先 `data-list-key`，其次 `href`，都没有就退回标签名。
 *
 * 断言失败时 `assert.equal(两个 MiniElement)` 会把整棵节点图展开成几秒的 dump（实测单条
 * 11 秒，会被误判成卡死）。比身份字符串既能一眼看出是哪一项，失败信息也短。
 */
function id(page) {
	const current = page.manager.getCurrent()
	if (!current)
		return 'null'
	return current.getAttribute('data-list-key')
		?? current.getAttribute('href')
		?? current.localName
}

/** 常规列表页夹具：侧栏两条 + 正文（排序控件 + 分类控件 + 四张卡片） */
function buildListPage(root, nodes) {
	const sidebar = el('nav', { [REGION_ATTRIBUTE]: 'sidebar' }, [
		el('a', { 'href': '/', 'data-list-key': 'home' }, ['首页']),
		el('a', { href: '/archive/' }, ['归档']),
	])
	const list = el('ul', {}, [
		el('li', {}, [el('a', { 'href': '/posts/a/', 'data-list-key': 'post-a' }, ['A'])]),
		el('li', {}, [el('a', { 'href': '/posts/b', 'data-list-key': 'post-b' }, ['B'])]),
		el('li', {}, [el('a', { 'href': '/posts/c/', 'data-list-key': 'post-c' }, ['C'])]),
		el('li', {}, [el('a', { 'href': '/posts/d/', 'data-list-key': 'post-d' }, ['D'])]),
	])
	const main = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
		el('button', { type: 'button' }, ['排序']),
		el('button', { 'type': 'button', 'data-gamepad-initial-focus': '' }, ['分类']),
		list,
	])
	root.append(sidebar, main)
	nodes.sidebar = sidebar
	nodes.main = main
	nodes.list = list
	nodes.sort = main.children[0]
	nodes.category = main.children[1]
	nodes.cards = list.children.map(li => li.children[0])
}

describe('DOM：发现目标', () => {
	it('语义元素与显式 data-gamepad-focus 都被发现；没有 href 的 a 不是目标', () => {
		const page = createPage((root, nodes) => {
			const region = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { href: '/a' }, ['link']),
				el('a', {}, ['no-href']),
				el('button', {}, ['button']),
				el('summary', {}, ['summary']),
				el('input', { type: 'text' }, []),
				el('select', {}, []),
				el('textarea', {}, []),
				el('div', { tabindex: '-1' }, ['tabindex']),
				el('div', { 'data-gamepad-focus': '' }, ['explicit']),
			])
			root.append(el('div', {}, [el('a', { href: '/outside' }, ['outside'])]), region)
			nodes.region = region
		})
		const region = page.nodes.region
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent(), region.children[0], '第一个可选目标')
		for (const index of [2, 3, 4, 5, 6, 7, 8]) {
			assert.equal(page.manager.move('down'), true, `应能走到第 ${index} 个子节点`)
			assert.equal(page.manager.getCurrent(), region.children[index])
		}
		assert.equal(page.manager.move('down'), false, '区域外的那个 a 不可达')
	})

	it('区域标记缺失或值非法时那一块不可达（不做任何推断）', () => {
		const page = createPage((root, nodes) => {
			// 非法区域**排在合法区域前面**：若区域值不校验，它会顶掉首项而让断言红
			const bad = el('div', { [REGION_ATTRIBUTE]: 'drawer' }, [el('a', { href: '/b' }, ['b'])])
			const good = el('nav', { [REGION_ATTRIBUTE]: 'sidebar' }, [el('a', { href: '/a' }, ['a'])])
			const none = el('div', {}, [el('a', { href: '/c' }, ['c'])])
			root.append(bad, good, none)
			nodes.bad = bad
			nodes.good = good
		})
		page.manager.focusInitial()
		assert.equal(page.manager.getCurrent(), page.nodes.good.children[0])
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/a')
		// 直接切到那个非法区域名：它是「没有区域」，不是一个叫 drawer 的区域
		page.manager.setRegion('drawer')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/a', '切到非法区域名不改变焦点')
		assert.equal(page.manager.move('down'), false, '没有区域标记的 a 也不可达')
	})

	it('嵌套区域取最近的那个', () => {
		const page = createPage((root) => {
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('div', { [REGION_ATTRIBUTE]: 'overlay' }, [el('a', { href: '/in-overlay' }, ['o'])]),
				el('a', { href: '/in-main' }, ['m']),
			]))
		})
		page.manager.focusInitial('overlay')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/in-overlay')
		page.manager.setRegion('main')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/in-main')
	})
})

describe('DOM：永不可选的元素', () => {
	it('hidden / inert / aria-hidden / disabled：自己带与祖先带都不可选', () => {
		const page = createPage((root, nodes) => {
			const region = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { href: '/hidden', hidden: '' }, ['hidden']),
				el('a', { href: '/inert', inert: '' }, ['inert']),
				el('a', { 'href': '/aria', 'aria-hidden': 'true' }, ['aria']),
				el('button', { disabled: '' }, ['disabled']),
				el('div', { inert: '' }, [el('a', { href: '/under-inert' }, ['under-inert'])]),
				el('div', { 'aria-hidden': 'true' }, [el('a', { href: '/under-aria' }, ['under-aria'])]),
				el('fieldset', { disabled: '' }, [el('a', { href: '/under-fieldset' }, ['under-fieldset'])]),
				probeLink(),
			])
			root.append(region)
			nodes.region = region
		})
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/probe')
		assert.equal(page.marked().length, 1)
	})

	it('未展开 details 的内容不可选，summary 本身可选；展开后恢复可选', () => {
		const page = createPage((root, nodes) => {
			const details = el('details', {}, [
				el('summary', {}, ['更多信息']),
				el('a', { href: '/folded' }, ['folded']),
			])
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [details, probeLink()]))
			nodes.details = details
			nodes.summary = details.children[0]
		})
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent(), page.nodes.summary, 'summary 由 UA 渲染，必须可选')
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/probe', '折叠内容不可选')

		page.nodes.details.setAttribute('open', '')
		page.manager.refresh()
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent(), page.nodes.summary, '区域首项仍是 summary')
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/folded', '展开后内容重新可选')
	})

	it('display:none 的元素与整棵子树都没有盒子', () => {
		const page = createPage((root) => {
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('div', { style: 'display: none' }, [el('a', { href: '/gone' }, ['gone'])]),
				probeLink(),
			]))
		})
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/probe')
	})

	it('visibility: hidden 不可选（祖先隐藏也生效）', () => {
		const page = createPage((root) => {
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { href: '/dim', style: 'visibility: hidden' }, ['dim']),
				el('div', { style: 'visibility: hidden' }, [el('a', { href: '/under-dim' }, ['under-dim'])]),
				probeLink(),
			]))
		})
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/probe')
	})

	it('被裁剪祖先挡住的元素不可选（轮播里当前不可见的卡片靠这条落法）', () => {
		const page = createPage((root, nodes) => {
			const track = el('div', { style: 'overflow: hidden', [REGION_ATTRIBUTE]: 'main' })
			const onScreen = el('a', { 'href': '/slide-1', 'data-list-key': 's1' }, ['1'])
			const offScreen = el('a', { 'href': '/slide-2', 'data-list-key': 's2' }, ['2'])
			track.append(onScreen, offScreen)
			root.append(track)
			nodes.track = track
			nodes.onScreen = onScreen
			nodes.offScreen = offScreen
		})
		// 轨道只有 44 高，第二张的中心必然落在轨道之外
		page.doc.setRect(page.nodes.track, { x: 0, y: 0, width: 640, height: 44 })
		page.doc.setRect(page.nodes.onScreen, { x: 0, y: 0, width: 640, height: 44 })
		page.doc.setRect(page.nodes.offScreen, { x: 0, y: 200, width: 640, height: 44 })
		page.manager.refresh()
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent(), page.nodes.onScreen)
		assert.equal(page.manager.move('down'), false, '不可见的卡片不在候选里，也就没有「向下」这一说')
	})

	it('视口之外但已展开的目标仍然可选（不做视口相交判定）', () => {
		const page = createPage((root, nodes) => {
			const region = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { 'href': '/top', 'data-list-key': 'top' }, ['top']),
				el('a', { 'href': '/far', 'data-list-key': 'far' }, ['far']),
			])
			root.append(region)
			nodes.top = region.children[0]
			nodes.far = region.children[1]
		})
		page.doc.setRect(page.nodes.top, { x: 0, y: 0, width: 640, height: 44 })
		page.doc.setRect(page.nodes.far, { x: 0, y: 5000, width: 640, height: 44 })
		page.manager.refresh()
		page.manager.focusInitial('main')
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent(), page.nodes.far, '视口外的项必须仍然可选')
		assert.deepEqual(page.calls(page.nodes.far), ['focus', 'scroll'], '选中之后才滚动')
	})
})

describe('DOM：初始焦点与区域切换', () => {
	it('页面级首焦点取 data-gamepad-initial-focus', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial()
		assert.equal(page.manager.getCurrent(), page.nodes.category)
	})

	it('传了区域就只看那一区；那一区没目标时什么都不做（不跨区兜底）', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('footer')
		assert.equal(page.manager.getCurrent(), null)
		page.manager.focusInitial('sidebar')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/')
	})

	it('重新进入区域时恢复该区域上一次的目标，而不是回到首选项', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.manager.setRegion('sidebar')
		page.manager.setRegion('main')
		assert.equal(page.manager.getCurrent(), page.nodes.category, '记住的 key 仍有效，恢复的就是它')
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent(), page.nodes.cards[0])
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent(), page.nodes.cards[1])
		page.manager.setRegion('sidebar')
		page.manager.setRegion('main')
		assert.equal(page.manager.getCurrent(), page.nodes.cards[1], '离开再回来恢复上次那一项，而不是首选项')
	})

	it('方向移动只在当前区域内；区域内没有候选时保留当前焦点', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('sidebar')
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/archive/')
		assert.equal(page.manager.move('down'), false, '侧栏没有第三项，不回绕')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/archive/')

		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent(), page.nodes.category)
		assert.equal(page.manager.move('up'), true)
		assert.equal(page.manager.getCurrent(), page.nodes.sort)
		assert.equal(page.manager.move('up'), false, '正文顶部没有上一项，不回绕')
		assert.equal(page.manager.getCurrent(), page.nodes.sort)
	})

	it('没有当前目标时第一次方向键退化成定位首选项', () => {
		const page = createPage(buildListPage)
		assert.equal(page.manager.getCurrent(), null)
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent(), page.nodes.category)
	})
})

describe('DOM：焦点类、真实 focus 与滚动', () => {
	it('同一时刻文档里只有一个 .gamepad-focus', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		for (let i = 0; i < 3; i++)
			page.manager.move('down')
		assert.equal(page.marked().length, 1)
		assert.equal(page.marked()[0], page.manager.getCurrent())
	})

	it('调用顺序是 focus({preventScroll:true}) 在前、scrollIntoView({block:"nearest"}) 在后', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		const log = page.doc.log.filter(entry => entry.element === page.nodes.category)
		assert.deepEqual(log.map(entry => entry.type), ['focus', 'scroll'])
		assert.deepEqual(log[0].options, { preventScroll: true })
		assert.deepEqual(log[1].options, { block: 'nearest' })
	})

	it('没有候选时既不 focus 也不 scroll', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.manager.move('up')
		const before = page.doc.log.length
		assert.equal(page.manager.move('up'), false)
		assert.equal(page.doc.log.length, before)
	})

	it('原生可聚焦的目标不被塞 tabindex；裸元素只在被聚焦时临时补 -1，destroy 撤销', () => {
		const page = createPage((root, nodes) => {
			const region = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { 'href': '/a', 'data-list-key': 'a' }, ['a']),
				el('div', { 'data-gamepad-focus': '', 'data-list-key': 'reader' }, ['正文阅读入口']),
			])
			root.append(region)
			nodes.region = region
			nodes.reader = region.children[1]
		})
		assert.equal(page.nodes.reader.hasAttribute('tabindex'), false, '建库阶段不得预先改 DOM')
		page.manager.focusInitial('main')
		assert.equal(page.nodes.region.children[0].hasAttribute('tabindex'), false, '原生目标保持原样')
		page.manager.move('down')
		assert.equal(page.manager.getCurrent(), page.nodes.reader)
		assert.equal(page.nodes.reader.getAttribute('tabindex'), '-1')
		page.manager.destroy()
		assert.equal(page.nodes.reader.hasAttribute('tabindex'), false, 'destroy 撤销临时属性')
	})

	it('A 键：文本输入框只聚焦不点，其余调原生 click()', () => {
		const page = createPage((root, nodes) => {
			const region = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('input', { 'type': 'search', 'data-list-key': 'q' }, []),
				el('button', { 'type': 'button', 'data-list-key': 'go' }, ['go']),
			])
			root.append(region)
			nodes.input = region.children[0]
			nodes.button = region.children[1]
		})
		page.manager.focusInitial('main')
		page.manager.activate()
		assert.equal(page.calls(page.nodes.input).includes('click'), false, '文本框不点')
		assert.equal(page.calls(page.nodes.input).at(-1), 'focus')
		page.manager.move('down')
		page.manager.activate()
		assert.deepEqual(page.calls(page.nodes.button), ['focus', 'scroll', 'click'])
	})
})

describe('DOM：focusin 接管', () => {
	it('鼠标点到另一个目标时同步当前目标，焦点类跟着换', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent(), page.nodes.category)
		page.doc.dispatch('focusin', page.nodes.cards[2])
		assert.equal(page.manager.getCurrent(), page.nodes.cards[2])
		assert.equal(page.marked().length, 1)
		assert.equal(page.marked()[0], page.nodes.cards[2])
	})

	it('用户接管到非目标元素时不把焦点抢回来', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.doc.dispatch('focusin', page.nodes.main)
		assert.equal(page.manager.getCurrent(), null)
		assert.equal(page.marked().length, 0)
		// 唯一「回到手柄目标」的时机是用户自己又按了方向键——那是一次新操作，
		// 且从首选项重新起步（不是从刚才那个分类按钮往下）
		assert.equal(page.manager.move('down'), true)
		assert.equal(page.manager.getCurrent(), page.nodes.category)
	})

	it('管理器自己调用 focus() 触发的 focusin 不把状态打乱', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.manager.move('down')
		assert.equal(page.manager.getCurrent(), page.nodes.cards[0])
		assert.equal(page.marked().length, 1)
	})
})

describe('DOM：动态列表与刷新', () => {
	it('同一批变更只触发一次刷新（每个微任务一次）', async () => {
		const page = createPage(buildListPage)
		const before = page.refreshes()
		page.nodes.list.append(el('li', {}, [el('a', { 'href': '/posts/e/', 'data-list-key': 'post-e' }, ['E'])]))
		page.nodes.list.append(el('li', {}, [el('a', { 'href': '/posts/f/', 'data-list-key': 'post-f' }, ['F'])]))
		page.nodes.cards[1].setAttribute('hidden', '')
		await page.settle()
		assert.equal(page.refreshes() - before, 1)
	})

	it('管理器自己的 class 变更不触发刷新（否则每移动一次焦点就自激一轮）', async () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		for (let i = 0; i < 3; i++) {
			assert.equal(page.manager.move('down'), true)
			await page.settle()
		}
		assert.equal(page.refreshes(), 0, '构造时那次静默发现不走 onRefresh')
	})

	it('客户端整份重渲染后按 data-list-key 认回同一项（不是靠序号）', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.manager.move('down')
		assert.equal(id(page), 'post-a', '当前是 A')

		// 模拟 OrderToggle 换排序：整份列表换成新节点，key 不变，顺序颠倒
		const fresh = ['d', 'c', 'b', 'a'].map(key => el('li', {}, [
			el('a', { 'href': `/posts/${key}/`, 'data-list-key': `post-${key}` }, [key.toUpperCase()]),
		]))
		for (const item of [...page.nodes.list.children])
			item.remove()
		page.nodes.list.append(...fresh)
		page.manager.refresh()

		assert.equal(page.manager.getCurrent(), fresh[3].children[0], '认回的是**新**节点里 key 相同的那一个')
		assert.equal(id(page), 'post-a', '而不是按序号落到 d 上')
		assert.equal(page.marked().length, 1)
	})

	it('原目标被移除时保留同序号的邻近项', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.manager.move('down')
		page.manager.move('down')
		assert.equal(id(page), 'post-b', '当前是 B')
		page.nodes.cards[1].remove()
		page.manager.refresh()
		assert.equal(id(page), 'post-c', '列表内下标 1 被删，落到新的下标 1')
	})

	it('列表清空时回到还剩下的控件（分类/排序按钮）', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		for (let i = 0; i < 5; i++)
			page.manager.move('down')
		assert.equal(id(page), 'post-d', '当前是最后一张')
		for (const card of page.nodes.cards)
			card.remove()
		page.manager.refresh()
		// 列表整段消失后没有同序号的邻近项了，退到区域首选项——也就是分类/排序按钮
		assert.equal(page.manager.getCurrent(), page.nodes.category)
	})

	it('当前项只是被 hidden（还在 DOM 里）也会让位，不留在不可见元素上', () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		page.manager.move('down')
		assert.equal(id(page), 'post-a')
		page.nodes.cards[0].setAttribute('hidden', '')
		page.manager.refresh()
		assert.equal(id(page), 'post-b', '让到同序号的邻近项')
		assert.equal(page.marked().length, 1)
		assert.equal(page.marked()[0], page.manager.getCurrent())
	})

	it('新增的客户端分页按钮下一轮就能被选中（Task 7 生成的节点）', async () => {
		const page = createPage(buildListPage)
		page.manager.focusInitial('main')
		const next = el('button', { 'type': 'button', 'data-list-key': 'page-2' }, ['下一页'])
		page.nodes.main.append(next)
		await page.settle()
		for (let i = 0; i < 6; i++)
			page.manager.move('down')
		assert.equal(page.manager.getCurrent(), next, '动态节点进了候选集')
	})

	it('destroy 之后不再刷新、不再响应方向键', async () => {
		const page = createPage(buildListPage)
		page.manager.destroy()
		page.nodes.list.append(el('li', {}, [el('a', { 'href': '/x', 'data-list-key': 'x' }, ['x'])]))
		await page.settle()
		assert.equal(page.refreshes(), 0)
		assert.equal(page.manager.move('down'), false)
		assert.equal(page.manager.getCurrent(), null)
	})
})

describe('DOM：key 与两种列表属性拼写', () => {
	it('data-list-key 优先于 data-gamepad-key，两者产出同一种 key 形状', () => {
		const page = createPage((root) => {
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { href: '/a', [LIST_KEY_ATTRIBUTE]: 'a' }, ['a']),
				el('a', { href: '/b', [LIST_KEY_ALIAS_ATTRIBUTE]: 'b' }, ['b']),
				el('a', { href: '/c', [LIST_KEY_ATTRIBUTE]: 'c', [LIST_KEY_ALIAS_ATTRIBUTE]: 'ignored' }, ['c']),
			]))
		})
		const [one, two, three] = page.root.children[0].children
		assert.equal(readFocusTargetKey(one), 'list:a')
		assert.equal(readFocusTargetKey(two), 'list:b')
		assert.equal(readFocusTargetKey(three), 'list:c', 'data-list-key 优先')
	})

	it('两种拼写混在一条列表里，重渲染后都能恢复', () => {
		const page = createPage((root, nodes) => {
			const list = el('ul', {}, [
				el('li', {}, [el('a', { href: '/x', [LIST_KEY_ATTRIBUTE]: 'k1' }, ['1'])]),
				el('li', {}, [el('a', { href: '/y', [LIST_KEY_ALIAS_ATTRIBUTE]: 'k2' }, ['2'])]),
			])
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [list]))
			nodes.list = list
		})
		page.manager.focusInitial('main')
		page.manager.move('down')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/y')

		const replacement = el('li', {}, [el('a', { href: '/y', [LIST_KEY_ALIAS_ATTRIBUTE]: 'k2' }, ['2'])])
		for (const item of [...page.nodes.list.children])
			item.remove()
		page.nodes.list.append(replacement)
		page.manager.refresh()
		assert.equal(page.manager.getCurrent(), replacement.children[0], '别名拼写的项同样靠 key 认回来')
	})

	it('href 规范化：去尾斜杠、保留 query 与 hash；list key 与 href 分处不同命名空间', () => {
		const page = createPage((root) => {
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { href: '/posts/a/' }, ['1']),
				el('a', { href: '/posts/a' }, ['2']),
				el('a', { href: '/posts/a?page=2#top' }, ['3']),
				el('a', { 'href': '/2026', 'data-list-key': '2026' }, ['4']),
			]))
		})
		const [one, two, three, four] = page.root.children[0].children
		assert.equal(readFocusTargetKey(one), 'href:/posts/a')
		assert.equal(readFocusTargetKey(two), 'href:/posts/a', '尾斜杠不算不同项')
		assert.equal(readFocusTargetKey(three), 'href:/posts/a?page=2#top')
		assert.equal(readFocusTargetKey(four), 'list:2026')
		assert.notEqual(readFocusTargetKey(one), readFocusTargetKey(four), '两个命名空间不撞')
	})

	it('既没有 list key 也没有 href 时退到 DOM 路径，同页面上不重号', () => {
		const page = createPage((root) => {
			root.append(el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('button', { 'data-gamepad-focus': '' }, ['x']),
				el('button', { 'data-gamepad-focus': '' }, ['y']),
			]))
		})
		const [x, y] = page.root.children[0].children
		const keyX = readFocusTargetKey(x)
		assert.ok(keyX?.startsWith('path:'))
		assert.notEqual(keyX, readFocusTargetKey(y))
	})

	it('两个元素标了同一个 data-list-key 时仍各自可选（key 被去重，不会互相顶掉）', () => {
		const page = createPage((root, nodes) => {
			const region = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
				el('a', { 'href': '/one', 'data-list-key': 'same' }, ['one']),
				el('a', { 'href': '/two', 'data-list-key': 'same' }, ['two']),
			])
			root.append(region)
			nodes.region = region
		})
		page.manager.focusInitial('main')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/one')
		assert.equal(page.manager.move('down'), true, '重号不吞掉第二项')
		assert.equal(page.manager.getCurrent()?.getAttribute('href'), '/two')
		assert.equal(page.marked().length, 1)
	})
})

describe('DOM：退出模式', () => {
	it('撤掉焦点类，并把焦点还给进入前仍可见的元素', () => {
		const doc = createDocument()
		const opener = el('button', { type: 'button' }, ['打开'])
		const main = el('main', { [REGION_ATTRIBUTE]: 'main' }, [
			el('a', { href: '/a' }, ['a']),
			el('a', { href: '/b' }, ['b']),
		])
		const root = el('div', {}, [opener, main])
		doc.body.append(root)
		doc.invalidate()
		doc.activeElement = opener // 进入前用户停在 opener 上

		const manager = createGamepadFocusManager(root)
		manager.focusInitial('main')
		assert.equal(manager.move('down'), true)
		assert.equal(manager.getCurrent(), main.children[1])

		manager.destroy()

		assert.equal(root.querySelectorAll(`.${GAMEPAD_FOCUS_CLASS}`).length, 0)
		assert.equal(manager.getCurrent(), null)
		assert.equal(doc.activeElement, opener, '焦点回到进入前的元素')
	})

	it('进入前的元素已经不可见时不去还焦点（不做无意义的跳动）', () => {
		const doc = createDocument()
		const opener = el('button', { type: 'button', hidden: '' }, ['打开'])
		const root = el('div', {}, [opener, el('main', { [REGION_ATTRIBUTE]: 'main' }, [el('a', { href: '/a' }, ['a'])])])
		doc.body.append(root)
		doc.invalidate()
		doc.activeElement = opener

		const manager = createGamepadFocusManager(root)
		manager.focusInitial('main')
		const before = doc.log.length
		manager.destroy()
		assert.equal(doc.log.length, before, '没有还焦点的 focus 调用')
	})
})

describe('DOM：能力缺失时降级为 no-op', () => {
	it('root 不属于任何文档时所有方法都不抛错', () => {
		const orphan = el('div', { [REGION_ATTRIBUTE]: 'main' }, [el('a', { href: '/a' }, ['a'])])
		const manager = createGamepadFocusManager(orphan)
		assert.equal(manager.getCurrent(), null)
		manager.refresh()
		manager.focusInitial('main')
		assert.equal(manager.move('down'), false)
		manager.setRegion('main')
		manager.activate()
		manager.destroy()
		assert.equal(manager.getCurrent(), null)
	})
})
