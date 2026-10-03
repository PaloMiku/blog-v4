/**
 * 标题 id（锚点 slug）的 Nuxt 后处理，全项目**只此一份实现**。
 *
 * 线上用的是 `@nuxtjs/mdc` 的 `compileHast`，其规则在
 * `node_modules/@nuxtjs/mdc/dist/runtime/parser/compiler.js`：
 *
 * ```js
 * node.properties.id = String(node.properties?.id || slugs.slug(toString(node)))
 *   .replace(/-+/g, "-")      // 折叠连续短横
 *   .replace(/^-|-$/g, "")    // 去首尾短横
 *   .replace(/^(\d)/, "_$1")  // 首位数字补 _
 * ```
 *
 * 也就是 **github-slugger + 三个后处理**。
 * Astro 侧 `rehypeHeadingIds` 只有 github-slugger，三个后处理一个都没有，
 * 于是同一段标题文字在两站得到不同的 id。实测三例：
 *
 * | 标题文字 | 线上 id | 修之前的 Astro id | 触发的那条后处理 |
 * |---|---|---|---|
 * | `123 网盘会员直链` | `_123-网盘会员直链` | `123-网盘会员直链` | 首位数字补 `_` |
 * | `Distrobox & DistroShelf（可选）` | `distrobox-distroshelf可选` | `distrobox--distroshelf可选` | 折叠连续短横 |
 * | `今天是他们的生日（ 今天是他们的生日 ）` | `今天是他们的生日-今天是他们的生日` | `今天是他们的生日-今天是他们的生日-` | 去尾短横 |
 *
 * **为什么这不只是「id 长得不一样」**：目录链接与标题自链接都指向 id，
 * 线上分享出去的 `…/2025/12/oss-prepare-list#_123-网盘会员直链`
 * 在 Astro 上点不动，反之亦然。而**页高和计算样式两道门禁都看不见它**
 * ——一个 `<a href="#…">` 指向一个不存在的 id，盒子尺寸完全不变。
 * 是本轮新增的语义签名探针（`live:ui-parity`）把它抓出来的。
 *
 * ## 调用点只有一处
 *
 * `src/plugins/heading-ids.ts`（`rehypeNuxtHeadingIds`）。
 * 推导、位置选择与踩过的坑都在那边的文件头，这里只留规则本身——
 * **规则与实现分离**，是为了让「规则变了」和「实现变了」在 diff 上分得开。
 *
 * ## 幂等
 *
 * 三步后处理对自身是不动的（`abc → abc`、`_7 → _7`），
 * 所以「已经归一过的 id 再过一次不会漂移」——
 * `scripts/check-heading-ids.mjs` 把这条当不变式查。
 *
 * ## 不要在这里自己实现 slug 规则
 *
 * slug 本体（去标点、转小写、重复标题加 `-1`）来自 `github-slugger`，
 * 本模块**只做后处理**，不重新跑一遍 slugger——
 * 那会把重复计数再走一遍，产出和 DOM 对不上。
 */
export function nuxtHeadingId(slug: string): string {
	return String(slug)
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.replace(/^(\d)/, '_$1')
}
