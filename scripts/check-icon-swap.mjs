#!/usr/bin/env node
/**
 * 静态检查：图标在 astro-icon 之下有没有真的换、`<use>` 有没有指向不存在的 symbol。
 *
 * ═══ 这道门禁为什么存在 ═══
 *
 * 站点从 `@nuxt/icon`（响应式 `:name`，客户端换图标）换成了 `astro-icon`
 * （**构建期**渲染内联 SVG，零客户端 JS）。换掉之后，产物长这样：
 *
 *     <svg class="iconify" data-icon="tabler:chevron-down">
 *       <symbol id="ai:tabler:chevron-down">…</symbol>
 *       <use href="#ai:tabler:chevron-down"></use>
 *     </svg>
 *
 * 字形**写死在 `<use href>` 上**。于是所有 `icon.setAttribute('data-icon', …)`
 * 全部变成空操作——按钮文案在换、图标纹丝不动。而这类缺陷：
 *   - 构建全绿、类型全对、页面大体正常；
 *   - `compare-ui-parity` 这类门禁看不见（它不点按钮）；
 *   - `audit-icons.mjs` 也看不见（它只统计**名字**，`data-icon` 改了照样算「用过」）。
 *
 * 更阴的一层是 sprite。astro-icon 只为**本页真实渲染过**的图标发 `<symbol>`
 * （`includeSymbol = i === 0`，计数 cache 挂在 `Astro.locals` 上按页隔离）。
 * 所以「把 `<use href>` 改成另一个名字」这种看起来更聪明的修法，只要那个名字
 * 本页没用过，就会渲染成**空白图标**——比现在的 no-op 更糟，而且更难发现。
 *
 * ═══ 判据 ═══
 *
 *  1. **悬空引用**（最重要的一条）：每页 sprite 里出现的每个 `<symbol id>`，
 *     都要能覆盖该页 HTML 与该页所加载脚本（内联 module + 外链 chunk）里
 *     出现的**每一个** `<use href="#…">` / `#ai:…` 字面量。
 *     Task 2 的空白图标就是被这一条抓住的：`#ai:tabler:message-circle-quote`
 *     写进了产物 JS，而 62 个页面的 sprite 里都没有这个 symbol。
 *  2. **换图标必须是真换**：产物脚本里每一处 `data-icon` 写入，
 *     都必须伴随同一脚本内真实的 `<use href>` 改写（`querySelector('use')`
 *     或 `setAttribute('href'…)`）。只改属性不改 `<use>` 就是空操作。
 *  3. **段落引用按钮的两条路必须一致**：构建期（`plugins/prose.ts` 写进 HTML 的
 *     内联 SVG）与客户端兜底（`prose-enhance.ts` 插的按钮）必须画出同一颗字形。
 *     判据核对构建期那颗的字形是不是约定的 `tabler:message-circle-2`，
 *     并禁止客户端兜底带任何别的 `#ai:…` 图标名。
 *  4. **prose 图标必须带 `iconify`**：`main.css` 的
 *     `:where(.iconify) { font-size:1.2em; vertical-align:sub }` 是尺寸契约，
 *     `lib/prose-icons.ts` 的 `iconElement()` 产物漏掉它就会退回 1em 且不沉底。
 *
 * 只认产物（`dist/`）与一份离线图标集合，不读源码里的实现。
 *
 * ═══ 自检 ═══
 *
 * 判据带 12 个用例，四条判据各测正反两面，外加「页面产物整个缺失」。
 * 判据自己判错的时候，门禁就是在教人忽略红灯——那比没门禁更糟，
 * 所以自检不过直接 exit 1、不输出结论。
 *
 * 用法（需先构建）：
 *   node scripts/check-icon-swap.mjs [--dist dist]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import process from 'node:process'

const require_ = createRequire(import.meta.url)
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1')

/**
 * 段落引用按钮约定的字形。
 *
 * ⚠️ Nuxt 的 ProseP.vue:52 写的是 `tabler:message-circle-quote`，但**该图标不存在**：
 * `@iconify-json/tabler@1.2.41` 里没有它，Iconify API 对 `tabler/message-circle-quote.svg`
 * 也直接 404。取同家族里真实存在的 `tabler:message-circle-2`（圆形 + 左下尾巴的对话气泡）。
 * 这条常量是「两条路必须一致」的唯一裁判，故与 src/plugins/prose.ts 的选择绑定。
 */
const QUOTE_ICON = 'tabler:message-circle-2'

/* ────────────────────────── 产物快照 ────────────────────────── */

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

/** 该页会跑到的脚本：内联 `<script type="module">` + 外链 chunk 的源码 */
function scriptsOf(distDir, html) {
	const out = []
	for (const m of html.matchAll(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)) {
		if (m[1].trim())
			out.push({ origin: 'inline', code: m[1] })
	}
	for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/g)) {
		const full = join(distDir, m[1].replace(/^\//, '').split('?')[0])
		if (statSync(full, { throwIfNoEntry: false }))
			out.push({ origin: m[1], code: readFileSync(full, 'utf8') })
	}
	return out
}

/** 把产物收成一份快照，判据只认这个结构（自检才能喂合成数据） */
function collectArtifacts(distDir) {
	const pages = []
	for (const file of walk(distDir).filter(f => f.endsWith('.html'))) {
		const html = readFileSync(file, 'utf8')
		pages.push({
			rel: relative(distDir, file).split('\\').join('/'),
			html,
			scripts: scriptsOf(distDir, html),
		})
	}
	return { pages, quoteIcon: QUOTE_ICON, quotePaths: quoteGlyphPaths() }
}

/** 约定的引用字形有哪些 `d`（从本地 iconify 集合取，判据因此不依赖网络） */
function quoteGlyphPaths() {
	const collection = require_('@iconify-json/tabler/icons.json')
	const icon = collection.icons?.[QUOTE_ICON.slice(QUOTE_ICON.indexOf(':') + 1)]
		?? collection.aliases?.[QUOTE_ICON.slice(QUOTE_ICON.indexOf(':') + 1)]
	if (!icon?.body)
		return null
	return [...icon.body.matchAll(/\sd="([^"]+)"/g)].map(m => m[1])
}

/* ────────────────────────── 判据本体 ────────────────────────── */

/**
 * 输入一份产物快照，返回问题描述数组（空 = 全过）。
 *
 * 保持纯函数、不读盘、不打印，自检才能喂合成数据。
 */
function evaluate(art) {
	const problems = []
	const quotePaths = art.quotePaths
	if (!quotePaths || quotePaths.length === 0) {
		problems.push(`约定的引用字形 ${art.quoteIcon} 在本地 iconify 集合里查不到，判据无法核对字形`)
	}

	for (const page of art.pages) {
		if (!page) {
			problems.push('页面产物缺失：null')
			continue
		}
		const { rel, html, scripts } = page
		const symbols = new Set([...html.matchAll(/<symbol[^>]*id="([^"]+)"/g)].map(m => m[1]))

		/* 1. 悬空引用：HTML 自身 + 该页脚本里的每一个 #ai: / #symbol 引用 */
		const refs = new Set()
		for (const m of html.matchAll(/<use[^>]*href="#([^"]+)"/g))
			refs.add(m[1])
		for (const { code } of scripts) {
			for (const m of code.matchAll(/#(ai:[\w.:-]+)/g))
				refs.add(m[1])
		}
		const dangling = [...refs].filter(r => !symbols.has(r)).sort()
		for (const r of dangling)
			problems.push(`${rel}：<use> 指向本页 sprite 里不存在的 symbol「${r}」→ 空白图标`)

		/* 2. 换图标必须伴随真实的 <use href> 改写 */
		for (const { origin, code } of scripts) {
			const writes = [...code.matchAll(/setAttribute\(\s*[`'"]data-icon[`'"]|\.dataset\.icon\s*=/g)]
			if (!writes.length)
				continue
			const rewrites = /querySelector\(\s*[`'"]use[`'"]\s*\)|setAttribute\(\s*[`'"]href[`'"]|\.href\s*=/.test(code)
			if (!rewrites) {
				problems.push(`${rel}（${origin}）：${writes.length} 处 data-icon 写入没有配套的 <use href> 改写 → 图标不会变（astro-icon 的字形写死在 <use href> 上）`)
			}
		}

		/* 3. 段落引用按钮：构建期字形 + 客户端兜底名，两条路必须一致 */
		if (html.includes('paragraph-quote-btn')) {
			const buttons = [...html.matchAll(/<button[^>]*paragraph-quote-btn[\s\S]*?<\/button>/g)].map(m => m[0])
			const wrong = buttons.filter((b) => {
				const ds = [...b.matchAll(/\sd="([^"]+)"/g)].map(m => m[1])
				return !ds.length || !ds.every(d => quotePaths.includes(d))
			})
			if (wrong.length)
				problems.push(`${rel}：${wrong.length} 个引用按钮的字形不是约定的 ${art.quoteIcon}（构建期与客户端兜底会画出不同的图标）`)
		}
		// 客户端兜底若自带图标名，只允许是约定的那一个
		for (const { origin, code } of scripts) {
			if (!code.includes('paragraph-quote-btn'))
				continue
			for (const m of code.matchAll(/#(ai:[\w.:-]+)/g)) {
				if (m[1] !== `ai:${art.quoteIcon}`)
					problems.push(`${rel}（${origin}）：客户端引用按钮兜底带了别的图标名「${m[1]}」，与构建期的 ${art.quoteIcon} 不一致`)
			}
		}

		/* 4. prose 图标（iconElement 产物）必须带 iconify */
		// iconElement 固定产出 focusable="false" 且无 data-icon，astro-icon 的 svg 一定带 data-icon
		for (const m of html.matchAll(/<svg[^>]*focusable="false"[^>]*>/g)) {
			const tag = m[0]
			if (tag.includes('data-icon'))
				continue
			const cls = /\sclass="([^"]*)"/.exec(tag)?.[1] ?? ''
			if (!cls.split(/\s+/).includes('iconify'))
				problems.push(`${rel}：prose 图标 <svg> 缺 iconify 类（class="${cls}"）→ 退回 1em 且不沉底`)
		}
	}

	return problems
}

/* ────────────────────────── 自检 ────────────────────────── */

/** 一份「全部齐活」的产物快照，逐条用例从这里派生 */
function goodArtifacts() {
	return {
		pages: [
			{
				rel: 'good/index.html',
				html: [
					'<button class="paragraph-quote-btn" aria-label="引用整段到评论区" data-paragraph-quote hidden>',
					'<svg class="iconify" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">',
					'<path d="GATE-PATH"></path></svg></button>',
					'<svg class="iconify" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" data-icon="tabler:copy">',
					'<symbol id="ai:tabler:copy"><path d="x"></path></symbol><use href="#ai:tabler:copy"></use></svg>',
				].join(''),
				scripts: [
					{
						origin: 'inline',
						code: 'const b=document.querySelector(".paragraph-quote-btn");b.insertAdjacentHTML("beforeend",tpl);',
					},
				],
			},
		],
		quoteIcon: QUOTE_ICON,
		quotePaths: ['GATE-PATH'],
	}
}

const good = goodArtifacts()
const problemsOf = art => evaluate(art)
/** 深拷贝一份快照后改一处 */
function mutate(fn) {
	const clone = structuredClone(good)
	fn(clone.pages[0])
	return clone
}

const SELF_TESTS = [
	{
		name: 'a) 全部齐活 → 不报',
		art: good,
		expect: [],
	},
	{
		// 本项目最典型的失败模式：改 data-icon 以为图标就换了
		name: 'b) 只改 data-icon、没有 <use href> 改写 → 空操作，必须报',
		art: mutate(p => p.scripts.push({ origin: 'inline', code: 'i.setAttribute("data-icon","tabler:check")' })),
		expect: ['没有配套的 <use href> 改写'],
	},
	{
		name: 'c) 改 data-icon 且确实改了 <use href> → 合法，不报',
		art: mutate((p) => {
			// 目标 symbol 必须同时出现在本页 sprite 里，否则判据 1 会（正确地）报悬空
			p.html += '<svg data-icon="tabler:check"><symbol id="ai:tabler:check"><path d="y"></path></symbol></svg>'
			p.scripts.push({
				origin: 'inline',
				code: 'const u=i.querySelector("use");i.setAttribute("data-icon","tabler:check");u.setAttribute("href","#ai:tabler:check")',
			})
		}),
		expect: [],
	},
	{
		// Task 2 的空白图标：名字写进了产物 JS，但本页 sprite 里没有这个 symbol
		name: 'd) 脚本引用了本页 sprite 没有的 symbol → 空白图标，必须报',
		art: mutate(p => p.scripts.push({ origin: 'inline', code: 'x.innerHTML=`<use href="#ai:tabler:message-circle-quote"></use>`' })),
		expect: ['sprite 里不存在的 symbol'],
	},
	{
		name: 'e) HTML 里的 <use> 悬空 → 必须报',
		art: mutate((p) => { p.html += '<svg><use href="#ai:tabler:ghost"></use></svg>' }),
		expect: ['sprite 里不存在的 symbol'],
	},
	{
		name: 'f) 引用按钮字形与约定不符（两条路会画出不同图标）→ 必须报',
		art: mutate((p) => { p.html = p.html.replace('GATE-PATH', 'OTHER-PATH') }),
		expect: ['不是约定的'],
	},
	{
		name: 'g) 客户端兜底带了别的图标名 → 必须报',
		art: mutate(p => p.scripts.push({
			origin: 'inline',
			code: 'q=`<button class="paragraph-quote-btn"><svg><use href="#ai:tabler:quote"></use></svg></button>`',
		})),
		expect: ['与构建期的'],
	},
	{
		name: 'h) prose 图标漏了 iconify 类 → 必须报',
		art: mutate((p) => { p.html = p.html.replace('class="iconify" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="GATE-PATH"', 'class="toggle-icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="GATE-PATH"') }),
		expect: ['缺 iconify 类'],
	},
	{
		// astro-icon 的 svg 带 data-icon，不该被当成 prose 图标判 iconify
		name: 'i) astro-icon 的 svg（带 data-icon）不算 prose 图标，即便没 iconify 也不报',
		art: mutate((p) => {
			p.html = p.html.replace(
				'class="iconify" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" data-icon="tabler:copy"',
				'class="astro-only" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" data-icon="tabler:copy"',
			)
		}),
		expect: [],
	},
	{
		name: 'j) 页面产物整个缺失 → 必须报错，不能当过',
		art: { ...good, pages: [null] },
		expect: ['页面产物缺失'],
	},
	{
		name: 'k) 约定的字形在本地集合里查不到 → 判据必须自己喊停',
		art: { ...good, quotePaths: [] },
		expect: ['查不到'],
	},
	{
		name: 'l) 外链 chunk 里的悬空引用也算数（只看 HTML 会漏）',
		art: mutate(p => p.scripts.push({ origin: '/_astro/x.js', code: 'const H="#ai:tabler:nope"' })),
		expect: ['sprite 里不存在的 symbol'],
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	const got = problemsOf(t.art)
	const ok = t.expect.length === 0
		? got.length === 0
		: got.some(g => t.expect.every(k => g.includes(k)))
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

const argv = process.argv.slice(2)
const DIST = join(ROOT, argv[argv.indexOf('--dist') + 1] ?? 'dist')

if (!statSync(DIST, { throwIfNoEntry: false })) {
	console.error(`FAIL: 找不到产物目录 ${DIST}。先构建再跑本门禁。`)
	process.exit(1)
}

const artifacts = collectArtifacts(DIST)
const problems = evaluate(artifacts)

const scriptCount = artifacts.pages.reduce((n, p) => n + p.scripts.length, 0)
console.log('===== 图标切换 / 悬空 <use> 门禁 =====')
console.log(`  产物：${artifacts.pages.length} 个页面，${scriptCount} 段脚本（内联 + 外链 chunk）`)
console.log(`  约定字形：${QUOTE_ICON}（Nuxt 的 tabler:message-circle-quote 不存在，Iconify API 对它 404）`)
console.log('  判据只读 dist/ 与本地 iconify 集合：源码里写了什么不算数，产物里没有就是没有。')

if (!problems.length) {
	console.log('\n  PASS: 没有悬空 <use>，换图标都伴随真实改写，两条引用路径一致，prose 图标带 iconify。')
	process.exit(0)
}

/*
 * 按「问题形状」归组输出：全量打印动辄两千行（一个页面的表格图标就能报几十条），
 * 没人看得下去的红灯等于没有红灯。每组给条数 + 最多 3 个样例页面。
 */
const MAX_EXAMPLES = 3
const groups = new Map()
for (const p of problems) {
	const at = p.indexOf('：')
	// 只抹掉「N 个 / N 处」里的计数，否则「1.2em」「message-circle-2」也会被吃掉
	const shape = (at === -1 ? p : p.slice(at + 1)).replace(/(\d+)( 个| 处)/g, '#$2')
	const where = at === -1 ? '' : p.slice(0, at)
	if (!groups.has(shape))
		groups.set(shape, [])
	groups.get(shape).push(where)
}

console.log(`\n  FAIL: ${problems.length} 处，归为 ${groups.size} 类\n`)
for (const [shape, wheres] of groups) {
	const unique = [...new Set(wheres)]
	console.log(`    [${wheres.length} 处] ${shape}`)
	for (const w of unique.slice(0, MAX_EXAMPLES))
		console.log(`        ${w}`)
	if (unique.length > MAX_EXAMPLES)
		console.log(`        …… 另有 ${unique.length - MAX_EXAMPLES} 个页面`)
}
console.log('\n  排查顺序：')
console.log('    1. `<use>` 悬空 → 该名字本页没渲染过，astro-icon 不会为它发 symbol；')
console.log('       修法是**在模板里把两态都渲染出来**（symbol 必然齐全），不是改 href 指向别的名字')
console.log('    2. 只改 data-icon → astro-icon 的字形写死在 <use href> 上，这是空操作')
console.log('    3. 两条引用路径不一致 → 字形必须只有一个来源（构建期出图标，客户端兜底克隆它）')
console.log('    4. prose 图标缺 iconify → main.css 的 :where(.iconify) 才是尺寸契约')
process.exit(1)
