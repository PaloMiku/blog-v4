import type { Nav, NavItem } from '~/types/nav'
import { Temporal } from 'temporal-polyfill'
import blogConfig from '~~/blog.config'
import { version } from '~~/package.json'

// 图标查询：https://yesicon.app/tabler
// 图标插件：https://marketplace.visualstudio.com/items?itemName=antfu.iconify

// @keep-sorted
export default defineAppConfig({
	// 将 blog.config 中的配置项复制到 appConfig，方便调用
	...blogConfig,

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

		/** 文章开头摘要 */
		excerpt: {
			animation: true,
			caret: '_',
			label: blogConfig.excerpt?.label ?? '智能摘要',
			badge: blogConfig.excerpt?.badge ?? 'Kimi·K2-Turbo',
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
		/** 侧边栏底部装饰图片配置 */
		// decorativeImage: {
		//	url: 'https://blog-files.101045700.xyz/MaitetsuVideoFix/Home.webp', // 装饰图 URL，为空则不显示
		//	opacity: 0.6, // 透明度（0~1），越小越淡
		//	height: '12rem', // 装饰层高度
		//	backgroundSize: 'cover', // 背景拉伸方式
		//	backgroundPosition: 'center', // 背景定位
		//	backgroundRepeat: 'no-repeat', // 背景是否重复
		// },
		/** 侧边栏底部图标导航 */
		iconNav: [
			{ icon: 'tabler:home', text: '个人主页', url: blogConfig.author.homepage },
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
					{ icon: 'simple-icons:nuxtdotjs', text: `主题: Clarity ${version}`, url: 'https://github.com/L33Z22L11/blog-v3' },
					{ icon: 'tabler:color-swatch', text: '主题和组件文档', url: '/previews/example' },
					{ icon: 'tabler:certificate', text: '鲁ICP备2024102866号-2', url: 'https://beian.miit.gov.cn/' },
				],
			},
		] satisfies Nav,
	},

	/** 左侧栏顶部 Logo */
	header: {
		logo: 'https://cravatar.com/avatar/1012bf78fb01d5b964c3a9a0f515911a?s=160',
		/** 展示标题文本，否则展示纯 Logo */
		showTitle: true,
		subtitle: blogConfig.subtitle,
	},
	/** 友链页面 */
	link: {
		/** 无订阅源展示静音图标 */
		remindNoFeed: true,
		/** 友链分组内随机排序 */
		randomInGroup: true,
	},

	/** 左侧栏导航 */
	nav: [
		{
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
		},
	] satisfies Nav,

	pagination: {
		perPage: 10,
		/** 默认排序方式，需要是 this.article.order 中的键名 */
		sortOrder: 'date' as keyof typeof blogConfig.article.order,
		/** 允许（普通/预览/归档）文章列表正序，开启后排序方式左侧图标可切换顺序 */
		allowAscending: false,
	},

	themes: {
		light: {
			icon: 'tabler:sun',
			tip: '浅色模式',
		},
		system: {
			icon: 'tabler:device-desktop',
			tip: '跟随系统',
		},
		dark: {
			icon: 'tabler:moon',
			tip: '深色模式',
		},
	},
})
