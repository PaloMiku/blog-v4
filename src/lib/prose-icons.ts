/**
 * 构建期图标解析：把 iconify 名称（如 `ri:github-fill`）变成 hast 元素节点。
 *
 * ═══ 为什么需要它 ═══
 * `getDomainIcon` / `getFileIcon` / `getLangIcon` 一共能返回 121 种图标
 * （ri / simple-icons / tabler / catppuccin / devicon / uim / material-symbols …），
 * 手写映射表不现实。而这些标记由 rehype 插件生成、不是 Astro 组件，
 * 拿不到 `<Icon />` 的构建期渲染管线，所以在这里自己解析。
 *
 * 数据源是本地已安装的 `@iconify-json/<prefix>`，转换用 `@iconify/utils` 的
 * `iconToSVG`（astro-icon 的依赖，已验证可从 astro-site 直接 resolve）。
 * 全程构建期，零客户端 JS。
 *
 * ⚠️ 输出必须是**结构化 hast 节点**，不能用 `{ type: 'raw' }` 塞 HTML 字符串：
 * MDX 的 hast → JSX 转换会直接抛 `Cannot handle unknown node 'raw'`。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

export interface HastNode {
	type: string
	tagName?: string
	value?: string
	properties?: Record<string, unknown>
	children?: HastNode[]
}

const require_ = createRequire(import.meta.url)

/** 集合前缀 -> 解析后的 IconifyJSON。构建期缓存，同一集合只读一次。 */
const collections = new Map<string, Record<string, any> | null>()

function loadCollection(prefix: string) {
	if (collections.has(prefix))
		return collections.get(prefix)!

	let data: Record<string, any> | null = null
	try {
		const path = require_.resolve(`@iconify-json/${prefix}/icons.json`)
		data = JSON.parse(readFileSync(path, 'utf8'))
	}
	catch {
		// 集合没装：返回 null，调用方按「无图标」处理，不抛错——
		// 图标缺失不该让整站构建失败。
		data = null
	}
	collections.set(prefix, data)
	return data
}

/** 裸名补全成 iconify 全名，与 Nuxt 侧 Icon 组件的解析规则一致。 */
export function iconName(name: string) {
	if (!name)
		return ''
	return name.includes(':') ? name : `tabler:${name}`
}

const TAG_RE = /<(\/)?([a-zA-Z][\w:-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * 把 iconify 的 body 字符串（`<path d="…"/>` / `<g>…</g>` 的有限子集）
 * 解析成 hast 节点。
 *
 * 为什么不用 `@iconify/utils` 的 `iconToSVG`：它返回的 `body` 是**字符串**而不是
 * 节点数组（实测 `Array.isArray === false`），而且不读集合级的 `width`/`height`
 * ——ri / tabler / simple-icons 集合级都是 24，devicon 是 128，
 * 单独调 `iconToSVG` 会得到错误的 `0 0 16 16` viewBox 并裁掉图形。
 */
function parseSvgBody(body: string): HastNode[] {
	const root: HastNode = { type: 'element', tagName: 'svg-fragment', properties: {}, children: [] }
	const stack: HastNode[] = [root]
	TAG_RE.lastIndex = 0
	let m: RegExpExecArray | null
	while ((m = TAG_RE.exec(body)) !== null) {
		const [, closing, tag, attrText, selfClose] = m
		if (closing) {
			if (stack.length > 1)
				stack.pop()
			continue
		}
		const props: Record<string, string> = {}
		ATTR_RE.lastIndex = 0
		let a: RegExpExecArray | null
		while ((a = ATTR_RE.exec(attrText)) !== null)
			props[a[1]] = a[2] ?? a[3] ?? ''
		const node: HastNode = { type: 'element', tagName: tag, properties: props, children: [] }
		stack[stack.length - 1].children!.push(node)
		if (!selfClose)
			stack.push(node)
	}
	return root.children!
}

/**
 * 生成一个行内 SVG 元素节点。
 *
 * `aria-hidden` 避免读屏软件念装饰图形。
 * 集合缺失或图标查不到时返回 `undefined`，调用方按「无图标」降级——
 * 与 Nuxt 侧 `<Icon>` 查不到时的行为一致。
 */
export function iconElement(name: string, cls?: string): HastNode | undefined {
	const full = iconName(name)
	const colon = full.indexOf(':')
	if (colon <= 0)
		return undefined

	const set = loadCollection(full.slice(0, colon))
	if (!set)
		return undefined
	const key = full.slice(colon + 1)

	let found = set.icons?.[key]
	if (!found) {
		// alias 指回父图标，父图标可能还藏在 aliases 里，逐层上溯。
		let alias = set.aliases?.[key]
		const seen = new Set<string>()
		while (alias && !found && !seen.has(alias.parent)) {
			seen.add(alias.parent)
			found = set.icons?.[alias.parent]
			alias = set.aliases?.[alias.parent]
		}
	}
	if (!found?.body)
		return undefined

	const children = parseSvgBody(found.body)
	if (children.length === 0)
		return undefined

	const width = found.width ?? set.width ?? 16
	const height = found.height ?? set.height ?? 16
	const left = found.left ?? 0
	const top = found.top ?? 0

	/*
	 * `iconify` 无条件带上，不能只靠调用方记得传。
	 *
	 * `main.css:87` 的 `:where(.iconify) { display:inline-block; flex-shrink:0;
	 * font-size:1.2em; vertical-align:sub }` 是 astro-icon（`Icon.astro` 根元素）
	 * 与 Nuxt `@nuxt/icon` 共用的尺寸契约，而这条 rehype 路径**不经** `Icon.astro`。
	 * 早先只有两处调用方（代码块文件名图标、链接域名图标）自己传了 `iconify`，
	 * 折叠箭头、两个表格切换图标、行内代码的 check/copy、引用按钮五处都漏了——
	 * 于是它们停在 1em 且不沉底。合并时去重，那两处的产物不变。
	 */
	const classes = ['iconify', ...(cls?.split(/\s+/) ?? [])].filter((c, i, all) => !!c && all.indexOf(c) === i)

	/*
	 * `width/height: 1em` **保留**，不要因为「Icon.astro 自己不带尺寸」就一并删掉：
	 * astro-icon 侧同样带（`iconToSVG()` 的 attributes 里就是 `width="1em" height="1em"`，
	 * 产物可查），Nuxt 的 `@nuxt/icon` 也一样。倍率由 `.iconify` 的 `font-size:1.2em`
	 * 提供，`1em` 是相对字号，所以视觉尺寸仍是 1.2em；反过来把 width/height 删掉，
	 * svg 会落回 UA 默认的 100%×100%，那才真的坏了。
	 */
	return {
		type: 'element',
		tagName: 'svg',
		properties: {
			'class': classes.join(' '),
			'viewBox': `${left} ${top} ${width} ${height}`,
			'width': '1em',
			'height': '1em',
			'aria-hidden': 'true',
			'focusable': 'false',
		},
		children,
	}
}
