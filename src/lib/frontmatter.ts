/**
 * MDX frontmatter 的读写纯逻辑：解析、序列化、YAML 转义、slug 生成、阅读时长估算。
 *
 * ## 为什么单独一个模块
 * 这些都是**与框架无关的纯函数 / 纯数据**。抽出它们是为了能被 `node --test` 直测
 * （见 `tests/frontmatter.test.mjs`）——本模块刻意不 import `astro:*`，
 * 以便测试进程无需 stub 内容层。
 *
 * ## 谁在用
 * 目前**没有生产调用方**。留着是因为任何写内容的工具（编辑器、脚手架、
 * 批量脚本）都要先把「YAML 标量何时必须加引号」「围栏怎么拆」这些坑踩一遍，
 * 而这些判据只有实测过才知道（见 `needsYamlQuote` 的注释）。
 * 约定：本模块与 `src/content.config.ts` 的 schema 形状对齐，
 * 改动 schema 时一并复核这里的 `ADMIN_FIELDS`。
 *
 * ## 与内容层的一致性约定
 * - `splitFrontMatter` 的围栏正则与 `remark-mdc` 的 `parseFrontMatter` 对齐；
 * - 序列化时**跳过空字符串与空数组**，不写 `title: ''` 这类噪声；
 * - 数组用流式语法 `[a, b]`（与仓库现有 MDX 一致），
 *   不用 YAML 块序列——后者会让 diff 变得难读。
 */

/** frontmatter 里允许的标量类型（对齐 `src/content.config.ts` 的 schema 形状） */
export type AdminScalar = string | number | boolean

/** 一份 frontmatter：标量或字符串数组，其余键忽略 */
export interface AdminFrontMatter {
	[key: string]: AdminScalar | string[] | undefined
}

/** 编辑器暴露给用户的字段及其默认值（顺序即表单顺序） */
export interface AdminFieldSpec {
	key: string
	label: string
	kind: 'text' | 'textarea' | 'number' | 'boolean' | 'list'
	placeholder?: string
}

/** @keep-sorted —— 键顺序即表单渲染顺序 */
export const ADMIN_FIELDS: readonly AdminFieldSpec[] = [
	{ key: 'title', label: '标题', kind: 'text', placeholder: '文章标题（列表与 RSS 用它）' },
	{ key: 'subtitle', label: '副标题', kind: 'text', placeholder: '可选，显示在标题下方' },
	{ key: 'description', label: '摘要', kind: 'textarea', placeholder: 'SEO 描述 / 列表摘要' },
	{ key: 'date', label: '创建日期', kind: 'text', placeholder: 'YYYY-MM-DD HH:mm:ss' },
	{ key: 'updated', label: '更新日期', kind: 'text', placeholder: '留空表示未更新' },
	{ key: 'categories', label: '分类', kind: 'list', placeholder: '逗号分隔，取第一个作一级分类' },
	{ key: 'tags', label: '标签', kind: 'list', placeholder: '逗号分隔' },
	{ key: 'type', label: '版式', kind: 'text', placeholder: 'tech / story' },
	{ key: 'collection', label: '合集', kind: 'text', placeholder: '可选，合集页据此归拢' },
	{ key: 'image', label: '封面', kind: 'text', placeholder: '图片 URL' },
	{ key: 'permalink', label: '自定义链接', kind: 'text', placeholder: '留空则用 /posts/… 形式' },
	{ key: 'recommend', label: '推荐权重', kind: 'number', placeholder: '越大越靠前，仅精选用' },
	{ key: 'draft', label: '草稿', kind: 'boolean', placeholder: '勾选后不进入列表与订阅源' },
]

/** 新建文章的初始 frontmatter */
export function emptyFrontMatter(): AdminFrontMatter {
	return {
		title: '',
		date: '',
		categories: [],
		tags: [],
		type: '',
		draft: false,
	}
}

/* ------------------------------------------------------------------ *
 * frontmatter 拆分 / 序列化
 * ------------------------------------------------------------------ */

/**
 * 把原始文件切成「frontmatter 原文」与「正文」。
 *
 * 只认文件**开头**的 `---` 围栏，且要求闭合行前后无其它内容——
 * 与 `remark-mdc` 的 `parseFrontMatter` 口径一致。正文里的 `---`
 * （YAML 分隔线 / 水平线）不会被误判，因为拆分只在开头找一次。
 */
export function splitFrontMatter(body?: string): { raw: string, content: string } {
	const text = body ?? ''
	// 开头允许一个 BOM / 空行外的首个字符必须是 `-`
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
	if (!match)
		return { raw: '', content: text }
	return { raw: match[1], content: text.slice(match[0].length) }
}

/** 是否需要给标量加引号（空串 / 会被 YAML 误读 / 含特殊字符） */
export function needsYamlQuote(value: string): boolean {
	if (value === '')
		return true
	// 纯空白或首尾有空白
	if (value !== value.trim())
		return true
	// 会被 YAML 解析成非字符串（数字 / 布尔 / null / 时间）
	if (/^(?:true|false|null|~|yes|no|on|off|[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)$/i.test(value))
		return true
	// 含 YAML 指示符或流式集合符号
	if (/[:#\-?*&!|>'"%@`{}[\],]/.test(value[0]) || /[:#{}[\],&*!|>'"%`]/.test(value.slice(1)))
		return true
	return false
}

/** 把字符串编码成安全的 YAML 双引号标量 */
export function quoteYamlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 标量 → YAML 字面量 */
export function formatYamlScalar(value: AdminScalar): string {
	if (typeof value === 'number')
		return Number.isFinite(value) ? String(value) : '0'
	if (typeof value === 'boolean')
		return value ? 'true' : 'false'
	return needsYamlQuote(value) ? quoteYamlString(value) : value
}

/** 标量或字符串数组 → YAML 字面量（数组用流式 `[a, b]`，逐项按需加引号） */
export function formatYamlValue(value: AdminScalar | string[]): string {
	if (Array.isArray(value))
		return `[${value.map(item => formatYamlScalar(item)).join(', ')}]`
	return formatYamlScalar(value)
}

/**
 * 把 frontmatter 对象序列化成**带围栏的整块** YAML。
 * 空字段跳过（避免写出一堆 `subtitle: ""` 噪声）；数组为空也跳过。
 * 返回以 `---\n` 开头、以 `---\n` 结尾，空对象时返回一个空围栏。
 */
export function serializeFrontMatter(data: AdminFrontMatter): string {
	const lines: string[] = []
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined || value === null)
			continue
		if (typeof value === 'string' && value.trim() === '')
			continue
		if (Array.isArray(value)) {
			if (value.length === 0)
				continue
			lines.push(`${key}: ${formatYamlValue(value)}`)
			continue
		}
		lines.push(`${key}: ${formatYamlValue(value)}`)
	}
	return `---\n${lines.join('\n')}\n---\n`
}

/**
 * 合成一份完整的 `.mdx` 文件文本（frontmatter 围栏 + 正文）。
 * 正文首尾各留一个换行，与仓库现有 `.mdx` 的排版一致。
 */
export function composeMdx(data: AdminFrontMatter, content: string): string {
	const body = content.replace(/^\n+/, '').replace(/\s+$/, '')
	return `${serializeFrontMatter(data)}\n${body}\n`
}

/* ------------------------------------------------------------------ *
 * 编辑器辅助
 * ------------------------------------------------------------------ */

/**
 * 粗略字数与阅读时长估算（编辑器里的实时反馈）。
 *
 * 与 `loaders/with-article-meta.ts` 里真正的 `reading-time` **不同**：
 * 那个精确对齐 `remark-reading-time`（按 mdast 的 text/code 节点拼接），
 * 需要完整解析 MDX；编辑器每次按键都跑一次解析太重，故这里用
 * 「CJK 按字、拉丁按词」的廉价近似，UI 上标注为「约」。
 */
export function estimateReading(text: string): { chars: number, words: number, minutes: number } {
	const chars = text.replace(/\s+/g, '').length
	const cjk = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) ?? []).length
	const latinWords = (text.replace(/[\u3400-\u9FFF\uF900-\uFAFF]/g, ' ').match(/[A-Z0-9]+/gi) ?? []).length
	const words = cjk + latinWords
	return { chars, words, minutes: Math.max(1, Math.round(words / 400)) }
}

/** 逗号 / 顿号分隔的列表输入 → 去空、去首尾空白、去重的字符串数组（保持首次出现的顺序） */
export function parseListInput(value: string): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const raw of value.split(/[,，、]/)) {
		const item = raw.trim()
		if (!item || seen.has(item))
			continue
		seen.add(item)
		out.push(item)
	}
	return out
}

/** 字符串数组 → 回填到列表输入框的逗号串 */
export function formatListInput(value?: string[]): string {
	return (value ?? []).join(', ')
}

/** 依据标题/路径给导出的文件起一个安全的 slug（去掉路径分隔符与非法字符） */
export function toFileSlug(titleOrId: string): string {
	const slug = titleOrId
		.trim()
		.toLowerCase()
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
	return slug || 'untitled'
}

/** 导出文件名的校验结果 */
export interface ExportSlugResult {
	/** 可直接用作文件名的 slug；失败时为空串 */
	slug: string
	/** 人可读的错误原因；成功时为 `undefined` */
	error?: string
	/** 因重名被改写时为 `true` */
	deduplicated?: boolean
}

/**
 * 把标题/当前 id 解析成导出用的文件 slug，并做两项校验。
 *
 * ## 为什么不能直接用 `toFileSlug`
 *
 * `toFileSlug` 对空输入回退到 `untitled`，导出后会得到一个无意义的
 * `untitled.mdx`；而两篇同标题的文章会导出成**同一个文件名**，
 * 作者放进 `src/content/posts/<年>/` 时后一篇会静默覆盖前一篇。
 * 两者在 UI 上没有任何提示，只在提交并重建后才发现。
 *
 * ## 规则
 *   - 标题与当前 id 都为空 → 直接拒绝，不再静默导出 `untitled`；
 *   - slug 与仓库里已有的文章重名 → 自动附 `-2` / `-3` 后缀；
 *   - 正在编辑的那篇本身的 id 不算冲突（重导同一篇不应被加成 `-2`），
 *     只对**其他**文章去重。
 */
export function resolveExportSlug(input: {
	title?: string
	id?: string
	/** 仓库已有的文章 id/文件名（不含末尾 `.mdx`） */
	existingIds?: readonly string[]
}): ExportSlugResult {
	const base = String(input.title ?? '').trim() || String(input.id ?? '').trim()
	if (!base)
		return { slug: '', error: '请先填写标题，再导出 .mdx' }

	// 已有名变为可比的 slug 集合；当前编辑对象本身排除。
	const self = toFileSlug(String(input.id ?? '').trim())
	const taken = new Set<string>()
	for (const raw of input.existingIds ?? []) {
		const id = toFileSlug(String(raw ?? '').trim())
		if (id && id !== self)
			taken.add(id)
	}

	const baseSlug = toFileSlug(base)
	if (!taken.has(baseSlug))
		return { slug: baseSlug }

	let n = 2
	while (taken.has(`${baseSlug}-${n}`))
		n++
	return { slug: `${baseSlug}-${n}`, deduplicated: true }
}
