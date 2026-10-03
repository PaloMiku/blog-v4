import type { APIRoute } from 'astro'
import blogConfig from '../config/blog'
import { getAllContent, toPath } from '../lib/content'

/**
 * 对应 Nuxt 侧 `nuxt-llms` 模块（nuxt.config.ts 的 `llms` 段）生成的 `/llms.txt`。
 *
 * 原实现其实是两个包接力：
 * 1. `nuxt-llms` 提供 `/llms.txt` 路由与 Markdown 骨架拼装
 *    （`# title` / `> description` / 每节 `## title` + `- [t](href): desc`，
 *      整篇以 `\n\n` 连接），配置项只有 domain / title / description。
 * 2. `@nuxt/content` 检测到装了 nuxt-llms 就自动挂载自己的 llms feature，
 *    注册 `llms:generate` 钩子补出一个 `## Content` 节：
 *    - 集合里所有 `extension = 'md'` 且 path 不含 `/.navigation` 的文档
 *    - title = `title || seo.title`，description = `description || seo.description`
 *    - href = `<domain>/raw<path>.md`（目录型 path 收尾成 `/index.md`）
 *    - 查询没有 ORDER BY，顺序就是 SQLite 的插入顺序，不可复现。
 *
 * 这里保留 href 的 `/raw/**` 形态以维持链接保真；Astro 侧的 `/raw/<id>.md`
 * 原始 markdown 路由属于路由层任务（会一次性产出 63 个文件），不在本端点范围内。
 *
 * 排序：原查询无 ORDER BY，取的是 @nuxt/content 遍历 content/ 的文件顺序。
 * 这里改为确定性的 `date` 升序（无 date 的排最前）、`path` 升序兜底，
 * 与基线的差异只有 2 个 previews 条目的位置。
 */

function toRawHref(path: string) {
	// 对应 @nuxt/content 的 getDocumentLink：`/raw<path>.md`，目录收尾成 index.md
	let href = `/raw${path}.md`
	if (href.endsWith('/.md'))
		href = `${href.slice(0, -3)}index.md`
	return new URL(href, blogConfig.url).toString()
}

export const prerender = true

export const GET: APIRoute = async () => {
	const entries = await getAllContent()

	const links = entries
		.map(entry => ({
			date: entry.data.date,
			path: toPath(entry),
			title: entry.data.title || '',
			description: entry.data.description || '',
		}))
		.sort((a, b) => {
			if (a.date !== b.date)
				return (a.date ?? '').localeCompare(b.date ?? '')
			return a.path.localeCompare(b.path)
		})
		.map(link => link.description
			? `- [${link.title}](${toRawHref(link.path)}): ${link.description}`
			: `- [${link.title}](${toRawHref(link.path)})`)

	return new Response([
		`# ${blogConfig.title}`,
		`> ${blogConfig.description}`,
		'## Content',
		links.join('\n'),
	].join('\n\n'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	})
}
