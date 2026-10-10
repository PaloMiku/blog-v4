/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`src/lib/shared/pagination.ts` 纯函数单测。
// getPaginationIndicator 的合同（与 Nuxt 侧 composable 逐字一致）：
// 首页恒在；`total > 1` 时末页恒在；中间窗口 `[current-expand, current+expand]`
// 夹到 `[2, total-1]`；两端被省略的区间各插一个 `-1`（渲染层约定 -1 = 省略号）。
// compareValues 的合同：码点序 `<`/`>`（**不是** localeCompare），相等返回 0。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareValues, getPaginationIndicator } from '../src/lib/shared/pagination.ts'

describe('getPaginationIndicator', () => {
	it('单页：只有 [1]，末页不重复追加', () => {
		assert.deepEqual(getPaginationIndicator(1, 1), [1])
	})

	it('两页：无窗口空隙，直接 [1,2]', () => {
		assert.deepEqual(getPaginationIndicator(1, 2), [1, 2])
		assert.deepEqual(getPaginationIndicator(2, 2), [1, 2])
	})

	it('首页态（current=1, total=5）：窗口贴左，尾部省略号', () => {
		assert.deepEqual(getPaginationIndicator(1, 5), [1, 2, 3, -1, 5])
	})

	it('末页态（current=5, total=5）：窗口贴右，头部省略号', () => {
		assert.deepEqual(getPaginationIndicator(5, 5), [1, -1, 3, 4, 5])
	})

	it('中段态（current=4, total=7）：窗口 [2..6] 恰不吃两端，无省略号', () => {
		assert.deepEqual(getPaginationIndicator(4, 7), [1, 2, 3, 4, 5, 6, 7])
	})

	it('中段态（current=3, total=7）：start 被夹到 2，只有尾部省略号', () => {
		assert.deepEqual(getPaginationIndicator(3, 7), [1, 2, 3, 4, 5, -1, 7])
	})

	it('current<1 夹到底：窗口收敛到左端', () => {
		assert.deepEqual(getPaginationIndicator(0, 10), [1, 2, -1, 10])
		// current=-5 时 end=min(9,-3)=-3 < start，窗口整体落空，只剩两端+省略号
		assert.deepEqual(getPaginationIndicator(-5, 10), [1, -1, 10])
	})

	it('current>total 夹到顶：窗口收敛到右端', () => {
		assert.deepEqual(getPaginationIndicator(11, 10), [1, -1, 9, 10])
		// current=999 时 start=min 侧越界（start=997 > end=9），窗口同样落空
		assert.deepEqual(getPaginationIndicator(999, 10), [1, -1, 10])
	})

	it('expand 可调：expand=0 只剩当前页，两端各一个省略号', () => {
		assert.deepEqual(getPaginationIndicator(3, 7, 0), [1, -1, 3, -1, 7])
	})

	it('expand=1 窄窗口', () => {
		assert.deepEqual(getPaginationIndicator(5, 9, 1), [1, -1, 4, 5, 6, -1, 9])
	})

	it('不变式：1 恒在首位，total>1 时 total 恒在末位，-1 只出现在中间', () => {
		for (let total = 1; total <= 12; total++) {
			for (let current = 0; current <= total + 1; current++) {
				const pages = getPaginationIndicator(current, total)
				assert.equal(pages[0], 1)
				if (total > 1)
					assert.equal(pages.at(-1), total)
				pages.forEach((p, i) => {
					if (p === -1)
						assert.ok(i > 0 && i < pages.length - 1, `-1 不应出现在端点 (current=${current}, total=${total})`)
					else
						assert.ok(p >= 1 && p <= total, `页码越界: ${p} (total=${total})`)
				})
			}
		}
	})
})

describe('compareValues', () => {
	it('小于/大于/相等：-1 / 1 / 0', () => {
		assert.equal(compareValues('a', 'b'), -1)
		assert.equal(compareValues('b', 'a'), 1)
		assert.equal(compareValues('x', 'x'), 0)
	})

	it('tie：内容相同的不同字符串相等分支返回 0', () => {
		assert.equal(compareValues('', ''), 0)
		assert.equal(compareValues('2024-03-15 19:24:26', '2024-03-15 19:24:26'), 0)
	})

	it('ISO 日期串：码点序与字典序同向（构建期 localeCompare 与客户端此处不分歧的前提）', () => {
		assert.equal(compareValues('2024-03-15', '2024-03-16'), -1)
		assert.equal(compareValues('2023-12-31', '2024-01-01'), -1)
	})

	it('合同是码点序而非 locale：大写 B(0x42) 排在小写 a(0x61) 之前', () => {
		assert.equal(compareValues('a', 'B'), 1)
		// 任意常见 locale 的字典序都是 a < b（即 'a'.localeCompare('B') === -1），
		// 与码点序相反——这行是对「不许顺手换成 localeCompare」（pagination.ts 头注）的钉。
		assert.notEqual(compareValues('a', 'B'), 'a'.localeCompare('B'))
	})

	it('可用于排序：升序数组两两比较恒 ≤0', () => {
		const sorted = ['2022-09-01', '2023-05-06', '2024-03-15', '2024-12-31']
		for (let i = 0; i + 1 < sorted.length; i++)
			assert.equal(compareValues(sorted[i], sorted[i + 1]), -1)
	})
})
