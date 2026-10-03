/**
 * 站点/主题的标识信息，原先统一取自 **Nuxt 根**的 `package.json`
 * （`clarity @ 3.8.0`）——那是一处跨树 import，Nuxt 树下线后就悬空了。
 *
 * ## 为什么不能改成读 astro-site 自己的 package.json
 *
 * astro-site 的 `package.json` 是 `blog-astro @ 0.1.0`。直接换过去会把
 * `<meta name="generator">` 从 `Clarity 3.8.0` 变成 `BlogAstro 0.1.0`，
 * atom.xml 的 generator 同步变掉，页脚还会多出「主题: Clarity 0.1.0」——
 * 全是可见的输出变化。所以这里把三个字段原样冻结下来。
 *
 * 消费方保持原有的 `pascalCase(...)` 调用形状，`themeName` 仍是小写 `clarity`，
 * 求值结果与迁移前完全一致。
 *
 * ## 语义
 *
 * 这三个字段描述的是**上游 Clarity 主题**（L33Z22L11/blog-v3），
 * 与 astro-site 自身的包版本无关。将来跟上游 bump 时改这里的字面量即可，
 * **不要**改成读本地 package.json。
 */

/** 主题包名，渲染时经 `pascalCase()` 得到 `Clarity` */
export const themeName = 'clarity'

/** 主题版本号，渲染为「主题: Clarity 3.8.0」等处 */
export const themeVersion = '3.8.0'

/**
 * `<meta name="generator" data-github-repo>` 的值。
 *
 * ⚠️ 沿用 Nuxt 根 package.json 的原值——它指向**站点自己**
 * （`https://blog.sotkg.com`）而不是 GitHub 仓库，看起来像是历史遗留的笔误。
 * 但它已经在生产产物里，属于既有行为，本次迁移只搬运不修正。
 */
export const themeHomepage = 'https://blog.sotkg.com'
