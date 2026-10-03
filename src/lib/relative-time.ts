/**
 * NuxtTime 的相对时间格式化，抽出来供构建期调用。
 *
 * ## 为什么要抽出来
 *
 * 它原本是 `components/util/Date.astro` 内部的一个函数，只有组件自己用。
 * 但 `BlogStats.astro` 的「上次更新」也需要同一套相对表述，而那里的
 * `DlGroup` 只接受 `string | number`——**塞不进组件**。
 * 原实现是绕过去的：先渲染绝对日期，再用一段客户端脚本把 `dd` 的文本
 * 改写成「N 天前」。那意味着首屏先闪一下错误文案、且文案依赖 JS 执行。
 *
 * 抽成纯函数后，构建期就能算好字符串直接传进去，客户端脚本可以整段删掉。
 *
 * ## 语义来源
 *
 * 照抄 `node_modules/nuxt/dist/app/components/nuxt-time.vue` 的单位阶梯，
 * 阈值取「上一级单位的进位基数」：60 秒 → 60 分 → 24 时 → 30 天 → 12 月。
 *
 * ⚠️ locale **必须写死**为 `blogConfig.language`（`zh-CN`），不能留 `undefined`。
 * 留 `undefined` 时取值落在**构建机运行时**默认值上，于是产物随构建环境变：
 * GitHub Actions（en-US）构建出 `25 seconds ago`，中文机器构建出 `43秒钟前`。
 *
 * 这个坑踩过一次：2026-10-03 首次切流，线上 63/63 篇文章的日期全部变成英文
 * （`August 7, 24`），而本地构建与冻结基线对比全绿——**因为基线和本地都是中文，
 * 只有 CI 那一侧是英文**，离线门禁结构上就看不见它。
 *
 * 当时这里写的是「写死 'zh-CN' 反而会与线上不一致，所以保持 undefined」。
 * 那句的前提是错的：核对冻结基线，线上曾经的措辞是**中文**（实测 `44秒钟前`）。
 * 结论反了——写死才是与线上一致，不写死才会不一致。
 */
import blogConfig from '../config/blog'

/** 取第一个 `|值| < 阈值` 的单位；阈值本身是上一级单位的进位基数。 */
const RELATIVE_UNITS = [
	{ unit: 'second', seconds: 1, threshold: 60 },
	{ unit: 'minute', seconds: 60, threshold: 60 },
	{ unit: 'hour', seconds: 3600, threshold: 24 },
	{ unit: 'day', seconds: 86400, threshold: 30 },
	{ unit: 'month', seconds: 2592e3, threshold: 12 },
	{ unit: 'year', seconds: 31536e3, threshold: Infinity },
] as const

export function formatRelative(instant: string | number | Date, now = Date.now()): string {
	const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()
	if (Number.isNaN(ms))
		return 'Invalid Date'
	const diffInSeconds = (ms - now) / 1e3
	const { unit, seconds } = RELATIVE_UNITS.find(({ seconds: s, threshold }) => Math.abs(diffInSeconds / s) < threshold)
		?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1]
	return new Intl.RelativeTimeFormat(blogConfig.language, { numeric: 'auto' }).format(Math.round(diffInSeconds / seconds), unit)
}
