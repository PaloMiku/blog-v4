/**
 * astro-icon 的 symbol 会被页面自己的「整块替换」误杀。
 *
 * ═══ astro-icon 1.2.0 的输出形状 ═══
 * 每个图标实例渲染成
 *
 *     <svg class="iconify" data-icon="tabler:pencil-minus">
 *       <symbol id="ai:tabler:pencil-minus"><path …/></symbol>   ← 只有「首次出现」的那一个带
 *       <use href="#ai:tabler:pencil-minus"></use>
 *     </svg>
 *
 * 也就是说 **symbol 定义全局只有一份，挂在文档顺序里第一个用到该图标的 `<svg>` 上**，
 * 其余实例全是纯 `<use>`。`<use>` 按文档级 id 解析，所以只要那一份还在，48 个引用都成立；
 * 它一旦没了，全部引用同时变空白（不是某个图标坏，是整批）。
 *
 * astro-icon 1.2.0 的 `IntegrationOptions` 只有 `include` / `iconDir` / `svgoOptions`
 * （见 `node_modules/astro-icon/typings/integration.d.ts`），**没有**「统一挂到一个共享
 * sprite 容器」的开关，所以这件事只能在应用侧兜。
 *
 * ═══ 实际踩到的两处 ═══
 * 首页 `?page=2` 与归档页的重排都走 `menu.replaceChildren(...)`，而首屏那张卡恰好
 * 持有 `ai:tabler:pencil-minus` 与 `ai:tabler:pilcrow` 的定义（文档顺序上它排在
 * OrderToggle 的分类下拉之后，所以分类图标 `tabler:bulb` 的定义在 `<menu>` 之外，
 * 幸存下来——**这正是「只有日期图标和字数图标消失、分类图标还在」的原因**）。
 *
 * 实测（2026-10-03，Chrome headless，localhost:4321）：
 *   首屏   document 内 symbol 54 个
 *   翻页后 document 内 symbol 52 个，`#ai:tabler:pencil-minus` 查不到，
 *          `use.getBBox()` = [0, 0]；而分类图标 `useBox` = [18, 18] 正常。
 * 时间线上是渲染完成后约 150 ms 内发生的**解析期**变化，MutationObserver 记录不到
 * 任何移除事件——所以别指望用 observer 抓它。
 *
 * ═══ 为什么是「搬走」而不是别的 ═══
 * - 不能让每个实例各带一份 symbol：id 重复，HTML 体积按实例数翻倍。
 * - 不能在脚本里补 cid / 重建字形：字形数据在构建期，运行时拿不到。
 * - `<use>` 按**文档级** id 解析，symbol 搬到哪个 `<svg>` 里都一样成立。
 *   所以只需在替换子树**之前**把定义捞到一个不会被替换的宿主。
 *
 * ⚠️ 宿主不能用 `display:none`：它装的是 `<symbol>`，而部分浏览器在祖先 `<svg>`
 * 处于 `display:none` 时不给 `<use>` 展开影子树。这里用零尺寸 + `aria-hidden`
 * 这个 sprite sheet 的常规藏法，实测两种写法都能正常渲染。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const HOST_ID = 'z-icon-sprite-host'

function ensureHost(): SVGElement {
	const existing = document.getElementById(HOST_ID)
	// 用 instanceof 而不是 `as SVGElement`：getElementById 的返回类型是 HTMLElement，
	// 直接断言会被 tsc 判成 TS2352（HTMLElement 与 SVGElement 没有足够重叠）。
	if (existing instanceof SVGElement)
		return existing

	const host = document.createElementNS(SVG_NS, 'svg')
	host.id = HOST_ID
	host.setAttribute('aria-hidden', 'true')
	// 只装 symbol，本身不渲染任何东西；藏法不能用 display:none，见文件头注
	host.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
	document.body.appendChild(host)
	return host
}

/**
 * 在**替换 `root` 的子树之前**调用：把 `root` 内的 astro-icon symbol 定义搬到常驻宿主。
 *
 * 幂等：搬过一次之后 `root` 里就没有 symbol 了，重复调用是 no-op。
 * 跨页安全：宿主挂在 `document.body` 下，不属于任何页面容器。
 */
export function hoistIconSprites(root: Element): void {
	const symbols = root.querySelectorAll('symbol[id^="ai:"]')
	if (!symbols.length)
		return

	const host = ensureHost()
	for (const symbol of symbols) {
		// 只有一份定义（astro-icon 的去重保证），直接搬；已存在同名说明是别的实例，
		// 保留先到的那份即可，`<use>` 解析结果不变。
		if (document.getElementById(symbol.id) !== symbol)
			continue
		host.appendChild(symbol)
	}
}
