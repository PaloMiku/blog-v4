/**
 * Component 围栏：把一个组件示例的**三页签**收进一个围栏里。
 *
 *   ````Component [Alert.astro]
 *   <Alert type="info" title="自定义标题">
 *     默认插槽的 [超链接](#alert) **粗体** `Inline code`
 *   </Alert>
 *   ````
 *
 * 展开成现有的 `<Tab tabs={['组件','用法','源码']}>`：正文按 MDX 解析后**真实渲染**
 * 为「组件」栏，正文**原文**作为「用法」栏，磁盘上的组件文件作为「源码」栏。
 * 三栏同出一处，因此作者**只写一次**组件，也不会像手抄快照那样与代码腐烂。
 *
 * ═══ 为什么不是「一个空围栏 + source=」 ═══
 *
 * 上一版是让作者手写 `<Tab>` + 三个 `<div slot>`，其中「源码」栏是一个**空围栏**，
 * 由本插件把 `source=` 指向的文件读进来填进正文。解析是做到了，但**重复书写没解决**：
 * 每个组件要在「组件」栏手写一遍、在「用法」栏再抄一遍，「源码」栏还得再指一次路径。
 * 围栏只是源码的载体，与组件本身毫无关系——组件被写了两遍这件事一件都没少。
 *
 * 组件既然天生就是「一段 MDX」，那就该由**围栏正文**承载：围栏是组件的包装，
 * 不是源码的旁注。
 *
 * ═══ 实现：合成 MDX 文本 → 交给 MDX 自己的解析器 ═══
 *
 * 不手工拼 `mdxJsxFlowElement` 节点，而是先拼出一整段 MDX 源码，再解析成节点树：
 *
 *   const tree = PROCESSOR.parse(template)   // template 里含 <Tab>/<div slot>/两个围栏
 *   children.splice(i, 1, tree.children[0])  // 换掉原来的围栏节点
 *
 * 节点形状因此**由 MDX 自己保证**，不会与「MDX 实际会接受的写法」漂移。
 * 这一点是硬要求：手写节点时 `tabs={["组件","用法","源码"]}` 会被 micromark 拒掉
 * （JSX 属性值只认单引号 / 双引号 / 花括号表达式），而这种错误只在**真正跑一遍解析**
 * 的时候才暴露。
 *
 * ⚠️ 解析器必须带 remark-math。`remark-math` v6 只有 micromark 扩展、**没有
 * transformer**（读 node_modules/remark-math/lib/index.js 确认过），也就是说
 * `$$x$$` 必须在**解析期**就被认出来。「数学公式」那一节的围栏正文里既有 `$$…$$`
 * 又有 ` ```math ` 围栏，缺了它这两样都会退化成字面文本——而那正是「组件」栏要展示的
 * 东西。`createProcessor({ remarkPlugins: [remarkMath] })` 的 remark 插件是在冻结
 * （首次 parse）时并进解析器的，所以只调 `parse()` 就已经带上数学语法。
 *
 * ═══ 围栏 info string ═══
 *
 *   ```Component [Alert.astro] source=components/blog/BlogHeader.astro
 *
 * - `Component`   本插件的标记，**不要**拿它当 shiki 语言
 * - `[Alert.astro]` 图注里显示的文件名，同时决定默认路径 `components/content/<名字>`
 *   （`BlogHeader.astro`、`math-code.ts` 这类不在 `components/content/` 的再补 `source=`）
 * - `source=…`     显式路径，相对 `src/`。其余 `key=value`（`icon=` / `wrap` / `expand`）
 *   对本围栏无意义——两个派生围栏的 meta 是写死的，见下。
 *
 * ═══ 派生围栏的 meta 靠 raw-source 扫描配对 ═══
 *
 * 「用法」「源码」两个围栏只存在于**合成文本**里，源文件里没有。可
 * `plugins/prose.ts` 的 `scanFences()` 是去**读 .mdx 原文**扫 info string 的
 * （meta 从 mdast 传不到 hast——Astro 的 shiki 会重建 `<pre>` 只保留自己的属性），
 * 于是图注的文件名/图标靠「同 lang、同顺序」配对：`takeMeta()` 按语言顺序取用。
 *
 * 本插件因此在树里产出 code 节点的顺序必须与 `componentFenceInfos()` 返回的顺序
 * **逐字一致**（先用法 `mdx`、后源码），否则文件名会张冠李戴——而那**不会报错**，
 * 只会让源码栏显示另一个文件的名字。改这个顺序前先读 `scanFences()` 里的配对注释。
 */
import { readFileSync } from 'node:fs'
import { extname, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProcessor } from '@mdx-js/mdx'
import remarkMath from 'remark-math'

/** `src/plugins/component-fence.ts` → `<repo>/src` */
const SRC_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 围栏语言，即本插件的标记 */
export const COMPONENT_FENCE_LANG = 'Component'

/** 页签名。顺序即页签顺序 */
const TABS = ['组件', '用法', '源码']

/** 「用法」栏围栏的 info string */
const USAGE_INFO = 'mdx wrap expand'

/** 源码默认目录，相对 SRC_ROOT */
const DEFAULT_DIR = 'components/content'

/** info string 里的 `[文件名]` 与 `source=<相对路径>` */
const FILENAME_RE = /\[([^\]]+)\]/
const SOURCE_RE = /(?:^|\s)source=(\S+)/

/** 正文里的大写开标签（MDX 组件名）。`/` 或空白开头，用来吃 `</Alert>` */
const JSX_TAG_RE = /<\/?\s*([A-Z][\w.-]*)/g

/** 只需要 mdast 节点的 `type / value / lang / meta / position / children` 六项，本地声明 */
interface MdastNode {
	type: string
	value?: string
	lang?: string | null
	meta?: string | null
	position?: { start?: { offset?: number | null } | null, end?: { offset?: number | null } | null } | null
	children?: MdastNode[]
}

/**
 * 解析围栏正文用的处理器。
 *
 * 只用 `parse()`，不走 `run()`：MDX 的 `run()` 会一路做到 estree 源码，
 * 而这里要的是**节点树**（splice 回页面树，由页面的 MDX 编译去求值）。
 */
const PROCESSOR = createProcessor({ remarkPlugins: [remarkMath] })

/** 源码栏的语言取文件名后缀：`Alert.astro` → `astro`，`math-code.ts` → `ts` */
export function sourceLangOf(filename: string): string {
	const ext = extname(filename).slice(1)
	if (!ext)
		throw new Error(`[component-fence] [${filename}] 没有扩展名，推不出源码栏该走的语言`)
	return ext
}

/**
 * 一个 Component 围栏派生出的两条围栏 info string。
 *
 * `plugins/prose.ts` 的 `scanFences()` 用它把**一个** Component 围栏算成**两个**
 * CodeMeta，好让「用法」「源码」两个代码块各自配到自己的 meta。**顺序即配对顺序**，
 * 改这里必须同步改本插件产出 code 节点的顺序。
 */
export function componentFenceInfos(filename: string): string[] {
	return [USAGE_INFO, `${sourceLangOf(filename)} [${filename}] expand`]
}

export function remarkComponentFence() {
	return (tree: MdastNode, file?: { path?: string }): void => {
		const path = file?.path
		/*
		 * 读源文件原文只为一件事：核对围栏正文有没有被**提前截断**（见
		 * `assertBodyIntact`）。拿不到 path 时（例如将来从字符串编译）就跳过这项核对，
		 * 其余检查照旧。
		 */
		const raw = readRaw(path)
		walk(tree, { path, raw })
	}
}

interface Ctx {
	path?: string
	raw: string | null
}

/*
 * 递归要遍历**父节点的 children 数组**并原地替换：只递归不替换的话，
 * 围栏节点没法换成 Tab 节点。
 *
 * ⚠️ 判断别写在 `if (node.lang)` 之类的守卫里——root / paragraph 自身没有 lang，
 * 条件挂在它上面整棵子树一次都不会被遍历（§78.2②）。
 */
function walk(node: MdastNode, ctx: Ctx) {
	const children = node.children
	if (!children)
		return
	for (let i = 0; i < children.length; i++) {
		const child = children[i]
		if (child.type === 'code' && child.lang === COMPONENT_FENCE_LANG) {
			children.splice(i, 1, ...expand(child, ctx))
			continue
		}
		walk(child, ctx)
	}
}

/** 展开一个围栏节点，返回替换它的新节点。任何一个前提不成立都抛错让构建失败。 */
function expand(node: MdastNode, ctx: Ctx): MdastNode[] {
	if (ctx.path && /\.md$/i.test(ctx.path))
		throw new Error(`[component-fence] Component 围栏只能写在 .mdx 里（${ctx.path} 是 .md，没有组件可渲染）`)

	const info = node.meta ?? ''
	const filename = FILENAME_RE.exec(info)?.[1]
	if (!filename)
		throw new Error(`[component-fence] 围栏 info 里必须有 [文件名]，实际是 ${JSON.stringify(info)}`)

	const rel = SOURCE_RE.exec(info)?.[1] ?? `${DEFAULT_DIR}/${filename}`
	const abs = normalize(resolve(SRC_ROOT, rel))
	/*
	 * 路径必须仍在 `src/` 之内。围栏是**内容作者**能写的东西，
	 * `source=../../../../Windows/System32/config/SAM` 这种必须在这里挡住。
	 */
	if (abs !== SRC_ROOT && !abs.startsWith(SRC_ROOT + sep))
		throw new Error(`[component-fence] source=${rel} 解析到 ${abs}，已逃出 ${SRC_ROOT}`)

	let source: string
	try {
		source = readFileSync(abs, 'utf8')
	}
	catch (err) {
		throw new Error(`[component-fence] 读不到 ${abs}（[${filename}]，默认路径是 ${DEFAULT_DIR}/<文件名>，不在那儿就补 source=）：${(err as Error).message}`)
	}
	if (!source.trim())
		throw new Error(`[component-fence] ${abs} 是空文件`)

	const body = (node.value ?? '').replace(/\s+$/, '')
	if (!body.trim())
		throw new Error(`[component-fence] 围栏正文是空的，[${filename}] 这一节没写组件`)

	assertBodyIntact(node, body, ctx.raw)
	assertNameMatches(body, filename)

	const parsed = PROCESSOR.parse(buildTemplate(body, source, filename))
	const nodes = parsed.children ?? []
	if (nodes.length !== 1 || nodes[0]?.type !== 'mdxJsxFlowElement')
		throw new Error(`[component-fence] 合成模板解析出来不是单个 <Tab>，实际是 ${nodes.map(n => n.type).join(',') || '(空)'}`)

	/*
	 * 报出来是因为「源码栏拿到了哪个文件、多少行」在页面上看不出来，
	 * 而它一旦配错（文件名张冠李戴）构建同样是绿的。
	 */
	console.warn(`[component-fence] [${filename}] 正文 ${body.split('\n').length} 行 + 源码 ${source.replace(/\s+$/, '').split('\n').length} 行 ← ${rel}`)

	return [nodes[0]]
}

/**
 * 核对围栏正文没被提前截断。
 *
 * 正文里若含有三反引号（例如「数学公式」那节的 ` ```math `），而外层 Component
 * 围栏也只写了三反引号，mdast 会在**第一个**三反引号处闭合——正文被截掉一大截，
 * 剩下的内容以普通 markdown 身份漏进页面。这类缺陷不会让构建变红。
 *
 * 判据：把源文件里「围栏首行之后」到 `position.end.offset`（= **闭合围栏之后**的偏移，
 * 实测如此）这段原文切出来，去掉末行闭合围栏后与 `code.value` 比。
 *
 * ⚠️ 只去**一行**：正文自己可能以「一行反引号」结尾（外层围栏写得比它长时），
 * 连着删多行会把那种情况误判成截断。
 * ⚠️ 闭合围栏可以带缩进（正文嵌在 JSX 元素里时就是），所以匹配要允许前导空白。
 */
function assertBodyIntact(node: MdastNode, body: string, raw: string | null) {
	const start = node.position?.start?.offset
	const end = node.position?.end?.offset
	if (raw === null || typeof start !== 'number' || typeof end !== 'number')
		return
	const bodyStart = raw.indexOf('\n', start)
	if (bodyStart < 0 || bodyStart > end)
		return
	// 源文件可能是 CRLF，mdast 的 value 已归一成 LF
	const lines = raw.slice(bodyStart + 1, end).replace(/\r\n/g, '\n').split('\n')
	const closer = lines.pop() ?? ''
	// 认不出闭合围栏就放弃这项核对：漏一次检查远好过误报一次
	if (!/^\s*`{3,}\s*$/.test(closer))
		return
	if (lines.join('\n').replace(/\s+$/, '') !== body)
		throw new Error(`[component-fence] 围栏正文与源文件对不上，围栏长度不够：正文里含有更长的反引号串时，Component 围栏必须写得比它更长（位置 ${start}…${end}）`)
}

/** 正文里的组件名与 `[文件名]` 对不上就抛错：否则源码栏会**安静地**显示另一个文件。 */
function assertNameMatches(body: string, filename: string) {
	const names = new Set([...body.matchAll(JSX_TAG_RE)].map(m => m[1]))
	if (names.size === 0)
		return
	const stem = filename.replace(/\.[^.]+$/, '')
	if (names.has(stem))
		return
	throw new Error(`[component-fence] 正文里的组件是 ${[...names].join(' / ')}，与 [${filename}] 对不上——源码栏会显示错的文件`)
}

/** 正文里已有 N 连反引号时，包裹它的围栏必须 N+1，否则会提前闭合 */
function fenceFor(text: string): string {
	let longest = 0
	for (const m of text.matchAll(/`+/g))
		longest = Math.max(longest, m[0].length)
	return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * 合成 `<Tab>` 的 MDX 源码。三个要点：
 *
 * 1. 闭合围栏**必须独占一行**——` ```` </div> ` 写在同一行时，`</div>` 会被当成代码内容。
 * 2. 属性表达式里用**单引号**：JSX 不接受 `tabs=["a","b"]`，会被 micromark 拒掉。
 * 3. 正文顶格写：缩进 ≥4 空格的行会被解析成缩进代码块。
 */
function buildTemplate(body: string, source: string, filename: string): string {
	const usageFence = fenceFor(body)
	const sourceFence = fenceFor(source)
	return [
		`<Tab tabs={[${TABS.map(t => `'${t}'`).join(',')}]}>`,
		'<div slot="tab1">',
		body,
		'</div>',
		'<div slot="tab2">',
		`${usageFence}${USAGE_INFO}`,
		body,
		usageFence,
		'</div>',
		'<div slot="tab3">',
		`${sourceFence}${sourceLangOf(filename)} [${filename}] expand`,
		source,
		sourceFence,
		'</div>',
		'</Tab>',
		'',
	].join('\n')
}

function readRaw(path: string | undefined): string | null {
	if (!path)
		return null
	try {
		return readFileSync(path, 'utf8')
	}
	catch {
		return null
	}
}
