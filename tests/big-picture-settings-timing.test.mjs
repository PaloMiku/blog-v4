/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// `src/lib/big-picture/settings-timing.ts` 的纯解析合同单测。
//
// 这段逻辑原先住在 `BigPictureShell.astro` 的 `<script>` 里，**无法被 Node
// 测试导入**（.astro 的 script 不是模块），所以一行测试都写不了。搬出来之后，
// 「吞掉 B」的守卫窗口长度才第一次可测。
//
// 为什么它值得测：`settingsCloseDelay()` 的返回值是 modal 家族吞掉 B 的窗口
// 长度——解析错了窗口就太短，B 会在面板收起途中穿透到下面那层，用户按两下 B
// 直接被送走。这类 bug 只在真实浏览器里复现，静态门禁一个都看不见。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { longestCssDuration, parseCssDuration } from '../src/lib/big-picture/settings-timing.ts'

describe('parseCssDuration', () => {
	it('秒写法乘 1000', () => {
		assert.equal(parseCssDuration('0.2s'), 200)
		assert.equal(parseCssDuration('1s'), 1000)
		assert.equal(parseCssDuration('0.05s'), 50)
	})

	it('毫秒写法原样返回', () => {
		assert.equal(parseCssDuration('200ms'), 200)
		assert.equal(parseCssDuration('350ms'), 350)
	})

	it('小数不四舍五入（0.15s 就是 150ms，不是 150.00001）', () => {
		assert.equal(parseCssDuration('0.15s'), 150)
	})

	it('解析不了一律当 0，而不是 NaN', () => {
		// NaN 会毒化下游的 Math.max：整个守卫窗口变成 NaN，setTimeout 立刻触发。
		for (const bad of ['', 'auto', 'inherit', '0', 'none']) {
			const got = parseCssDuration(bad)
			assert.equal(got, 0, `「${bad}」应得 0，实际 ${got}`)
			assert.ok(Number.isFinite(got))
		}
	})

	it('前后空白不影响解析', () => {
		assert.equal(parseCssDuration('  200ms  '), 200)
		assert.equal(parseCssDuration(' 0.2s '), 200)
	})

	it('只认结尾的 ms；中间出现 ms 仍按秒算', () => {
		assert.equal(parseCssDuration('200mss'), 200000)
	})
})

describe('longestCssDuration', () => {
	it('单段直接透传', () => {
		assert.equal(longestCssDuration('0.2s'), 200)
	})

	it('多段取最慢那段——守卫窗口必须覆盖整段过渡', () => {
		// 取最快的会让窗口比过渡短，B 在过渡途中穿透到下面那层。
		assert.equal(longestCssDuration('0.1s, 0.4s'), 400)
		assert.equal(longestCssDuration('0.2s, 0.2s, 0.6s'), 600)
	})

	it('混用秒与毫秒', () => {
		assert.equal(longestCssDuration('200ms, 0.5s'), 500)
	})

	it('含空分量时取其余的最大值', () => {
		assert.equal(longestCssDuration('0.3s, , 0.2s'), 300)
	})

	it('全不可解析时得 0，交给调用方退回默认值', () => {
		assert.equal(longestCssDuration(''), 0)
		assert.equal(longestCssDuration('auto'), 0)
	})
})
