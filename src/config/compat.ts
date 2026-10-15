/**
 * 迁移兼容开关的集中管理点（EC-004）。
 *
 * 规则：任何「为了对齐旧 Nuxt 行为而存在」的布尔开关都住在这里，
 * 每个开关必须写全四样：**保留原因、验证证据、退出条件、预计复核日期**。
 * 页面主流程只引用本模块，不再就地藏 `const PARITY_x = true`。
 * 散落在各文件、无法用开关表达的 URL/SEO 合同类条目（标题锚点 slugger、
 * `hidePostPrefix`、`smartypants: false`、robots 静态名单等）各有就地注释说明
 * 保留理由与退出条件，不在此重复。
 *
 * 能通过产品行为修复的兼容点，不继续用这里的开关隐藏问题。
 */
export const compat = {
	/**
	 * 压制文章内容页的「合集」（Collection）区块。
	 *
	 * 保留原因：**暂时移除**（2026-10-13）。合集功能已实现并跑通过（组件、数据链路、
	 * 7 个合集的登记都在仓库里，见 `Collection.astro` 的 COLLECTION_SETTINGS），
	 * 但站长决定先把「文章分类体系」这件事放一放，故不渲染该区块。
	 * 原始压制理由（迁流期视觉一致）见本文件 git 历史。
	 *
	 * 验证证据（2026-10-13 本机，产物级）：开关为 true 时，产物中
	 * `post-collection` 出现 0 次；35 篇文章的 frontmatter 已移除 `collection:`
	 * 字段（`git grep -l "^collection:" -- src/content/posts` 返回空）。
	 *
	 * 退出条件：想恢复合集时，把本开关改为 false **并**给文章加回
	 * frontmatter 的 `collection:` 字段（两者缺一不可：组件按 `collectionKey`
	 * 取数据，没有字段就什么都不渲染）。组件与数据链路无需改动。
	 *
	 * 复核日期：2026-11（与「文章分类」这件事一起决定）。
	 */
	hideCollectionBlock: true,
} as const
