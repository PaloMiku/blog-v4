/**
 * `pnpm summary` 的纯逻辑层：拼 prompt、解析模型输出、写回 JSON。
 *
 * **为什么单独一个文件**：模型会说不听话的话——返回包着围栏的 JSON、
 * 散文夹 JSON、字段名对不上、被安全策略拦回一段道歉。把这些形状的判据
 * 从「读文件 + 循环 + 发请求」的脚本里拆出来，才测得动（`tests/summary-llm.test.mjs`
 * 打不到网络，靠的就是这一层纯）。`scripts/summary.ts` 只管编排。
 *
 * 纯函数，无 IO、无 env、无网络。
 */
import { clampDescription } from '../../src/lib/shared/summaries.ts'

/** 正文送进 prompt 的上限。超长部分截断，并在 prompt 里明说。 */
export const BODY_LIMIT = 8000

const SYSTEM_PROMPT = [
	'你是博客的摘要撰写者。给定一篇中文技术博客的标题、分类、标签与正文，产出结构化摘要。',
	'',
	'要求：',
	'- summary：一段完整的中文摘要，说明文章讲了什么、怎么做的、结论是什么。',
	'  3~5 句，不超过 300 字。用陈述句，不要用「本文」「这篇文章」开头，不要 markdown 标记。',
	'- seo：一句不超过 150 字的中文描述，用于搜索结果摘要。',
	'  要包含标题里的主关键词，能独立看懂，不要与 summary 逐字重复。',
	'',
	'只输出 JSON 对象，形如 {"summary":"…","seo":"…"}。不要输出任何其它文字或代码围栏。',
].join('\n')

/**
 * 拼出一次请求的 messages。
 *
 * 截断时**必须在 prompt 里告诉模型**——否则它会以为自己读到了全文，
 * 对被切掉的后半篇（常是结论）凭空编造。
 *
 * @param {{ title?: string, tags?: string[], categories?: string[], date?: string, body: string }} post
 * @returns {string} user 消息正文
 */
export function buildPrompt(post) {
	const meta = [
		post.title ? `标题：${post.title}` : '',
		post.categories?.length ? `分类：${post.categories.join('、')}` : '',
		post.tags?.length ? `标签：${post.tags.join('、')}` : '',
		post.date ? `日期：${post.date}` : '',
	].filter(Boolean)

	const raw = String(post.body ?? '')
	const truncated = raw.length > BODY_LIMIT
	const body = truncated ? raw.slice(0, BODY_LIMIT) : raw

	return [
		...meta,
		'',
		`正文：${body}`,
		...(truncated ? [`（正文过长，已截断至前 ${BODY_LIMIT} 字。后面的内容你没看到，不要凭空推测。）`] : []),
	].join('\n')
}

export const SUMMARY_SYSTEM_PROMPT = SYSTEM_PROMPT

/** 从可能带围栏、带寒暄的文本里抠出第一个平衡花括号的对象 */
function extractJsonObject(text) {
	const start = text.indexOf('{')
	if (start < 0)
		return null
	let depth = 0
	let inString = false
	let escaped = false
	for (let i = start; i < text.length; i++) {
		const ch = text[i]
		if (escaped) {
			escaped = false
			continue
		}
		if (ch === '\\') {
			escaped = true
			continue
		}
		if (ch === '"') {
			inString = !inString
			continue
		}
		if (inString)
			continue
		if (ch === '{')
			depth++
		else if (ch === '}' && --depth === 0)
			return text.slice(start, i + 1)
	}
	return null
}

/**
 * 把模型的一次响应变成 `{ summary, seo }`，拿不到就返回 `null`。
 *
 * ⚠️ **返回 null 意味着「这个键一个字都不能碰」**，见 `applyEntry`。
 * 这里只负责形状与类型：`seo` 的长度由 `applyEntry` 兜 `clampDescription`。
 *
 * @param {unknown} raw API 响应对象，或 content 字符串（两种都认）
 * @returns {{ summary: string, seo?: string } | null} 可用的结果；形状不对时 null（调用方据此判定「这次失败」）
 */
export function parseSummaryResponse(raw) {
	let content = raw
	if (raw && typeof raw === 'object') {
		content = raw?.choices?.[0]?.message?.content
	}
	if (typeof content !== 'string')
		return null

	// 剥围栏：JSON.parse 对 "```json\n{…}\n```" 直接失败
	const unfenced = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '')
	const candidate = extractJsonObject(unfenced) ?? unfenced.trim()

	let parsed
	try {
		parsed = JSON.parse(candidate)
	}
	catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object')
		return null

	const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
	if (!summary)
		return null

	const seo = typeof parsed.seo === 'string' && parsed.seo.trim() ? parsed.seo.trim() : undefined
	return { summary, seo }
}

/**
 * 把一次成功生成写进 JSON。
 *
 * ## 失败时必须**完全不动这个键**
 *
 * 这是整个增量机制的地基。若失败也盖上新的 `sourceHash`，下一次跑
 * `hashSource(src) === rec.sourceHash` 成立 ⇒ 判成 `unchanged` ⇒ 那篇文章
 * 的摘要**再也不会生成**，而 `pnpm summary` 报「已同步」、`check-summaries` 报绿。
 * 一次网络抖动就变成永久静默丢失，且没有任何信号。
 *
 * ## seo 必须过 clampDescription，无条件
 *
 * 模型漏掉 `seo` 是常见输出形状；给出超长的 `seo` 更常见。`[...slug].astro` 里
 * `entry.data.seo ?? fallback` 对空串**不生效**（空串非 nullish），而 loader 的
 * `if (rec?.seo)` 又会挡掉空串，于是那篇文章的 meta description 直接空白。
 *
 * 而超长 seo 一旦落盘就是 `check-summaries` 的 `seo-too-long` 红灯——生成期修
 * 永远比门禁期修便宜，所以兜底不是「缺失才兜」，而是**恒过一遍 clamp**：
 * 缺失 / 空串 / 超长三种情形一个分支覆盖。
 *
 * @param {{ entries: Record<string, unknown> }} json 原地修改
 * @param {string} id
 * @param {{ summary: string, seo?: string } | null} result null = 本次失败
 * @param {string} hash 本次正文指纹，仅成功时写入
 */
export function applyEntry(json, id, result, hash) {
	if (!result || !result.summary)
		return false
	// ⚠️ 判据必须先 trim 再判空：`'  '` 是 truthy，`result.seo || result.summary`
	// 挡不住它，会让 clampDescription('') 产出空串 seo（空串非 nullish，
	// `[...slug].astro` 的 `??` 兜不住，meta description 直接空白）。
	const seo = clampDescription(result.seo?.trim() || result.summary)
	json.entries[id] = { ...json.entries[id], summary: result.summary, seo, sourceHash: hash }
	return true
}
