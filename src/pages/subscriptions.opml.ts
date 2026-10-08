import type { APIRoute } from 'astro'
import type { FeedEntry, FeedGroup, FeedGroupEntry } from '../lib/types/feed'
import XmlBuilder from 'fast-xml-builder'
import blogConfig from '../config/blog'
import feeds from '../lib/feeds'
import { toZonedTemporal } from '../lib/shared'

/**
 * 对应 Nuxt 侧的 server/routes/subscriptions.opml.get.ts。
 *
 * 这个端点完全不碰 content 集合——`app/feeds.ts` 是友链的静态数据，
 * 所以整段逻辑基本是 1:1 搬运。刻意**不**搬运的是 Nuxt 的 buildTime：
 * 它把构建时钟写进 `head.dateModified` 与无 date 条目的 `created`，
 * 两次 build 产物必然不同——而这份 OPML 是纯静态数据的函数，
 * 没有理由不可复现。created 的缺省值改用下面的固定纪元，
 * 判据由 `scripts/check-feeds.mjs` 钉住。
 */

/**
 * 无 date 条目的 created 缺省值：固定纪元，不取构建时刻。
 * 「条目加入时间」对这些条目本来不可知——不可知就写稳定的未知值，
 * 别把时钟藏在里面（改这个值时 check-feeds 会红，这是接线的两侧）。
 */
const CREATED_EPOCH = '2000-01-01T00:00:00Z'

const builder = new XmlBuilder({
	attributeNamePrefix: '$',
	format: true,
	ignoreAttributes: false,
})

function mapEntry(item: FeedEntry) {
	return {
		$text: item.title || item.sitenick || item.author,
		$type: 'rss',
		$xmlUrl: item.feed,
		$created: item.date ? toZonedTemporal(item.date).toInstant().toString() : CREATED_EPOCH,
		$description: item.desc,
		$htmlUrl: item.link || item.feed,
	}
}

/** entries 是 FeedEntry | FeedGroup 的联合，只有 FeedEntry 带 feed 字段。 */
function isFeedEntry(entry: FeedGroupEntry): entry is FeedEntry {
	return 'feed' in entry
}

function flattenGroups(groups: FeedGroup[]) {
	// 嵌套的 FeedGroup 不带 feed，这里一律滤掉（不递归展开子分组）。
	return groups.flatMap(({ entries }) => entries.filter(isFeedEntry).filter(({ feed }) => feed).map(mapEntry))
}

export const prerender = true

export const GET: APIRoute = async () => {
	// myFeed 不再单独预置：feeds.ts:13 已把它放进第一个分组，
	// 这里再 mapEntry 一次就是订阅器里同站两遍（check-feeds 判据 1）。
	const outlines = flattenGroups(feeds)

	// 站点自身没有「最后修改时间」的可知来源（友链是仓库里的静态数据），
	// dateModified 取 dateCreated——自建站以来无已知修改，且不含构建时钟。
	const established = toZonedTemporal(blogConfig.timeEstablished).toInstant().toString()

	const opml = {
		$version: '2.0',
		head: {
			title: `${blogConfig.title}的友链订阅`,
			dateCreated: established,
			dateModified: established,
			ownerName: blogConfig.author.name,
			ownerEmail: blogConfig.author.email,
			ownerId: blogConfig.author.homepage,
			docs: 'https://opml.org/spec2.opml',
		},
		body: { outline: outlines },
	}

	return new Response(builder.build({
		'?xml': { $version: '1.0', $encoding: 'UTF-8' },
		opml,
	}), {
		headers: { 'Content-Type': 'application/xml' },
	})
}
