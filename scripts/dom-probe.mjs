/*
 * 逐字段提取器：每个字段一条独立的小表达式。
 *
 * ## 为什么不用一个大探针
 *
 * 第一版把全部特征写进一个巨型 IIFE，一次 `Runtime.evaluate` 取回。
 * 结果每一页都返回 `{}` —— 页面加载完全正常（同一时刻的 PING 探针能正确
 * 返回 `{"ok":1,"h":2624,"t":8}`），但大表达式整体求值不出结果，且
 * `exceptionDetails` 是空的，没有任何可诊断的信息。
 *
 * 更糟的是它把失败伪装成了成功：`diff(undefined, undefined)` 每一项都判定
 * 相等，于是八页全部报「无结构差异」、退出码 0。一次彻底失效的对比看起来
 * 像满分。
 *
 * 拆成逐字段的小表达式后：
 *   - 每个都短到能被可靠求值；
 *   - 任一字段失败能立刻定位到是哪个字段，不会整页哑掉；
 *   - 失败仍然必须硬报错退出（见调用侧），不允许"两边都没取到就当相等"。
 *
 * 表达式统一包成 `(...)` 对象/数组字面量，配合 `returnByValue: true`，
 * 这是本仓库 screenshot.mjs 里已验证可用的传输方式。
 */

/** 头 meta：逐个字段单独取，便于定位哪一条不一致。 */
const META_FIELDS = [
	'description',
	'keywords',
	'author',
	'generator',
	'robots',
	'og:title',
	'og:description',
	'og:image',
	'og:type',
	'og:url',
	'og:site_name',
	'og:locale',
	'og:site_name',
	'twitter:card',
	'theme-color',
	'viewport',
	'article:published_time',
	'article:modified_time',
	'article:tag',
]

export const EXTRACTORS = {
	docHeight: 'document.documentElement.scrollHeight',
	docWidth: 'document.documentElement.scrollWidth',
	title: 'document.title',
	bodyTextLen: 'String((document.body.innerText || "").replace(/\\s+/g, "").length)',
	h1: 'Array.from(document.querySelectorAll("h1")).map(e => e.textContent.replace(/\\s+/g," ").trim()).filter(Boolean)',
	h2Count: 'document.querySelectorAll("h2").length',
	h3Count: 'document.querySelectorAll("h3").length',
	canonical: '(document.querySelector(\'link[rel="canonical"]\') || {}).href || null',
	counts: `({
		links: document.querySelectorAll('a[href]').length,
		images: document.querySelectorAll('img').length,
		svgs: document.querySelectorAll('svg').length,
		iframes: document.querySelectorAll('iframe').length,
		pre: document.querySelectorAll('pre').length,
		code: document.querySelectorAll('code').length,
		tables: document.querySelectorAll('table').length,
		buttons: document.querySelectorAll('button').length,
		katex: document.querySelectorAll('.katex, .katex-display').length,
		details: document.querySelectorAll('details').length,
		timeTags: document.querySelectorAll('time').length,
	})`,
	nav: 'Array.from(document.querySelectorAll(\'nav a, header a\')).map(e => e.textContent.replace(/\\s+/g," ").trim()).filter(Boolean).slice(0, 20)',
	// 文章列表：前 3 张卡的标题 / 日期文本 / 字数 / 实测高度
	cards: `Array.from(document.querySelectorAll('article, [class*="post-item"], li.post, [class*="card"]'))
		.slice(0, 3)
		.map(c => ({
			title: (c.querySelector('h1,h2,h3,[class*="title"]') || {}).textContent?.replace(/\\s+/g,' ').trim().slice(0, 40) || null,
			date: (c.querySelector('time, [class*="date"]') || {}).textContent?.replace(/\\s+/g,' ').trim().slice(0, 40) || null,
			words: ((c.textContent || '').match(/[\\d,.]+\\s*字/) || [null])[0],
			h: Math.round(c.getBoundingClientRect().height),
		}))`,
	// 代码块行号：Nuxt 侧靠 CSS attr(data-line) 显示，Astro 侧 CSS 在但数据源存疑
	codeLines: `Array.from(document.querySelectorAll('pre .line')).slice(0, 3)
		.map(l => ({ dataLine: l.getAttribute('data-line'), text: l.textContent.slice(0, 30) }))`,
	// 侧栏 widget：标题 + 键值行
	/*
	 * widgets：`.filter(w => w.title || w.rows.length)` 曾把「既没有 dt、
	 * 标题也不落在 h3/h4/[class*=title] 里」的 BlogWidget 全部滤掉，
	 * 于是在 /previews/example 上报出「0 个 widget」——而产物里明明有 4 个
	 * `blog-widget` 和一份目录。那是探针的缺陷，不是站点的。
	 * 判据放宽成「这个元素确实是 widget 容器」，标题只作展示。
	 */
	widgets: `Array.from(document.querySelectorAll('[class*="widget"]')).slice(0, 12)
		.map(w => ({
			cls: (w.className || '').toString().split(/\\s+/).filter(Boolean).slice(0, 2).join('.'),
			title: (w.querySelector('h2, h3, h4, [class*="title"], header') || {}).textContent?.replace(/\\s+/g, ' ').trim() || null,
			h: Math.round(w.getBoundingClientRect().height),
			rows: Array.from(w.querySelectorAll('dt')).slice(0, 20).map(dt => (dt.textContent || '').trim() + '=' + ((dt.nextElementSibling || {}).textContent || '').trim()),
		}))
		.filter(w => w.h > 4)`,
	footerTitles: 'Array.from(document.querySelectorAll(\'footer h1, footer h2, footer h3, footer [class*="title"]\')).map(e => e.textContent.replace(/\\s+/g," ").trim()).filter(Boolean).slice(0, 12)',
	/*
	 * 侧栏页脚图标导航（Nuxt `appConfig.footer.iconNav` 由 ZIconNavList 消费）。
	 * 之前完全没覆盖到它：主对比器的 nav 只查 `nav a, header a`，
	 * 而这组链接在侧栏 footer 里，于是"生产站 6 个图标 / Astro 4 个"这种
	 * 肉眼可见的差异反而没进报告——工具的覆盖盲区比它的差异更有欺骗性。
	 * 这里同时取 href 与 title（图标导航没有可见文字，只能靠 title 辨认）。
	 */
	sidebarFooter: `Array.from(document.querySelectorAll('#blog-sidebar footer a, .sidebar-footer a, aside footer a'))
		.map(a => ({ t: (a.getAttribute('title') || a.textContent || '').trim().slice(0, 30), h: (a.getAttribute('href') || '').slice(0, 60) }))`,
	// 侧栏页脚里所有可点击元素（含 button），用来数"到底渲染了几个"
	sidebarFooterCount: 'document.querySelectorAll(\'#blog-sidebar footer a, #blog-sidebar footer button, .sidebar-footer a, .sidebar-footer button\').length',
}

/** 为每个 meta 字段生成一条表达式。name 走 meta[name=]，其余走 meta[property=]。 */
function metaExtractor(field) {
	const isNameOnly = ['description', 'keywords', 'author', 'generator', 'robots', 'twitter:card', 'theme-color', 'viewport'].includes(field)
	const sel = isNameOnly ? `meta[name="${field}"]` : `meta[property="${field}"]`
	return `(document.querySelector('${sel}') || {}).content || null`
}

for (const f of META_FIELDS)
	EXTRACTORS[`meta.${f}`] = metaExtractor(f)
