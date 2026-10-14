/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test。 */
// client/shared 平行实现的对账测试（架构梳理 B1）。
//
// `lib/client.ts` 与 `lib/shared/*` 各持一份「同语义、零依赖」的复刻实现，
// 两侧一致性此前只靠头注释约定——注释不报错，漂移零信号。本文件把对账
// 钉成判据：任何一侧改动导致输出形状变化，这里先红。
//
// ⚠️ 对账的是**行为合同**，不是逐字实现：两侧存在三条记录在案的差异
// （escapeHtml 多转义 `'`；highlightHtml 用 <span class=highlight> 对 <mark>、
// 且按词长排序保证长词优先），这些是刻意的设计差异，断言里显式写明；
// 其余输出必须严格一致。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { escape as toolkitEscape, escapeRegExp as toolkitEscapeRegExp } from 'es-toolkit/string'
import {
	escapeHtml,
	escapeRegExp,
	highlightHtml,
	safelyDecodeUriComponent,
} from '../src/lib/client.ts'
import { safelyDecodeUriComponent as sharedSafelyDecodeUriComponent } from '../src/lib/shared/link.ts'
import { highlightHtml as sharedHighlightHtml } from '../src/lib/shared/str.ts'

/** 公共样例：中文 / HTML 实体 / 非法编码 / 混合文本 */
const SAMPLES = [
	'普通中文文本',
	'混合 mixed 123 文本 with spaces',
	'<div class="x">已是标签的文本</div>',
	'实体 &amp; &lt; &gt; &quot; &#39;',
	'特殊字符 < > & " \'',
	'%E4%B8%AD%E6%96%87 percent-encoded 中文',
	'%zz 非法编码 %E4%BD 截断序列',
	'a%2Fb%252Fc 嵌套编码',
	'',
]

describe('对账：safelyDecodeUriComponent（client === shared，逐字同语义）', () => {
	for (const s of SAMPLES) {
		it(`样例一致: ${s.slice(0, 24) || '(空串)'}`, () => {
			assert.equal(safelyDecodeUriComponent(s), sharedSafelyDecodeUriComponent(s))
		})
	}

	it('非法编码原样返回、不抛（两侧同判）', () => {
		assert.equal(safelyDecodeUriComponent('%zz'), '%zz')
		assert.equal(sharedSafelyDecodeUriComponent('%zz'), '%zz')
	})

	it('合法编码正常解码且一致', () => {
		assert.equal(safelyDecodeUriComponent('%E4%B8%AD'), sharedSafelyDecodeUriComponent('%E4%B8%AD'))
		assert.equal(safelyDecodeUriComponent('%E4%B8%AD'), '中')
	})
})

describe('对账：escapeHtml（与 es-toolkit escape 完全同语义）', () => {
	it('五字符（& < > " \'）转义行为与 es-toolkit 逐字一致', () => {
		for (const s of ['<div class="x">&amp; it\'s', 'a<b>c&d"e', SAMPLES[2], SAMPLES[3]])
			assert.equal(escapeHtml(s), toolkitEscape(s))
	})

	it('纯中文与空串不转义，与原版一致', () => {
		assert.equal(escapeHtml('中文'), toolkitEscape('中文'))
		assert.equal(escapeHtml(''), toolkitEscape(''))
	})
})

describe('对账：highlightHtml（未命中片段输出一致；命中标记形状是记录在案的差异）', () => {
	it('无关键词时退化为纯 escape，两侧未命中片段一致', () => {
		const text = '纯文本 <b> 加粗 & 实体'
		assert.equal(highlightHtml(text, undefined), escapeHtml(text))
		assert.equal(sharedHighlightHtml(text, undefined), escapeHtml(text))
	})

	it('同一关键词命中时，未命中的文本片段两侧转义一致', () => {
		const text = '前缀 <b>中</b> 后缀'
		const a = highlightHtml(text, '中', 'hl')
		const b = sharedHighlightHtml(text, '中', 'hl')
		// 拆掉两侧各自的命中标记后，剩余片段必须逐字相等
		const strip = s => s.replaceAll(/<span class="hl">|<mark class="hl">|<span class="highlight">|<mark>|<\/span>|<\/mark>/g, '')
		assert.equal(strip(a), strip(b))
	})

	it('记录在案的差异：client 用 span.highlight，shared 用 mark', () => {
		assert.ok(highlightHtml('中文词', '中文').includes('<span class="highlight">中文</span>'))
		assert.ok(sharedHighlightHtml('中文词', '中文').includes('<mark>中文</mark>'))
	})

	it('中文关键词命中后，未命中的中文与实体片段不被破坏', () => {
		const a = highlightHtml('关键词 &amp; 其他', '关键词')
		assert.ok(a.includes('&amp;'))
	})
})

describe('对账：escapeRegExp（client 与 es-toolkit 同语义）', () => {
	it('正则元字符全部转义，构造出的 RegExp 行为一致', () => {
		for (const s of ['a.b*c?d[e]f', '中文(括号)', '^$|{}\\']) {
			const reA = new RegExp(escapeRegExp(s))
			const reB = new RegExp(toolkitEscapeRegExp(s))
			assert.equal(reA.test(s), reB.test(s))
			assert.equal(reA.test('x'), reB.test('x'))
		}
	})
})
