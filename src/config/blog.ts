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
		/**
		 * 页尾「相关阅读」（`PostRelated.astro` + `lib/content.ts` 的 `getRelated`）
		 * 的候选数与打分权重。
		 *
		 * 站点是纯静态的，推荐结果只能在构建期算出来，读者之间**没有任何个性化信号**
		 * （无点击、无浏览记录、无 cookie）。能用的只有文章自身的元数据，权重即
		 * 「同属一类内容，在多大程度上算相关」。
		 *
		 * 取值理由（按信号强度递减）：
		 * - `collection` 最高：同一合集是**作者显式声明**的系列关系，比任何自动推断都可靠；
		 * - `category` 次之：分类是明确的主题归属，取 3 让「同分类」压过
		 *   「同版式 + 同时间段」这种一堆弱信号；
		 * - `tag` 再次：单个标签的题材重合不如分类明确（38 篇文章里 43 个唯一标签，
		 *   很多只出现一次），所以每命中一个才 +2，两个共同标签才追平同分类；
		 * - `type` 与 `recency` 是弱信号，只在题材打平时微调，不该主导排序。
		 *
		 * ⚠️ 权重是**站点可调项**，不是算法常量。改这里等于改「什么算相关」，
		 * 别去组件里改分数、也别在 `getRelated` 内写死（见该函数顶部的判据）。
		 */
		related: {
			/** 每篇推荐的文章数 */
			limit: 4,
			/** 同合集 */
			collection: 4,
			/** 命中任意一个共同分类 */
			category: 3,
			/** 每一个共同标签 */
			tag: 2,
			/** 同版式（tech / story） */
			type: 1,
			/** 发布日期在 recencyDays 天内 */
			recency: 1,
			/** recency 的天数窗口 */
			recencyDays: 90,
		},
		/** 禁止搜索引擎收录的路径 */
		robotsNotIndex: ['/preview', '/previews/*'],
	},

	/** 博客 Atom 订阅源 */
	feed: {
		/** 订阅源最大文章数量 */
		limit: 50,
		/** 订阅源是否启用XSLT样式 */
		enableStyle: true,
	},

	/** 文章统计配置 */
	stats: {
		/**
		 * 统计范围，匹配 content 下不含扩展名的路径（stem）；空数组统计全部内容
		 * 使用 SQL LIKE 语法：% 匹配任意长度字符，_ 匹配单个字符
		 * 多个范围取并集，如 ['posts/%', 'book/%']
		 */
		includePaths: [] as string[],
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
	// 描述的是**本站**的技术架构（友链页逐站标注用的），不是作者个人会什么，
	// 所以框架 / 托管平台跟着仓库现实走：2026-10-03 起是 Astro 7，产物由
	// GitHub Actions 推 blog-public（GitHub Pages），站点再经 EdgeOne CDN 对外服务。
	archs: ['Astro', 'GitHub Pages'],
	date: blogConfig.timeEstablished,
	comment: '这是我自己',
}

export default blogConfig
