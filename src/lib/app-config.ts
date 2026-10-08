/**
 * Nuxt 侧 `app/app.config.ts` 的 Astro 版本。
 *
 * 分批迁入，每批只加实际被消费到的字段：
 * 1. 内容组件（Phase 2）：`title` / `header` / `component`
 * 2. 站点外壳（Phase 3）：`nav` / `footer` / `themes`
 * 3. 页面级：`stats` / `pagination` / `link` 已迁入；
 *    尚未迁入：`excerpt` / `slide`
 *
 * 注意：Nuxt 的 `useAppConfig()` 在运行时可被覆盖，这里是构建期常量。
 * 另注意 Nuxt 侧是 `...blogConfig` 展开 + 同名字段覆盖，本文件只显式列出被读取的键。
 *
 * ⚠️ **本文件必须能在浏览器里求值。**
 * `BlogStats.astro` / `Excerpt.astro` 的 `<script>` 都会
 * import 它。曾经这里用 `node:fs` + `process.cwd()` 读版本号，构建日志因此报
 * `Module "node:fs" has been externalized for browser compatibility`；
 * 更早一版没有 `typeof process` 探测，直接让 66/67 个页面抛
 * `ReferenceError: process is not defined`。
 *
 * 改成静态 `import ... from '*.json'`：Vite 在**构建期**把 JSON 内联进产物，
 * 运行时不再有任何 Node 依赖，服务端与客户端拿到的是同一个值。
 * （早前注释说「避免依赖 resolveJsonModule」——那是纯 tsc 的顾虑，Vite 原生支持。）
 */
// title / subtitle 与 Nuxt 侧一致，来自根 blog.config（Nuxt 侧是 `...blogConfig` 展开进来的）
import { Temporal } from 'temporal-polyfill'
import blogConfig from '../config/blog'
import { themeVersion } from '../config/site-meta'

/** 导航项，与 Nuxt 侧 `app/types/nav.ts` 的 NavItem 同构 */
export interface NavItem {
	icon: string
	text: string
	url: string
	external?: boolean
	children?: NavItem[]
}

export type Nav = {
	title: string
	items: NavItem[]
}[]

export const appConfig = {
	/** 站点标题 */
	title: blogConfig.title,

	/** 站点规范域名（BlogTech 的「规范域名」一行） */
	url: blogConfig.url,

	/** 文章许可信息（BlogTech 的「文章许可」一行） */
	copyright: blogConfig.copyright,

	/** 博客建立日期（BlogStats 的「运营时长」/ BlogLog 的末条） */
	timeEstablished: blogConfig.timeEstablished,

	/** 侧边栏顶部 Logo（由 BlogHeader 组件消费） */
	header: {
		logo: 'https://cravatar.com/avatar/1012bf78fb01d5b964c3a9a0f515911a?s=160',
		/** 展示标题文本，否则展示纯 Logo */
		showTitle: true,
		subtitle: blogConfig.subtitle,
	},

	/** 友链页面（由 FeedCard / FeedGroup / link.astro 消费） */
	link: {
		/** 无订阅源展示静音图标 */
		remindNoFeed: true,
		/** 友链分组内随机排序 */
		randomInGroup: true,
	},

	component: {
		alert: {
			/** 默认使用卡片风格还是扁平风格 */
			defaultStyle: 'card' as 'card' | 'flat',
		},

		codeblock: {
			/** 代码块触发折叠的行数 */
			triggerRows: 32,
			/** 代码块折叠后的行数 */
			collapsedRows: 16,
			/** 启用代码块缩进导航会关闭空格渲染 */
			enableIndentGuide: true,
			/** 代码块缩进导航(Indent Guige)竖线匹配空格数 */
			indent: 4,
			/** tab渲染宽度 */
			tabSize: 3,
		},

		/** 精选文章 Slide */
		slide: {
			/** 适合封面图无字时启用 */
			showTitle: true,
		},

		stats: {
			/** 归档页面每年标题对应的年龄 */
			birthYear: 2006,
			/** blog-stats widget 的预置文本 */
			wordCount: '约10万',
		},
	},

	// @keep-sorted
	footer: {
		/** 页脚版权信息，支持 <br> 换行等 HTML 标签 */
		copyright: `© ${Temporal.Now.plainDateISO().year.toString()} ${blogConfig.author.name}`,
		/** 侧边栏底部图标导航（由 BlogSidebar 消费） */
		iconNav: [
			{ icon: 'tabler:home', text: '个人主页', url: '/' },
			{ icon: 'ri:qq-line', text: '交流群: 767876073', url: 'https://qm.qq.com/q/NH7OS40dY6' },
			{ icon: 'tabler:brand-github', text: 'GitHub: PaloMiku', url: 'https://github.com/PaloMiku' },
			{ icon: 'tabler:brand-mastodon', text: 'Fediverse', url: 'https://circle.tkg3.top/@PaloMiku' },
			{ icon: 'tabler:rss', text: 'Atom订阅', url: '/atom.xml' },
			{ icon: 'tabler:train', text: '开往', url: 'https://travellings.cn/go.html' },
		] satisfies NavItem[],
		/** 页脚版权信息底部的其他信息 */
		message: '',
		/** 页脚站点地图 */
		nav: [
			{
				title: '探索',
				items: [
					{ icon: 'tabler:rss', text: 'Atom订阅', url: '/atom.xml' },
					{ icon: 'tabler:train', text: '开往', url: 'https://travellings.cn/go.html' },
				],
			},
			{
				title: '社交',
				items: [
					{ icon: 'tabler:brand-github', text: 'PaloMiku', url: 'https://github.com/PaloMiku' },
					{ icon: 'ri:qq-line', text: '群: 767876073', url: 'https://qm.qq.com/q/NH7OS40dY6' },
					{ icon: 'tabler:mail', text: blogConfig.author.email, url: `mailto:${blogConfig.author.email}` },
				],
			},
			{
				title: '信息',
				items: [
					{ icon: 'simple-icons:nuxtdotjs', text: `主题: Clarity ${themeVersion}`, url: 'https://github.com/L33Z22L11/blog-v3' },
					{ icon: 'tabler:color-swatch', text: '主题和组件文档', url: '/previews/example' },
					{ icon: 'tabler:certificate', text: '鲁ICP备2024102866号-2', url: 'https://beian.miit.gov.cn/' },
				],
			},
		] satisfies Nav,
	},

	/**
	 * 文章统计配置。Nuxt 侧是 `defineAppConfig({ ...blogConfig })` 展开进来的，
	 * 所以 `useAppConfig().stats` 就是 `blogConfig.stats`。
	 * 这里显式挂上同源引用（BlogStats 用 `stats.includePaths.length`
	 * 决定标签写「文章字数」还是「总字数」）。
	 */
	stats: blogConfig.stats,

	/** 左侧栏导航（由 BlogSidebar 消费） */
	nav: [{
		title: '',
		items: [
			{ icon: 'tabler:files', text: '文章', url: '/' },
			{ icon: 'tabler:archive', text: '归档', url: '/archive' },
			{
				icon: 'tabler:book',
				text: '资料',
				url: '#',
				children: [
					{ icon: 'tabler:device-gamepad-2', text: '游戏', url: '/games' },
					{ icon: 'tabler:cloud', text: '云盘', url: '/drive' },
				],
			},
			{ icon: 'tabler:link', text: '友链', url: '/link' },
			{ icon: 'tabler:info-circle', text: '关于', url: '/about' },
		],
	}] satisfies Nav,

	/**
	 * 主题切换项（由 ThemeToggle 消费）。
	 *
	 * ⚠️ 这里是字母序（`@keep-sorted`），**不是**渲染顺序；按钮的先后由
	 * `ThemeToggle.astro` 的 `THEME_ORDER` 显式定序（必须与 Nuxt 基线一致）。
	 */
	// @keep-sorted
	themes: {
		dark: {
			icon: 'tabler:moon',
			tip: '深色模式',
		},
		light: {
			icon: 'tabler:sun',
			tip: '浅色模式',
		},
		system: {
			icon: 'tabler:device-desktop',
			tip: '跟随系统',
		},
	},

	/**
	 * 列表分页与排序，迁移自 `app/app.config.ts` 的 pagination 段。
	 * `article.order` / `article.categories` 直接取自根 blog.config，不在此重复。
	 */
	pagination: {
		perPage: 10,
		/** 默认排序方式，需要是 blog.config 的 article.order 中的键名 */
		sortOrder: 'date' as keyof typeof blogConfig.article.order,
		/** 允许（普通 / 预览 / 归档）文章列表正序；开启后 OrderToggle 左侧图标可切换方向 */
		allowAscending: false,
	},
} as const

export type AppConfig = typeof appConfig
