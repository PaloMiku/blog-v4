/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`src/lib/shared/time.ts` 纯逻辑单测。
// 时区前提：tests/harness.mjs 已把 process.env.TZ 钉在 Asia/Shanghai（与
// blogConfig.timeZone 一致；该时区自 1991 年起无 DST，本地 getter 分支无需考虑夏令时跳变）。
// isSameUnit 用 `new Date` + 本地 getter（year/month）/ toDateString（day），
// 非法输入不抛出：Invalid Date 的字段是 NaN，NaN === NaN 为 false → 恒返回 false，
// 函数体内的 try/catch 只对**非字符串**入参（如 undefined 触发 new Date 之外的错误）兜底。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	isSameUnit,
	isTimeDiffSignificant,
	timeElapse,
	toInstantString,
	toZonedTemporal,
} from '../src/lib/shared/time.ts'

const DAY = 86_400_000

describe('isSameUnit', () => {
	it('year：同年不同月/日 → true；跨年 → false', () => {
		assert.equal(isSameUnit('2024-01-01T08:00:00+08:00', '2024-12-31T08:00:00+08:00', 'year'), true)
		assert.equal(isSameUnit('2024-12-31T23:30:00+08:00', '2023-01-01T00:30:00+08:00', 'year'), false)
	})

	it('month：同年同月不同日 → true；同月跨年 → false', () => {
		assert.equal(isSameUnit('2024-03-07T00:00:00+08:00', '2024-03-31T23:59:59+08:00', 'month'), true)
		assert.equal(isSameUnit('2023-03-15T12:00:00+08:00', '2024-03-15T12:00:00+08:00', 'month'), false)
	})

	it('day：同一上海日历日的不同时刻 → true；跨日 → false', () => {
		assert.equal(isSameUnit('2024-03-07T00:01:00+08:00', '2024-03-07T23:59:00+08:00', 'day'), true)
		assert.equal(isSameUnit('2024-03-07T23:30:00+08:00', '2024-03-08T00:30:00+08:00', 'day'), false)
	})

	it('day：同一瞬间的不同 offset 表示 → 同一天（比较的是日历日不是字符串）', () => {
		assert.equal(isSameUnit('2024-03-07T19:24:26+08:00', '2024-03-07T11:24:26Z', 'day'), true)
	})

	it('非法输入：Invalid Date 的字段是 NaN → 与合法日期恒不等', () => {
		assert.equal(isSameUnit('nope', '2024-01-01T12:00:00+08:00', 'year'), false)
		assert.equal(isSameUnit('', '2024-01-01T12:00:00+08:00', 'month'), false)
	})

	it('合同怪癖（如实钉住）：day 分支用 toDateString，两个 Invalid Date 字符串相等 → true', () => {
		// `new Date('nope').toDateString()` 都是字面 'Invalid Date'，`===` 成立。
		// year/month 分支因 NaN 比较没有此问题。行为保持原样（改它属于行为变更，
		// 不在 EC-005 范围内），这条测试钉住「现状是什么」而非「应当是什么」。
		assert.equal(isSameUnit('nope', 'also-nope', 'day'), true)
		// 非法 vs 合法仍是 false：
		assert.equal(isSameUnit('nope', '2024-01-01T12:00:00+08:00', 'day'), false)
	})
})

describe('isTimeDiffSignificant', () => {
	it('缺任一侧时间 → false（短路，不进阈值判定）', () => {
		assert.equal(isTimeDiffSignificant(undefined, '2024-01-01T12:00:00+08:00'), false)
		assert.equal(isTimeDiffSignificant('2024-01-01T12:00:00+08:00', ''), false)
	})

	it('threshold<=0 恒 false；threshold>1 恒 true（两端开区间语义）', () => {
		const d = '2024-01-01T12:00:00+08:00'
		assert.equal(isTimeDiffSignificant(d, d, 0), false)
		assert.equal(isTimeDiffSignificant(d, d, -1), false)
		assert.equal(isTimeDiffSignificant(d, d, 2), true)
	})

	it('同龄（同一时间串）→ 比值 1 → 不显著', () => {
		const d = new Date(Date.now() - DAY).toISOString()
		assert.equal(isTimeDiffSignificant(d, d), false)
	})

	it('100 天 vs 10 天：小/大比值 0.1 < 0.6 → 显著', () => {
		const old = new Date(Date.now() - 100 * DAY).toISOString()
		const fresh = new Date(Date.now() - 10 * DAY).toISOString()
		assert.equal(isTimeDiffSignificant(old, fresh), true)
	})

	it('非法日期串：getTime 得 NaN，NaN<x 恒 false → false（try/catch 不触发，如实钉住）', () => {
		assert.equal(isTimeDiffSignificant('nope', '2024-01-01T12:00:00+08:00'), false)
	})
})

describe('timeElapse', () => {
	const ago = ms => new Date(Date.now() - ms).toISOString()

	it('未来时间 → 刚刚', () => {
		assert.equal(timeElapse(new Date(Date.now() + 60_000).toISOString()), '刚刚')
	})

	it('不足一分钟 → 刚刚（整串为空时的兜底）', () => {
		assert.equal(timeElapse(ago(5_000)), '刚刚')
	})

	it('只保留最高两级单位', () => {
		assert.equal(timeElapse(ago(65_000)), '1分')
		assert.equal(timeElapse(ago(65 * 60 * 1000)), '1小时5分')
		assert.equal(timeElapse(ago(90 * 60 * 1000)), '1小时30分')
		assert.equal(timeElapse(ago(25 * 60 * 60 * 1000)), '1天1小时')
		assert.equal(timeElapse(ago(400 * DAY)), '1年1个月')
	})

	it('非法输入：NaN 差值不进任何分支 → 刚刚（不抛出）', () => {
		assert.equal(timeElapse('nope'), '刚刚')
	})
})

describe('toZonedTemporal / toInstantString', () => {
	it('无时区字面量按 blogConfig.timeZone（Asia/Shanghai）解释，不偏移', () => {
		// content.config.ts 的 toDateStringFromUtc 注释所钉的同一套约定：
		// `2024-03-07 19:24:26` 必须还原为上海墙钟 19:24:26，而不是凭空 ±8h
		const zdt = toZonedTemporal('2024-03-07 19:24:26')
		assert.equal(zdt.timeZoneId, 'Asia/Shanghai')
		assert.equal(`${zdt.year}-${zdt.month}-${zdt.day} ${zdt.hour}:${zdt.minute}:${zdt.second}`, '2024-3-7 19:24:26')
		assert.equal(toInstantString('2024-03-07 19:24:26'), '2024-03-07T11:24:26Z')
	})

	it('纯日期串：PlainDateTime 分支按上海零点 → 前一日 16:00 UTC', () => {
		assert.equal(toInstantString('2024-03-07'), '2024-03-06T16:00:00Z')
	})

	it('带 offset 的 ISO 串：Instant 分支，原瞬间不受精确时区影响', () => {
		assert.equal(toInstantString('2024-03-07T19:24:26+08:00'), '2024-03-07T11:24:26Z')
	})

	it('完整 ZonedDateTime 串：第一分支直通', () => {
		const s = '2024-03-07T19:24:26+08:00[Asia/Shanghai]'
		assert.equal(toInstantString(s), '2024-03-07T11:24:26Z')
	})

	it('已是 ZonedDateTime 的入参：toInstantString 不再走解析分支', () => {
		const zdt = toZonedTemporal('2024-03-07 19:24:26')
		assert.equal(toInstantString(zdt), '2024-03-07T11:24:26Z')
	})

	it('无参调用 → 当前时刻，时区钉在 Asia/Shanghai', () => {
		assert.equal(toZonedTemporal().timeZoneId, 'Asia/Shanghai')
	})

	it('彻底非法的字符串：三个解析分支全部失败后 RangeError 如实抛出', () => {
		assert.throws(() => toZonedTemporal('not a date at all'), RangeError)
	})
})
