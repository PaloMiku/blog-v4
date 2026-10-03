#!/usr/bin/env node
/**
 * 门禁：`Component` 围栏必须真的展开成三页签，且**源码栏显示的就是那个文件**。
 *
 * ## 抓的是什么
 *
 * `src/plugins/component-fence.ts` 把
 *
 *     ```Component [Alert.astro]
 *     <Alert …>…</Alert>
 *     ```
 *
 * 展开成 `<Tab>` 的「组件 / 用法 / 源码」三栏。其中两处**坏了不会变红**：
 *
 * 1. **围栏 meta 的配对**。`plugins/prose.ts` 的 `scanFences()` 是去**读 .mdx
 *    原文**扫 info string 的（meta 从 mdast 传不到 hast——Astro 的 shiki 会重建
 *    `<pre>` 只保留自己的属性），`takeMeta()` 再按「同语言、同顺序」配对。
 *    于是插件产出 code 节点的顺序一旦与 `componentFenceInfos()` 不一致，
 *    每个源码栏仍会拿到一个文件名，**只是拿的是别人的**。
 *    页面照常渲染、构建照常成功，没有任何一行日志提到它。
 * 2. **围栏被提前截断**。正文里含三反引号而外层也只写三反引号时，mdast 在第一个
 *    三反引号处闭合，正文缺一大截，剩下的以普通 markdown 身份漏进页面。
 *
 * 两条都是「看起来对、其实错」，所以判据落在**产物**上：把每个源码栏的正文
 * 逐字读回来，和磁盘上那个文件比。配对错了就是内容对不上。
 *
 * ## 源侧判据
 *
 * - `source=` 只允许出现在 `Component` 围栏上：旧写法（空围栏 + `source=`）退役后
 *   残留一个，插件不再填它，源码栏就是一个**空代码块**，而构建是绿的。
 * - `[文件名]` 必须能推到一个存在且非空的文件（默认 `components/content/<文件名>`）。
 * - 正文里的大写组件名必须包含文件名去扩展名——否则是「源码栏配了另一个文件」。
 * - 围栏长度必须严格大于正文里最长的反引号串。
 * - 围栏必须闭合。
 *
 * ## 用法
 *
 *     node scripts/check-component-fence.mjs
 *
 * 退出码：0 = 通过；1 = 有问题；2 = 脚本自身跑不起来（缺 dist 等）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(ROOT, 'src')
const CONTENT = join(SRC, 'content')
const DIST = join(ROOT, 'dist')

/** 源码默认目录，与插件里的同名常量一致 */
const DEFAULT_DIR = 'components/content'

/** 围栏语言，即插件的标记 */
const LANG = 'Component'

const FILENAME_RE = /\[([^\]]+)\]/
const SOURCE_RE = /(?:^|\s)source=(\S+)/
const JSX_TAG_RE = /<\/?\s*([A-Z][\w.-]*)/g

/** 判据用「产物里的出现次数」对「源里的出现次数」，不逐元素配对 */
function fail(problems) {
	for (const p of problems)
		console.error(`  FAIL  ${p}`)
	console.error(`\nRESULT: FAIL - ${problems.length} 处问题`)
	process.exit(1)
}

function fatal(message) {
	console.error(`ERROR: ${message}`)
	console.error('RESULT: ERROR - 门禁自己跑不起来，不算数')
	process.exit(2)
}

/**
 * 扫一个文件里的围栏。
 *
 * ⚠️ 闭合判定与 `plugins/prose.ts` 的 `scanFences()` 保持一致：同字符、
 * 长度不小于开启围栏、**且 info 为空**。围栏里那行带 info 的三反引号
 * （例如 Component 正文里的 ` ```math `）是**正文**，必须原样收进 body，
 * 不能当成别的围栏吞掉。
 */
function scanFences(source) {
	const lines = source.split(/\r?\n/)
	const out = []
	let open = null
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const m = /^\s*(`{3,}|~{3,})/.exec(line)
		if (!m) {
			if (open)
				open.body.push(line)
			continue
		}
		const fence = m[1]
		const info = line.slice(m[0].length).trim()
		if (open) {
			if (fence[0] === open.char && fence.length >= open.len && !info) {
				out.push({ ...open, body: open.body.join('\n') })
				open = null
			}
			else {
				open.body.push(line)
			}
			continue
		}
		open = { char: fence[0], len: fence.length, info, lang: info.split(/\s+/)[0] ?? '', body: [], line: i + 1 }
	}
	return { fences: out, unclosed: open }
}

function walkMdx(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory())
			walkMdx(full, out)
		else if (name.endsWith('.mdx'))
			out.push(full)
	}
	return out
}

function longestBacktickRun(text) {
	let longest = 0
	for (const m of text.matchAll(/`+/g))
		longest = Math.max(longest, m[0].length)
	return longest
}

/**
 * 源文件 → 路由。
 *
 * 与 `content.config.ts` 的 `generateId()` 同一套规则：frontmatter `permalink`
 * 优先，其次相对路径去扩展名、去 `index`，最后按 `hidePostPrefix` 去 `posts/` 前缀。
 * `build.format: 'directory'` ⇒ 产物是 `dist/<route>/index.html`。
 */
function routeOf(file, source) {
	const permalink = /^permalink:\s*(\S+)\s*$/m.exec(source)?.[1]
	if (permalink)
		return permalink.replace(/^\/+|\/+$/g, '')
	let rel = file.replace(CONTENT, '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.[^./]+$/, '')
	rel = rel.replace(/(^|\/)index$/, '$1').replace(/\/+$/, '')
	// hidePostPrefix 从 src/config/blog.ts 里读（那是 TS，node 直接 import 不了）
	const cfg = readFileSync(join(SRC, 'config/blog.ts'), 'utf8')
	const hide = /hidePostPrefix:\s*(true|false)/.exec(cfg)?.[1] === 'true'
	if (hide && rel.startsWith('posts/'))
		rel = rel.slice('posts/'.length)
	return rel
}

function normalizeText(s) {
	return s.replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

function groupBy(list, key) {
	const map = new Map()
	for (const item of list) {
		const k = key(item)
		const bucket = map.get(k)
		if (bucket)
			bucket.push(item)
		else
			map.set(k, [item])
	}
	return map
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&apos;': '\'', '&amp;': '&' }

function decode(s) {
	return s.replace(/&(?:lt|gt|quot|apos|#39|amp);/g, m => ENTITIES[m] ?? m)
}

/** 产物里每个代码块 figure：文件名、语言、正文 */
function figuresOf(html) {
	const out = []
	for (const m of html.matchAll(/<figure class="z-codeblock"[^>]*>([\s\S]*?)<\/figure>/g)) {
		const block = m[1]
		const caption = /<figcaption>([\s\S]*?)<\/figcaption>/.exec(block)?.[1] ?? ''
		const fileM = /<span class="filename">([\s\S]*?)<\/span>/.exec(caption)
		const langM = /<span class="language">([\s\S]*?)<\/span>/.exec(caption)
		const body = block.slice(block.indexOf('</figcaption>') + '</figcaption>'.length)
		out.push({
			filename: fileM ? decode(fileM[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : undefined,
			lang: langM ? langM[1].trim() : undefined,
			text: decode(body.replace(/<[^>]*>/g, '')),
		})
	}
	return out
}

// ── 源侧 ───────────────────────────────────────────────────────────────────
const problems = []
/** 每个含 Component 围栏的源文件 → 该文件的围栏列表（后面拿去对产物） */
const perFile = new Map()

for (const file of walkMdx(CONTENT)) {
	const source = readFileSync(file, 'utf8')
	const { fences, unclosed } = scanFences(source)
	if (unclosed)
		problems.push(`${file}:${unclosed.line} 围栏没有闭合（起始于第 ${unclosed.line} 行）`)

	const demos = []
	for (const fence of fences) {
		if (fence.lang !== LANG) {
			// 旧写法退役后残留：插件不再填它，源码栏是空的，而构建是绿的
			if (SOURCE_RE.test(fence.info))
				problems.push(`${file}:${fence.line} 还有非 Component 围栏带 source=（旧写法已退役）：${fence.info}`)
			continue
		}

		const filename = FILENAME_RE.exec(fence.info)?.[1]
		if (!filename) {
			problems.push(`${file}:${fence.line} Component 围栏缺 [文件名]：${fence.info || '(空)'}`)
			continue
		}

		const rel = SOURCE_RE.exec(fence.info)?.[1] ?? `${DEFAULT_DIR}/${filename}`
		const abs = join(SRC, rel)
		if (!abs.startsWith(SRC)) {
			problems.push(`${file}:${fence.line} source=${rel} 逃出 src/`)
			continue
		}
		let content
		try {
			content = readFileSync(abs, 'utf8')
		}
		catch {
			problems.push(`${file}:${fence.line} 读不到 ${rel}（[${filename}] 的默认路径是 ${DEFAULT_DIR}/<文件名>，不在那儿就补 source=）`)
			continue
		}
		if (!content.trim())
			problems.push(`${file}:${fence.line} ${rel} 是空文件`)

		const body = normalizeText(fence.body)
		if (!body)
			problems.push(`${file}:${fence.line} [${filename}] 围栏正文是空的`)

		const names = new Set([...body.matchAll(JSX_TAG_RE)].map(m => m[1]))
		if (names.size && !names.has(filename.replace(/\.[^.]+$/, '')))
			problems.push(`${file}:${fence.line} [${filename}] 与正文的组件（${[...names].join(' / ')}）对不上`)

		const run = longestBacktickRun(body)
		if (fence.len <= run)
			problems.push(`${file}:${fence.line} [${filename}] 围栏只有 ${fence.len} 个反引号，正文里有 ${run} 连的，正文会被截断`)

		demos.push({ line: fence.line, filename, rel, source: normalizeText(content), body })
	}
	if (demos.length)
		perFile.set(file, demos)
}

if (!perFile.size) {
	console.log('OK: src/content 下没有 Component 围栏')
	process.exit(0)
}
if (problems.length)
	fail(problems)

// ── 产物侧 ─────────────────────────────────────────────────────────────────
if (!statSync(DIST).isDirectory())
	fatal('dist/ 不存在，先 pnpm build')

for (const [file, demos] of perFile) {
	const source = readFileSync(file, 'utf8')
	const route = routeOf(file, source)
	const htmlPath = join(DIST, route, 'index.html')
	let html
	try {
		html = readFileSync(htmlPath, 'utf8')
	}
	catch {
		fail([`${file} 推导出路由 /${route}，但产物 ${htmlPath.slice(ROOT.length + 1)} 不存在`])
	}

	const figures = figuresOf(html)
	for (const demo of demos) {
		const label = `${file}:${demo.line} [${demo.filename}]`

		// 源码栏：图注文件名要对，内容还要**逐字**等于磁盘上那个文件。
		// 只比文件名抓不到配对错位——错位时两边都还「有名字」。
		// 按名字分组而不是逐个围栏找：同一个组件可以在页面里演示多次
		// （LinkCard 就有两处），那时「恰好一个」是错的判据。
		const byName = figures.filter(f => f.filename === demo.filename)
		if (byName.length === 0)
			fail([`${label} 产物里没有图注为 ${demo.filename} 的源码栏`])
		for (const f of byName) {
			if (normalizeText(f.text) !== demo.source) {
				/*
				 * 只陈述量到的事实。内容不符有两种可能，症状一样：
				 *   (a) 注入的就是被截断/写错的源码；
				 *   (b) 图注与内容配错位（顺序对不上）。
				 */
				fail([`${label} 源码栏内容与 ${demo.rel} 对不上（产物 ${normalizeText(f.text).split('\n').length} 行 / 磁盘 ${demo.source.split('\n').length} 行）——要么注入的内容本身不对，要么图注与内容配错了位`])
			}
		}

		// 用法栏：正文原文，一个不带文件名的 mdx 代码块
		const usage = figures.filter(f => f.lang === 'mdx' && !f.filename && normalizeText(f.text) === demo.body)
		if (usage.length === 0)
			fail([`${label} 产物里找不到与围栏正文逐字相同的「用法」代码块`])
	}

	// 数量对账：同名源码栏的个数必须等于引用它的围栏个数。
	// 「少」= 有围栏没展开；「多」= 别的围栏抢走了这个名字。
	for (const [name, group] of groupBy(demos, d => d.filename)) {
		const got = figures.filter(f => f.filename === name).length
		const want = group.length
		if (got !== want)
			fail([`${file}: 图注为 ${name} 的源码栏有 ${got} 个，引用它的 Component 围栏有 ${want} 个`])
	}
}

const total = [...perFile.values()].reduce((n, d) => n + d.length, 0)
console.log(`OK: ${total} 个 Component 围栏（${perFile.size} 个文件）——三页签都展开，源码栏与磁盘文件逐字一致。`)
process.exit(0)
