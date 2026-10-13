/**
 * meta description 的截断规则（纯函数，无 node / astro 依赖）。
 *
 * ═══ 为什么独立成一个文件 ═══
 *
 * 这套规则此前**逐字存在两份**：
 *
 * - `src/layouts/Base.astro` 的模块私有副本（渲染期，meta / og:description）
 * - `src/lib/shared/summaries.ts` 的导出版（生成期，`summary-core.mjs` 的
 *   `parseSummaryResponse` 用它兜底）
 *
 * 两份漂移的失败模式是静默的：生成期截到 140、渲染期截到 160 时，
 * 「什么算超长」的判断已经分叉，而 `check-summaries` 只校验 JSON 里的 `seo`
 * 是否 ≤ `SEO_DESCRIPTION_MAX`，**不校验渲染路径**——于是门禁全绿，
 * 只有产物里的 meta description 偶发超长。与坑位 23 的同族问题一致：
 * 判据与写入口各持一份算法，漂移只是时间问题。
 *
 * ⚠️ 本模块刻意**不放** `readSummaries` / `hashSource`。那两个带 `node:fs` /
 * `node:crypto`，而 `Base.astro` 是全站 68 页共用的根布局——把 node 内置依赖
 * 引进根作用域，等于邀请客户端 `<script>` 去 import barrel，而历史上
 * `SearchModal.astro` / `Comment.astro` 的做法是**内联复制**（见那两处的注释：
 * 「升级时需与源同改」）。那两份副本正是这种复制繁殖出来的，
 * 所以这里只收纯函数，别把 IO 也拖进来。
 */

/**
 * 截断上限。Google 的结果摘要在 155~160 字符附近截断，超出的部分永远显示不出来，
 * 只是白占权重。150 而非 160：留一点余量，避免中英混排时按字节/字素折算的偏差顶到边界。
 *
 * ⚠️ 这是一次**对线上行为的主动偏离**，不是修回归：Nuxt 基线同样不截断，
 * 所以 parity 档的 `live:head` 会就此报出差异。那是预期内的，
 * 别把 `live:head` 在描述栏上的差异当缺陷去"修"。
 */
export const SEO_DESCRIPTION_MAX = 150

/** 超长时按句子边界回退，实在切不出句子边界再硬切，避免把词劈开 */
export function clampDescription(text: string, max = SEO_DESCRIPTION_MAX): string {
	const trimmed = text.trim()
	if (trimmed.length <= max)
		return trimmed
	const head = trimmed.slice(0, max - 1)
	const lastStop = Math.max(
		head.lastIndexOf('。'),
		head.lastIndexOf('！'),
		head.lastIndexOf('？'),
		head.lastIndexOf('. '),
		head.lastIndexOf('! '),
		head.lastIndexOf('? '),
	)
	// 回退到最近的句子边界；最近的边界若在 60% 之前，说明这句太长，
	// 那种情况下宁可硬切也不要丢掉大半内容。
	return `${lastStop > max * 0.6 ? head.slice(0, lastStop + 1) : head}…`
}
