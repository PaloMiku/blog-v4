/* eslint-disable test/no-import-node-test -- 同 summaries.test.mjs：用 Node 内置 node:test。 */
/**
 * `scripts/lib/summary-core.mjs` 的单测——纯函数，**不打网络**。
 *
 * 这一层存在的理由是「模型会说不听话的话」：真实 API 返回的可能是包着
 * ```json 围栏的、可能是散文夹 JSON、可能字段名对不上、可能干脆被安全策略拦回
 * 一段道歉。它们各自对应一种**必须不写盘**的情形，所以判据不是「parse 成功」
 * 而是「拿到能用的 summary 与 seo 才算成功」。
 *
 * 最要紧的一条不变量在 `applyEntry` 的失败分支：**调用失败时那个键必须原封不动**。
 * 写错了（照样盖上新 sourceHash）会让失败的条目永远判成 unchanged，于是
 * `pnpm summary` 报「已同步」、`check-summaries` 报绿，唯独那篇文章的摘要
 * 再也不会生成，且没有任何东西会提示——CLAUDE.md 坑位 29 的假绿。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyEntry, buildPrompt, parseSummaryResponse } from '../scripts/lib/summary-core.mjs'
import { deriveModelLabel, SEO_DESCRIPTION_MAX } from '../src/lib/shared/summaries.ts'

describe('parseSummaryResponse', () => {
	it('裸 JSON', () => {
		const r = parseSummaryResponse('{"summary":"摘要。","seo":"描述。"}')
		assert.deepEqual(r, { summary: '摘要。', seo: '描述。' })
	})

	it('包着 ```json 围栏', () => {
		const raw = '```json\n{"summary":"摘要。","seo":"描述。"}\n```'
		assert.deepEqual(parseSummaryResponse(raw), { summary: '摘要。', seo: '描述。' })
	})

	it('围栏无语言标注', () => {
		const raw = '```\n{"summary":"摘要。","seo":"描述。"}\n```'
		assert.equal(parseSummaryResponse(raw).summary, '摘要。')
	})

	it('散文前后夹着 JSON —— 取第一个对象', () => {
		const raw = '好的，这是结果：\n{"summary":"摘要。","seo":"描述。"}\n希望有帮助。'
		assert.equal(parseSummaryResponse(raw).summary, '摘要。')
	})

	it('对象里含嵌套花括号不被截断', () => {
		const raw = '{"summary":"见 {tag} 的说明","seo":"含 } 的描述"}'
		assert.equal(parseSummaryResponse(raw).summary, '见 {tag} 的说明')
		assert.equal(parseSummaryResponse(raw).seo, '含 } 的描述')
	})

	it('summary 是空白串 —— 失败（长度检查在 parse 阶段就要挡）', () => {
		assert.equal(parseSummaryResponse('{"summary":"   ","seo":"描述。"}'), null)
	})

	it('缺 summary 字段 —— 失败', () => {
		assert.equal(parseSummaryResponse('{"seo":"描述。"}'), null)
	})

	it('summary 不是字符串 —— 失败', () => {
		assert.equal(parseSummaryResponse('{"summary":{"a":1},"seo":"描述。"}'), null)
	})

	it('散文道歉 / 被安全策略拦回 —— 失败', () => {
		assert.equal(parseSummaryResponse('抱歉，我无法协助处理这个请求。'), null)
	})

	it('空串 / null / undefined —— 失败', () => {
		assert.equal(parseSummaryResponse(''), null)
		assert.equal(parseSummaryResponse(null), null)
		assert.equal(parseSummaryResponse(undefined), null)
	})

	it('JSON 语法坏掉 —— 失败，不抛', () => {
		assert.equal(parseSummaryResponse('{"summary":"没闭合'), null)
	})

	it('响应外壳缺 choices[0].message.content —— 失败', () => {
		assert.equal(parseSummaryResponse(undefined), null)
	})
})

describe('buildPrompt', () => {
	const post = {
		title: 'Fedora Silverblue 安装',
		tags: ['Linux', 'Fedora'],
		categories: ['折腾'],
		date: '2025-12-10',
		body: '正文内容。',
	}

	it('带上标题与分类标签', () => {
		const p = buildPrompt(post)
		assert.match(p, /Fedora Silverblue 安装/)
		assert.match(p, /Linux/)
		assert.match(p, /折腾/)
	})

	it('超长正文截断并明说截断了', () => {
		const long = '字'.repeat(20000)
		const p = buildPrompt({ ...post, body: long })
		assert.ok(p.length < 20000, '截断后 prompt 不应含全文')
		assert.match(p, /截断|截取/)
	})

	it('短正文不被标记为截断', () => {
		assert.doesNotMatch(buildPrompt(post), /截断|截取/)
	})

	it('tags/categories 缺失时不影响出 prompt', () => {
		const p = buildPrompt({ title: '只有标题', body: '正文。' })
		assert.match(p, /只有标题/)
	})
})

describe('applyEntry', () => {
	function fresh() {
		return { $meta: {}, entries: { 'a/b': { summary: '旧摘要。', seo: '旧描述。', sourceHash: 'old' } } }
	}

	it('成功写入：三个字段一起更新', () => {
		const j = fresh()
		applyEntry(j, 'a/b', { summary: '新摘要。', seo: '新描述。' }, 'new')
		assert.deepEqual(j.entries['a/b'], { summary: '新摘要。', seo: '新描述。', sourceHash: 'new' })
	})

	it('新增条目', () => {
		const j = { $meta: {}, entries: {} }
		applyEntry(j, 'x/y', { summary: '摘要。', seo: '描述。' }, 'h')
		assert.deepEqual(j.entries['x/y'], { summary: '摘要。', seo: '描述。', sourceHash: 'h' })
	})

	/*
	 * 下面两条是这个文件存在的主要理由。**红绿双向**：先看第二条会红——
	 * 只要 applyEntry 在失败时也盖 sourceHash，它立刻失败。
	 */
	it('❌ 失败时不得改动已有键（sourceHash 保持旧值）', () => {
		const j = fresh()
		const before = JSON.stringify(j.entries['a/b'])
		applyEntry(j, 'a/b', null, 'new')
		assert.equal(JSON.stringify(j.entries['a/b']), before, '失败调用改动了条目')
		assert.equal(j.entries['a/b'].sourceHash, 'old', '失败调用盖上了新的 sourceHash —— 该条目将永远判成 unchanged')
	})

	it('失败时不新建空条目', () => {
		const j = { $meta: {}, entries: {} }
		applyEntry(j, 'x/y', null, 'h')
		assert.equal('x/y' in j.entries, false)
	})

	it('seo 缺失时用 clampDescription(summary) 兜底', () => {
		const j = { $meta: {}, entries: {} }
		applyEntry(j, 'x/y', { summary: '摘要。' }, 'h')
		assert.equal(j.entries['x/y'].seo, '摘要。')
	})

	it('seo 为空串时同样兜底', () => {
		const j = { $meta: {}, entries: {} }
		applyEntry(j, 'x/y', { summary: '摘要。', seo: '  ' }, 'h')
		assert.equal(j.entries['x/y'].seo, '摘要。')
	})

	it('seo 超长时兜底截断到上限内', () => {
		const j = { $meta: {}, entries: {} }
		const long = '描'.repeat(400)
		applyEntry(j, 'x/y', { summary: '摘要。', seo: long }, 'h')
		assert.ok(j.entries['x/y'].seo.length <= SEO_DESCRIPTION_MAX, `seo ${j.entries['x/y'].seo.length} 仍超限`)
	})
})

/*
 * 徽章短名的推导。这里最容易做坏的地方不是「长不长」，而是**字母汤**：
 * 逐段删掉 `moonshotai/`、`meta-llama/` 这类厂商前缀后可能什么都不剩，
 * 或者只剩 `4-70b`、`2.5-pro` 这种无意义的碎片。
 */
describe('deriveModelLabel', () => {
	/** 显式 label 永远优先，派生逻辑一律不介入 */
	it('显式 modelLabel 直接返回', () => {
		assert.equal(deriveModelLabel('deepseek/deepseek-flash', 'DeepSeek Flash'), 'DeepSeek Flash')
	})

	it('显式 label 也接受模型 ID 本身（用户就是想显示全名）', () => {
		assert.equal(deriveModelLabel('deepseek/deepseek-flash', 'Kimi K2'), 'Kimi K2')
	})

	/** OpenRouter 风格：取尾段，且**剥掉与厂商同名的首词 */
	it('剥掉与厂商重复的首词：deepseek/deepseek-flash → Flash', () => {
		assert.equal(deriveModelLabel('deepseek/deepseek-flash'), 'Flash')
	})

	it('厂商名不重复时一个都不动', () => {
		assert.equal(deriveModelLabel('moonshotai/kimi-k2-instruct'), 'Kimi K2 Instruct')
	})

	it('版本后缀被丢掉：kimi-k2-0905-preview → Kimi K2', () => {
		assert.equal(deriveModelLabel('moonshotai/kimi-k2-0905-preview'), 'Kimi K2')
	})

	it(':free 之类的路由后缀被丢掉', () => {
		assert.equal(deriveModelLabel('deepseek/deepseek-v3.1-terminus:free'), 'V3.1 Terminus')
	})

	it('厂商 slug 不参与显示：x-ai/grok-4 → Grok 4', () => {
		// 厂商 slug 是路由命名空间，读者不认识；标签只由型号段构成
		assert.equal(deriveModelLabel('x-ai/grok-4'), 'Grok 4')
		assert.equal(deriveModelLabel('google/gemini-2.5-pro'), 'Gemini 2.5 Pro')
		assert.equal(deriveModelLabel('anthropic/claude-sonnet-4.5'), 'Claude Sonnet 4.5')
	})

	it('数字版本保留：gpt-5 → GPT 5', () => {
		assert.equal(deriveModelLabel('openai/gpt-5'), 'GPT 5')
	})

	it('点号版本保留：claude-sonnet-4.5 → Claude Sonnet 4.5', () => {
		assert.equal(deriveModelLabel('anthropic/claude-sonnet-4.5'), 'Claude Sonnet 4.5')
	})

	/** 无 vendor 的裸 ID（自建端点常见）不该凭空加前缀 */
	it('裸 ID 直接按词拆标题化', () => {
		assert.equal(deriveModelLabel('kimi-k2'), 'Kimi K2')
		assert.equal(deriveModelLabel('gpt-4o-mini'), 'GPT 4o Mini')
	})

	/** 派生不出来时退回原值 —— 宁可长着也不要空 */
	it('空 / 空白 model 返回空串（徽章据此不渲染）', () => {
		assert.equal(deriveModelLabel(''), '')
		assert.equal(deriveModelLabel('   '), '')
		assert.equal(deriveModelLabel(undefined), '')
	})

	it('尾段全是路由标记时退回原值，不显示光秃秃的厂商名', () => {
		// `preview` / `free` 是路由标记不是产品名；剥掉后只剩厂商，读起来像断言
		assert.equal(deriveModelLabel('vendor/preview'), 'vendor/preview')
		assert.equal(deriveModelLabel('vendor/free'), 'vendor/free')
	})

	it('结果长度不超过徽章可读上限', () => {
		const long = deriveModelLabel('some-vendor/some-extremely-long-model-name-20250901-preview')
		assert.ok(long.length <= 40, `"${long}" 长度 ${long.length}，徽章放不下`)
	})

	/*
	 * 下面这条是整个推导里最容易被做坏的地方，且**已经坏过一次**：
	 * 早先按「slug 词集合与尾段有交集就剥厂商回声」判断，
	 * `meta-llama` 与 `llama` 有交集，于是 `llama-4-70b-instruct` 被剥成 `4 70b`——
	 * 型号整个丢了，只剩版本号碎片，读者完全不知道是什么模型。
	 * 比「显示长名字」糟得多。当前规则只在**已知厂商的展示名**之间去重。
	 */
	it('❌ 型号不得被剥成只剩版本号碎片', () => {
		const label = deriveModelLabel('meta-llama/llama-4-70b-instruct')
		assert.match(label, /llama/i, `"${label}" 把型号名剥丢了`)
		assert.ok(!/^\d/.test(label), `"${label}" 开头是数字，说明剥过头了`)
	})
})
