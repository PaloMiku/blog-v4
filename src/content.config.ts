import type { ReadTimeResults } from 'reading-time'
import { glob } from 'astro/loaders'
import { defineCollection, z } from 'astro:content'
import blogConfig from './config/blog'
import { withArticleMeta } from './loaders/with-article-meta'

// Nuxt 侧的 `content:file:afterParse` 钩子在 build 时改写 path，
// 等价逻辑在这里用 glob loader 的 `generateId` 复刻：
//   1. frontmatter.permalink 优先，直接作为条目 id
//   2. 其次按 hidePostPrefix 去掉 /posts 前缀
//      （`/posts/foo` → `/foo`，`/posts/a/b` → `/a/b`）
function generateId({ entry, data, base }: { entry: string, data: Record<string, unknown>, base: URL }) {
	const permalink = data.permalink
	if (typeof permalink === 'string' && permalink)
		return permalink.replace(/^\/+|\/+$/g, '')

	// 去掉 base 与扩展名，得到相对内容根的路径
	let rel = entry.replace(String(base), '').replace(/\.[^./]+$/, '')
	rel = rel.replace(/^\/+/, '')

	// index.md 表示所在目录本身，与 Nuxt 的文件路由一致：`games/index.md` → `games`
	rel = rel.replace(/(^|\/)index$/, '$1')
	rel = rel.replace(/\/+$/, '')

	if (blogConfig.article.hidePostPrefix && rel.startsWith('posts/'))
		rel = rel.slice('posts/'.length)

	return rel
}

export interface ArticleSchema {
	title?: string
	subtitle?: string
	description?: string
	date?: string
	updated?: string
	published?: string
	categories?: string[]
	tags?: string[]
	type?: string

	image?: string
	recommend?: number
	references?: { title?: string, link?: string }[]
	collection?: string
	draft?: boolean
	permalink?: string

	readingTime?: ReadTimeResults
}

/** frontmatter `metaSlots` 的单条：`props` 是 MDC 属性，`content` 是已转换的 MDX 片段 */
export interface MetaSlot {
	props: Record<string, unknown>
	content: string
}

export type MetaSlots = Record<string, MetaSlot>

const articleTypes = Object.keys(blogConfig.article.types)

/**
 * 把 YAML 解析出的 Date 还原成原始字面量。
 *
 * 关键点：YAML 里 `2024-03-07 19:24:26` 这种**无时区**标量会被解析成
 * `2024-03-07T19:24:26Z`（按 UTC 解释）。要还原原始字面量必须用 `getUTC*` 系列，
 * 用 `getFullYear()` 等本地 getter 会在 UTC+8 的构建机上**凭空多加 8 小时**
 * （实测：takagi 的 `2024-03-07 19:24:26` 变成 `2024-03-08 03:24:26`）。
 *
 * Nuxt Content（minimark）保持字符串原样，因此这里必须逐字还原。
 */
function toDateStringFromUtc(value: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return [
		`${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
		`${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`,
	].join(' ')
}

const dateLike = z
	.union([z.string(), z.date(), z.number()])
	.transform(v => (v instanceof Date ? toDateStringFromUtc(v) : String(v)))
	.optional()

export const collections = {
	// 对应 Nuxt 侧的 `content` 集合（type: 'page'）
	content: defineCollection({
		loader: withArticleMeta(glob({
			// 内容源。2026-10-03 Astro 接管仓库根时，`content-mdx/` 改名为 `content/`，
			// 目录里装的就是原来那批 `.mdx`（63 个，glob loader 的输入，一个都没少）。
			//
			// 接管前这里是「codemod 产物」，原文 `content/*.md` 另存一份当事实源。现在原文树
			// 已删除，`.mdx` **就是**一手内容源，`mdc-to-mdx` codemod 随之退役
			// （转换报告存档在 docs/mdc-to-mdx-report.md）。
			pattern: '**/*.mdx',
			base: new URL('./content/', import.meta.url),
			generateId,
		})),
		schema: z.object({
			title: z.string().optional(),
			subtitle: z.string().optional(),
			description: z.string().optional(),
			date: dateLike,
			updated: dateLike,
			published: dateLike,
			categories: z.array(z.string()).default([blogConfig.defaultCategory]),
			tags: z.array(z.string()).default([]),
			type: z.enum(articleTypes as [string, ...string[]]).optional().default(articleTypes[0]),

			image: z.string().optional(),
			recommend: z.number().optional(),
			references: z.array(z.object({
				title: z.string().optional(),
				link: z.string().optional(),
			})).optional(),
			collection: z.string().optional(),
			draft: z.boolean().default(false),
			permalink: z.string().optional(),

			// Nuxt 侧由 remark-reading-time 注入；Astro 侧改由 withReadingTime loader 计算
			readingTime: z.object({
				text: z.string(),
				minutes: z.number(),
				time: z.number(),
				words: z.number(),
			}).optional(),

			// 原 rehype-meta-slots 提取的 `<meta-xxx>` 具名槽位。
			// 注意 frontmatter 里的键名是 `metaSlots`（不是 `slots`）：
			// codemod 把正文中的 `<meta-aside-foo>` 整块抽出后写到这里，
			// 键是**去掉 `meta-` 前缀后**的名字（`meta-aside-foo` → `aside-foo`），
			// 与 Nuxt 侧 `useWidgets()` 的 `widgetName.slice('meta-'.length)` 同一套算法。
			metaSlots: z.record(z.string(), z.object({
				props: z.record(z.string(), z.unknown()).default({}),
				content: z.string().default(''),
			})).optional(),

			aside: z.array(z.string()).optional(),
			/** 由 withArticleMeta loader 补齐：对应 Nuxt 的 stem LIKE 'posts/%' */
			isPost: z.boolean().optional(),
		}),
	}),
}
