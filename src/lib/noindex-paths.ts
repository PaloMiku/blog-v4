/**
 * 不该被搜索引擎收录的路径，判定口径的唯一事实源。
 *
 * ## 为什么单独抽出来
 *
 * 站点有两处必须对同一批路径达成一致，历史上它们是各写各的：
 *
 * 1. `public/robots.txt` 的 `Disallow`（由 nuxt-robots 生成，线上原文是
 *    `Disallow: /preview` 与 `Disallow: /previews/*`）
 * 2. `<meta name="robots">`（nuxt-robots 对被 Disallow 的路径会额外输出
 *    `noindex, nofollow`）
 * 3. `sitemap.xml` 的过滤（`@astrojs/sitemap` 的 `filter`）
 *
 * 线上实测三处口径一致：`/preview`、`/previews/example`、
 * `/previews/bangumi-components` 三个页面在 robots.txt 里被禁、在 sitemap 里
 * 不出现、且 meta robots 都是 `noindex, nofollow`。
 *
 * ## 少了这个判定的实际后果
 *
 * 只做了 robots.txt 和 sitemap 过滤时，`/previews/*` 的页面 HTML 里仍然写着
 * `index, follow, max-image-preview:large, …`。robots.txt 的 Disallow 对
 * 爬虫是「建议不要抓」，而 meta robots 的 noindex 才是「抓了也别收录」，
 * 而且被 Disallow 过的 URL 根本不会被抓，**恰恰是 meta noindex 永远没机会
 * 被看到**。这两者必须同时存在才构成完整的屏蔽。
 *
 * ## 口径里的两个易错点（都已踩过）
 *
 * - `/preview` 与 `/previews/*` 是**两个不同的路径**（单数页 + 复数目录），
 *   少写一个 `s` 就会漏掉两个演示页。
 * - sitemap 里的 URL 带**尾斜杠**，判定若用 `startsWith('/preview')` 之外的
 *   精确匹配很容易失配；这里统一用「路径段」正则，两种写法都覆盖。
 *
 * 注：`astro.config.mjs` 里 sitemap 的 `filter` 有同一口径的正则，目前仍是
 * 各写一份（那边也用捕获组，`regexp/no-unused-capturing-group` 会报）。
 * 两处应收敛到本模块，但那个文件正在被别的任务改，等其交付后再合并。
 */
const NOINDEX_PATTERN = /^\/previews?(?:\/|$)/

/**
 * 该路径是否应输出 `noindex, nofollow`。
 *
 * 404 页不在这里判定——它由布局按 `pathname === '/404'` 单独处理，
 * 因为 404 是产物形态（`404.html`）而不是一条真实路由。
 */
export function isNoindexPath(pathname: string): boolean {
	return NOINDEX_PATTERN.test(pathname)
}
