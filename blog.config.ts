import type { FeedEntry } from './app/types/feed'

const basicConfig = {
	title: 'Mikuの极光星',
	subtitle: '心有多宽，世界就有多远',
	// 长 description 利好于 SEO
	description: 'Mikuの鬆的个人博客，分享技术与生活。这个博客记录了他在生活和技术学习中的点滴经历，充满启发与思考。网站界面简洁美观，内容丰富实用，人气互动活跃，涵盖了编程、生活、学习等多个领域，为读者提供了卓越的阅读体验。',
	author: {
		name: 'Mikuの鬆',
		avatar: 'https://cn.cravatar.com/avatar/1012bf78fb01d5b964c3a9a0f515911a.png',
		email: 'admin@sotkg.com',
		homepage: 'https://blog.sotkg.com/',
	},
	copyright: {
		abbr: 'CC BY-NC-SA 4.0',
		name: '署名-非商业性使用-相同方式共享 4.0 国际',
		url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans',
	},
	favicon: 'https://cn.cravatar.com/avatar/1012bf78fb01d5b964c3a9a0f515911a.png',
	language: 'zh-CN',
	qqGroup: '767876073',
	timeEstablished: '2022-09-01',
	timeZone: 'Asia/Shanghai',
	url: 'https://blog.sotkg.com/',
	defaultCategory: '未分类',
}

// 存储 nuxt.config 和 app.config 共用的配置
// 此处为启动时需要的配置，启动后可变配置位于 app/app.config.ts
// @keep-sorted
const blogConfig = {
	...basicConfig,

	article: {
		categories: {
			[basicConfig.defaultCategory]: { icon: 'ph:folder-dotted-bold' },
			技术探索: { icon: 'ph:lightbulb-bold', color: '#fa3' },
			联邦宇宙: { icon: 'ph:planet-bold', color: '#a6f' },
			旮瘩给木: { icon: 'ph:game-controller-bold', color: '#f6a' },
			站点魔改: { icon: 'ph:wrench-bold', color: '#3fa' },
			动漫番剧: { icon: 'ph:film-strip-bold', color: '#f5a' },
			日志记录: { icon: 'ph:notebook-bold', color: '#7af' },
			日常随笔: { icon: 'ph:pen-bold', color: '#af7' },
			经验分享: { icon: 'ph:mouse-bold', color: '#3af' },
			代码: { icon: 'ph:code-bold', color: '#77f' },
			/** 实践可复用操作经验：工具/系统/部署/排障 */
			技术: { icon: 'ph:mouse-bold', color: '#33aaff' },
			/** 编程：代码实现/工程实践/开发方法 */
			开发: { icon: 'ph:code-bold', color: '#7777ff' },
			/** 安全：漏洞/CTF/恶意软件/安全事件分析 */
			安全: { icon: 'ph:bug-beetle-bold', color: '#ff7733' },
			/** 思考：观点讨论/复盘反思/行业或产品观察 */
			杂谈: { icon: 'ph:chat-bold', color: '#33bbaa' },
			/** 记录叙事：个人经历/校园家庭/日常片段 */
			生活: { icon: 'ph:shooting-star-bold', color: '#ff7777' },
		},
		defaultCategoryIcon: 'ph:folder-bold',
		/** 文章版式，首个为默认版式 */
		types: {
			tech: {},
			story: {},
		},
		/** 分类排序方式，键为排序字段，值为显示名称 */
		order: {
			date: '创建日期',
			updated: '更新日期',
			// title: '标题',
		},
		/** 使用 pnpm new 新建文章时自动生成自定义链接（permalink/abbrlink） */
		useRandomPremalink: false,
		/** 隐藏基于文件路由（不是自定义链接）的 URL /post 路径前缀 */
		hidePostPrefix: true,
		/** 禁止搜索引擎收录的路径 */
		robotsNotIndex: ['/preview', '/previews/*'],
	},

	excerpt: {
		label: '智能摘要',
		badge: 'Kimi·K2.5',
	},

	/** 博客 Atom 订阅源 */
	feed: {
		/** 订阅源最大文章数量 */
		limit: 50,
		/** 订阅源是否启用XSLT样式 */
		enableStyle: true,
	},

	/** 向 <head> 中添加脚本 */
	scripts: [
		// 自己部署的 Umami 统计服务
		{ 'src': 'https://umami.sotkg.com/script.js', 'data-website-id': '372ccc48-32bf-434d-a1a2-9879fe82ca32', 'defer': true },
		// Cloudflare Insights 统计服务
		{ 'src': 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': '{"token": "b5c89be9025a4b1ba8750f8fd8850904"}', 'defer': true },
		// Twikoo 评论系统
		{ src: 'https://lib.baomitu.com/twikoo/1.7.4/twikoo.min.js', defer: true },
	],

	/** 自己部署的 Twikoo 服务 */
	twikoo: {
		envId: 'https://twikoo.zhilu.site/',
		preload: 'https://twikoo.zhilu.site/',
	},
}

/** 用于生成 OPML 和友链页面配置 */
export const myFeed: FeedEntry = {
	author: blogConfig.author.name,
	sitenick: '摸鱼处',
	title: blogConfig.title,
	desc: blogConfig.subtitle || blogConfig.description,
	link: blogConfig.url,
	feed: new URL('/atom.xml', blogConfig.url).toString(),
	icon: blogConfig.favicon,
	avatar: blogConfig.author.avatar,
	archs: ['Nuxt', 'Vercel'],
	date: blogConfig.timeEstablished,
	comment: '这是我自己',
}

export default blogConfig
