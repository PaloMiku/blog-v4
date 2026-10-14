/**
 * 第三方集成配置——统计 / 评论等**外部服务**的接入参数，与「内容与作者域」的
 * `blog.ts`（分类、版式、许可、友链）分工：改统计或评论服务只碰这一个文件。
 *
 * ⚠️ `scripts` 里的属性会**原样透传**为 head 里 `<script>` 的属性
 * （`Base.astro` 的 `thirdPartyScripts`）。旧栈那种「双花括号包 SECRET 前缀」的
 * 运行时替换占位符在 Astro 构建链不解析——写进来会原样发到线上（见
 * `check-placeholder` 门禁）。
 */

/** 注入 `<head>` 的第三方脚本，src 之外的属性原样透传 */
export const integrationScripts = [
	// 自己部署的 Umami 统计服务
	{ 'src': 'https://umami.sotkg.com/script.js', 'data-website-id': '372ccc48-32bf-434d-a1a2-9879fe82ca32', 'defer': true },
	// Cloudflare Insights 统计服务
	{ 'src': 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': '{"token": "b5c89be9025a4b1ba8750f8fd8850904"}', 'defer': true },
	// Twikoo 评论系统
	//
	// 换版本 / 换 CDN 之后跑 `node scripts/check-twikoo-cdn.mjs`：脚本 404 或
	// CDN 回 200 + HTML 错误页时，浏览器里与正常完全一样（评论区框在、评论不出来），
	// 只看状态码不算检查。
	{ src: 'https://s4.zstatic.net/ajax/libs/twikoo/2.0.12/twikoo.min.js', defer: true },
] as const

/** 自己部署的 Twikoo 服务 */
export const twikoo = {
	// 必须写到云函数本体，不能只写站点根：Netlify 上 `/` 是一张
	// `location.href='/.netlify/functions/twikoo'` 的静态跳转页，只对浏览器导航有效。
	// 客户端是对 envId 直接 POST JSON，POST `/` 落到静态文件返回 404 且不带
	// CORS 头，浏览器读不到响应 → xhr.status 0 → Twikoo 报「请求被跨域策略拦截」。
	// 这类错报会伪装成 CORS 问题：换 CORS 配置、改代码都没用，先核对 envId 指向的
	// 路径真的接受 POST：
	//   curl -i -X POST <envId> -H 'Origin: https://blog.sotkg.com' \
	//     -H 'Content-Type: application/json' \
	//     --data '{"event":"GET_CONFIG","envId":"<envId>"}'
	envId: 'https://twikoo.sotkg.com/.netlify/functions/twikoo',
	// preconnect 用 origin 即可，不必写到函数路径。
	preload: 'https://twikoo.sotkg.com/',
}

/** 摘要块（`Excerpt.astro`）的静态文案；生成来源徽章是数据，取自 summaries.json，不在这里 */
export const excerptLabel = '智能摘要'
