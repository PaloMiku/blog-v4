/**
 * 迁移兼容开关的集中管理点（EC-004）。
 *
 * 规则：任何「为了对齐旧 Nuxt 行为而存在」的布尔开关都住在这里，
 * 每个开关必须写全四样：**保留原因、验证证据、退出条件、预计复核日期**。
 * 页面主流程只引用本模块，不再就地藏 `const PARITY_x = true`。
 * 全量兼容点清单（含不属于「开关」的 URL 合同类条目）见
 * `docs/plan/analysis/engineering-inventory.md` §4；验证命令：`pnpm accept:parity`。
 *
 * 能通过产品行为修复的兼容点，不继续用这里的开关隐藏问题。
 */
export const compat = {
	/**
	 * 压制文章内容页的「所属系列」（Collection）区块。
	 *
	 * 保留原因：线上产物从来没有这个区块。Nuxt 侧它因 `useNuxtData` payload
	 * 缓存静默失效而一次都没渲染过；2026-10-03 切流要求视觉一致，Astro 侧
	 * 顺手「修好」数据源反而多出线上没有的块。
	 *
	 * 验证证据（63 页产物级核对，非推断）：带 `collection:` 的文章仅 4 篇；
	 * Nuxt 基线产物 `post-collection` 出现 0 次，未关闭此开关的 Astro 产物
	 * 出现 4 次；单页高度偏差 +249px（记录于 compare-ui-parity 的 ACCEPTED 名单）。
	 *
	 * 退出条件：站长决定恢复该区块（属新增产品行为，需重新冻结线上基线并跑
	 * `pnpm accept:parity` 确认偏差可接受）；届时把本开关改为 false，
	 * Collection 组件与数据链路无需改动。
	 *
	 * 复核日期：2026-11。
	 */
	hideCollectionBlock: true,
} as const
