/**
 * 静态检查：三个列表页（`/` `/archive` `/preview`）的**排序 / 分类 / 分页 / 密度控件真的接上线了**。
 *
 * ═══ 这道门禁为什么存在 ═══
 *
 * 这四组控件的共同点是：**缺席时页面照样正常渲染，而且完全看不出来**。
 *
 * - 排序按钮：`OrderToggle.astro` 照常渲染、照常派发 `partial:change`，
 *   但页面没有监听器 → 点了没反应。迁移时监听器只判 `d.category !== undefined`，
 *   把 `sortOrder` / `isAscending` 丢掉后按构建期默认值重排，排序与方向**全是死的**。
 * - 分页条：`Pagination.astro` 自管页码并派发事件，但列表不重排 → 第 11 条往后够不到。
 * - 密度面板：两个 `Slider` 纯视觉纯交互，滑了不动。
 * - 首次进入的卡片若不惰性，全量 38 条会直接把首屏撑到基线的 4 倍，
 *   而**页高门禁只会报一个数字**，没人知道是数据没分页。
 *
 * 现有的 `compare-page-heights`（比高度）、`compare-dom-live`（比类名计数）、
 * `audit-dead-scope`（比 scoped 死规则）都看不见以上任何一条：
 * 少一个监听器，页高不变、DOM 形状不变、样式不变。
 * `check-flip-gates` 覆盖 FLIP 接线，但不覆盖「排序状态有没有被消费」。
 *
 * 更阴的一种：**源码里写了、产物里没有**。Astro 不会编译没人引用的组件，
 * 构建照样绿。所以本门禁只认产物（`dist/`），不认源码。
 *
 * ═══ 检查项 ═══
 *  1. **首屏仍是 perPage 张卡片**（`data-post-menu` 段内数 `article-card`）——
 *     全量数据必须惰性，否则页高门禁会先炸，而它不会告诉你为什么。
 *  2. **全量数据已嵌入且惰性**：`<template … data-post-dataset>` 存在，
 *     条目数 > 一页，且 `useUpdated` 的两种形态都在（否则切「更新日期」时
 *     卡片里的 `<time>` 措辞没法还原——那是构建机 locale 决定的）。
 *  3. **`partial:change` 控制器在产物 JS 里**：三个页面的数据集标记 + 排序键 +
 *     `sortOrder` / `isAscending` / `checked` / `spring` 全都被读过。
 *     这条专治「监听器只判 `d.category`、把另外两个字段丢掉」这个原缺陷。
 *  4. **FLIP wrapper 在三个页面上都在**，且是 `ListTransition.astro` 渲染的
 *     （认组件自己的 `data-list-transition-root` / `-content` 两个钩子，
 *     手工内联的同名 div 骗不过去）。
 *  5. **密度面板与两个滑杆存在**，`z-toggle` / `z-slider` 的选择器在产物 CSS 里
 *     （外链 `_astro/*.css` **加**各页内联 `<style>`——见下）。
 *  6. **三处「作者级 display 压过 `hidden`」都补了显式规则**：
 *     `.archive-tuning[hidden]`（被 `reusable.css:2` 的 `.card{display:block}` 压过）、
 *     `.article-item[hidden]`（被 `Archive.astro` 的 `display:flex` 压过，
 *     于是分类筛选其实是空操作）、`.hide-info`（`column > 1` 时收起次要信息）。
 *  7. **密度变量是运行时驱动的**：`--archive-item-column` / `--archive-item-gap`
 *     必须出现在产物 **JS** 里。只出现在 HTML 里 = 仍然写死（这正是原缺陷）。
 *  8. **四个查询参数都被读**：`sort` / `asc` / `category` / `page`。
 *     字面量形态要归一引号（产物是反引号），但**不能**抹掉引号。
 *
 * ═══ 「产物 CSS/JS」指哪一段：外链 + 内联 ═══
 * Astro 7 对够小的组件样式与脚本**直接内联进 HTML**，不落 `_astro/`：
 * 68 个页面里内联了 69 段 `<style>`（100 KB）与 491 段可执行 `<script>`（676 KB）。
 * 只读外链等于把一大半产物当成「不存在」——`z-toggle`、`--archive-item-column`、
 * `data-archive-dataset` 全都明明白白写在 `dist/archive/index.html` 的内联块里。
 * 收法照 `check-icon-swap.mjs` 的 `scriptsOf()`：内联与外链同权，`src=` 的归外链那一路。
 *
 * 另一头要同时守住：标记与代码分开数。Astro 7 把 `Archive.astro` 的控制器内联进
 * `/archive`，里面两处 ``[data-slider-root]`` 的 querySelector 字面量会让
 * 「面板里有几个滑杆」数成 4 个（真实控件是 2 个）。故标记类判据一律过 `markupOf()`。
 *
 * ═══ 这道门禁自己判错过两轮，都是「看不见明明存在的东西」 ═══
 *
 * 两轮的产物都是**对的**，红灯全来自判据。记在这里是因为教训比代码更容易被改没：
 *
 * 1. **只读外链 `dist/_astro/*.{css,js}`**——看不见 Astro 7 内联进 HTML 的
 *    69 段 `<style>` 与 491 段 `<script>`。修法是把两路同权收进一份快照。
 * 2. **规则查找用扁平正则看不见 CSS 嵌套**。Astro 7 编译嵌套时**不展开** `&`
 *    （实测 73 个样式块里 1159 个 `&`），产物里那条规则的真身是
 *    `.archive-tuning[…]{position:sticky;…;&[hidden]{display:none}}`，
 *    扁平正则只看得见 `&[hidden]` 一段，里面没有 `archive-tuning` 三个字，
 *    于是被判成「规则没进产物」。`.article-item[hidden]` 与 `.hide-info` 当时
 *    能过是**碰巧**（它们的嵌套片段恰好被扁平正则看得见），不是判据对。
 *    修法见 `collectRules()`：沿父链解析 `&`，父链穿过 `@media` / `@supports` /
 *    `@container` 继续往下传，`@keyframes` / `@font-face` 这类声明型 at-rule 整块跳过。
 * 3. **查询参数判据只认 `"` 与 `'`**。Astro 压缩器把字符串字面量写成**反引号**，
 *    全 dist 里 `"sort"` 0 处、`'sort'` 0 处、`` `sort` `` 3 处，
 *    四个参数于是各报一次「没被读取或写回」。见下面第 8 项的注释。
 *
 * ═══ 自检 ═══
 * 判据带 27 个用例，全部由「一份合格产物」派生：逐个抽掉关键片段，
 * 要求对应检查**必须报出**。其中 4 例专门复现本项目的真实失败模式：
 * 全量数据没惰性（首屏 38 张卡）、只判 `category` 丢掉方向字段、
 * 密度初值没从面板读、密度变量写死在 HTML 里；另 4 例（m–p）锁死内联那一路：
 * 内联块与外链同权、且内联脚本里的选择器字面量不算标记；
 * q–s3 / t–v 锁死上面第 2、3 条修正，且各自带**反面**用例
 * （真抽掉就必红、`sortOrder` 这类标识符不许顶替字面量），
 * 免得「见啥都认」的匹配器也能全过。自检不过直接 exit 1、
 * 不输出结论——判据自己判错的时候，门禁就是在教人忽略红灯。
 *
 * ⚠️ 选 token 的一条硬规矩：**不能选通用词**。
 * 第一版用 `checked` / `spring` / `sortOrder` 当「控件被消费」的证据，实测在改动前的
 * 产物里它们**全都命中**——`checked` 来自打包进来的 markdown 解析器，
 * `spring` 来自一个弹簧动画库，`sortOrder` 来自 `appConfig` 那个对象字面量。
 * 这类 token 永远不会红，等于没有检查。现在只保留在旧产物里 0 命中的那些。
 *
 * ═══ 这道门禁证明不了什么 ═══
 * 产物层面**无法**区分「`Toggle` 派发了 `{ checked }`」与「页面真的拿它切了显隐」——
 * 两者在 dist 里长得一样。门禁只能证明控件的样式、标记、定位钩子都进了产物，
 * 以及驱动代码在 JS 里。显隐是否真的生效要靠
 * `interaction-check.mjs` 那类真浏览器脚本。
 *
 * ═══ 只读 dist ═══
 * 本门禁对 `dist/` **只读**。`LIST_CONTROLS_DIST` 环境变量只为「拿一份被故意
 * 弄坏的产物副本跑一遍、证明门禁真的会红」而存在，默认为 `dist/`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const DIST = process.env.LIST_CONTROLS_DIST || join(ROOT, 'dist')

/** 需要检查的三个页面；键名即报告里的名字 */
const PAGES = {
	index: 'index.html',
	archive: join('archive', 'index.html'),
	preview: join('preview', 'index.html'),
}

function walk(dir, out = []) {
	for (const e of readdirSync(dir)) {
		const full = join(dir, e)
		if (statSync(full).isDirectory())
			walk(full, out)
		else
			out.push(full)
	}
	return out
}

function countOf(haystack, needle) {
	if (!needle)
		return 0
	let n = 0
	for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length))
		n++
	return n
}

/**
 * 取 `dist/_astro` 下某个文件的全部 CSS 文本。
 *
 * 任务书要求的是 `dist/_astro/*.css`，不是「dist 里的任意 .css」——
 * Astro 只会把被打包过的样式吐进 `_astro/`，散落在别处的 .css 是别的进程留下的。
 *
 * ⚠️ 这条只管**外链**。Astro 7 还会把够小的组件样式内联进各页 `<style>`，
 * 那一半由 `collectInline()` 单独收，两路在 `evaluate` 里合并。
 */
function collectCss(distDir) {
	const astro = join(distDir, '_astro')
	if (!statSync(astro, { throwIfNoEntry: false }))
		return ''
	return readdirSync(astro).filter(f => f.endsWith('.css')).map(f => readFileSync(join(astro, f), 'utf8')).join('\n')
}

/**
 * 各页内联的 `<style>` / `<script>` 正文——Astro 7 的另一半产物。
 *
 * `src=` 的那一路不算（那是外链 chunk）；`type` 只收缺省与 JS MIME 两种，
 * `application/ld+json` / `importmap` 是数据不是代码。
 */
function collectInline(distDir) {
	const css = []
	const js = []
	for (const file of walk(distDir).filter(f => f.endsWith('.html'))) {
		const html = readFileSync(file, 'utf8')
		for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
			if (m[1].trim())
				css.push(m[1])
		}
		for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
			if (/\bsrc\s*=/.test(m[1]))
				continue
			const type = /\btype\s*=\s*['"]?([^'"\s>]+)/i.exec(m[1])?.[1]?.toLowerCase()
			if (type && !/^(?:module|text\/javascript|application\/javascript)$/.test(type))
				continue
			if (m[2].trim())
				js.push(m[2])
		}
	}
	return { css, js }
}

/**
 * 只留标记：抹掉 `<style>` / `<script>` 的正文，标签本身留着。
 * 数 wrapper、数滑杆时，内联脚本里的选择器字面量不是标记。
 */
function markupOf(html) {
	return html.replace(/(<(?:script|style)\b[^>]*>)([\s\S]*?)(<\/(?:script|style)>)/g, '$1$3')
}

/** 把产物收成一份「三个页面 HTML / _astro 的 CSS / 全部 JS」的快照，判据只认这个结构 */
function collectArtifacts(distDir) {
	const files = walk(distDir)
	const read = f => readFileSync(f, 'utf8')
	const pages = {}
	for (const [name, rel] of Object.entries(PAGES)) {
		const full = join(distDir, rel)
		pages[name] = statSync(full, { throwIfNoEntry: false }) ? read(full) : null
	}
	return {
		pages,
		css: collectCss(distDir),
		js: files.filter(f => f.endsWith('.js')).map(read).join('\n'),
		inline: collectInline(distDir),
	}
}

/* ────────────────────────── 规则查找（`&` 嵌套感知） ────────────────────────── */

/**
 * 声明型 at-rule：体内是声明或关键帧（`0%` / `50%` / `to`），没有选择器，整体跳过。
 * 实测产物里出现的是 `@keyframes` / `@font-face` / `@font-feature-values` / `@styleset`。
 * 不在表内的 `@media` / `@supports` / `@container` 是「条件组」，里面的规则沿用父链。
 */
const DECL_AT_RULE = /^@(?:-\w+-)?(?:keyframes|font-face|font-feature-values|styleset|font-palette-values|property|page|counter-style)\b/

/** 跳过引号串，返回收尾引号的下标 */
function skipString(text, i) {
	const q = text[i]
	for (i++; i < text.length; i++) {
		if (text[i] === '\\')
			i++
		else if (text[i] === q)
			return i
	}
	return text.length - 1
}

/** `text[i]` 是 `{` 时返回配对 `}` 的下标；配不上返回 -1 */
function matchBrace(text, i) {
	let depth = 0
	for (; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === '\'') {
			i = skipString(text, i)
			continue
		}
		if (c === '{')
			depth++
		else if (c === '}' && --depth === 0)
			return i
	}
	return -1
}

/**
 * 顶层逗号切分。括号 / 方括号 / 引号里的逗号不算分隔符——
 * `:where(menu,ol,ul)` 这种形态产物里有好几处，天真切开会把它劈成三条选择器。
 */
function splitTopLevel(text) {
	const parts = []
	let depth = 0
	let start = 0
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === '\'') {
			i = skipString(text, i)
			continue
		}
		if (c === '(' || c === '[')
			depth++
		else if (c === ')' || c === ']')
			depth--
		else if (c === ',' && depth === 0) {
			parts.push(text.slice(start, i))
			start = i + 1
		}
	}
	parts.push(text.slice(start))
	return parts
}

/**
 * 一段前导里的最后一条语句。
 * `position:sticky;bottom:…;&[hidden]` 的前导混着自己的声明与嵌套选择器，
 * 能当选择器用的只有最后一个 `&[hidden]`。
 */
function lastStmt(text) {
	let depth = 0
	let cut = -1
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === '\'') {
			i = skipString(text, i)
			continue
		}
		if (c === '(' || c === '[')
			depth++
		else if (c === ')' || c === ']')
			depth--
		else if (!depth && (c === ';' || c === '}'))
			cut = i
	}
	return text.slice(cut + 1)
}

/**
 * 剥掉规则体里的嵌套块，只留这条规则**自己**的声明。
 * 关键：`display:none` 得算在 `&[hidden]` 头上，不能顺到父规则头上——
 * 反过来也一样，父规则自己的声明不能冒充嵌套规则的。
 */
function ownDecls(body) {
	let out = ''
	for (let i = 0; i < body.length; i++) {
		const c = body[i]
		if (c === '"' || c === '\'') {
			const end = skipString(body, i)
			out += body.slice(i, end + 1)
			i = end
			continue
		}
		if (c === '{') {
			const end = matchBrace(body, i)
			if (end === -1)
				break
			out += ' '
			i = end
			continue
		}
		out += c
	}
	return out
}

/**
 * 沿父链把 `&` 解析成绝对选择器，逐条返回（父列表 × 子列表要笛卡尔积）。
 *
 * 实测 dist/_astro/*.css 与各页内联块里真有的形态：`&[attr]` `&>.x` `& .x`
 * `&:hover` `&--mod` 裸 `&` `article &` `:hover>&` 一条里多个 `&`（`&:hover>&:after`）、
 * 逗号列表。`&` 之后不带分隔符的 `&--error` 也占一份，故按「每个 `&` 逐个替换」处理。
 * 子选择器完全不含 `&` 时按 CSS 嵌套规则当后代补上。
 */
function resolveNested(sel, parents) {
	const parts = splitTopLevel(sel).map(s => s.trim()).filter(Boolean)
	if (!parents.length)
		return parts
	const out = []
	for (const p of parents) {
		for (const s of parts)
			out.push(s.includes('&') ? s.replace(/&/g, p) : `${p} ${s}`)
	}
	return out
}

/** 把一份样式表扫成 `{ sel: string[], decl: string }[]`，`&` 已沿父链解析完 */
function collectRules(css) {
	const out = []
	scanRules(css, [], out)
	return out
}

function scanRules(text, parents, out) {
	let i = 0
	let start = 0
	while (i < text.length) {
		const c = text[i]
		if (c === '"' || c === '\'') {
			i = skipString(text, i) + 1
			start = i
			continue
		}
		if (c !== '{') {
			i++
			continue
		}
		const close = matchBrace(text, i)
		if (close === -1)
			return
		const body = text.slice(i + 1, close)
		const prelude = lastStmt(text.slice(start, i)).trim()
		if (prelude.startsWith('@')) {
			// 条件组（@media / @supports / @container）里的规则**沿用**父链，
			// 声明型 at-rule 体内没有选择器，整块丢掉
			if (!DECL_AT_RULE.test(prelude))
				scanRules(body, parents, out)
		}
		else {
			const sel = resolveNested(prelude, parents)
			if (sel.length) {
				// 一条规则可能既有自己的声明又有嵌套规则，两边都算数
				out.push({ sel, decl: ownDecls(body) })
				scanRules(body, sel, out)
			}
		}
		i = close + 1
		start = i
	}
}

/**
 * 某条规则里是否同时含选择器关键字与声明关键字（用来查 `xxx[hidden]{display:none}`）。
 *
 * ⚠️ 这里必须走 `collectRules()`，不能用一条扁平正则。Astro 7 编译原生 CSS 嵌套时
 * **不展开** `&`，`.archive-tuning[hidden]{display:none}` 在产物里长这样：
 *
 *   .archive-tuning[data-astro-cid-maku5qik]{position:sticky;…;&[hidden]{display:none}}
 *
 * 扁平正则只能看到 `&[hidden]` 这一段——选择器里没有 `archive-tuning` 三个字，
 * 于是把明明写着的规则判成「没进产物」。`.article-item[hidden]` / `.hide-info`
 * 之前能过是**碰巧**：它们的嵌套片段恰好被扁平正则看得见。
 */
function hasRule(css, selNeedle, declNeedle) {
	return collectRules(css).some(r => r.decl.includes(declNeedle) && r.sel.some(s => s.includes(selNeedle)))
}

/** 只问选择器、不问声明（`.hide-info` 这类只要有一条规则提到它就算数） */
function hasSelector(css, selNeedle) {
	return collectRules(css).some(r => r.sel.some(s => s.includes(selNeedle)))
}

/**
 * 判据本体：输入一份产物快照，返回问题描述数组（空 = 全过）。
 *
 * 保持纯函数、不读盘、不打印，自检才能喂合成数据。
 */
function evaluate(art) {
	const problems = []
	const { pages } = art
	// 「产物 CSS/JS」= 外链 + 各页内联块，两路同权。Astro 7 把够小的组件 CSS/JS 直接
	// 内联进 HTML，只读外链会把 `z-toggle`、`--archive-item-column` 这些明明写在
	// dist/archive/index.html 里的东西判成「没被编译进来」
	const css = [art.css, ...art.inline.css].join('\n')
	const js = [art.js, ...art.inline.js].join('\n')
	// 标记视图：内联脚本里两处 `[data-slider-root]` 的 querySelector 字面量会让
	// 「面板里有几个滑杆」数成 4 个（真实控件是 2 个），标记判据只认 markupOf()
	const markup = Object.fromEntries(Object.entries(pages).map(([n, h]) => [n, h === null ? null : markupOf(h)]))

	// ---- 0. 页面产物必须存在，不能把「没扫到」当成「没问题」 ----
	for (const [name, html] of Object.entries(markup)) {
		if (html === null) {
			problems.push(`页面产物缺失：/${name === 'index' ? '' : name}`)
			continue
		}

		// ---- 4. FLIP wrapper（认组件自己的钩子，手工内联的同名 div 骗不过去）----
		if (!html.includes('list-transition'))
			problems.push(`/${name === 'index' ? '' : name} 缺少 .list-transition wrapper（ListTransition.astro 没接上）`)
		if (!html.includes('data-list-transition-root'))
			problems.push(`/${name === 'index' ? '' : name} 缺少 data-list-transition-root（wrapper 是手写内联的，不是 ListTransition.astro）`)
		if (!html.includes('data-list-transition-content'))
			problems.push(`/${name === 'index' ? '' : name} 缺少 data-list-transition-content（同上）`)
	}

	// ---- 1 + 2. 首页：首屏仍是 perPage 张卡，全量数据惰性且带两种 useUpdated 形态 ----
	const index = markup.index
	if (index !== null) {
		const perPage = Number(/data-per-page="(\d+)"/.exec(index)?.[1] ?? 0)
		if (!perPage)
			problems.push('首页缺少 data-per-page，分页步长无从判断')
		else {
			const from = index.indexOf('data-post-menu')
			const to = from === -1 ? -1 : index.indexOf('</menu>', from)
			if (from === -1 || to === -1)
				problems.push('首页缺少 data-post-menu 容器')
			else {
				const shown = countOf(index.slice(from, to), 'article-card')
				if (shown !== perPage)
					problems.push(`首页首屏渲染了 ${shown} 张卡片，应为 ${perPage}（全量数据没有惰性化，会直接顶穿页高门禁）`)
			}
		}

		// 惰性容器：必须是 <template>（规范保证 display:none + 内容不进渲染树）
		if (!/<template[^>]*data-post-dataset/.test(index))
			problems.push('首页全量数据不在 <template data-post-dataset> 里（非惰性容器，首屏高度会被撑穿）')

		const entries = countOf(index, 'data-post-entry')
		if (entries <= perPage)
			problems.push(`首页 <template> 里只有 ${entries} 个条目，不足一整页的 ${perPage} 条——分页翻不到第二页`)
		if (!index.includes('data-post-state="date"') || !index.includes('data-post-state="updated"'))
			problems.push('首页数据缺 useUpdated 形态之一（切「更新日期」时卡片里的日期措辞无法还原）')
	}

	// ---- 2b. 归档 / 预览：两种 useUpdated 形态也得在 ----
	if (markup.archive !== null && !/data-list-state="date"/.test(markup.archive))
		problems.push('/archive 的数据源缺 useUpdated="date" 形态')
	if (markup.archive !== null && !/data-list-state="updated"/.test(markup.archive))
		problems.push('/archive 的数据源缺 useUpdated="updated" 形态')
	if (markup.preview !== null && !/data-preview-state="date"/.test(markup.preview))
		problems.push('/preview 的数据源缺 useUpdated="date" 形态')
	if (markup.preview !== null && !/data-preview-state="updated"/.test(markup.preview))
		problems.push('/preview 的数据源缺 useUpdated="updated" 形态')

	// ---- 5. 密度面板：标记 + 控件 + 样式 ----
	const archive = markup.archive
	if (archive !== null) {
		if (!archive.includes('archive-tuning'))
			problems.push('/archive 缺少密度调节面板 .archive-tuning')
		if (!/<div[^>]*data-archive-tuning[^>]*\shidden/.test(archive) && !/<div[^>]*\shidden[^>]*data-archive-tuning/.test(archive))
			problems.push('/archive 的密度面板没有用 hidden 属性隐藏（应默认隐藏，由 Toggle 打开）')
		if (!archive.includes('z-toggle'))
			problems.push('/archive 的 OrderToggle 槽位里没有密度开关（z-toggle）')
		// 数的是标记：`Archive.astro` 的控制器被 Astro 7 内联进同一页，
		// 里面两处 `[data-slider-root]` 字面量不是控件（否则 2 个滑杆会被数成 4 个）
		if (countOf(archive, 'data-slider-root') !== 2)
			problems.push(`/archive 的密度面板应有 2 个滑杆（间距 / 列数），实得 ${countOf(archive, 'data-slider-root')}`)
	}

	for (const sel of ['z-toggle', 'input-toggle']) {
		if (!css.includes(sel))
			problems.push(`产物 CSS 里没有 ${sel} 选择器（Toggle 的样式没被编译进来？）`)
	}
	for (const sel of ['z-slider', 'input-slider', 'data-value']) {
		if (!css.includes(sel))
			problems.push(`产物 CSS 里没有 ${sel} 选择器（Slider 的样式没被编译进来？）`)
	}

	// ---- 6. 三处「作者级 display 压过 hidden」必须都补了显式规则 ----
	//      本仓库已因此付过两次代价：prose 的 2036px 虚高、归档页的孤儿面板。
	if (!hasRule(css, 'archive-tuning', 'display:none'))
		problems.push('CSS 里没有 `.archive-tuning[hidden]{display:none}` —— `.card{display:block}`（reusable.css:2）会压过 UA 的 [hidden]，面板一直占位可见')
	if (!hasRule(css, 'article-item', 'display:none'))
		problems.push('CSS 里没有 `.article-item[hidden]{display:none}` —— `Archive.astro` 的 `display:flex` 会压过 UA 的 [hidden]，分类筛选其实是空操作')
	if (!hasSelector(css, 'hide-info'))
		problems.push('CSS 里没有 .hide-info 规则（列数 > 1 时该收起次要信息，见 archive.vue:138）')

	// ---- 7. 密度变量必须是运行时驱动的，而不是写死在 HTML 里 ----
	for (const v of ['--archive-item-column', '--archive-item-gap']) {
		if (!js.includes(v))
			problems.push(`产物 JS 里没有 ${v} —— 密度滑杆没接上，列数/间距仍然写死在构建期的内联样式里`)
	}

	// ---- 3. partial:change 控制器：三个页面的数据集标记 + 所有字段都被读过 ----
	//      这条专治「监听器只判 d.category、把 sortOrder / isAscending 丢掉」的原缺陷。
	for (const [name, marker, what] of [
		['index', 'data-post-dataset', '首页的 partial:change 控制器没有进产物 JS'],
		['index', 'data-post-menu', '首页控制器没有重排可见列表'],
		['archive', 'data-archive-dataset', '/archive 的 partial:change 控制器没有进产物 JS'],
		['preview', 'data-preview-dataset', '/preview 的 partial:change 控制器没有进产物 JS'],
	]) {
		if (!js.includes(marker))
			problems.push(`产物 JS 里没有 ${marker}（${what}）`)
	}
	for (const [needle, what] of [
		['postDate', '排序键没有从数据源读出'],
		['postUpdated', '排序键没有从数据源读出'],
		['defaultOrder', '页面没有消费 sortOrder（连回退到构建期排序的那一步都没有）'],
		['defaultAscending', '页面没有消费 isAscending'],
		['isAscending', '没有任何地方读 isAscending——方向按钮必然是死的'],
		['archiveSpacing', '密度初值没从面板读出（间距滑杆没接线）'],
		['archiveColumn', '密度初值没从面板读出（列数滑杆没接线）'],
		['data-slider-root', '页面控制器没有定位密度滑杆'],
		['data-toggle-root', '页面控制器没有定位密度开关'],
	]) {
		if (!js.includes(needle))
			problems.push(`产物 JS 里没有 \`${needle}\`（${what}）`)
	}

	// ---- 8. 四个查询参数都要能被读（Nuxt 的 routeQuery 绑定）----
	//
	// ⚠️ 引号形态必须归一：Astro 的压缩器把字符串字面量写成**反引号**，产物里是
	// `n===\`sort\`?…:t.searchParams.set(n,e)`，双引号形态 0 处、单引号形态 0 处。
	// 原判据只认 `"` 与 `'`，于是四个参数各报一次「没被读取或写回」，而它们读得好好的。
	//
	// 归一方式是**把三种引号都换成同一种**再找带引号的 token，不是抹掉引号：
	// 抹掉之后 `sort` 会命中 `sortOrder`（appConfig 里的键，产物里恒有，实测几十处）
	// 与各种 `Array.prototype.sort`，这条判据就成了永真式——正是本文件开头
	// 「不能选通用词」那条硬规矩的翻版。保留引号就仍然要求它是一个**完整的字面量**。
	const jsQuoted = js.replace(/[`'"]/g, '"')
	for (const key of ['sort', 'asc', 'category', 'page']) {
		if (!jsQuoted.includes(`"${key}"`))
			problems.push(`产物 JS 里没有查询参数 ${key} 的字面量（该参数没被读取或写回）`)
	}

	return problems
}

/* ────────────────────────── 自检 ────────────────────────── */

/** 一份「全部齐活」的产物快照；每个用例从这里派生 */
function goodArtifacts() {
	const card = '<a class="article-card" data-list-key="/a" data-astro-cid-x></a>'
	const menu = `<menu class="proper-height" data-post-menu>${card.repeat(10)}</menu>`
	const row = '<li class="article-item" data-archive-item data-list-key="/a" data-list-state="date" data-astro-cid-y></li>'
	return {
		pages: {
			index: [
				'<div class="post-list" data-post-list data-per-page="10" data-default-order="date" data-default-ascending="false">',
				'<div class="list-transition" data-list-transition-root>',
				'<div class="list-transition-content" data-list-transition-content>',
				menu,
				'</div></div>',
				'<template data-post-dataset>',
				...Array.from({ length: 20 }, (_, i) => `<div data-post-entry data-post-key="/p${i}" data-post-state="${i % 2 ? 'updated' : 'date'}"></div>`),
				'</template>',
			].join(''),
			archive: [
				'<div class="list-transition" data-list-transition-root>',
				'<div class="list-transition-content" data-list-transition-content>',
				'<div data-archive-list>',
				`<menu class="archive-list">${row}</menu>`,
				'<template data-archive-dataset>',
				'<li class="article-item" data-archive-item data-list-key="/a" data-list-state="date"></li>',
				'<li class="article-item" data-archive-item data-list-key="/a" data-list-state="updated"></li>',
				'</template>',
				'</div></div>',
				'<div class="archive-tuning card" data-archive-tuning hidden>',
				'<label class="z-toggle" data-toggle-root><input class="input-toggle" data-toggle-input></label>',
				'<label class="z-slider" data-slider-root><input class="input-slider" data-slider-input></label>',
				'<label class="z-slider" data-slider-root><input class="input-slider" data-slider-input></label>',
				'</div>',
			].join(''),
			preview: [
				'<div class="list-transition" data-list-transition-root>',
				'<div class="list-transition-content" data-list-transition-content>',
				'<menu data-preview-list><li data-article-item>',
				'<div data-preview-entry data-preview-state="date"></div>',
				'<div data-preview-entry data-preview-state="updated"></div>',
				'</li></menu></div></div>',
			].join(''),
		},
		css: [
			'.z-toggle[data-astro-cid-t]{user-select:none}',
			'.input-toggle[data-astro-cid-t]{appearance:none}',
			'.z-slider[data-astro-cid-s]{display:flex}',
			'.input-slider[data-astro-cid-s]{appearance:none}',
			'.data-value[data-astro-cid-s]{min-width:var(--slider-value,3ch)}',
			'.archive-tuning[data-astro-cid-a][hidden]{display:none}',
			'.archive-group[data-astro-cid-a] .article-item[data-astro-cid-r][hidden]{display:none}',
			'.archive-group[data-astro-cid-a].hide-info .dim-hover{display:none}',
		].join('\n'),
		js: [
			'const t=document.querySelector("[data-post-dataset]"),m=document.querySelector("[data-post-menu]");',
			'const a=document.querySelector("[data-archive-dataset]"),p=document.querySelector("[data-preview-dataset]");',
			'const q=new URLSearchParams(location.search);q.get("sort");q.get("asc");q.get("category");q.get("page");',
			'e.dataset.postDate;e.dataset.postUpdated;',
			'd.isAscending;d.category;',
			'r.dataset.defaultOrder;r.dataset.defaultAscending;',
			'const sp=Number(x.dataset.archiveSpacing),co=Number(x.dataset.archiveColumn);',
			'x.querySelectorAll("[data-slider-root]");',
			'document.querySelector("[data-toggle-root]");',
			'g.style.setProperty("--archive-item-column",String(c));',
			'g.style.setProperty("--archive-item-gap",s+"em");',
		].join('\n'),
		// 内联那一路默认留空：上面那些用例各自抽掉外链片段即可验证「缺了就报」，
		// 放进内联就不然了。内联路径由 m) / n) 单独覆盖
		inline: { css: [], js: [] },
	}
}

/** 在一份好产物上删掉某个片段，用来验证「缺了就必须报」 */
function without(art, kind, needle) {
	const clone = structuredClone(art)
	clone[kind] = clone[kind].split(needle).join('')
	return clone
}

/** 换掉 CSS 正文的合成产物（`css` 要给整段） */
function withCss(art, css) {
	return { ...art, css }
}

const good = goodArtifacts()

/**
 * 「CSS 写成原生 `&` 嵌套」的产物——照 `dist/archive/index.html` 内联块的**真身**抄的。
 *
 * Astro 7 在本项目里**不展开** `&`（Lightning CSS 保留了嵌套），所以线上产物里
 * `.archive-tuning[hidden]{display:none}` 的实际长相就是下面那个 `&[hidden]`。
 * 旧的扁平正则 `([^{}]+)\{([^{}]*)\}` 只能看到 `&[hidden]` 这一段，
 * 片段里没有 `archive-tuning` 三个字，于是把明明写着的规则判成「没进产物」。
 *
 * 顺带带上产物里另外两种真身形态：一条里多个 `&`（`&:hover>&:after`）
 * 与 `&` 后直接接后缀的 BEM 修饰（`&--error`）——`&` 不是只出现在选择器开头。
 */
function nestedArtifacts() {
	return {
		...structuredClone(good),
		css: [
			'.z-toggle[data-astro-cid-t]{user-select:none}',
			'.input-toggle[data-astro-cid-t]{appearance:none}',
			'.z-slider[data-astro-cid-s]{display:flex}',
			'.input-slider[data-astro-cid-s]{appearance:none}',
			'.data-value[data-astro-cid-s]{min-width:var(--slider-value,3ch)}',
			'.archive-tuning[data-astro-cid-a]{position:sticky;bottom:min(2em,5%);&[hidden]{display:none}&>.z-slider{margin:.5em .8em}}',
			'.archive-group[data-astro-cid-a]{margin:1rem 0 3rem;&>.archive-list[data-astro-cid-a]{grid-template-columns:repeat(var(--archive-item-column,1),1fr)}&>.archive-list[data-astro-cid-a]>.article-item[hidden],&.hide-info .dim-hover{display:none}}',
			'.badge[data-astro-cid-a]{--tone:1;&--error{color:red}&:hover>&:after{content:""}}',
		].join('\n'),
	}
}

const nested = nestedArtifacts()
const SELF_TESTS = [
	{ name: 'a) 全部齐活 → 不报', art: good, expect: [] },
	{
		// 本项目的真实失败模式：全量数据没惰性化，首屏直接 38 张卡
		name: 'b) 首屏不是 perPage 张卡（全量数据没惰性）',
		art: { ...good, pages: { ...good.pages, index: good.pages.index.replace(/<menu class="proper-height" data-post-menu>[\s\S]*?<\/menu>/, `<menu class="proper-height" data-post-menu>${'<a class="article-card"></a>'.repeat(38)}</menu>`) } },
		expect: ['首屏渲染了 38 张卡片'],
	},
	{
		// ⚠️ 原来期望 `不在 <template> data-post-dataset 里`，判据实际报的是
		// `不在 <template data-post-dataset> 里`（属性与属性之间没有空格）——
		// 旧 matcher 是空转的，所以这条错配一直没被发现。此处对齐真实措辞。
		name: 'c) 全量数据不在 <template> 里（非惰性容器）',
		art: { ...good, pages: { ...good.pages, index: good.pages.index.replace('<template data-post-dataset>', '<div data-post-dataset>').replace('</template>', '</div>') } },
		expect: ['不在 <template data-post-dataset> 里'],
	},
	{
		name: 'd) 只判 category、丢掉方向字段（原缺陷）',
		art: { ...good, js: good.js.split('d.isAscending;').join('') },
		expect: ['没有 `isAscending`'],
	},
	{
		name: 'd2) 排序字段没有回退路径（连 defaultOrder 都没读）',
		art: { ...good, js: good.js.split('r.dataset.defaultOrder;').join('') },
		expect: ['没有 `defaultOrder`'],
	},
	{
		name: 'd3) 密度初值没从面板读（滑杆面板存在但驱动没接）',
		art: { ...good, js: good.js.split('archiveSpacing').join('') },
		expect: ['没有 `archiveSpacing`'],
	},
	{
		name: 'd4) 控制器没有定位滑杆 / 密度开关',
		art: { ...good, js: good.js.split('data-slider-root').join('') },
		expect: ['没有 `data-slider-root`'],
	},
	{
		name: 'e) 密度变量只写死在 HTML 里（滑杆没接上）',
		art: { ...good, js: good.js.split('"--archive-item-column"').join('') },
		expect: ['没有 --archive-item-column'],
	},
	{
		// ⚠️ 原来这里只把 `list-transition-content` 改名，根 wrapper 的 class 还在，
		// 于是「缺少 .list-transition wrapper」那条压根不会触发，期望串是条死断言。
		// 现在两层 wrapper 一起拆掉，期望串逐条对得上。
		name: 'f) 归档页没接 FLIP wrapper',
		art: { ...good, pages: { ...good.pages, archive: good.pages.archive.replace(/list-transition/g, 'x') } },
		expect: ['缺少 .list-transition wrapper', '缺少 data-list-transition-root', '缺少 data-list-transition-content'],
	},
	{
		// ⚠️ 原来 replace 的是 `'data-list-transition-root '`（带尾空格），而合成标记里
		// 该属性后面紧跟 `>`，所以这步等于没改，art 与 good 完全相同 → 实得 []。
		// 去掉尾空格后两个钩子真的被摘掉，判据才真的被测到。
		name: 'g) wrapper 是手写内联的（没接 ListTransition.astro）',
		art: { ...good, pages: { ...good.pages, preview: good.pages.preview.replace('data-list-transition-root>', '>').replace('data-list-transition-content>', '>') } },
		expect: ['缺少 data-list-transition-root', '缺少 data-list-transition-content'],
	},
	{
		name: 'h) 密度面板没有 hidden 兜底（作者级 display 压过 [hidden]）',
		art: { ...good, css: good.css.split('.archive-tuning[data-astro-cid-a][hidden]{display:none}').join('') },
		expect: ['没有 `.archive-tuning[hidden]{display:none}`'],
	},
	{
		name: 'i) 分类筛选是空操作（.article-item[hidden] 没被压回）',
		art: { ...good, css: good.css.split('.article-item[data-astro-cid-r][hidden]{display:none}').join('') },
		expect: ['没有 `.article-item[hidden]{display:none}`'],
	},
	{
		name: 'j) .hide-info 规则丢了',
		art: { ...good, css: good.css.split('.hide-info').join('') },
		expect: ['没有 .hide-info 规则'],
	},
	{
		name: 'k) 滑杆样式没进产物',
		art: without(good, 'css', 'z-slider'),
		expect: ['没有 z-slider'],
	},
	{
		name: 'l) 页面产物整个缺失 → 必须报错，不能当过',
		art: { ...good, pages: { ...good.pages, index: null } },
		expect: ['页面产物缺失'],
	},
	{
		// 本门禁自己踩过的坑：Astro 7 把 Toggle / Slider / 三个列表页的控制器直接内联进
		// 页面，产物里明明有、外链 chunk 里没有，只读外链时这 21 条会全红
		name: 'm) CSS/JS 只内联在页面里、外链一个都没有 → 不报',
		art: { ...good, css: '', js: '', inline: { css: [good.css], js: [good.js] } },
		expect: [],
	},
	{
		name: 'n) 内联块里也没有 → 照样必须报（内联那一半是同权判据，不是安慰奖）',
		art: { ...good, css: '', js: '', inline: { css: [], js: [] } },
		expect: ['没有 z-toggle', '没有 `.archive-tuning[hidden]{display:none}`', '没有 `isAscending`'],
	},
	{
		// 判据本身也被内联骗过一次：Archive.astro 的控制器内联进 /archive，
		// 两处 `[data-slider-root]` 的 querySelector 字面量把 2 个滑杆数成了 4 个
		name: 'o) 内联脚本里的 [data-slider-root] 字面量不算控件 → 仍是 2 个滑杆，不报',
		art: { ...good, pages: { ...good.pages, archive: `${good.pages.archive}<script>for(const e of r.querySelectorAll(\`[data-slider-root]\`))e.addEventListener(\`change\`,f)</script>` } },
		expect: [],
	},
	{
		name: 'p) 面板里真的只剩 1 个滑杆 → 必须报（markup 视图不能把判据一起放过）',
		art: { ...good, pages: { ...good.pages, archive: good.pages.archive.replace('<label class="z-slider" data-slider-root><input class="input-slider" data-slider-input></label>', '') } },
		expect: ['应有 2 个滑杆'],
	},
	{
		// 判据自己瞎过一次：产物里那三条规则是 `&` 嵌套写的，扁平正则只看得见
		// `&[hidden]` 这一段，`.archive-tuning[hidden]{display:none}` 被判成「没进产物」。
		// 这条锁死「嵌套形态要能认出来」，配套的 r) / s) 是它的反面。
		name: 'q) 三处规则都写成 & 嵌套（照产物真身）→ 不报',
		art: nested,
		expect: [],
	},
	{
		// 负控制：嵌套形态下真的把 `&[hidden]{display:none}` 抽掉 → 必须报。
		// 只做「嵌套能认」不做这条，一个见啥都认的匹配器也能全过。
		name: 'r) 嵌套形态下 &[hidden]{display:none} 真被抽掉 → 必须报',
		art: withCss(nested, nested.css.split('&[hidden]{display:none}').join('')),
		expect: ['没有 `.archive-tuning[hidden]{display:none}`'],
	},
	{
		// 负控制：`.article-item[hidden]` 那条嵌套规则抽掉后必须报。
		// 同一个声明块里还留着 `&.hide-info .dim-hover{display:none}`，
		// 父规则 `.archive-group` 自己也带着 display:none 的邻居——
		// 顺带锁死「父规则的声明不许冒充嵌套规则的」。
		name: 's) 嵌套里 .article-item[hidden] 那条真被抽掉 → 必须报',
		art: withCss(nested, nested.css.replace('&>.archive-list[data-astro-cid-a]>.article-item[hidden],&.hide-info .dim-hover{display:none}', '&.hide-info .dim-hover{display:none}')),
		expect: ['没有 `.article-item[hidden]{display:none}`'],
	},
	{
		// 负控制：`.hide-info` 整段抽掉 → 必须报。改用 hasSelector() 之后，
		// 它的判据从「CSS 里有这个字符串」变成「有一条规则的选择器提到它」，
		// 这条用例盯的就是收紧后的判据仍然会红。
		name: 's2) 嵌套形态下 .hide-info 真被抽掉 → 必须报',
		art: withCss(nested, nested.css.split('hide-info').join('')),
		expect: ['没有 .hide-info 规则'],
	},
	{
		// `.hide-info` 挪到**另一条**规则下、且中间隔着 @media 与一层父规则
		// （`@media → .panel → &.hide-info`），要求父链能穿过 at-rule 继续往下传。
		// 原处那条只留 `.article-item[hidden]`，好让本例只考察 hide-info 认得出认不出。
		name: 's3) .hide-info 只藏在 @media 里的第二层嵌套下 → 仍要认出来，不报',
		art: withCss(nested, `${nested.css.replace('&>.archive-list[data-astro-cid-a]>.article-item[hidden],&.hide-info .dim-hover{display:none}', '&>.archive-list[data-astro-cid-a]>.article-item[hidden]{display:none}')}.root[data-astro-cid-a]{@media (width>=769px){.panel[data-astro-cid-a]{&.hide-info .dim-hover{display:none}}}}`),
		expect: [],
	},
	{
		// 产物 JS 里字符串字面量是**反引号**（Astro 压缩器写的），双/单引号形态 0 处。
		// 旧判据只认 " 与 '，于是四个参数各报一次「没被读取或写回」——参数其实读得好好的。
		name: 't) 四个查询参数是反引号字面量（产物真身）→ 不报',
		art: { ...good, js: good.js.split('"sort"').join('`sort`').split('"asc"').join('`asc`').split('"category"').join('`category`').split('"page"').join('`page`') },
		expect: [],
	},
	{
		// 负控制：四个参数真的不在产物里 → 四条必须都报。
		name: 'u) 四个查询参数真被抽掉 → 四条全报',
		art: { ...good, js: good.js.split('q.get("sort");q.get("asc");q.get("category");q.get("page");').join('q.get();') },
		expect: ['查询参数 sort 的字面量', '查询参数 asc 的字面量', '查询参数 category 的字面量', '查询参数 page 的字面量'],
	},
	{
		// ⚠️ 这条是「归一引号」与「抹掉引号」的分水岭。
		// 产物 JS 里有 `sortOrder` / `sorted` / `listSorted`（Nuxt 路由与 useOrderState 的键）、
		// `pageCount` / `ascending`。若照搬 check-affordances 的 replace(/[`'"]/g,'')，
		// 这些标识符会让四个参数全部「命中」——判据直接变成永真式。
		// 保留引号、只归一引号形态，才仍然要求参数是一个**完整的字面量**。
		name: 'v) 只有 sortOrder / pageCount 这类标识符、没有任何字面量 → 四条仍必须报',
		art: { ...good, js: good.js.split('q.get("sort");q.get("asc");q.get("category");q.get("page");').join('e.sortOrder;e.sorted;e.listSorted;e.pageCount;e.ascending;e.categoryList;') },
		expect: ['查询参数 sort 的字面量', '查询参数 asc 的字面量', '查询参数 category 的字面量', '查询参数 page 的字面量'],
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	const got = evaluate(t.art)
	const ok = t.expect.length === 0
		? got.length === 0
		// ⚠️ 这里原来写的是 `got.every(k => got.some(g => g.includes(k)))`——
		// 迭代的是 `got` 而不是 `t.expect`，于是「每条问题都被某条问题包含」
		// 恒真（空数组的 every 也是 true）：**自检永远不会失败**，判据坏了也照样出结论。
		// 本门禁的另外两道（check-flip-gates / check-icon-swap）都是
		// `t.expect.every(k => got.some(g => g.includes(k)))`，此处对齐。
		: t.expect.every(k => got.some(g => g.includes(k)))
	if (!ok) {
		selfOk = false
		console.error(`  自检失败：${t.name}`)
		console.error(`    期望含 [${t.expect.join(', ') || '（无问题）'}]，实得 ${JSON.stringify(got)}`)
	}
	else {
		console.log(`  PASS  ${t.name}`)
	}
}
if (!selfOk) {
	console.error('FAIL: 判据自检不过，判据本身不可信，拒绝输出结论。')
	process.exit(1)
}
console.log(`self-test: ${SELF_TESTS.length} 例全过\n`)

/* ────────────────────────── 实际检查 ────────────────────────── */

if (!statSync(DIST, { throwIfNoEntry: false })) {
	console.error(`FAIL: 找不到产物目录 ${DIST}。先构建再跑本门禁。`)
	process.exit(1)
}

const artifacts = collectArtifacts(DIST)
const problems = evaluate(artifacts)

const pageCount = Object.values(artifacts.pages).filter(Boolean).length
const bytes = arr => arr.reduce((n, s) => n + s.length, 0)
console.log('===== 列表控件接线门禁 =====')
console.log(`  产物：${pageCount} 个页面`)
console.log(`    CSS 外链 ${artifacts.css.length} 字节（仅 _astro/）+ 内联 ${artifacts.inline.css.length} 段 <style>（${bytes(artifacts.inline.css)} 字节）`)
console.log(`    JS  外链 ${artifacts.js.length} 字节 + 内联 ${artifacts.inline.js.length} 段 <script>（${bytes(artifacts.inline.js)} 字节）`)
console.log('  判据只读 dist/，不读源码——源码里有但没被引用的组件，Astro 不会编译。')
console.log('  Astro 7 的内联块与外链同权；标记类判据只认 markupOf()，代码里的字面量不算标记。')
if (DIST !== join(ROOT, 'dist'))
	console.log(`  ⚠ 读的是 ${DIST}（演练模式），不是默认的 dist/`)

if (!problems.length) {
	console.log('\n  PASS: 排序 / 分类 / 分页 / 密度四组控件都已接线，首屏仍是惰性的一页卡片。')
	process.exit(0)
}

console.log(`\n  FAIL: ${problems.length} 处未接线\n`)
for (const p of problems)
	console.log(`    - ${p}`)
console.log('\n  排查顺序：')
console.log('    1. 页面有没有 <script> 监听 partial:change（OrderToggle 派发事件但不自己改列表）')
console.log('    2. 三个字段（category / sortOrder / isAscending）有没有**全部**被消费——只判 category 是本项目的历史缺陷')
console.log('    3. 改 DOM 之前调了 listTransition.refresh() 吗（MutationObserver 拿不到 before rect）')
console.log('    4. 产物 JS 里找不到控制器标记 → 组件没被引用，Astro 根本没编译它')
process.exit(1)
