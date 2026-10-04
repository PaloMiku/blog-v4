import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'

/**
 * 站点内容查询辅助层。
 *
 * Nuxt 侧用 `@nuxt/content` 的 SQL 式 API（`queryCollection` / `queryCollectionItemSurroundings`），
 * Astro 内容层是纯 JS 查询，这里把等价语义实现为构建期函数。
 * 63 篇规模下无性能问题。
 */

export type ContentEntry = CollectionEntry<'content'>

/** 全部内容条目 */
export function getAllContent(): Promise<ContentEntry[]> {
	return getCollection('content')
}

/** 条目的 URL 路径（与 `generateId` 产出的 id 一致） */
export function toPath(entry: ContentEntry): string {
	return `/${entry.id}`
}

/**
 * 仅文章（`content/posts/**`），按 date 升序。
 * 对应 Nuxt 的 `queryCollection('content').where('stem', 'LIKE', 'posts/%').order('date', 'ASC')`。
 */
export function getPostsSorted(): Promise<ContentEntry[]> {
	return getCollection('content').then(list => list.filter(e => e.data.isPost).sort(byDateAsc))
}

/**
 * 上/下一篇文章。
 * 对应 Nuxt 的 `queryCollectionItemSurroundings('content', path, { fields: [...] })`。
 * 返回 `[prev, next]`，缺失的一侧为 `null`。
 */
export async function getSurroundings(currentId: string): Promise<{
	prev: ContentEntry | null
	next: ContentEntry | null
}> {
	const posts = await getPostsSorted()
	const index = posts.findIndex(e => e.id === currentId)
	if (index === -1)
		return { prev: null, next: null }

	return {
		// 列表按时间升序，index-1 是更早的（上一篇），index+1 是更晚的（下一篇）
		prev: posts[index - 1] ?? null,
		next: posts[index + 1] ?? null,
	}
}

/**
 * 某合集下的文章。
 * 对应 Nuxt 的 `queryCollection('content').where('collection', '=', key).order('date', 'ASC')`。
 */
export async function getByCollection(key: string | undefined): Promise<ContentEntry[]> {
	if (!key)
		return []
	const list = await getCollection('content')
	return list.filter(e => e.data.collection === key).sort(byDateAsc)
}

function byDateAsc(a: ContentEntry, b: ContentEntry): number {
	return (a.data.date ?? '').localeCompare(b.data.date ?? '')
}

/* ------------------------------------------------------------------ *
 * 以下对应 app/composables/useArticleSort.ts 与 useArticleCategory.ts。
 * 两者原本是响应式 composable（排序方向与分类绑定 URL query），
 * Astro 侧拆成「构建期算默认序」+「客户端按事件重排 DOM」两部分。
 * ------------------------------------------------------------------ */

/** 排序可用的字段，来自 `blogConfig.article.order` */
export type ArticleOrderType = 'date' | 'updated'

export interface ArticleSortOptions {
	initialAscend?: boolean
	initialOrder?: ArticleOrderType
}

/**
 * 文章排序。
 * 对应 `orderBy(list, [sortOrder, 'date'], [isAscending ? 'asc' : 'desc'])`：
 * 先按选定字段，同值时回退到 date。
 */
export function sortArticles(
	list: readonly ContentEntry[],
	options: ArticleSortOptions = {},
): { sorted: ContentEntry[], sortOrder: ArticleOrderType, isAscending: boolean } {
	const { initialAscend = false, initialOrder = 'date' } = options
	const dir = initialAscend ? 1 : -1
	const key = (e: ContentEntry) => e.data[initialOrder] ?? ''

	const sorted = [...list].sort((a, b) => {
		const primary = key(a).localeCompare(key(b))
		return primary !== 0 ? primary * dir : byDateAsc(a, b) * dir
	})

	return { sorted, sortOrder: initialOrder, isAscending: initialAscend }
}

/**
 * 按文章首个分类过滤。
 * 对应 `useArticleCategory`：categories 为去重后的首分类集合，
 * listCategorized 为按选中分类过滤后的列表。
 */
export function categorizeArticles(list: readonly ContentEntry[]) {
	const categories = [...new Set(list.map(e => e.data.categories?.[0]).filter(Boolean) as string[])]
	return {
		categories,
		byCategory(key: string | undefined) {
			if (!key)
				return [...list]
			return list.filter(e => e.data.categories?.[0] === key)
		},
	}
}

/**
 * 精选文章（首页轮播）：先按 recommend 降序，同 recommend 时按 date 降序。
 * 两个键同向，date 侧沿用 `sortArticles` 的 desc 约定（比较器取负）。
 *
 * 注意 Nuxt 侧 `recommend !== null` 的判据在 zod `.optional()` 下等于「全部通过」
 * （未设置时是 `undefined`），实际靠 `recommend` 有值才进入排序。
 * 这里用 `!= null` 保持同样语义：有值才精选。
 */
export async function getRecommended(): Promise<ContentEntry[]> {
	const list = await getAllContent()
	return list
		.filter(e => e.data.recommend != null)
		.sort((a, b) => {
			const p = (b.data.recommend ?? 0) - (a.data.recommend ?? 0)
			return p !== 0 ? p : byDateAsc(a, b) * -1
		})
}

/** 条目在其页面上的 URL 路径 */
export function entryPath(entry: ContentEntry): string {
	return toPath(entry)
}
