/**
 * 客户端安全的工具集。
 *
 * ## 为什么不能直接用 `lib/shared.ts`
 *
 * `lib/shared.ts` 转出了 `shared/utils/*` 的全部四个模块，而其中两个会把
 * 非纯函数的东西拖进客户端 chunk：
 *
 * | 模块 | 顶层依赖 | 后果 |
 * | --- | --- | --- |
 * | `lib/shared/time.ts` | 顶层引入整个 blog 配置（`../../config/blog`） | 整个 4.4 KB 站点配置进客户端包（摇不掉） |
 * | `lib/shared/link.ts` | 顶层依赖 `parse-domain` | 拖进一整个域名解析库，而这里只需要取个主域名 |
 *
 * 实测教训：从 `lib/shared.ts` import 一个 5 行的 `safelyDecodeUriComponent`，
 * 客户端 chunk 会多出 4.4 KB。因此凡是**会进浏览器 bundle** 的代码，
 * 只能从本文件取，或自行内联实现。
 *
 * ## 什么时候用哪个
 *
 * - `<script>` 里（会打包到客户端）→ 用本文件，或就地内联
 * - Astro frontmatter 里（只在构建期跑）→ 用 `lib/shared.ts`，无此顾虑
 *
 * 另注：`lib/shared/icon.ts` 的 `getDomainIcon` 依赖 `lib/shared/link.ts` 的
 * `getDomain` / `getMainDomain`，而后者又依赖 `parse-domain`（本项目的正式依赖）
 * 与内联的 `isPathFile` 扩展名白名单（原先来自 `site-config-stack`，已内联）。
 * 整条链是纯 JS、可在浏览器跑，但体积不划算，因此下面给出一份自包含实现。
 */

const ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	'\'': '&#39;',
}

/** 与 `shared/utils/str.ts` 的 `escape` 同语义，但零依赖 */
export function escapeHtml(str: string): string {
	return String(str).replace(/[&<>"']/g, c => ESCAPE_MAP[c] ?? c)
}

export function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 与 `shared/utils/link.ts` 同名函数等价（无自动导入依赖） */
export function safelyDecodeUriComponent(str: string): string {
	try {
		return decodeURIComponent(str)
	}
	catch {
		return str
	}
}

/**
 * 在文本中高亮关键词。
 * 与 `shared/utils/str.ts` 的 `highlightHtml` 输出一致，但只依赖本文件的
 * `escape` / `escapeRegExp`（原实现用 `es-toolkit/string`，会把该包拉进客户端）。
 */
export function highlightHtml(
	text: string,
	words?: string | string[] | null,
	className = 'highlight',
): string {
	if (!words)
		return escapeHtml(text)

	const list = Array.isArray(words) ? words : [words]
	const filtered = list.filter(Boolean).map(w => w.trim()).sort((a, b) => b.length - a.length)
	if (!filtered.length)
		return escapeHtml(text)

	const re = new RegExp(`(${filtered.map(escapeRegExp).join('|')})`, 'gi')
	const lower = new Set(filtered.map(w => w.toLowerCase()))
	return text
		.split(re)
		.map(part => (
			lower.has(part.toLowerCase())
				? `<span class="${className}">${escapeHtml(part)}</span>`
				: escapeHtml(part)
		))
		.join('')
}
