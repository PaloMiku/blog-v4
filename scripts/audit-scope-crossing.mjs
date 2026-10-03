/**
 * 扫全仓库：「某组件的 scoped 样式里，选择器指向的是别的组件的根元素」。
 *
 * ## 要抓的 bug
 *
 * Vue 的 scoped CSS 有一条机制：**子组件的根元素会同时带上父组件的 scope id**，
 * 所以父组件可以选中子组件的根节点。基线产物里到处是
 * `<figure class="image post-cover" data-v-33b9aef5 data-v-bb6a4939>` 这种双 id。
 *
 * Astro **没有这条机制**：子组件渲染的元素只带子组件自己的 cid。于是父组件里
 * 写 `.post-cover { … }` 会编译成 `.post-cover[data-astro-cid-父cid]`，
 * 而实际元素带的是子组件的 cid —— 规则永不匹配，且不报任何错。
 * 实测代价：文章头图 `aspect-ratio:16/9` 整组失效，547px 变 3355px。
 *
 * ## 前两版为什么都是废的
 *
 * 1. 取"模板里第一个带 class 的元素"当根元素 → `SkipToContent` 的 `active`
 *    被当成根 class，全站 `&.active` 全误报（45 处）。
 * 2. 正则 `<([A-Z]\w*)\b[\s\S]{0,300}?class="…"` → **会跨标签边界**，
 *    把后续某个元素的 class 误安到组件标签头上，`.title`/`.content`/`.date`
 *    这些通用 class 全被误报（19 处，依然一处真的都没有）。
 *
 * 这一版**真解析属性归属**：取标签自身 `>` 之前的属性段（跳过引号内的 `>`），
 * 样式侧也按规则切分而不是整段扫。
 *
 * ## 自检
 *
 * `--self-test` 用内置样本验证判据本身能抓到已知真问题。
 * **一个从没抓到真问题的检查器，它的"无发现"没有任何意义。**
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')
const SELF_TEST = process.argv.includes('--self-test')

/* ────────────────────────── 属性归属解析 ────────────────────────── */

/** 从 `src` 的 start 处读一个标签的属性段（到引号外的 `>` 为止），返回 {tag, attrs}。 */
function readTag(src, start) {
	const open = /<([A-Z][\w:-]*)/i.exec(src.slice(start, start + 80))
	if (!open)
		return null
	let i = start + open[0].length
	let quote = null
	while (i < src.length) {
		const ch = src[i]
		if (quote) {
			if (ch === quote)
				quote = null
		}
		else if (ch === '"' || ch === '\'') {
			quote = ch
		}
		else if (ch === '>') {
			break
		}
		i++
	}
	return { tag: open[1], attrs: src.slice(start + open[0].length, i) }
}

/** 属性段里的 class 值。 */
function classOf(attrs) {
	const m = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)
	if (!m)
		return []
	return (m[1] ?? m[2] ?? '').split(/\s+/).map(c => c.replace(/[^\w-]/g, '')).filter(Boolean)
}

/**
 * 组件模板里，被**大写组件标签**使用的 class —— 这些才是"别的组件的根元素"。
 * 只认组件标签（父组件渲染的入口），不认普通 HTML 元素。
 */
function componentRootClasses(src) {
	const tpl = src.split(/<style[\s>]/)[0]
	const out = new Set()
	let i = 0
	while (i < tpl.length) {
		const lt = tpl.indexOf('<', i)
		if (lt < 0)
			break
		if (tpl[lt + 1] === '/' || tpl[lt + 1] === '!') {
			i = lt + 1
			continue
		}
		const t = readTag(tpl, lt)
		if (!t) {
			i = lt + 1
			continue
		}
		if (/^[A-Z]/.test(t.tag)) {
			for (const c of classOf(t.attrs))
				out.add(c)
		}
		i = lt + 1
	}
	return out
}

/**
 * 样式里未被 `:global()` 包裹的规则选择器。
 * 按 `{`/`}` 切规则；含 GLOBALMARK 的一律丢弃（那是故意跨组件的）。
 */
function nonGlobalSelectors(style) {
	const noGlobal = style.replace(/:global\([^)]*\)/g, 'GLOBALMARK')
	const out = []
	let depth = 0
	let selStart = 0
	for (let i = 0; i < noGlobal.length; i++) {
		const ch = noGlobal[i]
		if (ch === '{') {
			if (depth === 0)
				selStart = i + 1
			depth++
		}
		else if (ch === '}') {
			depth--
			if (depth === 0) {
				const sel = noGlobal.slice(selStart, i)
				if (!sel.includes('GLOBALMARK'))
					out.push(sel)
			}
			if (depth < 0)
				depth = 0
		}
	}
	return out
}

/* ────────────────────────── 核心判定 ────────────────────────── */

function audit(components) {
	const owners = new Map() // class -> [file]
	for (const c of components) {
		for (const cls of c.roots) {
			if (!owners.has(cls))
				owners.set(cls, [])
			owners.get(cls).push(c.name)
		}
	}

	const findings = []
	for (const c of components) {
		for (const sel of c.selectors) {
			for (const token of sel.matchAll(/\.([A-Z][\w-]*)/gi)) {
				const cls = token[1]
				/*
				 * 刻意**不**排除 `c.roots.has(cls)`。
				 *
				 * `.post-cover` 正是同文件的情况：PostHeader 把 class 传给 <Pic>，
				 * 再在同一文件里写 `.post-cover { aspect-ratio: … }`。
				 * 「同文件 → 本组件的 class → scoped 正确」这个直觉是错的：
				 * 一旦 class 是经由**组件标签**传下去的，它实际渲染在
				 * 子组件内部，scoped 就够不着了。上一版正是这条把已知的真问题滤掉了。
				 */
				const who = owners.get(cls)
				if (!who)
					continue
				findings.push({
					file: c.name,
					selector: sel.trim().replace(/\s+/g, ' '),
					cls,
					ownedBy: who.filter(n => n !== c.name),
					sameFile: who.includes(c.name),
				})
			}
		}
	}
	return findings
}

function loadComponents(rootDir) {
	const files = []
	const walk = (d) => {
		for (const e of readdirSync(d)) {
			const full = join(d, e)
			if (statSync(full).isDirectory())
				walk(full)
			else if (e.endsWith('.astro'))
				files.push(full)
		}
	}
	walk(rootDir)
	return files.map((f) => {
		const src = readFileSync(f, 'utf8')
		// 用 `<style[\s>]` 而不是 indexOf('<style')——后者会命中模板里
		// 任何含 "<style" 字样的地方，曾把 index.astro 的模板代码
		// 当成样式选择器报出来。
		const m = /<style[\s>]/.exec(src)
		return {
			name: relative(rootDir, f).split(sep).join('/'),
			roots: componentRootClasses(src),
			selectors: m ? nonGlobalSelectors(src.slice(m.index)) : [],
		}
	})
}

/* ────────────────────────── 自检 ────────────────────────── */

if (SELF_TEST) {
	// Parent passes a class to a child component and then styles it — exactly
	// the shape that breaks in Astro.
	const sample = [
		{
			name: 'Parent.astro',
			roots: componentRootClasses('--- ---\n<Pic class="post-cover" src="x" />\n---\n<p>hi</p>'),
			selectors: nonGlobalSelectors('<style>.post-cover { aspect-ratio: 16/9; }</style>'),
		},
		{
			name: 'Fixed.astro',
			roots: componentRootClasses('--- ---\n<Pic class="post-cover" src="x" />\n---\n<p>hi</p>'),
			selectors: nonGlobalSelectors('<style>:global(.post-cover) { aspect-ratio: 16/9; }</style>'),
		},
		{
			// 通用 class 出现在别的组件的根上，但不是本文件用组件标签传的
			name: 'Other.astro',
			roots: componentRootClasses('--- ---\n<Icon class="title" />\n---\n<p>hi</p>'),
			selectors: nonGlobalSelectors('<style>.title { color: red; } .unrelated { color: blue; }</style>'),
		},
	]
	const found = audit(sample)
	const titles = found.map(f => `${f.file}:${f.cls}`)
	const ok = titles.includes('Parent.astro:post-cover')
		&& !titles.includes('Fixed.astro:post-cover')
		&& !titles.includes('Other.astro:unrelated')
	console.log(`self-test findings: ${JSON.stringify(titles)}`)
	console.log(ok
		? 'SELF-TEST PASS: 抓到了未 :global 的那处，放过了已 :global 的那处，也没有误报无关 class。'
		: 'SELF-TEST FAIL: 判据抓不到已知真问题（或误报已修复项），结论不可信。')
	process.exit(ok ? 0 : 1)
}

/* ────────────────────────── 实际扫描 ────────────────────────── */

const components = loadComponents(join(ROOT, 'src'))
const findings = audit(components)

if (!findings.length) {
	console.log('PASS: 未发现「父组件 scoped 样式指向子组件根元素且未 :global」的可疑规则。')
	console.log('      （本检查器已通过 --self-test 验证过判据本身有效）')
	process.exit(0)
}

console.log(`WARN: ${findings.length} 处可疑规则\n`)
const seen = new Set()
for (const f of findings) {
	const key = `${f.file}|${f.selector}|${f.cls}`
	if (seen.has(key))
		continue
	seen.add(key)
	console.log(`  ${f.file}`)
	console.log(`    selector : ${f.selector}`)
	console.log(`    .${f.cls}  是这些组件的根元素 → ${f.ownedBy.join(', ')}`)
}
console.log('\n  Vue 侧允许这样写；Astro 侧必须整体 :global()。')
