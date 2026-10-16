import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'
import blogConfig from '../config/blog'

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

/**
 * 页尾推荐文章。
 *
 * ## 为什么只有元数据可用
 * 站点是纯静态的（`build.format: 'directory'`，产物直接发 CDN），**没有服务端、
 * 没有用户态**：推荐结果在构建期就必须算完并冻进 HTML。对比之下 Nuxt 侧原本可以做
 * 「读请求再算」，能拿到的东西多得多——但那不是本仓库的形态，不要按那个假设设计。
 * 于是可用信号只剩文章自身的 frontmatter，这也意味着**推荐结果对所有读者完全一致**，
 * 它是「相关阅读」而不是「猜你喜欢」。别在注释或文案里写成后者。
 *
 * ## 打分
 * 权重与条目数全部来自 `blogConfig.article.related`，理由见那里的注释。
 * 这里只负责**实现**判据，不定义「什么算相关」。
 *
 * ## 破平与「零分候选」
 * 分数相同时依次比 `recommend`（大者前，缺省视为 0，与 `getRecommended` 同一约定）
 * → `date`（新者前）。第三键 date 是必须的：38 篇文章里有 23 篇的 top1 是并列的
 * （同分类的文章大量共享首分类），不破平的话同一个输入会拿到任意顺序，
 * 「同一篇文章的推荐每次构建都一样」这条性质就不成立了。
 *
 * 排序**不设门槛**：分数为 0 的候选不是被丢弃，而是排在有分的之后，
 * 于是 `limit` 个位置总能填满。实测 38 篇文章里有 3 篇与**所有**其它文章零重叠
 * （既不同分类、也无共同标签、不在合集里），若把 0 分当不合格，这三篇的推荐块
 * 会渲染成空的——空块比「勉强相关的几篇」更糟，它让读者以为站内没有更多内容。
 * 它们最终拿到的是最近发布的文章，因为 0 分组内部仍按 recommend → date 破平。
 */
export async function getRelated(currentId: string, limit = blogConfig.article.related.limit): Promise<ContentEntry[]> {
	const posts = await getPostsSorted()
	const current = posts.find(e => e.id === currentId)
	if (!current || limit <= 0)
		return []

	const weights = blogConfig.article.related

	/*
	 * 草稿排除。与 `stats.ts` 的 `includePaths` 语义对齐（`lib/frontmatter.ts:52`
	 * 写的是「勾选后不进入列表与订阅源」）：推荐块是「站内还有这些」，把草稿推给
	 * 读者等于提前泄露未发布内容。
	 */
	const candidates = posts.filter(e => e.id !== currentId && !e.data.draft)

	const scored = candidates
		.map((entry) => {
			const score
				= (current.data.collection && entry.data.collection === current.data.collection ? weights.collection : 0)
					+ overlap(current.data.tags, entry.data.tags) * weights.tag
					+ (overlap(current.data.categories, entry.data.categories) > 0 ? weights.category : 0)
					+ (current.data.type && current.data.type === entry.data.type ? weights.type : 0)
					+ (withinDays(entry.data.date, current.data.date, weights.recencyDays) ? weights.recency : 0)

			return { entry, score }
		})
		// 单次排序完成「打分 → 破平 → 0 分兜底」三件事，末尾的 slice(0, limit)
		// 因此总能填满（见函数头注释的「零分候选」）
		.sort((a, b) => (b.score - a.score)
			|| ((b.entry.data.recommend ?? 0) - (a.entry.data.recommend ?? 0))
			|| byDateAsc(b.entry, a.entry))

	return scored.slice(0, limit).map(x => x.entry)
}

/** 两个字符串数组的交集大小（去重后计，前端 frontmatter 可能带重复项） */
function overlap(a: readonly string[] | undefined, b: readonly string[] | undefined): number {
	if (!a?.length || !b?.length)
		return 0
	const set = new Set(a)
	return b.reduce((n, item) => (set.has(item) ? n + 1 : n), 0)
}

/** 两篇文章的发布日期是否在 days 天之内；任一日期缺失或不可解析时返回 false */
function withinDays(a: string | undefined, b: string | undefined, days: number): boolean {
	if (!a || !b)
		return false
	const gap = Math.abs(daysBetween(a, b) ?? Number.POSITIVE_INFINITY)
	return gap <= days
}

/**
 * `YYYY-MM-DD` 前缀 → 数字三元组（年、月、日）。不可解析时返回 `null`。
 *
 * ⚠️ 必须同时接受**空格与 `T` 两种分隔符**：原实现用 `split(/[- ]/)`，遇
 * `2025-11-04T18:30:00` 会得到 `[2025, 11, NaN]`，于是「不可解析」被判真、
 * 返回 null，进而让调用方的 `recency` 权重**静默归零**——没有任何报错。
 * 一条带引号的 frontmatter 日期（`date: "2025-11-04T18:30:00"`，YAML 给字符串而非
 * `Date`，绕过了 schema 的格式化）就能触发。见 tests/content.test.mjs 的回归用例。
 */
function dateParts(value: string): [number, number, number] | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
	if (!m)
		return null
	return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * 两个 `YYYY-MM-DD` 日期相隔的天数（绝对值向下取整），任一串缺失或不可解析时返回 null。
 *
 * ⚠️ frontmatter 的日期是**裸墙钟**（无时区），schema 已把它还原成字符串原样
 * （见 `content.config.ts` 的 `toDateStringFromUtc`）。这里只做「日期部分之间」的
 * 相减，两侧都不带时区，相减结果与真实时间差一致，因此**不需要**也不能引入
 * 时区转换——任何带瞬间的日期类型（`Temporal.ZonedDateTime` / `Instant`）都会引入
 * 构建机时区依赖，正是 PostFooter 注释里记的那次 2026-10-03 事故的成因。
 *
 * 另：**刻意不用 `Temporal.PlainDate`**。它虽然只解析日历日、不涉及时区，
 * 但 `temporal-polyfill` 在本仓库有过一次代价记录（`Excerpt.astro` 头注：顶层 import
 * 让 56 KB 的 polyfill 进了客户端 chunk）。这里只需要「取前 10 个字符再拆」，
 * 一个正则足够，不值得为它拉进一个依赖。
 */
function daysBetween(a: string | undefined, b: string | undefined): number | null {
	if (!a || !b)
		return null
	const p1 = dateParts(a)
	const p2 = dateParts(b)
	if (!p1 || !p2)
		return null
	const MS_PER_DAY = 86400000
	const t1 = Date.UTC(p1[0], p1[1] - 1, p1[2])
	const t2 = Date.UTC(p2[0], p2[1] - 1, p2[2])
	return Math.floor(Math.abs(t1 - t2) / MS_PER_DAY)
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
