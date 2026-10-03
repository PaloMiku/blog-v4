import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import GithubSlugger from 'github-slugger'

/**
 * 搜索索引（构建期静态 JSON），对应 Nuxt 侧的
 * `queryCollectionSearchSections('content', { ignoredTags: ['pre'] })`。
 *
 * ## 为什么是静态端点而不是构建期内联进 ModalHost
 * 索引是全站 63 篇文章的标题层级 + 正文切片，量级在百 KB。
 * 内联进 `ModalHost` 意味着**每一个页面**的 HTML 都要背上这份数据，
 * 而绝大多数访客不会打开搜索框。做成 `/search-index.json` 后：
 * 页面 HTML 保持原样，首次打开搜索框时才 `fetch` 一次并缓存在内存里。
 * 参照已有的 `src/pages/api/stats.ts`，同样 `prerender = true`。
 *
 * ## 分节模型
 * 与 Nuxt 侧 `queryCollectionSearchSections` 的返回结构保持一致，
 * 因为 `SearchItem` 的展示逻辑依赖这几个字段：
 * - `id`：可跳转的 URL，标题节点带 `#slug` 锚点
 * - `title`：本节标题
 * - `titles`：祖先标题（面包屑）
 * - `content`：本节正文纯文本
 * - `level`：标题深度；`1` 表示文章自身（正文首节），`SearchItem` 据此显示文章图标
 *
 * 锚点 slug 用 `github-slugger` 生成——Astro 自己给 heading 生成 `id`
 * 用的就是同一个库（`Toc.astro` 消费的 `render().headings[].slug` 同源），
 * 因此这里不自己实现 slug 规则，避免与实际 DOM 里的锚点对不上。
 */

export const prerender = true

/** 一个搜索结果节 */
export interface SearchSection {
	id: string
	title: string
	titles: string[]
	content: string
	level: number
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
/**
 * 围栏代码块。开启行允许最多 3 个前导空格（再多就是缩进代码块而非围栏），
 * 闭合行必须同种标记、长度不短于开启行、且后面不能跟 info string。
 * 长度条件不能省：`previews/example.mdx` 里存在 ````mdc wrap expand` 里再嵌
 * ```md` 的写法，只做「遇到 ``` 就翻转」会把整段围栏状态搅乱，
 * 导致围栏内的 `# 标题` 被当成真标题、围栏内容漏进索引。
 */
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/
/** MDX 的 ESM 语句（import / export 开头的那一类），可能跨行 */
const ESM_RE = /^\s*(?:import|export)\b/
/** 列表项与引用行前缀 */
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/
const BLOCKQUOTE_RE = /^\s*>+\s?/
/** 表格分隔行 `| --- | --- |` */
const TABLE_DELIM_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/
/** 数学公式：`$$...$$` 与 `$...$` */
const MATH_BLOCK_RE = /\$\$[\s\S]*?\$\$/g
const MATH_INLINE_RE = /\$[^$\n]+?\$/g
/** 图片 / 链接，保留可见文本 */
const IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g
/** 行内 HTML / JSX 标签，保留标签内文本 */
const TAG_RE = /<\/?[A-Za-z][^>]*>/g
/** 自闭合组件（整行只有标签时清空该行） */
const SELF_CLOSING_RE = /<[A-Za-z][^>]*\/>/g
/** MDX 表达式与注释 `{...}` */
const MDX_EXPR_RE = /\{[^{}]*\}/g
/** 行内代码定界符，保留内容 */
const INLINE_CODE_RE = /`([^`]*)`/g
/** 强调标记 */
const EMPHASIS_RE = /[*_~]{1,3}/g

/** 把一行 Markdown/MDX 压成纯文本 */
function toPlainText(line: string): string {
	return line
		.replace(MATH_BLOCK_RE, ' ')
		.replace(MATH_INLINE_RE, ' ')
		.replace(IMAGE_RE, '$1')
		.replace(LINK_RE, '$1')
		.replace(SELF_CLOSING_RE, ' ')
		.replace(TAG_RE, ' ')
		.replace(MDX_EXPR_RE, ' ')
		.replace(BLOCKQUOTE_RE, '')
		.replace(LIST_RE, '')
		.replace(TABLE_DELIM_RE, ' ')
		.replace(INLINE_CODE_RE, '$1')
		.replace(EMPHASIS_RE, '')
		.replace(/\s+/g, ' ')
		.trim()
}

/** 去掉可能存在的 frontmatter（glob loader 通常已剥离，这里兜底） */
function stripFrontmatter(body: string): string {
	return body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/**
 * 把一篇正文切成若干搜索节。
 *
 * 逐行扫描：围栏代码块整体丢弃（对应 Nuxt 侧 `ignoredTags: ['pre']`），
 * ATX 标题切节，其余行压成纯文本累加到当前节。
 */
function splitSections(body: string, path: string, docTitle: string): SearchSection[] {
	const lines = stripFrontmatter(body).split(/\r?\n/)
	const slugger = new GithubSlugger()

	const sections: SearchSection[] = []
	/** 标题栈：index = 深度 - 1 */
	const headingStack: string[] = []
	let current: SearchSection | null = null
	/** 当前围栏的标记与长度；null 表示不在围栏内 */
	let fence: { marker: string, length: number } | null = null
	let inEsm = false

	/** 开一节；`level` 为 0 表示文章自身（首个标题之前的正文） */
	function startSection(level: number, title: string, anchor: string) {
		/*
		 * 祖先标题 = 深度比本节浅的那些。
		 * 必须过滤空位：本文档的标题通常从 `##`（深度 2）起，
		 * `headingStack[0]` 从未被赋值，是个空洞，
		 * 直接 slice 会得到 [undefined] → 序列化后变成 [null]，
		 * 客户端再拿去 split() 就炸。
		 */
		const titles = level === 0 ? [] : headingStack.slice(0, level - 1).filter((t): t is string => Boolean(t))
		current = {
			id: anchor ? `${path}#${anchor}` : path,
			title: title || docTitle,
			titles,
			content: '',
			level: level === 0 ? 1 : level,
		}
		sections.push(current)
	}

	/** 首节对应文章自身：即使正文首个标题不是 `##` 也能被标题搜到 */
	function ensureFirstSection() {
		if (!sections.length)
			startSection(0, docTitle, '')
	}

	for (const line of lines) {
		// 围栏优先于一切：围栏里的 `# xxx` 是代码注释，不是标题
		if (fence) {
			const close = FENCE_CLOSE_RE.exec(line)
			if (close && close[1][0] === fence.marker && close[1].length >= fence.length)
				fence = null
			continue
		}
		const open = FENCE_OPEN_RE.exec(line)
		if (open) {
			// 反引号围栏的 info string 里不能再出现反引号（CommonMark）
			if (open[1][0] === '`' && open[2].includes('`'))
				continue
			fence = { marker: open[1][0], length: open[1].length }
			continue
		}

		if (inEsm) {
			// 缩进的非空行是上一条 import/export 的续行
			if (line.trim() && /^\s/.test(line))
				continue
			// 收尾的这一行本身要照常处理，不能一起吃掉
			inEsm = false
		}

		if (ESM_RE.test(line)) {
			inEsm = true
			continue
		}

		const heading = HEADING_RE.exec(line)
		if (heading) {
			const depth = heading[1].length
			const text = toPlainText(heading[2])
			// slugger 必须按文档顺序消费每一个标题，才能与 Astro 生成的 id 一致
			const anchor = slugger.slug(text)

			ensureFirstSection()
			headingStack.length = depth - 1
			headingStack[depth - 1] = text
			startSection(depth, text, anchor)
			continue
		}

		const text = toPlainText(line)
		if (!text)
			continue
		ensureFirstSection()
		// 用空格拼接而不是换行：正文里换行只是排版断句，
		// 拼成一段后高亮片段读起来更连贯
		current!.content = current!.content ? `${current!.content} ${text}` : text
	}

	ensureFirstSection()
	/*
	 * 丢掉「只有标题没有正文」的小节（`SearchItem` 里表现为只有面包屑、没有摘要）。
	 *
	 * 但 level 1 的文章节要保留：多数文章正文第一个字符就是 `##`，
	 * 首节正文为空，若一并丢掉，frontmatter 里的文章标题就成了搜不到的东西
	 * （Nuxt 侧有同样的缺口——那里文章标题由 PostHeader 渲染，本就不在正文里）。
	 * 保留一个「只有标题」的条目，好让按标题能直接跳到文章。
	 */
	return sections.filter(s => s.content || s.level === 1)
}

export const GET: APIRoute = async () => {
	const entries = await getCollection('content')

	const sections = entries.flatMap((entry) => {
		const path = `/${entry.id}`
		const title = entry.data.title ?? entry.id
		return splitSections(entry.body ?? '', path, title)
	})

	return new Response(JSON.stringify(sections), {
		headers: { 'Content-Type': 'application/json' },
	})
}
