#!/usr/bin/env node
/**
 * 静态检查：有没有 CSS 规则在编译时**整条消失**，以及代码块折叠按钮是不是单行。
 *
 * ═══ 这道门禁为什么存在 ═══
 *
 * `src/components/content/Chat.astro` 曾经把四条规则写成**顶层裸子代选择器**：
 *
 *     > .chat-body { … padding: 0 1em; max-width: 90%; … }
 *
 * 花括号深度 0 的 `> …` 是**非法**的顶层 CSS。压缩器在顶层遇到 `>` 会把整条
 * 规则丢掉，**一声不吭**——构建全绿、类型全对、页面大体能看。
 * 编译产物里当时只剩下：
 *
 *     .chat[data-astro-cid-knx2e2po]{margin-inline:2vw;font-size:.9em}
 *
 * `chat-body` / `chat-caption` / `chat-myself` **一个都不在**。
 * 实测代价：`dd.chat-body` 的 padding / max-width / margin-bottom 全是初始值，
 * 会话体恒宽 688px 且永不换行，一个页面凭空多出 267px。
 *
 * ═══ 为什么已有门禁没抓到 ═══
 *
 * `audit-dead-scope.mjs` 那一类门禁的判据是「产物里的这条选择器有没有匹配到
 * 元素」。本缺陷里那条规则**压根不在产物里**——不是写错了选择器，而是整条蒸发。
 * 「产物里没有它」与「产物里有它但不匹配」是两回事，前者不在那套判据的射程内。
 * `audit-css-blocks.mjs` 也抓不到：它看的是**顶层裸声明**（`;`）与花括号配对，
 * 而 `> .chat-body {` 结构上完全合法（花括号是配对的），只是在语义上非法。
 *
 * 所以这里补的是**第三条判据**：顶层裸子代选择器。
 *
 * ═══ 判据 ═══
 *
 *  1. **顶层裸 `> selector`**：任意 `.astro` 的 `<style>` 块里，花括号深度 0
 *     处出现以 `>` 开头的规则 → 报。深度 ≥1 的 `> .x` 是**正常**的
 *     （`PostSurround.astro:95` 就靠它编译成 `&>.surround-text`），不报。
 *  2. **编译产物形状**：直接调 Astro 编译器（`@astrojs/compiler-rs` 的
 *     `parse()` / `transform()`，与 astro 同版本）编译 Chat.astro，断言
 *     `chat-caption` / `chat-body` / `chat-system` / `chat-myself` 四条规则
 *     **确实在编译后的 CSS 里**，且带着当初被吞掉的那几个声明
 *     （`max-width:90%` / `padding:0 1em` / `white-space:pre-wrap` …）。
 *     判据 1 抓的是「写法」，判据 2 抓的是「结果」，两条都要。
 *  3. **折叠按钮单行**：直接跑**真实的** `rehypeProseChrome()`（注册一个解析钩子
 *     补 TS 后缀扩展名），喂一段 40 行的合成代码块，拿到真正产出的 hast，然后断言
 *     按钮有 ≥2 个元素子节点（`button > .iconify:only-child` 因此不可能命中，
 *     图标回到 `:where(.iconify)` 的 inline-block，与文字同行），
 *     且 `collapsed` / `is-collapsed` / `aria-label` 三处**一起**在构建期就位。
 *
 * ═══ 为什么判据 3 不用「产物里数一下」 ═══
 *
 * 折叠按钮曾经 6 个页面实测 40.78px vs 线上 24.47px，每个块多 16.31px
 * （两个块 +33px，差值正好是行数 × 16.31）。那是对**真实渲染**的测量，
 * 而这道门禁不跑浏览器也不读 `dist/`：它把**产物 hast** 当数据检查。
 * 这不是削弱——`:only-child` 成不成立、图标是不是 `display:block`，
 * 全部由「按钮有几个元素子节点」这一个事实决定，不需要排版引擎。
 *
 * ═══ 一个必须防的作弊 ═══
 *
 * 判据 3 绝不能写成「图标最终不是 block」这种宽泛检查——加一条
 * `svg { display: block }` 也能让它通过，而实际把行高推得更糟。
 * `:where()` 是**零特异性**（`main.css:87` 的 `:where(.iconify)`），
 * 任何裸标签/通配选择器都能盖掉它，`Tip.astro` 图标被永久清空就是同一族的坑。
 * 所以判据 3 是**合取**：元素子节点数 + `:only-child` 规则仍然是窄的 +
 * 没有任何规则给图标下非 `:only-child` 的 `display`。
 * 少任何一条，这道门禁都会在「按钮已经坏了」的产物上放行。
 *
 * ═══ 自检 ═══
 *
 * 三条判据各带正反用例，用例里有**本仓库真实损坏的那一段**。
 * 判据自己判错的时候，门禁就是在教人忽略红灯——那比没门禁更糟，
 * 所以自检不过直接 exit 1、不输出任何结论。
 *
 * 用法：
 *   node scripts/check-dropped-css.mjs              # 真跑
 *   node scripts/check-dropped-css.mjs --inject-fault   # 负控制：注入缺陷，**应该红**
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, relative } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')
const SRC = join(ROOT, 'src')
const CHAT_REL = 'components/content/Chat.astro'
const CHAT_ABS = join(SRC, CHAT_REL)

/* ══════════════════════════ 通用 CSS 工具 ══════════════════════════ */

/**
 * 把注释与字符串**抹成等长空白**（保留换行，行号才不会错位）。
 *
 * 不抹就会两处误判：
 *   - `/* > .fake { *\/` 注释里的 `> .fake {` 被当成真规则
 *   - `content: "}"` 里的分号/花括号破坏深度计数
 * 抹成等长而不是删掉，是为了报错时给的行号仍然指向真实位置。
 */
function maskNonCode(css) {
	const chars = [...css]
	let i = 0
	const blank = (from, to) => {
		for (let k = from; k < to && k < chars.length; k++) {
			if (chars[k] !== '\n')
				chars[k] = ' '
		}
	}
	while (i < chars.length) {
		const c = css[i]
		if (c === '/' && css[i + 1] === '*') {
			const end = css.indexOf('*/', i + 2)
			const stop = end === -1 ? css.length : end + 2
			blank(i, stop)
			i = stop
		}
		else if (c === '"' || c === '\'') {
			let j = i + 1
			while (j < css.length && css[j] !== c) {
				if (css[j] === '\\')
					j++
				j++
			}
			blank(i, Math.min(j + 1, css.length))
			i = j + 1
		}
		else {
			i++
		}
	}
	return chars.join('')
}

/**
 * 剥掉 frontmatter，避免把注释里字面写的 `<style>` 当成真块。
 *
 * 一并返回**删掉的行数**：不返回的话，`<style>` 块里的行号全是块内相对行号，
 * 报错会指到 `Chat.astro:7` 这种地方（真实位置在 60 行之后）——
 * 指错行的门禁，用两次就没人看了。
 */
function stripFrontmatter(text) {
	const lines = text.split('\n')
	if (lines[0].replace(/^\uFEFF/, '').trim() !== '---')
		return { text, removed: 0 }
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '---')
			return { text: lines.slice(i + 1).join('\n'), removed: i + 1 }
	}
	return { text, removed: 0 }
}

function countLines(s) {
	let n = 0
	for (const ch of s) {
		if (ch === '\n')
			n++
	}
	return n
}

/** 只认行首的 `<style`，行内文字提及不算（`FeedCard.astro` 的注释里就写了 `<style>`） */
function styleBlocks(text) {
	const { text: body, removed } = stripFrontmatter(text)
	const opens = [...body.matchAll(/^<style[^>]*>/gm)]
	return opens.map((m) => {
		const from = m.index + m[0].length
		const close = body.indexOf('</style>', from)
		return {
			body: close === -1 ? body.slice(from) : body.slice(from, close),
			// 块体**紧接在 `<style>` 同一行的尾部开始**，所以块内第 n 行
			// 对应文件第 lineBase + n 行。少算一行，报错就会指到上一行。
			lineBase: removed + countLines(body.slice(0, from)),
		}
	})
}

/* ══════════════════════════ 判据 1：顶层裸 `> selector` ══════════════════════════ */

function scanTopLevelCombinator(rawCss) {
	const findings = []
	const css = maskNonCode(rawCss)
	let depth = 0
	let segStart = 0
	for (let i = 0; i < css.length; i++) {
		const c = css[i]
		if (c === '{') {
			if (depth === 0) {
				const selector = css.slice(segStart, i).trim()
				// 深度 0 的裸子代选择器：非法顶层 CSS，压缩器会**整条丢弃**
				if (selector.startsWith('>')) {
					findings.push({
						line: css.slice(0, i).split('\n').length,
						selector: selector.replace(/\s+/g, ' '),
					})
				}
			}
			depth++
		}
		else if (c === '}') {
			depth--
			if (depth < 0)
				depth = 0
			if (depth === 0)
				segStart = i + 1
		}
		else if (c === ';' && depth === 0) {
			segStart = i + 1
		}
	}
	return findings
}

/* ══════════════════════════ 判据 2：Chat 的编译产物形状 ══════════════════════════ */

/**
 * Chat 四条规则在**编译后**必须带着这些声明。
 *
 * 声明是从当初 267px 的实测差距里挑的「失效即肉眼可见」的几条，
 * 不是随手抄的：`max-width` / `padding` / `white-space` 三个一掉，
 * 会话体立刻变成恒宽不换行，正是当时量到的 688px。
 */
const CHAT_RULES = [
	{ cls: 'chat-caption', decls: [[/opacity:\s*\.8/], [/font-size:\s*\.9em/]] },
	{
		cls: 'chat-body',
		decls: [[/max-width:\s*90%/], [/margin-bottom:\s*1em/], [/padding:\s*0\s+1em/], [/white-space:\s*pre-wrap/]],
	},
	{ cls: 'chat-system', decls: [[/text-align:\s*center/], [/margin-bottom:\s*1em/]] },
	{ cls: 'chat-myself', decls: [[/text-align:\s*end/], [/margin-inline-start:\s*auto/]] },
]

/**
 * 在编译后的 CSS 里找 `.chat-*` 的规则块。
 *
 * 编译产物形如
 *     .chat[data-astro-cid-x] { … & > .chat-body[data-astro-cid-x] { … } }
 * ——嵌套**没有被展平**，`& >` 里的空格也可能是 `&>`（`PostSurround.astro`
 * 编译出来就是 `&>.surround-text`），所以一律用正则而不是字符串 includes。
 */
function findChatRule(css, cls) {
	const head = new RegExp(`(^|[,{}\\s&])>\\s*\\.${cls}\\b`)
	const start = head.exec(css)
	if (!start)
		return undefined
	const open = css.indexOf('{', start.index)
	if (open === -1)
		return undefined
	// 从这个 `{` 起做深度配对，取出规则体
	let depth = 0
	for (let i = open; i < css.length; i++) {
		if (css[i] === '{') {
			depth++
		}
		else if (css[i] === '}') {
			depth--
			if (depth === 0) {
				return css.slice(open + 1, i)
			}
		}
	}
	return undefined
}

function checkCompiledChat(compiledCss) {
	const findings = []
	for (const rule of CHAT_RULES) {
		const body = findChatRule(compiledCss, rule.cls)
		if (body === undefined) {
			findings.push(`${rule.cls}：编译产物里没有「父选择器 > .${rule.cls}」这条规则——整条被丢弃了`)
			continue
		}
		const flatBody = body.replace(/\s+/g, ' ')
		const missing = rule.decls.filter(([re]) => !re.test(flatBody)).map(([re]) => String(re))
		if (missing.length) {
			findings.push(`${rule.cls}：规则在，但声明缺失 ${missing.join(' / ')}`)
		}
	}
	return findings
}

/* ══════════════════════════ 判据 3：折叠按钮单行 ══════════════════════════ */

/**
 * 深度感知的规则收集器：记下每条规则的选择器、规则体、以及**外层选择器链**。
 *
 * 父链是判据 3 的关键：`> .iconify:only-child { display:block }` 单独看无害，
 * 只有知道它挂在 `button` 里面，才能判断「按钮有两个元素子节点」失配的正是它。
 * ⚠️ 第一版按深度索引记父链，对最外层内规则算出的是**空数组**，
 * 于是「这条规则挂在 button 下吗」永远为否，判据 3 在真数据上立刻误报。
 * 正确做法是 `>` 出现时 `pop()` 掉**自己**，剩下的 `selStack` 天然就是父链。
 */
function collectRules(rawCss) {
	const css = maskNonCode(rawCss)
	const out = []
	const selStack = []
	const bodyStack = []
	let segStart = 0
	for (let i = 0; i < css.length; i++) {
		const c = css[i]
		if (c === '{') {
			selStack.push(css.slice(segStart, i).trim())
			bodyStack.push('')
			segStart = i + 1
		}
		else if (c === '}') {
			const sel = selStack.pop()
			const body = (bodyStack.pop() ?? '') + css.slice(segStart, i)
			if (sel !== undefined) {
				out.push({ sel, body, parents: selStack.slice() })
			}
			segStart = i + 1
		}
		else if (bodyStack.length) {
			bodyStack[bodyStack.length - 1] += c
		}
		else if (c === ';') {
			// 顶层只可能是选择器或 @import 这类以 `;` 结尾的语句。
			// ⚠️ 这里**不能**像第一版那样对每个字符都推进 segStart：
			// 那会把 `button {` 的选择器记成最后一个字符（实测记成空串），
			// 于是「这条规则挂在 button 下吗」永远为否，判据 3 立刻误报。
			segStart = i + 1
		}
	}
	return out
}

/** 图标类名：`.iconify` 是 `main.css:87` 尺寸契约的载体，丢了就退回 1em 且不沉底 */
function classesOf(node) {
	const c = node?.properties?.class
	if (Array.isArray(c))
		return c.map(String)
	if (typeof c === 'string')
		return c.split(/\s+/).filter(Boolean)
	return []
}

/**
 * 判据 3 的核心：`button` 的两个元素子节点是否真的能让 `:only-child` 失配。
 *
 * 拆成三个**互相独立、缺一不可**的合取项：
 *  1. 元素子节点 ≥2 → `button > .iconify:only-child` 不可能命中
 *  2. `button` 下面那条 `.iconify:only-child{display:block}` 规则**仍然是窄的**
 *     （一旦去掉 `:only-child`，第 1 条就成了无用功，图标照样 block）
 *  3. 项目 CSS 里没有任何**别的**规则给图标下非 block 的 display
 *     （防 `svg { display: block }` / `button > * { display: block }` 这类作弊）
 */
function checkToggleButton(render, styles) {
	const findings = []
	const { figure, button } = render
	const elementKids = (button.children ?? []).filter(c => c.type === 'element')
	if (elementKids.length < 2) {
		findings.push(
			`折叠按钮只有 ${elementKids.length} 个元素子节点（Nuxt 是 2 个：图标 + 文案 span）`
			+ '→ `button > .iconify:only-child` 成立，图标 display:block 独占一行，每个块多一行',
		)
	}

	const icon = elementKids[0]
	const iconClasses = classesOf(icon)
	if (!iconClasses.includes('iconify')) {
		findings.push(`折叠按钮的第一个元素子节点没有 iconify 类（实得 ${iconClasses.join(' ') || '（无）'}）`)
	}

	const figureClasses = classesOf(figure)
	if (!figureClasses.includes('collapsed')) {
		findings.push(
			`figure 缺少 collapsed（实得「${figureClasses.join(' ')}」）`
			+ '→ SSR 产物是展开的，要等 prose-enhance 的 initCodeCollapse 跑完才折叠',
		)
	}
	if (!figureClasses.includes('collapsible')) {
		findings.push(`figure 缺少 collapsible（实得「${figureClasses.join(' ')}」）`)
	}
	// collapsed 一旦在构建期就位，initCodeCollapse 开头那个 continue 会整块跳过，
	// 所以 is-collapsed / aria-label 必须**同时**在构建期做掉，否则箭头永远不旋转。
	if (!iconClasses.includes('is-collapsed')) {
		findings.push('折叠按钮的图标缺少 is-collapsed → prose.css:247 的 rotate(180deg) 不会生效，箭头方向反了')
	}
	if (button.properties?.['aria-label'] !== '展开代码块') {
		findings.push(`折叠按钮 aria-label 应为「展开代码块」（实得「${button.properties?.['aria-label']}」）`)
	}

	const all = styles.flatMap(s => collectRules(s.css))
	const onlyChildRule = all.find(r =>
		r.parents.some(p => /(?:^|[\s,>])button$/.test(p.trim()))
		&& /\.iconify:only-child/.test(r.sel)
		&& /display:\s*block/.test(r.body),
	)
	if (!onlyChildRule) {
		findings.push(
			'在项目 CSS 里找不到 `button > .iconify:only-child { display: block }` 这条规则'
			+ '——它被删掉或改宽了，「元素子节点 ≥2」这套推理的前提就没了，必须重新确认按钮形状',
		)
	}

	/*
	 * 只拦**块级** display。必须锚在值的开头：`inline-block` 里含 "block"，
	 * 第一版用 `/\s*(block|flex|…)/` 去 test，结果把
	 * `main.css:87` 的 `:where(.iconify){display:inline-block}`——**那条规则的
	 * 存在本身就是我们要的**——报成了缺陷，真数据上当场误报。
	 * `inline-block` 走的是行内格式化上下文，不会自己换行，恰恰是想要的结果。
	 */
	const BLOCK_LEVEL = /^\s*(?:block|flow-root|list-item|flex|grid|table)\b/
	for (const r of all) {
		const display = /display:\s*([^;}]+)/.exec(r.body)
		if (!display || !BLOCK_LEVEL.test(display[1]))
			continue
		if (/\.iconify:only-child/.test(r.sel))
			continue // 这就是上面那条「合法的窄规则」，由元素子节点数来失配
		if (!/\.iconify|\.toggle-icon|\bsvg\b/.test(r.sel))
			continue
		findings.push(
			`有一条规则会给图标上块级 display：「${r.sel.replace(/\s+/g, ' ')}」→ display:${display[1].trim()}`
			+ '（`:where()` 是零特异性，裸标签/通配选择器能盖掉 `.iconify` 的 inline-block）',
		)
	}

	return findings
}

/* ══════════════════════════ 驱动真实的构建期代码 ══════════════════════════ */

/**
 * 让 Node 能 import `src` 下的 `.ts`（`src\**\/*.ts`）。
 *
 * `src/plugins/prose.ts` 内部用的是**无扩展名**相对导入（`'../lib/app-config'`），
 * 那是 Vite 的解析方式，原生 ESM 不认，于是直接 import 会 ERR_MODULE_NOT_FOUND。
 * 这里补 `.ts` 与 `/index.ts` 两个候选即可——不引第三方 loader，也不起构建。
 */
function registerTsResolver() {
	registerHooks({
		resolve(spec, ctx, next) {
			if (spec.startsWith('.') && !/\.(?:[cm]?[jt]sx?|astro|css|json)$/.test(spec)) {
				for (const cand of [`${spec}.ts`, `${spec}/index.ts`]) {
					try {
						return next(cand, ctx)
					}
					catch {
						// 试下一个候选
					}
				}
			}
			return next(spec, ctx)
		},
	})
}

/** 找 @astrojs/compiler-rs：它是 astro 的传递依赖，版本必须与 astro 同一条 */
function resolveAstroCompiler() {
	const pnpm = join(ROOT, 'node_modules', '.pnpm')
	let entries = []
	try {
		entries = readdirSync(pnpm)
	}
	catch {
		return undefined
	}
	const dir = entries.filter(n => n.startsWith('@astrojs+compiler-rs@')).sort().pop()
	if (!dir)
		return undefined
	const file = join(pnpm, dir, 'node_modules', '@astrojs', 'compiler-rs', 'dist', 'index.mjs')
	try {
		statSync(file)
	}
	catch {
		return undefined
	}
	return file
}

async function compileAstro(source, filename) {
	const file = resolveAstroCompiler()
	if (!file) {
		// 拿不到判据数据就**不判通过**：这正是 compare-page-heights 的教训
		throw new Error('找不到 @astrojs/compiler-rs（astro 的传递依赖），无法编译 Chat.astro')
	}
	const compiler = await import(pathToFileURL(file).href)
	try {
		// parse() 只为拿诊断；transform() 收的是**源码字符串**，传 AST 会直接抛
		const parsed = compiler.parse(source, { position: true })
		const result = await compiler.transform(source, { filename, scopedStyleStrategy: 'attribute' })
		return {
			css: (Array.isArray(result.css) ? result.css : [result.css ?? '']).join('\n'),
			styleError: result.styleError,
			diagnostics: parsed?.diagnostics ?? result.diagnostics ?? [],
		}
	}
	catch (e) {
		// wasm 报错会把整个 AST 塞进 message，直接抛会把控制台刷爆
		throw new Error(`编译 ${filename} 失败：${String(e?.message ?? e).split('\n')[0]}`)
	}
}

/**
 * 真的跑一遍 `rehypeProseChrome()`，拿它产出的 hast。
 *
 * 用合成的 40 行代码块（`CODEBLOCK.triggerRows` 是 32，越界才 collapsible），
 * `file` 传空对象 → `readFenceMetas` 返回空 meta，于是没有 filename / wrap / expand，
 * 正好是「最普通的可折叠代码块」，与线上 12 个折叠块同形。
 */
async function renderCollapsibleCodeBlock() {
	registerTsResolver()
	const { rehypeProseChrome } = await import(pathToFileURL(join(SRC, 'plugins', 'prose.ts')).href)
	const run = rehypeProseChrome()
	const rows = 40
	const source = Array.from({ length: rows }, (_, i) => `echo line ${i + 1}`).join('\n')
	const tree = {
		type: 'root',
		children: [{
			type: 'element',
			tagName: 'pre',
			properties: { 'data-language': 'bash' },
			children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: source }] }],
		}],
	}
	await run(tree, {})
	const figure = tree.children[0]
	const button = (figure.children ?? []).find(
		c => c.type === 'element' && c.tagName === 'button' && classesOf(c).includes('toggle-btn'),
	)
	if (!button)
		throw new Error('合成代码块没有产出折叠按钮——判据 3 无数据可判')
	return { figure, button }
}

/** 把 hast 的元素子节点渲染成一行人类可读的形状，用来自证 DOM 长什么样 */
function describeButton(button) {
	return (button.children ?? [])
		.map((c) => {
			if (c.type !== 'element')
				return `#text(${JSON.stringify(String(c.value).slice(0, 28))}…)`
			const cls = classesOf(c)
			return `<${c.tagName}${cls.length ? ` class="${cls.join(' ')}"` : ''}>`
		})
		.join(' ')
}

/* ══════════════════════════ 负控制：本仓库真实损坏的那一段 ══════════════════════════ */

/** Chat.astro 修复前的 `<style>` 原文，逐字取自当时的文件 */
const CHAT_BROKEN_STYLE = `
	.chat {
		margin-inline: 2vw;
		font-size: 0.9em;
	}

	> .chat-caption {
		opacity: 0.8;
		font-size: 0.9em;
	}

	> .chat-body {
		overflow: hidden; /* BFC */
		width: fit-content;
		max-width: 90%;
		margin-bottom: 1em;
		padding: 0 1em;
		border-radius: 1em;
		border-start-start-radius: 0.2em;
		background-color: var(--c-bg-2);
		/* body 内的反斜杠换行（\`\\\` 结尾）依赖 pre-wrap */
		white-space: pre-wrap;
	}

	> .chat-system {
		margin-bottom: 1em;
		text-align: center;
	}

	> .chat-myself {
		text-align: end;

		& + .chat-body {
			margin-inline-start: auto;
			border-radius: 1em;
			border-start-end-radius: 0.2em;
			background-color: var(--c-primary-soft);
		}
	}
`

/** 把真实文件里的 `<style>` 换回损坏版本，得到「缺陷版」的 Chat.astro */
function injectChatFault(chatSource) {
	const open = /<style[^>]*>/.exec(chatSource)
	if (!open)
		return chatSource
	const close = chatSource.indexOf('</style>', open.index)
	return chatSource.slice(0, open.index + open[0].length) + CHAT_BROKEN_STYLE + chatSource.slice(close)
}

/** 把真实产出的按钮还原成修复前那副形状：裸 svg + 裸文本节点、图标不带 is-collapsed */
function injectButtonFault(render) {
	const { figure, button } = render
	const clone = structuredClone({ figure, button })
	clone.figure.properties = { ...clone.figure.properties, class: 'z-codeblock collapsible' }
	const icon = clone.button.children.find(c => c.type === 'element')
	icon.properties = { ...icon.properties, class: classesOf(icon).filter(c => c !== 'is-collapsed').join(' ') }
	const label = clone.button.children.find(c => c.type === 'element' && c.tagName === 'span')
	// 修复前文案是**裸文本节点**，不是 <span>
	clone.button.children = [
		icon,
		{ type: 'text', value: (label?.children?.[0]?.value ?? '') },
	]
	clone.button.properties = { ...clone.button.properties, 'aria-label': '折叠代码块' }
	return clone
}

/* ══════════════════════════ 自检 ══════════════════════════ */

/**
 * 自检里复用的样式片段，形状取自 src/styles 的真实内容。
 *
 * STYLE_MAIN 里那两段都是**契约本身**，不能当缺陷：
 *   - `button > .iconify:only-child{display:block}` 是判据 3 要失配的那条
 *   - `:where(.iconify){display:inline-block}` 是图标的行内排版来源（零特异性）
 */
const STYLE_MAIN = { css: 'button {\n\tcursor: pointer;\n\n\t> .iconify:only-child {\n\t\tdisplay: block;\n\t}\n}\n\n:where(.iconify) {\n\tdisplay: inline-block;\n\tflex-shrink: 0;\n\tfont-size: 1.2em;\n\tvertical-align: sub;\n}\n' }
const STYLE_PROSE = { css: '.z-codeblock .toggle-btn {\n\tdisplay: block;\n\tposition: relative;\n\topacity: 0.3;\n\twidth: 100%;\n\tpadding: 0.2em;\n}\n\n.z-codeblock .toggle-icon {\n\tmargin-inline-end: 0.2em;\n\ttransition: all 0.2s;\n}\n\n.z-codeblock .toggle-icon.is-collapsed {\n\ttransform: rotate(180deg);\n}\n' }

const SELF_TESTS = [
	{
		name: '判据1：修复前的 Chat <style>（真实损坏的那一段）应被报出 4 处',
		run: () => scanTopLevelCombinator(CHAT_BROKEN_STYLE).length,
		expect: 4,
	},
	{
		name: '判据1：修复后的形状（嵌套在 .chat 内）一条都不该报',
		run: () => scanTopLevelCombinator(`
	.chat {
		margin-inline: 2vw;

		> .chat-body {
			max-width: 90%;
		}
	}
`).length,
		expect: 0,
	},
	{
		name: '判据1：报出的行号必须是**文件真实行号**（frontmatter + `<style>` 偏移都要算）',
		run: () => {
			// 造一个和 Chat.astro 同构的文件：3 行 frontmatter、模板 2 行、`<style>` 在第 7 行
			const text = [
				'---',
				'const a = 1',
				'---',
				'',
				'<div>x</div>',
				'',
				'<style>',
				'\t> .fake {',
				'\t\tcolor: red;',
				'\t}',
				'</style>',
				'',
			].join('\n')
			const b = styleBlocks(text)[0]
			return b.lineBase + scanTopLevelCombinator(b.body)[0].line
		},
		expect: 8, // `> .fake {` 就在第 8 行
	},
	{
		name: '判据1：同款写法在深度 1（PostSurround.astro 的真实形态）不报',
		run: () => scanTopLevelCombinator(`
	.surround {
		color: red;

		> .surround-text {
			color: blue;
		}
	}
`).length,
		expect: 0,
	},
	{
		name: '判据1：@media 内部的 `> .x` 深度是 1，不报',
		run: () => scanTopLevelCombinator('@media (width < 600px) {\n\t> .x {\n\t\tcolor: red;\n\t}\n}\n').length,
		expect: 0,
	},
	{
		name: '判据1：注释里字面写的 `> .fake {` 不算',
		run: () => scanTopLevelCombinator('/* 历史写法：> .fake { color: red } */\n.a {\n\tcolor: red;\n}\n').length,
		expect: 0,
	},
	{
		name: '判据1：自定义属性与普通顶层规则不报',
		run: () => scanTopLevelCombinator('--x: 1;\n.a {\n\tcolor: red;\n}\n').length,
		expect: 0,
	},
	{
		name: '判据2：编译产物里四条规则齐、声明齐 → 无 finding',
		run: () => checkCompiledChat(`
.chat[data-astro-cid-a] {
  & > .chat-caption[data-astro-cid-a] { opacity: .8; font-size: .9em; }
  & > .chat-body[data-astro-cid-a] { max-width: 90%; margin-bottom: 1em; padding: 0 1em; white-space: pre-wrap; }
  & > .chat-system[data-astro-cid-a] { margin-bottom: 1em; text-align: center; }
  & > .chat-myself[data-astro-cid-a] { text-align: end; & + .chat-body[data-astro-cid-a] { margin-inline-start: auto; } }
}`).length,
		expect: 0,
	},
	{
		name: '判据2：只剩 .chat{}（修复前的真实产物形状）→ 4 条全报',
		run: () => checkCompiledChat('.chat[data-astro-cid-a] {\n  margin-inline: 2vw;\n  font-size: .9em;\n}').length,
		expect: 4,
	},
	{
		name: '判据2：规则在但 max-width 掉了 → 仍要报（不能只看选择器在不在）',
		run: () => checkCompiledChat(`
.chat[data-astro-cid-a] {
  & > .chat-caption[data-astro-cid-a] { opacity: .8; font-size: .9em; }
  & > .chat-body[data-astro-cid-a] { margin-bottom: 1em; padding: 0 1em; white-space: pre-wrap; }
  & > .chat-system[data-astro-cid-a] { margin-bottom: 1em; text-align: center; }
  & > .chat-myself[data-astro-cid-a] { text-align: end; & + .chat-body[data-astro-cid-a] { margin-inline-start: auto; } }
}`).length,
		expect: 1,
	},
	{
		name: '判据2：`&>` 无空格的写法也要认（PostSurround 编译出来就是这种）',
		run: () => checkCompiledChat(`
.chat[data-astro-cid-a] {
  &>.chat-caption[data-astro-cid-a] { opacity: .8; font-size: .9em; }
  &>.chat-body[data-astro-cid-a] { max-width: 90%; margin-bottom: 1em; padding: 0 1em; white-space: pre-wrap; }
  &>.chat-system[data-astro-cid-a] { margin-bottom: 1em; text-align: center; }
  &>.chat-myself[data-astro-cid-a] { text-align: end; &+.chat-body[data-astro-cid-a] { margin-inline-start: auto; } }
}`).length,
		expect: 0,
	},
	{
		name: '判据3：真数据形状（main.css 原文 + 修好的按钮）→ 一条都不该报',
		run: () => checkToggleButton({
			figure: { properties: { class: 'z-codeblock collapsed collapsible' } },
			button: {
				properties: { 'aria-label': '展开代码块' },
				children: [
					{ type: 'element', tagName: 'svg', properties: { class: 'iconify toggle-icon is-collapsed' } },
					{ type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: '40 lines' }] },
				],
			},
		}, [STYLE_MAIN, STYLE_PROSE]).length,
		expect: 0,
	},
	{
		name: '判据3：按钮只有 1 个元素子节点（修复前形状）→ 必报',
		run: () => checkToggleButton({
			figure: { properties: { class: 'z-codeblock collapsed collapsible' } },
			button: {
				properties: { 'aria-label': '展开代码块' },
				children: [
					{ type: 'element', tagName: 'svg', properties: { class: 'iconify toggle-icon is-collapsed' } },
					{ type: 'text', value: ' 40 lines' },
				],
			},
		}, [STYLE_MAIN]).length > 0,
		expect: true,
	},
	{
		name: '判据3：加了 `svg { display:block }` 作弊 → 必报（防零特异性陷阱）',
		run: () => checkToggleButton({
			figure: { properties: { class: 'z-codeblock collapsed collapsible' } },
			button: {
				properties: { 'aria-label': '展开代码块' },
				children: [
					{ type: 'element', tagName: 'svg', properties: { class: 'iconify toggle-icon is-collapsed' } },
					{ type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: '40 lines' }] },
				],
			},
		}, [STYLE_MAIN, { css: 'svg {\n\tdisplay: block;\n}\n' }]).length > 0,
		expect: true,
	},
	{
		name: '判据3：`:only-child` 被去掉（规则被改宽）→ 必报，元素子节点数不再顶用',
		run: () => checkToggleButton({
			figure: { properties: { class: 'z-codeblock collapsed collapsible' } },
			button: {
				properties: { 'aria-label': '展开代码块' },
				children: [
					{ type: 'element', tagName: 'svg', properties: { class: 'iconify toggle-icon is-collapsed' } },
					{ type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: '40 lines' }] },
				],
			},
		}, [{ css: 'button {\n\t> .iconify {\n\t\tdisplay: block;\n\t}\n}\n' }]).length > 0,
		expect: true,
	},
	{
		name: '判据3：collapsed 只在客户端补（SSR 缺）→ 必报',
		run: () => checkToggleButton({
			figure: { properties: { class: 'z-codeblock collapsible' } },
			button: {
				properties: { 'aria-label': '折叠代码块' },
				children: [
					{ type: 'element', tagName: 'svg', properties: { class: 'iconify toggle-icon' } },
					{ type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: '40 lines' }] },
				],
			},
		}, [STYLE_MAIN]).length > 0,
		expect: true,
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	let got
	try {
		got = t.run()
	}
	catch (e) {
		selfOk = false
		console.error(`  自检抛异常：${t.name}\n    ${e.message}`)
		continue
	}
	if (got !== t.expect) {
		selfOk = false
		console.error(`  自检失败：${t.name}`)
		console.error(`    期望 ${JSON.stringify(t.expect)}，实得 ${JSON.stringify(got)}`)
	}
}
if (!selfOk) {
	console.error('FAIL: 判据自检不过，判据本身不可信，拒绝输出结论。')
	process.exit(1)
}
console.log(`self-test: ${SELF_TESTS.length} 例全过`)

/* ══════════════════════════ 扫描 ══════════════════════════ */

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		const st = statSync(p)
		if (st.isDirectory())
			walk(p, out)
		else if (name.endsWith('.astro'))
			out.push(p)
	}
	return out
}

const INJECT = process.argv.includes('--inject-fault')

async function main() {
	const chatSource = readFileSync(CHAT_ABS, 'utf8')
	const styles = [
		{ name: 'main.css', css: readFileSync(join(SRC, 'styles', 'main.css'), 'utf8') },
		{ name: 'prose.css', css: readFileSync(join(SRC, 'styles', 'prose.css'), 'utf8') },
	]

	/* 判据 1 */
	/*
	 * 判据 1 扫的是**磁盘上的文件**，所以负控制必须让它也吃到注入的缺陷，
	 * 否则判据 1 永远绿，等于「从没被看过变红」——第一版负控制就是这么
	 * 漏掉判据 1 的（注入后判据 1 仍报 OK）。
	 */
	const blocks = []
	for (const f of walk(SRC)) {
		const raw = INJECT && f === CHAT_ABS ? injectChatFault(readFileSync(f, 'utf8')) : readFileSync(f, 'utf8')
		for (const b of styleBlocks(raw))
			blocks.push({ file: f, body: b.body, lineBase: b.lineBase })
	}
	const combinator = []
	for (const b of blocks) {
		for (const hit of scanTopLevelCombinator(b.body)) {
			combinator.push({
				file: relative(ROOT, b.file).replace(/\\/g, '/'),
				line: b.lineBase + hit.line,
				selector: hit.selector,
			})
		}
	}

	/* 判据 2 */
	const chatInput = INJECT ? injectChatFault(chatSource) : chatSource
	const compiled = await compileAstro(chatInput, CHAT_REL)
	const chatFindings = checkCompiledChat(compiled.css)

	/* 判据 3 */
	const render = await renderCollapsibleCodeBlock()
	const renderInput = INJECT ? injectButtonFault(render) : render
	const toggleFindings = checkToggleButton(renderInput, styles)

	const total = combinator.length + chatFindings.length + toggleFindings.length

	if (INJECT)
		console.log('\n########## 负控制：已注入本仓库真实的那两个缺陷 ##########')
	console.log('\n===== 判据 1：顶层裸 `> selector` =====')
	console.log(`  扫描 ${blocks.length} 个 <style> 块`)
	if (!combinator.length) {
		console.log('  OK: 没有花括号深度 0 的裸子代选择器')
	}
	else {
		console.log(`  FAIL: ${combinator.length} 处`)
		for (const f of combinator)
			console.log(`      ${f.file}:${f.line}  ${f.selector}`)
	}

	console.log('\n===== 判据 2：Chat 编译产物形状 =====')
	// wasm 把它当结构体返回，没错时是个**空对象**（真值！），所以不能直接 if 判断
	if (compiled.styleError && Object.keys(compiled.styleError).length)
		console.log(`  编译器 styleError: ${JSON.stringify(compiled.styleError)}`)
	console.log(`  编译后 CSS 共 ${compiled.css.length} 字符，chat-body 出现 ${(compiled.css.match(/chat-body/g) ?? []).length} 次`)
	if (!chatFindings.length) {
		console.log('  OK: chat-caption / chat-body / chat-system / chat-myself 四条规则与关键声明都在')
	}
	else {
		console.log(`  FAIL: ${chatFindings.length} 处`)
		for (const f of chatFindings)
			console.log(`      ${f}`)
	}

	console.log('\n===== 判据 3：折叠按钮单行 =====')
	console.log(`  figure class : ${classesOf(renderInput.figure).join(' ')}`)
	console.log(`  button DOM   : ${describeButton(renderInput.button)}`)
	console.log(`  元素子节点数 : ${(renderInput.button.children ?? []).filter(c => c.type === 'element').length}（Nuxt 是 2）`)
	if (!toggleFindings.length) {
		console.log('  OK: `:only-child` 失配 + collapsed/is-collapsed/aria-label 三处齐备')
	}
	else {
		console.log(`  FAIL: ${toggleFindings.length} 处`)
		for (const f of toggleFindings)
			console.log(`      ${f}`)
	}

	if (INJECT) {
		console.log('\n===== 负控制结论 =====')
		if (total === 0) {
			console.error('  FAIL: 注入了缺陷却一条都没报——判据根本没在工作，这道门禁是假的。')
			process.exit(2)
		}
		console.log(`  OK: 注入缺陷后共报出 ${total} 处，判据确实能变红。`)
		process.exit(1)
	}

	console.log('\n===== 结论 =====')
	if (!total)
		console.log('  OK: 三条判据全过')
	process.exitCode = total ? 1 : 0
}

await main()
