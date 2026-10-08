/**
 * 列表分页 / 排序的共用纯函数。
 *
 * ═══ 为什么在这一个文件里 ═══
 *
 * 这两个函数各自被手写了两到三份，且注释里明写着「逐字照搬」：
 *
 * - `getPaginationIndicator`（原 Nuxt `app/composables/usePagination.ts`）
 *   - `components/partial/Pagination.astro` 的 **frontmatter**（构建期算首屏页码）
 *   - `pages/index.astro` 的 `<script>`（`syncPager()` 客户端重画）
 *   两份逐字相同，只是一份跑在构建期、一份跑在浏览器。
 * - `compareValues`（es-toolkit `compareAscending` 的字符串分支）
 *   - `pages/index.astro` / `pages/archive.astro` / `pages/preview.astro`
 *     三个 `<script>` 各一份，逐字相同。
 *
 * 两份 `getPaginationIndicator` 之所以必须保持一致：**客户端那份是重画，
 * 不是可选的**。构建期那一份算出的页码在筛选改变 `totalPages` 之后就失效了
 * （Nuxt 侧是响应式的，Astro 侧 `Pagination.astro` 是静态渲染），
 * 所以 `index.astro` 的 `syncPager()` 必须用**同一个算法**重算，
 * 否则两套算法一旦分叉，就会出现「页码按钮个数与实际页数对不上」。
 * 这正是原先两份副本最危险的地方——它们没有任何东西强制同步。
 *
 * ⚠️ **本文件必须同时能在构建期与浏览器里求值。**
 * `Pagination.astro` 在 frontmatter 里 import 它（构建期 / Node），
 * 三个页面的 `<script>` 也 import 它（客户端 / 浏览器），
 * 所以这里只能用纯 JS：不许出现 `node:` 内置模块、不许碰构建期配置、
 * 不许有副作用。曾经 `app-config.ts` 里塞 `node:fs` 就把 66/67 个页面打成
 * `Module "node:fs" has been externalized for browser compatibility`。
 *
 * ⚠️ **刻意不从 `src/lib/shared.ts` 桶文件导出。**
 * 那个桶把 `shared/icon`（整张 `domainIcons` 映射表）也 re-export 了，
 * 客户端 import 会把它一起打进产物。这几个纯函数没有别的依赖，
 * 调用方直接引本文件的路径即可。
 *
 * （这段说明第一版里为了描述用法，贴了一句**字面 import 说明**。门禁
 * `check-self-contained` 扫的是 import 说明符，它不剥注释，于是把那句话当成
 * 真 import 解析，算出 `src/lib/` 下多一层目录的不存在路径，直接红。
 * 改这一行时留意：注释里别贴能被解析器当成路径的串。坑位 30。）
 */

/**
 * 页码指示器：返回要渲染的页码数组，`-1` 表示省略号。
 *
 * 规则（与 Nuxt 侧 composable 逐字一致）：
 * 首页恒在、末页（`total > 1` 时）恒在，中间保留 `expand` 页，
 * 两端被省略的区间各插一个 `-1`。
 */
export function getPaginationIndicator(current: number, total: number, expand = 2) {
	const pages: number[] = [1]
	const start = Math.max(2, current - expand)
	const end = Math.min(total - 1, current + expand)
	if (start > 2)
		pages.push(-1) // -1 means ellipsis
	for (let i = start; i <= end; i++) pages.push(i)
	if (end < total - 1)
		pages.push(-1)
	if (total > 1)
		pages.push(total)
	return pages
}

/**
 * es-toolkit `compareAscending` 的字符串分支：**用 `<` / `>`，不是 `localeCompare`**。
 *
 * ⚠️ 构建期 `src/lib/content.ts` 的 `sortArticles` 用的是 `localeCompare`，
 * 客户端这里用 `<` / `>`。两者对 ISO 日期串结果一致（`'2024-03-15' < '2024-03-16'`
 * 的码点序与字典序同向），所以首屏顺序与重排后顺序不会打架。
 * 换成 `localeCompare` 才会引入分歧——那才是缺陷，不要顺手「统一」成它。
 */
export function compareValues(a: string, b: string) {
	if (a < b)
		return -1
	if (a > b)
		return 1
	return 0
}
