import blogConfig from '../config/blog'
import { getAllContent } from './content'

/**
 * 站点统计数据，对应 Nuxt 侧的 `server/api/stats.get.ts`。
 *
 * Nuxt 版是一个运行时端点（SQL 查询 + 聚合），这里改为构建期纯函数：
 * `/api/stats` 端点与 `BlogStats` 组件的 `stats` prop 共用本模块，
 * 保证「页面上的数字」与「公开 JSON」永远是同一份数据，不会各自漂移。
 *
 * 已知与 Nuxt 版的偏差（沿用 Astro 端点原有行为，未改动）：
 * Nuxt 的年份取 `toZonedTemporal(post.date || '').year`，且只看 `date`；
 * 这里取 `date || published` 的前四位。对 `2024-03-07 19:24:26` 这类字面量
 * 两者结果一致，改动会牵动已发布的 JSON，故保留原样。
 */

export interface StatsEntry {
	posts: number
	words: number
}

export interface CategoryEntry {
	name: string
	posts: number
	children?: CategoryEntry[]
}

export interface BlogStats {
	total: StatsEntry
	annual: Record<number, StatsEntry>
	categories: CategoryEntry[]
	tags: string[]
}

export interface StatsOptions {
	/** 统计范围（内容根相对 stem 的 LIKE 模式）；缺省读 `blogConfig.stats.includePaths` */
	includePaths?: readonly string[]
}

/**
 * 把 SQL LIKE 模式编译为正则，保持与 SQLite 相同的通配语义：
 *   %  匹配任意长度字符
 *   _  匹配单个字符
 * 其余字符按字面量匹配（转义正则元字符）。
 */
function likeToRegExp(pattern: string): RegExp {
	let out = ''
	for (const ch of pattern) {
		if (ch === '%')
			out += '.*'
		else if (ch === '_')
			out += '.'
		else
			out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	}
	return new RegExp(`^${out}$`)
}

/** 条目的 stem：内容根相对路径去掉扩展名，与 Nuxt Content 的 `stem` 语义一致。 */
function toStem(filePath: string | undefined, id: string): string {
	if (!filePath)
		return id
	const m = filePath.match(/content[\\/](.+?)\.[^./]+$/)
	return m ? m[1].replace(/\\/g, '/') : id
}

/*
 * 构建期同一进程内会算三次以上（/api/stats 端点 + 首页 + 归档页），
 * 而每次都是一次全集合扫描，故按「唯一入参」做模块级 memo。
 * 缓存 promise 而非结果：Astro 并发渲染页面时共享同一次 getCollection，
 * 失败也不重试——同一次构建里所有消费方要么都拿到数据，要么一起失败，
 * 不会有的页面有数字、有的显示 `--`。
 * 键用 includePaths 的 JSON：它是唯一影响结果的入参，不同配置必须分开算。
 * 返回值是共享对象，消费方只读即可，不要就地改写（否则会污染缓存）。
 */
const cache = new Map<string, Promise<BlogStats>>()

export function getStats(options: StatsOptions = {}): Promise<BlogStats> {
	const includePaths = options.includePaths ?? blogConfig.stats.includePaths
	const key = JSON.stringify(includePaths)

	let hit = cache.get(key)
	if (!hit) {
		hit = computeStats(includePaths)
		cache.set(key, hit)
	}
	return hit
}

async function computeStats(includePaths: readonly string[]): Promise<BlogStats> {
	const stats: BlogStats = {
		total: { posts: 0, words: 0 },
		annual: {},
		categories: [],
		tags: [],
	}

	const existedPaths = new Set<string>()

	let entries = await getAllContent()

	// 多个范围取并集，与原 orWhere(...LIKE...) 语义一致；
	// 空数组时完全不加条件，等价于 Nuxt 侧不调用 orWhere（统计全部内容）
	if (includePaths.length) {
		const matchers = includePaths.map(likeToRegExp)
		entries = entries.filter(e => matchers.some(re => re.test(toStem(e.filePath, e.id))))
	}

	const findOrCreateCategory = (name: string, tree: CategoryEntry[]): CategoryEntry => {
		let category = tree.find(entry => entry.name === name)
		if (!category) {
			category = { name, posts: 0 }
			tree.push(category)
		}
		return category
	}

	for (const post of entries) {
		// 重复路径检测
		if (existedPaths.has(post.id))
			console.warn('文章存在重复路径', post.id)
		existedPaths.add(post.id)

		// readingTime 由 withArticleMeta loader 写入 entry.data（对应 Nuxt 的 remark-reading-time）
		const words = post.data.readingTime?.words ?? 0

		// 文章/总字数计数
		stats.total.posts++
		stats.total.words += words

		// 年文章/年字数计数
		const rawDate = post.data.date || post.data.published || ''
		if (rawDate) {
			const year = Number(rawDate.slice(0, 4))
			if (Number.isFinite(year) && year > 0) {
				if (!stats.annual[year])
					stats.annual[year] = { posts: 0, words: 0 }
				stats.annual[year].posts++
				stats.annual[year].words += words
			}
			else {
				console.warn(`文章日期格式错误: "${rawDate}" (${post.id})`)
			}
		}
		else {
			console.warn(`文章日期为空 (${post.id})`)
		}

		// 分类文章计数
		let currentLevel = stats.categories
		const categories = post.data.categories || []
		for (const [index, categoryName] of categories.entries()) {
			if (typeof categoryName !== 'string')
				continue

			const category = findOrCreateCategory(categoryName, currentLevel)
			category.posts++

			if (index < categories.length - 1) {
				if (!category.children)
					category.children = []
				currentLevel = category.children
			}
		}

		// 标签统计
		for (const tag of post.data.tags || []) {
			if (typeof tag === 'string' && !stats.tags.includes(tag))
				stats.tags.push(tag)
		}
	}

	return stats
}
