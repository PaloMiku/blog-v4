/**
 * 门禁：`aria-current="page"` 必须与「href 指向当前页」严格等价。
 *
 * ## 这条不变式是什么
 *
 * 线上每个指向当前页的链接都带 `aria-current="page"`，那是 vue-router
 * `NuxtLink` 的**自动行为**，作者不必写。反过来，非当前页的链接一个都不带。
 * 实测（2026-10-03 部署后）：
 *
 *   `/`                 4 个 `href="/"` 的链接，4 个全带
 *   `/link`              同样这批，0 个带
 *   `/2024/03/takagi`    同样这批，0 个带
 *
 * Astro 侧原实现里 `BlogSidebar` 自己算 `currentMark`（精确命中 `page`、
 * 栏目命中 `true`），但**其余指向当前页的链接全都没有**——首页 4 个里只有
 * 1 个带。语义与边界见 `src/lib/shared/link.ts` 的 `currentPageHref`。
 *
 * ## 为什么值得单独一道静态门禁
 *
 * `compare-ui-parity.mjs` 的 `SEM_RULES.a` 里已经有 `aria-current`，
 * 所以**回归会被抓到**——但它只跑受测清单里那 66 页、且要拉浏览器。
 * 这道门禁扫**全部 68 个 HTML**、不碰浏览器、约 1 秒，
 * 并且直接断言不变式本身而不是「这些页恰好对」。
 *
 * ## 为什么值得断言（它不是外观问题）
 *
 * `[aria-current]` 在两侧 CSS 里都是 **0 条规则**（已普查，见 findings），
 * 所以它不影响任何盒子的几何——页高门禁与计算样式门禁都看不见它。
 * 它是屏幕阅读器会念出来的信息，属于功能差异，
 * 而「几何门禁看不见」正是最容易被漏掉的一类（坑位 6/7）。
 *
 * ## 判据（不写字面量）
 *
 * 1. 根相对、无 query/hash 的 `<a href>`：`aria-current="page"` ⟺ 归一化 href
 *    等于该页路径。两个方向都查——「该有却没有」和「不该有却有」同样报。
 * 2. 外链（带 scheme 或 `//`）、页内锚点（`#…`）、带 query/hash 的链接：
 *    **一律不得**出现 `aria-current="page"`。
 * 3. `aria-current="true"` 不在本门禁管辖内——那是 `BlogSidebar` 的栏目标记，
 *    两侧都合法，语义不同（`/games` 在 `/games/galgames/clannad` 上就是 `true`）。
 *
 * 文件路径 → 页面路径的映射：`<dir>/index.html` → `/<dir>`，`index.html` → `/`。
 * 与 `astro.config.mjs` 的 `build.format: 'directory'` 一致。
 *
 * ## 顺带记一笔：属性值里的裸 `>` 不是缺陷
 *
 * `content/posts/2025/11/riddle-joker` 的 `description` 里有
 * `式部茉优 > 在原七海 > …`。线上序列化成 `&gt;`，Astro 产物里是**裸 `>`**。
 * 看着像坏了，其实不是：HTML5 只禁止双引号属性值里出现 `"` 和歧义的 `&`，
 * **`>` 是允许的**，浏览器会把 `>` 之后的内容继续并进同一个属性值，
 * 于是 `getAttribute('title')` 拿到的字符串与线上**逐字相同**。
 * 这也解释了为什么它此前一直没被发现——页高门禁与计算样式门禁都看不见。
 * 真正会红的是 `check-text-literal.mjs` 那类按**字符**比的门禁，
 * 而它判的是正文，不看属性值。
 *
 * 本门禁自己踩了这个坑两次（见下面 `attrs` 的注释），
 * 留着记录是因为：**任何手写标签解析器都会踩**。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const DIST = 'dist'
const FAIL = []

/** 归一化页面路径：去尾斜杠，空则 '/'（与 lib/shared/link.ts 的 normalizeContentPath 同规则） */
const norm = p => p.replace(/\/+$/, '') || '/'

/** dist 文件路径 → 页面路径 */
function routeOf(file) {
	const rel = relative(DIST, file).split(sep).join('/')
	if (rel === 'index.html')
		return '/'
	return `/${rel.replace(/\/?index\.html$/, '')}`
}

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name)
		return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.html') ? [p] : [])
	})
}

/**
 * 只在引号外切属性，避免扫进属性值。
 *
 * 两条踩过的坑，都写在这里免得再犯：
 *
 * 1. **匹配标签头不能用 `<a\b([^>]*)>`。** HTML5 **允许**双引号属性值里出现裸 `>`
 *   （禁的只有 `"` 和歧义的 `&`），而 `content/posts/2025/11/riddle-joker` 的
 *   `title` 里就有 `式部茉优 > 在原七海 > …`。`[^>]*` 会在第一个 `>` 处截断，
 *   于是捕获到一个**引号未闭合**的属性串——第一版解析器就是这么坏的。
 *   正确写法是让引号内的 `>` 不参与终止：`(?:[^>"]|"[^"]*")*`。
 * 2. **`indexOf` 可能返回 -1。** 未闭合时 `i = -1 + 1 = 0`，指针回到开头，
 *   解析器**无限循环**（实测烧了 99s CPU 才被外层超时打断）。
 *   所以：`-1` 必须当「未闭合」处理，而且指针任何一步都不得后退。
 *
 * 未闭合时抛错而不是猜：静默跳过就等于「这条没检查」，那比不写更糟。
 */
function attrs(tag, where) {
	const out = {}
	let i = 0
	while (i < tag.length) {
		const before = i
		while (i < tag.length && /[\s/]/.test(tag[i])) i++
		let j = i
		while (j < tag.length && !/[\s=/]/.test(tag[j])) j++
		const name = tag.slice(i, j)
		i = j
		while (i < tag.length && /\s/.test(tag[i])) i++
		let value = ''
		if (tag[i] === '=') {
			i++
			if (tag[i] === '"') {
				const k = tag.indexOf('"', i + 1)
				if (k === -1)
					throw new Error(`${where}  属性 ${name} 的双引号未闭合：${JSON.stringify(tag.slice(before, before + 120))}`)
				value = tag.slice(i + 1, k)
				i = k + 1
			}
			else {
				const k = tag.indexOf(' ', i)
				value = tag.slice(i, k === -1 ? tag.length : k)
				i = k === -1 ? tag.length : k
			}
		}
		if (name)
			out[name] = value
		if (i <= before && i < tag.length)
			throw new Error(`${where}  属性解析器不前进于 ${i}：${JSON.stringify(tag.slice(before, before + 120))}`)
	}
	return out
}

const files = walk(DIST)
let checkedLinks = 0
let pageMarked = 0

for (const file of files) {
	const route = routeOf(file)
	const html = readFileSync(file, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '')
	for (const m of html.matchAll(/<a\b((?:[^>"]|"[^"]*")*)>/g)) {
		const a = attrs(m[1], route)
		const href = a.href
		if (href === undefined)
			continue
		const isPage = a['aria-current'] === 'page'
		// ② 不可判定的形态：外链 / 页内锚点 / 带 query 或 hash —— 一律不许标
		if (!href.startsWith('/') || href.startsWith('//') || href.includes('?') || href.includes('#')) {
			if (isPage)
				FAIL.push(`${route}  不可判定的链接带了 aria-current="page"  href=${JSON.stringify(href)}`)
			continue
		}
		checkedLinks++
		const should = norm(href) === norm(route)
		if (should)
			pageMarked++
		// ① 双向
		if (should && !isPage)
			FAIL.push(`${route}  指向当前页却缺 aria-current="page"  href=${JSON.stringify(href)}`)
		if (!should && isPage)
			FAIL.push(`${route}  不指向当前页却带了 aria-current="page"  href=${JSON.stringify(href)}`)
	}
}

if (FAIL.length) {
	console.error(`FAIL: aria-current 与「href 指向当前页」不等价 —— ${FAIL.length} 条`)
	for (const f of FAIL.slice(0, 40)) console.error(`  ${f}`)
	if (FAIL.length > 40)
		console.error(`  …… 另有 ${FAIL.length - 40} 条`)
	process.exit(1)
}
console.log(`OK: aria-current="page" —— ${files.length} 个 HTML / ${checkedLinks} 个根相对链接全部符合不变式，其中 ${pageMarked} 个指向本页。`)
