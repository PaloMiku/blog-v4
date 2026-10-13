/**
 * 大屏设置面板的收起时序。
 *
 * ## 为什么这两块要搬出来
 *
 * 原来它们住在 `BigPictureShell.astro` 的 `<script>` 里，而 **`.astro` 的
 * `<script>` 无法被 Node 测试导入**——于是这两段纯逻辑一行测试都写不了。
 * `BigPictureShell.astro` 早就在文件头承认过这件事，并据此搬走了
 * `resolveBackLayer`，但只搬了那一个。
 *
 * ## 为什么它是个契约而不是个常量
 *
 * `settingsCloseDelay` 的返回值是 modal 家族「吞掉 B」的窗口长度：
 * 面板正在收起时若 B 穿透到下面那一层，用户按两下 B 就会被送走。
 *
 * 所以它**从 CSS 读、绝不写死**。读的是**此刻**的计算样式，而此刻面板还
 * 开着（`hidden` 是 `finish()` 稍后才加的），拿到的是它声明的
 * `transition-duration` 而不是 `0s`。CSS 里一旦加了过渡，这里自动跟随，
 * 不会出现「CSS 过渡比守卫窗口长、第二次 B 穿透」这种只在真实浏览器里
 * 复现的离站 bug。
 *
 * ⚠️ 反过来：`big-picture.css` 里那条 `transition-duration` **不能**被
 * `prefers-reduced-motion` 归零。归零会让这个窗口塌成 0ms，于是「吞掉 B」
 * 的保护消失——动那段 CSS 前先读这里的注释。
 */

/**
 * `'0.2s'` / `'200ms'` → 毫秒。解析不了一律当 0（= 没有过渡）。
 *
 * 纯函数：只吃字符串，不碰 DOM。
 */
export function parseCssDuration(value: string): number {
	const number = Number.parseFloat(value)
	if (!Number.isFinite(number))
		return 0
	return value.trim().endsWith('ms') ? number : number * 1000
}

/**
 * 取一组 `transition-duration` 分量里最长的那个（毫秒）。
 *
 * `getComputedStyle` 在多段过渡时返回逗号分隔的列表（`'0.2s, 0.4s'`），
 * 守卫窗口必须按**最慢**的那段算，否则会出现「窗口比过渡短 ⇒ B 穿透」。
 */
export function longestCssDuration(declared: string): number {
	let max = 0
	for (const part of declared.split(','))
		max = Math.max(max, parseCssDuration(part))
	return max
}
