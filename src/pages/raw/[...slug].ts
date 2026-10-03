import type { APIRoute, GetStaticPaths } from 'astro'
import type { ContentEntry } from '../../lib/content'
import { getAllContent } from '../../lib/content'

/**
 * `/raw/<id>.md` —— 对应 `@nuxt/content` 内置的 markdown 端点产物。
 *
 * 基线 `.output/public/raw/` 下有 63 个 `.md`，是真实、可被搜索引擎收录的公开 URL，
 * 删掉会断外部链接，所以必须补齐。
 *
 * ## URL 结构（已与基线 63 条逐条核对）
 * 基线的 raw 路径是 **页面 URL** + `.md`，不是内容文件路径：
 *
 * | 源文件 | 页面 URL | raw 文件 |
 * | --- | --- | --- |
 * | `content/games/index.md` | `/games` | `raw/games.md` |
 * | `content/games/galgames/index.md` | `/games/galgames` | `raw/games/galgames.md` |
 * | `content/games/galgames/clannad/secret/index.md` | `/games/galgames/clannad/secret` | `raw/games/galgames/clannad/secret.md` |
 * | `content/posts/2025/11/riddle-joker.md`（hidePostPrefix） | `/2025/11/riddle-joker` | `raw/2025/11/riddle-joker.md` |
 *
 * `entry.id` 恰好就是页面路径（`content.config.ts` 的 `generateId` 已做
 * permalink 优先 + 去 `/posts` 前缀 + 剥 `index.md` 三步），
 * 所以**直接用 `entry.id` 拼 `raw/${entry.id}.md`**，不要再自己实现一遍目录规则。
 * 全库无任何 `permalink` 字段，因此这三种规则没有交叉，63 条全部命中。
 *
 * 路由文件叫 `[...slug].ts` 而非 `[...slug].md.ts`：rest 参数的值里带 `.` 会被原样保留
 * （Astro 的 `getRouteGenerator` 对 spread 段不做扩展名处理），因此把 `.md` 放进
 * `getStaticPaths` 的参数值里，生成出来的就是 `/raw/<id>.md`。
 */
export const prerender = true

export const getStaticPaths: GetStaticPaths = async () => {
	const entries = await getAllContent()
	return entries.map(entry => ({
		params: { slug: `${entry.id}.md` },
		props: { entry },
	}))
}

/**
 * 正文取 `entry.body`：Astro 的 glob loader 用 `parseFrontmatter` 解析，
 * 拆成 `data`（frontmatter）与 `body`（**已剥离 frontmatter** 的原文），
 * 所以这里不需要再剥一次。
 *
 * 输出结构对齐基线（`# 标题` + 空行 + `> 摘要` + 空行 + 正文 + 末尾换行）。
 */
function toMarkdown(entry: ContentEntry) {
	const head: string[] = []
	if (entry.data.title)
		head.push(`# ${entry.data.title}`)
	// 基线恒有这一行：文章填摘要，独立页为空引用（`> `）
	head.push(`> ${entry.data.description ?? ''}`)

	const body = (entry.body ?? '').trim()
	return `${[...head, body].filter(Boolean).join('\n\n')}\n`
}

export const GET: APIRoute = ({ props }) => {
	const { entry } = props as { entry: ContentEntry }

	return new Response(toMarkdown(entry), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	})
}
