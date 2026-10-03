import type { APIRoute } from 'astro'
import { pascalCase } from 'es-toolkit/string'
import XmlBuilder from 'fast-xml-builder'
import { Temporal } from 'temporal-polyfill'
import blogConfig from '../config/blog'
import { themeName, themeVersion } from '../config/site-meta'
import { getAllContent, toPath } from '../lib/content'
import { toZonedTemporal } from '../lib/shared'

/**
 * 对应 Nuxt 侧的 server/routes/atom.xml.get.ts。
 *
 * 两处框架差异：
 * 1. `useRuntimeConfig().public.buildTime` → `Temporal.Now.zonedDateTimeISO().toString()`，
 *    与 nuxt.config.ts 里 runtimeConfig.public.buildTime 的取值完全一致（构建期常量）。
 * 2. `queryCollection(event, 'content').where('stem','LIKE','posts/%').order('updated','DESC')`
 *    → `getAllContent()` + `isPost` 过滤 + JS 排序，见 sortByUpdatedDesc。
 */

const buildTime = Temporal.Now.zonedDateTimeISO().toString()

const builder = new XmlBuilder({
	attributeNamePrefix: '$',
	cdataPropName: '$',
	format: true,
	ignoreAttributes: false,
	textNodeName: '_',
})

function formatIsoDate(date?: string) {
	if (!date)
		return
	try {
		return toZonedTemporal(date).toInstant().toString()
	}
	catch {
		console.error('Invalid date format', date)
		return date
	}
}

function getUrl(path: string | undefined) {
	return new URL(path ?? '', blogConfig.url).toString()
}

function renderContent(post: { path: string, image?: string, title?: string, description?: string }) {
	return [
		post.image && `<img src="${post.image}" alt="${post.title}" />`,
		post.description && `<p>${post.description}</p>`,
		`<a class="view-full" href="${getUrl(post.path)}" target="_blank">点击查看全文</a>`,
	].join(' ')
}

/**
 * 对应 SQL 的 `ORDER BY updated DESC LIMIT n`。
 *
 * 两点必须显式固定，否则结果不可复现：
 * - SQLite 的 `DESC` 把 NULL 排到最后（无 updated 的文章沉底），这里用 undefined 排最后保持一致。
 * - 38 篇文章里 32 篇没有 `updated`，全部互为并列；SQLite 对并列行返回的是插入顺序
 *   （@nuxt/content 遍历 content/ 的文件顺序），无法在 Astro 侧复刻，
 *   因此补一个 `path` 升序做稳定 tie-break。
 * - 排序键用解析后的 instant 而非原始字符串：原库混用 `...Z` 与不带时区的写法，
 *   字符串比较会错位（`2025-04-11T18:00:00` 实际是 Asia/Shanghai 的 10:00Z）。
 *   当前数据集下两种排序结果一致，差异只会在新增异格式日期时体现。
 */
function sortByUpdatedDesc(a: { path: string, updated?: string }, b: { path: string, updated?: string }): number {
	const key = (e: { updated?: string }) => (e.updated ? toZonedTemporal(e.updated).toInstant().epochMilliseconds : -Infinity)
	const diff = key(b) - key(a)
	return diff !== 0 ? diff : a.path.localeCompare(b.path)
}

export const prerender = true

export const GET: APIRoute = async () => {
	const posts = (await getAllContent())
		.filter(entry => entry.data.isPost)
		.map(entry => ({
			path: toPath(entry),
			title: entry.data.title,
			image: entry.data.image,
			description: entry.data.description,
			updated: entry.data.updated,
			// Nuxt 侧是 `post.author || blogConfig.author.name`；Astro 的 content schema
			// 没有 author 字段，且全库 63 篇内容无一在 frontmatter 里声明 author，
			// 所以那个 fallback 恒成立，这里直接取站点作者。
			author: blogConfig.author.name,
			categories: entry.data.categories,
			published: entry.data.published ?? entry.data.date,
		}))
		.sort(sortByUpdatedDesc)
		.slice(0, blogConfig.feed.limit)

	const entries = posts.map(post => ({
		id: getUrl(post.path),
		title: post.title ?? '',
		updated: formatIsoDate(post.updated),
		author: { name: post.author },
		content: {
			$type: 'html',
			$: renderContent(post),
		},
		link: { $href: getUrl(post.path) },
		summary: post.description,
		category: { $term: post.categories?.[0] },
		published: formatIsoDate(post.published),
	}))

	const feed = {
		$xmlns: 'http://www.w3.org/2005/Atom',
		id: blogConfig.url,
		title: blogConfig.title,
		updated: buildTime,
		description: blogConfig.description, // RSS 2.0
		author: {
			name: blogConfig.author.name,
			email: blogConfig.author.email,
			uri: blogConfig.author.homepage,
		},
		link: [
			{ $href: getUrl('atom.xml'), $rel: 'self' },
			{ $href: blogConfig.url, $rel: 'alternate' },
		],
		language: blogConfig.language, // RSS 2.0
		generator: {
			$uri: 'https://github.com/L33Z22L11/blog-v3',
			$version: themeVersion,
			_: pascalCase(themeName),
		},
		icon: blogConfig.favicon,
		logo: blogConfig.author.avatar, // Ratio should be 2:1
		rights: `© ${Temporal.Now.plainDateISO().year.toString()} ${blogConfig.author.name}`,
		subtitle: blogConfig.subtitle || blogConfig.description,
		entry: entries,
	}

	return new Response(builder.build({
		'?xml': { $version: '1.0', $encoding: 'UTF-8' },
		'?xml-stylesheet': blogConfig.feed.enableStyle ? { $type: 'text/xsl', $href: '/assets/atom.xsl' } : undefined,
		feed,
	}), {
		headers: { 'Content-Type': 'application/xml' },
	})
}
