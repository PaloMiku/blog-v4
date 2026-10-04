/**
 * 站点主配置，迁移自 Nuxt 根的 `blog.config.ts`（逐字拷贝）。
 *
 * 与原文件的唯一差异是第 1 行的类型引用：原先指向根目录的 `./app/types/feed`，
 * 现在指向 astro-site 自己的 `./lib/types/feed`。配置内容一字未改。
 */
import type { FeedEntry } from '../lib/types/feed'

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
			[basicConfig.defaultCategory]: { icon: 'tabler:circle-dashed' },
			技术探索: { icon: 'tabler:bulb', color: '#fa3' },
			联邦宇宙: { icon: 'tabler:planet', color: '#a6f' },
			旮瘩给木: { icon: 'tabler:device-gamepad-2', color: '#f6a' },
			站点魔改: { icon: 'tabler:tool', color: '#3fa' },
			动漫番剧: { icon: 'tabler:movie', color: '#f5a' },
			日志记录: { icon: 'tabler:notebook', color: '#7af' },
			日常随笔: { icon: 'tabler:scribble', color: '#af7' },
			经验分享: { icon: 'tabler:click', color: '#3af' },
			代码: { icon: 'tabler:code', color: '#77f' },
			/** 实践可复用操作经验：工具/系统/部署/排障 */
			技术: { icon: 'tabler:click', color: '#33aaff' },
			/** 编程：代码实现/工程实践/开发方法 */
			开发: { icon: 'tabler:code', color: '#7777ff' },
			/** 安全：漏洞/CTF/恶意软件/安全事件分析 */
			安全: { icon: 'tabler:bug', color: '#ff7733' },
			/** 思考：观点讨论/复盘反思/行业或产品观察 */
			杂谈: { icon: 'tabler:message-circle', color: '#33bbaa' },
			/** 记录叙事：个人经历/校园家庭/日常片段 */
			生活: { icon: 'tabler:comet', color: '#ff7777' },
		},
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
		badge: 'Qwen 3.7 Max',
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
		//
		// 换版本 / 换 CDN 之后跑 `node scripts/check-twikoo-cdn.mjs`：脚本 404 或
		// CDN 回 200 + HTML 错误页时，浏览器里与正常完全一样（评论区框在、评论不出来），
		// 只看状态码不算检查。
		{ src: 'https://s4.zstatic.net/ajax/libs/twikoo/2.0.12/twikoo.min.js', defer: true },
	],

	/** 文章统计配置 */
	stats: {
		/**
		 * 统计范围，匹配 content 下不含扩展名的路径（stem）；空数组统计全部内容
		 * 使用 SQL LIKE 语法：% 匹配任意长度字符，_ 匹配单个字符
		 * 多个范围取并集，如 ['posts/%', 'book/%']
		 */
		includePaths: [] as string[],
	},

	/** 自己部署的 Twikoo 服务 */
	twikoo: {
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
	},
}

/** 用于生成 OPML 和友链页面配置 */
export const myFeed: FeedEntry = {
	author: blogConfig.author.name,
	sitenick: '极光星',
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
