/**
 * 组件源码围栏：把 ```` ```astro [Alert.astro] source=components/content/Alert.astro expand ````
 * 这种**空围栏**的正文，替换成磁盘上那个文件的真实内容。
 *
 * ═══ 为什么走 remark 而不是做一个 Astro 组件 ═══
 *
 * 「展示组件源码」看起来该写个 `<SourceCode file="…" />`。但那样要**复刻**一整套
 * 代码块 DOM：`figure.z-codeblock` 外壳、figcaption 里的文件名/语言标签/两个操作
 * 按钮、shiki 的双主题 CSS 变量、每行一个 `.line` 且带 `data-line`（行号列靠
 * `prose.css` 的 `attr(data-line)`）、`--collapsed-rows` / `--tab-size` 两个变量、
 * 超过阈值的折叠按钮……
 *
 * 复刻的每一处都是一处**将来会悄悄失配**的地方：`main.css` 与 `prose.css` 里成百
 * 上千条规则是按 Nuxt 产物逐字写的，`.shiki > .line`、`:where(.iconify)`、
 * `button > .iconify:only-child` 这些都依赖精确的 DOM 形状。
 *
 * 而在 **remark 阶段**替换 `code` 节点的 `value`，等于什么都没写：
 * 下游还是 Astro 自己的 shiki（`catppuccin-latte` / `one-dark-pro` + `defaultColor:false`）
 * → `transformerLineNumbers` 补 `data-line` → `rehypeProseChrome` 套 `figure.z-codeblock`
 * → `src/lib/prose-enhance.ts` 按 `data-cb-action` 接上换行/复制/折叠。
 * **与页面上任何一个人工围栏走的是同一条路**，因此外观逐字一致、零新增 CSS、
 * 且源码永远与磁盘同步（不会像快照那样腐烂）。
 *
 * ═══ 围栏 info string ═══
 *
 *   ```astro [Alert.astro] source=components/content/Alert.astro expand
 *
 * - `astro`        语言，走 shiki
 * - `[Alert.astro]` 图注里显示的文件名。**必须字面写出来**：`plugins/prose.ts` 的
 *   `scanFences()` 是去**读源文件原文**扫 info string 的（meta 从 mdast 传不到
 *   hast——Astro 的 shiki 会重建 `<pre>` 节点只保留自己的属性），本插件改的是树，
 *   改不到那份扫描结果。
 * - `source=…`     本插件的标记。`parseFenceInfo()` 只认 `icon=` / `wrap` / `expand`
 *   三个 token，**其余 `key=value` 一律静默忽略**，所以这里不会和它打架。
 * - `expand`       不折叠，完整展开（源码 tab 的意义就是看全文）。
 *
 * 路径相对 `src/` 解析，基准由本文件的 `import.meta.url` 推出——`src/plugins/x.ts`
 * 往上走**一层**就是 `src/`。（§35 记的正是「少算一层」那个坑：组件被复制到仓库外
 * 单独构建时会一路向上找到某个碰巧存在的文件。这里刻意用本文件自身的 URL 而不是
 * 内容文件的 VFile 路径，基准与内容放在哪无关。）
 */
import { readFileSync } from 'node:fs'
import { normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `src/plugins/component-source.ts` → `<repo>/astro-site/src` */
const SRC_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** info string 里的 `source=<相对路径>`；路径不含空格（真要含空格得加引号，届时再说） */
const MARKER_RE = /(?:^|\s)source=(\S+)/

/**
 * mdast 节点的最小结构，**本地声明**。
 *
 * ⚠️ 不要从 `mdast` / `unified` 这两个包取类型：它们是 `@astrojs/markdown-remark`
 * 带进来的 **transitive** 依赖，`astro-site/package.json` 里没有声明，
 * `check-self-contained.mjs` 会判 `[undeclared]` 并让验收变红。
 * 能不引就不引——本插件只需要 `type / value / meta / children` 这四个字段，
 * 声明一个本地接口就够，而且**零新增依赖**这件事本身就是收益。
 *
 * ⚠️⚠️ 顺带记一笔：上面那个警告我**自己又踩了一次**。第一版把
 * `Root` / `Plugin` 写成 import 删掉之后，我在注释里又把它们原样写了出来当反面例子，
 * 门禁立刻再次报红——它是**词法**扫描，不认注释。
 * 同一条教训一天内犯了两次（另一次在 `BlogTech.astro`）：
 * **注释里不要出现任何可解析的 import 语句或相对路径**，
 * 哪怕是拿来说「不要这么写」的。
 */
interface MdastNode {
	type: string
	value?: string
	lang?: string | null
	meta?: string | null
	children?: MdastNode[]
}

export function remarkComponentSource() {
	return (tree: MdastNode): void => {
		walk(tree)
	}
}

/*
 * 递归不能藏在 `if (node.lang)` 之类的守卫里：mdast 的 `root` / `paragraph` 自身没有
 * `lang`，条件一旦挂在它上面，整棵子树就一次都不会被遍历（§78.2② 记的就是这个：
 * 判据写在更上游的环节里，下游补多少内容都没用）。
 */
function walk(node: MdastNode) {
	if (node.type === 'code') {
		fill(node)
		return
	}
	for (const child of node.children ?? [])
		walk(child)
}

/** 取回真实源码并写进 `code` 节点。任何一步不成立都抛错让构建失败。 */
function fill(node: MdastNode) {
	const meta = node.meta ?? ''
	const m = meta.match(MARKER_RE)
	if (!m)
		return

	const rel = m[1]
	const abs = normalize(resolve(SRC_ROOT, rel))

	/*
	 * 路径必须仍在 `src/` 之内。围栏是**内容作者**能写的东西，
	 * `source=../../../../Windows/System32/config/SAM` 这种必须在这里挡住，
	 * 不能让它变成「构建期任意文件读取」。
	 */
	if (abs !== SRC_ROOT && !abs.startsWith(SRC_ROOT + sep))
		throw new Error(`[component-source] source=${rel} 解析到 ${abs}，已逃出 ${SRC_ROOT}`)

	let source: string
	try {
		source = readFileSync(abs, 'utf8')
	}
	catch (err) {
		throw new Error(`[component-source] 读不到 ${abs}（source=${rel}）：${(err as Error).message}`)
	}

	if (!source.trim())
		throw new Error(`[component-source] ${abs} 是空文件`)

	node.value = source.replace(/\s+$/, '')
	/*
	 * 报告出来是因为这类东西**坏了不会变红**：围栏照常渲染，只是内容变成空。
	 * 页面上看不出来，构建也不报错（§78.2 的形状）。
	 */
	console.warn(`[component-source] ${rel} → ${node.value.split('\n').length} 行，lang=${node.lang ?? '(无)'}`)
}
