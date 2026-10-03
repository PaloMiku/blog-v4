import type { APIRoute } from 'astro'
import XmlBuilder from 'fast-xml-builder'
import { Temporal } from 'temporal-polyfill'
import blogConfig, { myFeed } from '../config/blog'
import feeds from '../lib/feeds'
import type { FeedEntry, FeedGroup, FeedGroupEntry } from '../lib/types/feed'
import { toZonedTemporal } from '../lib/shared'

/**
 * 对应 Nuxt 侧的 server/routes/subscriptions.opml.get.ts。
 *
 * 这个端点完全不碰 content 集合——`app/feeds.ts` 是友链的静态数据，
 * 所以整段逻辑是 1:1 搬运，唯一的框架差异是 buildTime：
 * `useRuntimeConfig().public.buildTime` → `Temporal.Now.zonedDateTimeISO().toString()`
 * （与 nuxt.config.ts 的 runtimeConfig.public.buildTime 取值一致）。
 */

const buildTime = Temporal.Now.zonedDateTimeISO().toString()

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
		$created: toZonedTemporal(item.date).toInstant().toString(),
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
	const outlines = [
		mapEntry(myFeed),
		...flattenGroups(feeds),
	]

	const opml = {
		$version: '2.0',
		head: {
			title: `${blogConfig.title}的友链订阅`,
			dateCreated: toZonedTemporal(blogConfig.timeEstablished).toInstant().toString(),
			dateModified: buildTime,
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
