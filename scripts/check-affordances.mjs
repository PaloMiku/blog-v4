/**
 * 静态检查：「点得动的东西看起来点得动」这层**可交互提示**在产物里是不是真的接上了。
 *
 * ═══ 这道门禁为什么存在 ═══
 *
 * 这一轮审出来的四个缺陷有一个共同点：**缺席时页面照样正常渲染，而且构建全绿**。
 *
 *   1. 侧栏的 Ctrl/⌘+K 键帽：按键会高亮（`Key.astro` 的全局 keydown 在跑），
 *      `press` 事件也照派，但全树没有任何人消费它 → 键盘入口整条链断在最后一步。
 *   2. 外链缺 `rel="noopener noreferrer"`：NuxtLink 自动加，Astro 的裸 `<a>` 不加。
 *      浏览器不会报错，`window.opener` 也不会说话。
 *   3. 配图缺 `cursor: zoom-in`：灯箱其实早就接好了（`LightboxModal.astro` 的全局
 *      委托命中 `img[data-zoom]`），只是当初按"功能没接"的假设把提示删了。
 *   4. 侧栏折叠动画：`animation.css` 里 `.collapse-enter-*` 全套都在，
 *      但没有任何代码打这些类名 → CSS 是**死的**，肉眼比对页面高度完全看不出。
 *
 * 现有的门禁全都看不见它们：`compare-page-heights` 量的是渲染高度（快照不触发动画），
 * `compare-ui-parity` 比的是静态计算样式（`.collapse-*` 没有元素命中，比对时两边都空），
 * `check-dead-css` 找的是"选择器够不到元素"（这里相反：CSS 有、JS 没有）。
 * `check-flip-gates.mjs` 抓的是"组件写了但没被引用"，而这四个组件都**被引用了**。
 *
 * 更阴的一层是注释：这四处里有三处的成因都写在源码注释里，而且**注释本身是错的**
 * （「搜索按钮不会产生可见反馈」「灯箱暂不可用，刻意不加 cursor」）。
 * 照注释读代码的人会把缺陷当成设计。所以判据只看产物，不看注释。
 *
 * ═══ 判据（全部只读 dist/ + 源码里那几个文件的存在性）═══
 *
 *   1. 侧栏键帽有**真正的消费者**：产物 JS 里必须同时出现
 *      `.search-btn [data-key-root]` 选择器、以及紧随其后的 `press` 监听与 `search` 开键。
 *      只查"有没有派发 press"是不够的——`Key.astro` 一直在派发，那样这道判据永远绿。
 *   2. 每个 `target="_blank"` 都带 `rel="noopener noreferrer"`；
 *      站内链接**不得**带 `noopener`（NuxtLink 也不加，全站加就是新差异）。
 *      「站内/外链」按 Nuxt 的 `isExtLink()` 判（含 `:` / 以 `//` 开头 /
 *      末段命中扩展名白名单，故 `/atom.xml` 算**外链**），**不是**看 href 有没有 scheme。
 *      缺 `noreferrer` 但有 `noopener` 的按「是否已登记的 parity 形态」分流：
 *      登记在 `PARITY_BLANK_NO_NOREFERRER` 里的照旧统计并打印，但**不**算失败
 *      （与 Nuxt 基线逐字相同、源码注释明写要保留）；出现第三种形状照样红。
 *   3. 每个 `data-zoom` 配图都发出 `cursor: zoom-in`；一个都没有时判据必须报空，
 *      不能当成过（`compare-page-heights` 踩过"拿不到值就默认通过"）。
 *   4. 六个 collapse 类名**在产物 JS 里**（只存在于 CSS 里就是没接），
 *      同时 CSS 里也得还在；并且要有可折叠标记供这段代码操作。
 *   5. 两个孤儿组件不在树里，活的两个还在，且 MDX 组件表仍指向 `blog/` 那份。
 *
 * ═══ 自检 ═══
 *
 * 判据带 20 个用例，含 4 个专门复现本轮真实缺陷的快照
 * （事件派发出去没人消费 / CSS 有类名 JS 没有 / data-zoom 一个都没有 / 同源链接带 noopener），
 * 另 6 例锁死本轮两处收窄的边界：m–n2 锁内联那一路（内联 CSS 同权、
 * 内联脚本按 chunk 粒度保住 320 字窗口），o–s 锁判据 2（`/atom.xml` 算外链、
 * 真·站内链接仍红、未登记 class 仍红、parity 形态不红、没有 noopener 仍红）。
 * 判据自己判错的时候，门禁就是在教人忽略红灯——所以自检不过直接 exit 1、不输出结论。
 *
 * ═══ 「产物 CSS/JS」指哪一段 ═══
 * Astro 7 对够小的组件 CSS/JS **直接内联进 HTML**，不落 `dist/_astro/*`：
 * 68 个页面里内联了 69 段 `<style>`（100 KB）与 491 段可执行 `<script>`（676 KB）。
 * 收法照 `check-icon-swap.mjs` 的 `scriptsOf()`：内联与外链同权，
 * `src=` 的仍归外链那一路。内联脚本一段当一个 chunk 收，
 * 判据 1 的 320 字窗口依赖的正是这个粒度——把内联块和外链拼成一大段，
 * 「press 监听在不在消费者旁边」这条就废了。
 *
 * 用法：`node scripts/check-affordances.mjs [--dist <目录>]`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'
import { isExtLink } from '../src/lib/shared/link.ts'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')

/** 侧栏搜索键帽的选择器；产物 JS 里只有本组件会写出它 */
const KEYCAP_SELECTOR = '.search-btn [data-key-root]'
/** Vue <Transition name="collapse"> 的六个类名 */
const COLLAPSE_CLASSES = [
	'collapse-enter-active',
	'collapse-enter-from',
	'collapse-enter-to',
	'collapse-leave-active',
	'collapse-leave-from',
	'collapse-leave-to',
]
/** 两个被判死的孤儿，与两个必须还在的活件 */
const ORPHANS = {
	'src/components/BlogHeader.astro': 'MDX 的 `::blog-header` 由 src/lib/content-components.ts 指向 components/blog/ 那份，这里那份零引用',
	'src/components/partial/DlGroup.astro': '活件是 components/blog/DlGroup.astro（BlogStats / BlogLog / BlogTech 都引那一份），这份零引用',
}
const LIVE = [
	'src/components/blog/BlogHeader.astro',
	'src/components/blog/DlGroup.astro',
]

/**
 * `target="_blank"` 只有 `noopener` 缺 `noreferrer` 的**已知 parity 形态**：键 = 组件自身的 class。
 *
 * ═══ 为什么这一类不再让门禁红灯 ═══
 * 这两处都不是本次改写引入的：Nuxt 基线（`.output/public`）里逐字相同
 * （37 个 feed-card + 5 个 download-btn，形状与数量都对得上），而且源码把
 * 「照搬原版、不要补全成新差异」写在了注释里（`FeedCard.astro:13-16`）。
 * 判据自己早年的措辞也是「属历史遗留，不是本次改写引入」——判据都这么说了还
 * 拿它 exit 1，就是在教人忽略红灯，而会哭狼的门禁等于没有门禁
 * （本仓库守则）。所以：照旧统计、照旧打印，但只当**记录**，不当失败。
 *
 * ⚠️ 放行范围是这两个 class，不是整类。出现第三种形状（谁再写一个裸
 * `rel="noopener"` 的外链）照样红；`target="_blank"` 完全没有 `noopener` 也照样红。
 * 这不是把判据删掉，是把它从「绝对规则」收回到「parity 差异检测」——
 * 门禁该抓的是**改写引入的新差异**，不是把原样搬过来的既成事实。
 */
const PARITY_BLANK_NO_NOREFERRER = {
	'feed-card': 'FeedCard.astro:86 `rel={to ? \'noopener\' : undefined}`，照搬 FeedCard.vue:45（注释明写「不要补全成新差异」）',
	'download-btn': 'ResourceList.astro:71 与 clarity-resource-list.mdx:78 手写 `rel="noopener"`，Nuxt 侧同形',
}

/**
 * 「站内链接却带 noopener」的 parity 登记，语义与上面那张表**不同**，单列。
 *
 * 上一张表放行的是「外链只写 noopener、漏了 noreferrer」；这里放行的是
 * 「`isExtLink` 判为站内、却仍然带 `noopener noreferrer`」。
 *
 * 判据本来的假设是「NuxtLink 只给外链加 rel」。它成立——**除非调用方手写了
 * `target="_blank"`**。`SeriesGroup.vue` 的「查看详情」就是这么写的：
 *
 *     <NuxtLink v-if="link" :to="link" class="detail-link" target="_blank" title="查看详情">
 *
 * NuxtLink 见到显式 `target="_blank"` 就补 `rel="noopener noreferrer"`，
 * 与 `link` 是不是站内无关。Nuxt 基线逐字（`.output/public/previews/example/index.html`）：
 *
 *     <a href="/games/galgames/aokana" rel="noopener noreferrer" target="_blank"
 *        class="detail-link" title="查看详情" data-v-1244c887>
 *
 * Astro 侧 `SeriesGroup.astro:111-116` 现在逐属性一致。
 * **把它改成「按 isExtLink 决定 rel」会主动制造一处与线上的差异**，
 * 而本次迁移的要求就是与 Nuxt 一致，所以登记为 parity 而不是改代码。
 *
 * ⚠️ 放行范围同样是这几个 class，不是整类：未登记的 class 照红，
 * 站内链接**完全没有** noopener 也照红。
 */
const PARITY_SAME_ORIGIN_NOOPENER = {
	'detail-link': 'SeriesGroup.astro:111-116 显式 target="_blank"，照搬 SeriesGroup.vue 的 <NuxtLink target="_blank">；NuxtLink 据此补 rel，与 isExtLink 无关。基线同形',
}

/** 只认行首/独立的 `<a` 开始标签，取出属性 */
function anchors(html) {
	return [...html.matchAll(/<a\s[^>]*>/g)].map(m => m[0])
}

function attr(tag, name) {
	const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
	if (!m)
		return undefined
	return m[2] ?? m[3] ?? m[4]
}

/**
 * 目标是否**站内**。
 *
 * ⚠️ 判据不能用「href 有没有 scheme」。Nuxt 的规则是 `isExtLink()`：
 * 含 `:`、以 `//` 开头，**或者末段命中文件扩展名白名单**——所以 `/atom.xml`、
 * `/feed.json`、`/anything.md` 都算**外链**。第一版按 scheme 判，于是把 134 个
 * `/atom.xml` 订阅链接（页脚 + 侧栏图标导航）判成「同源却带 noopener」，
 * 报出 135 个假阳性；而 Nuxt 基线里那些锚点是逐字相同的 `rel="noopener noreferrer"`。
 *
 * `isExtLink` 直接引 `src/lib/shared/link.ts`（全站唯一实现）：那份扩展名清单有
 * 一百多项，手抄进本文件迟早漂移，而漂移的方向恰好是把绿灯变成红灯。
 * 引它不违反「判据只认产物」——判据问的是「产物里的链接算不算外链」，
 * 这个定义属于站点本身；判据仍然不拿源码里的**实现**当接线证据。
 */
function isSameOrigin(href) {
	return !isExtLink(href)
}

function relTokens(tag) {
	return (attr(tag, 'rel') || '').toLowerCase().split(/\s+/).filter(Boolean)
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

/**
 * 页面 HTML 里内联的 `<style>` / `<script>`：Astro 7 对够小的组件 CSS/JS 直接内联
 * 进页面，不落 `dist/_astro/*`，只看外链 chunk 会把这一大半产物当不存在。
 *
 * 内联脚本**一段当一个 chunk** 收，`path` 记来源页与序号——判据 1 的 320 字窗口
 * 依赖的就是这个粒度，内联块与外链 chunk 在判据眼里必须同权、且不能被合并。
 * `src=` 的那一路不算；`type` 只收缺省与 JS MIME 两种。
 */
function inlineOf(html, rel) {
	const css = []
	const js = []
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
			js.push({ path: `${rel}#inline-${js.length + 1}`, text: m[2] })
	}
	return { css, js }
}

/**
 * 只留标记：抹掉 `<style>` / `<script>` 的正文，标签本身留着。
 * 数可交互元素时，内联脚本里的同名字符串不是标记。
 */
function markupOf(html) {
	return html.replace(/(<(?:script|style)\b[^>]*>)([\s\S]*?)(<\/(?:script|style)>)/g, '$1$3')
}

/** 把产物收成一份快照，判据只认这个结构（好让自检能喂合成数据） */
function collectArtifacts(distDir) {
	const files = walk(distDir)
	const read = f => readFileSync(f, 'utf8')
	const rel = f => relative(distDir, f).split(sep).join('/')
	const exists = p => Boolean(statSync(join(ROOT, p), { throwIfNoEntry: false }))
	const pages = []
	const inlineCss = []
	const inlineJs = []
	for (const f of files.filter(f => f.endsWith('.html'))) {
		const path = rel(f)
		const html = read(f)
		pages.push({ path, html })
		// 外链之外的那一半：Astro 7 内联进各页的 <style> / <script>
		const inl = inlineOf(html, path)
		inlineCss.push(...inl.css)
		inlineJs.push(...inl.js)
	}
	return {
		pages,
		css: files.filter(f => f.endsWith('.css')).map(read).join('\n'),
		inline: { css: inlineCss },
		// 内联块与外链 chunk 同列，path 标明来源；判据 1 只在**同一段**里找 press 监听
		js: [
			...files.filter(f => f.endsWith('.js')).map(f => ({ path: rel(f), text: read(f) })),
			...inlineJs,
		],
		sources: {
			...Object.fromEntries(Object.keys(ORPHANS).map(p => [p, exists(p)])),
			...Object.fromEntries(LIVE.map(p => [p, exists(p)])),
		},
	}
}

/**
 * 判据本体：输入一份产物快照，返回 `{ problems, relOffenders }`（problems 空 = 全过）。
 *
 * 保持纯函数、不读盘、不打印，自检才能喂合成数据。
 * `relOffenders` 是外链违规按「成因｜class｜cid」归的堆，给修的人直接定位到组件。
 */
function evaluate(art) {
	const problems = []
	// 「产物 JS」= 外链 chunk + 各页内联块，同列同权（内联块 path 标明来源页）
	const allJs = art.js.map(c => c.text).join('\n')
	// 「产物 CSS」= 外链 + 各页内联 <style>
	const allCss = [art.css, ...art.inline.css].join('\n')

	/* 1. 侧栏键帽 → 搜索：必须有人消费 press */
	/*
	 * 产物 JS 是压缩过的，字符串字面量的引号形态会变（实测是反引号），
	 * 所以先把三种引号抹掉再看字符顺序。
	 *
	 * ⚠️ 取的窗口必须**从选择器之后**开始：`.search-btn` 本身就含 `search`
	 * 这五个字母，把选择器算进窗口的话，"有没有打开 search" 这条判据恒真。
	 * （自检用例 d 就是抓这一条抓出来的。）
	 */
	const chunks = art.js.map(c => ({ path: c.path, norm: c.text.replace(/[`'"]/g, '') }))
	const owner = chunks.find(c => c.norm.includes(KEYCAP_SELECTOR))
	if (!owner) {
		problems.push(`产物 JS 里没有 \`${KEYCAP_SELECTOR}\` 的消费者——Ctrl/⌘+K 仍然打不开搜索（Key.astro 照旧在派发 press，只是没人接）`)
	}
	else {
		const at = owner.norm.indexOf(KEYCAP_SELECTOR) + KEYCAP_SELECTOR.length
		const win = owner.norm.slice(at, at + 320)
		if (!win.includes('press'))
			problems.push(`${owner.path}：找到了键帽消费者，但它附近没有 press 监听——事件还是派发出去没人接`)
		if (!win.includes('search'))
			problems.push(`${owner.path}：键帽按下了，但没有打开 search 布局态（与 Nuxt 的 layoutStore.toggle('search') 不等价）`)
	}

	/* 2. 外链的 rel */
	let blankNoRel = 0
	let blankNoNoreferrer = 0
	let sameOriginNoopener = 0
	const offenders = new Map()
	// 与 Nuxt 基线逐字相同、源码明写要保留的形态：只记录，不失败（见 PARITY_BLANK_NO_NOREFERRER）
	const parityBlank = new Map()
	const paritySameOrigin = new Map()
	for (const page of art.pages) {
		// 判的是标记：锚点与配图都是页面元素，内联脚本里的同名字符串不算
		const markup = markupOf(page.html)
		for (const tag of anchors(markup)) {
			const target = (attr(tag, 'target') || '').toLowerCase()
			const href = attr(tag, 'href')
			const tokens = relTokens(tag)
			const isBlank = target === '_blank'
			const isSame = isSameOrigin(href)

			// 站内链接带 noopener：NuxtLink 默认不加；加了要么是显式 target="_blank"
			// 带来的（已登记的 parity 形态），要么就是改写引入的新差异
			if (isSame && tokens.includes('noopener')) {
				const cls = (attr(tag, 'class') || '').split(/\s+/).filter(Boolean)
				const parity = cls.find(c => c in PARITY_SAME_ORIGIN_NOOPENER)
				if (parity)
					paritySameOrigin.set(parity, (paritySameOrigin.get(parity) || 0) + 1)
				else
					sameOriginNoopener++
			}

			if (!isBlank)
				continue

			if (!tokens.includes('noopener')) {
				blankNoRel++
				noteOffender(offenders, tag, '外链 target=_blank 完全没有 noopener')
			}
			else if (!tokens.includes('noreferrer')) {
				// 先看是不是已登记的 parity 形态，只放行那两种 class
				const cls = (attr(tag, 'class') || '').split(/\s+/).filter(Boolean)
				const parity = cls.find(c => c in PARITY_BLANK_NO_NOREFERRER)
				if (parity) {
					parityBlank.set(parity, (parityBlank.get(parity) || 0) + 1)
				}
				else {
					blankNoNoreferrer++
					noteOffender(offenders, tag, '外链只有 noopener，缺 noreferrer')
				}
			}
		}
	}
	if (blankNoRel)
		problems.push(`${blankNoRel} 个 target="_blank" 链接没有 noopener（NuxtLink 会自动补 rel="noopener noreferrer"）`)
	if (blankNoNoreferrer)
		problems.push(`${blankNoNoreferrer} 个 target="_blank" 只有 noopener、缺 noreferrer，且不是已登记的 parity 形态（见 PARITY_BLANK_NO_NOREFERRER）——既非 NuxtLink 默认、也无源码注释背书，属本次改写引入的新差异`)
	if (sameOriginNoopener)
		problems.push(`${sameOriginNoopener} 个同源链接带了 noopener，且不是已登记的 parity 形态（见 PARITY_SAME_ORIGIN_NOOPENER）——既没有显式 target="_blank" 的依据、也无源码注释背书，属本次改写引入的新差异`)

	/* 3. 配图的光标 */
	let zoomImgs = 0
	let zoomNoCursor = 0
	for (const page of art.pages) {
		for (const m of markupOf(page.html).matchAll(/<img\s[^>]*data-zoom[^>]*>/g)) {
			zoomImgs++
			if (!/cursor\s*:\s*zoom-in/i.test(m[0]))
				zoomNoCursor++
		}
	}
	// 判据为空 ≠ 判据通过：全站一个 data-zoom 都没有，说明这条根本没被验证
	if (zoomImgs === 0)
		problems.push('产物里一个 data-zoom 配图都没有，`cursor: zoom-in` 这条判据是空的（不能当成过）')
	else if (zoomNoCursor)
		problems.push(`${zoomNoCursor}/${zoomImgs} 个 data-zoom 配图没有 cursor: zoom-in（灯箱是接好的，这个光标是唯一的可点提示）`)

	/* 4. 折叠动画的类名：CSS 有 + JS 也得有 */
	const jsMissing = COLLAPSE_CLASSES.filter(c => !allJs.includes(c))
	if (jsMissing.length)
		problems.push(`collapse 类名只存在于 CSS、产物 JS 里没有：${jsMissing.join(' / ')}——动画是死的（点折叠列表仍然瞬变）`)
	const cssMissing = COLLAPSE_CLASSES.filter(c => !allCss.includes(c))
	if (cssMissing.length)
		problems.push(`animation.css 里缺 collapse 类名：${cssMissing.join(' / ')}（JS 在打类名，CSS 侧没规则）`)
	if (!art.pages.some(p => markupOf(p.html).includes('data-subnav-toggle')))
		problems.push('产物里没有 data-subnav-toggle 折叠按钮——折叠动画判据无对象可判（不能当成过）')

	/* 5. 孤儿组件 */
	for (const [path, why] of Object.entries(ORPHANS)) {
		if (art.sources[path])
			problems.push(`孤儿组件回来了：${path}（${why}）`)
	}
	for (const path of LIVE) {
		if (!art.sources[path])
			problems.push(`活件不见了：${path}——删错文件了`)
	}

	return { problems, relOffenders: [...offenders.entries()].sort((a, b) => b[1] - a[1]), parityBlank: [...parityBlank.entries()].sort((a, b) => b[1] - a[1]), paritySameOrigin: [...paritySameOrigin.entries()].sort((a, b) => b[1] - a[1]) }
}

/** 违规按「class | cid」归堆，方便直接定位到组件 */
function noteOffender(offenders, tag, why) {
	const cls = attr(tag, 'class') || '(无 class)'
	const cid = /data-astro-cid-(\w+)/.exec(tag)?.[1] || '(无 cid)'
	const key = `${why}｜class=${cls} cid=${cid}`
	offenders.set(key, (offenders.get(key) || 0) + 1)
}

/* ────────────────────────── 自检 ────────────────────────── */

const GOOD_PAGE = [
	'<button class="search-btn" data-layout-toggle="search">',
	'<kbd data-key-root data-key-code="K" data-key-mods="cmd" data-key-prevent="1">Ctrl+K</kbd>',
	'</button>',
	'<button data-subnav-toggle="g0-i0" aria-expanded="true" aria-controls="sidebar-subnav-g0-i0"></button>',
	'<ul id="sidebar-subnav-g0-i0" class="sidebar-subnav">',
	'<li><a href="/about" class="sidebar-nav-item">关于</a></li>',
	'<li><a class="sidebar-nav-item" href="https://github.com/PaloMiku" target="_blank" rel="noopener noreferrer" title="GitHub"></a></li>',
	'</ul>',
	'<figure class="image"><img class="image" src="/a.png" alt="a" style="cursor:zoom-in" data-zoom data-zoom-caption="a"></figure>',
].join('')

/** 六个类名在产物 JS 里的形态：压缩器不会改字符串字面量，所以它们必须真的在 */
const GOOD_JS_COLLAPSE = `const a=[${COLLAPSE_CLASSES.map(c => `"${c}"`).join(',')}];`
/** 侧栏 chunk 里"键帽消费 press 并打开 search"在产物里的形态 */
const GOOD_JS_KEYCAP = 't.querySelector(`.search-btn [data-key-root]`)?.addEventListener(`press`,()=>i(`search`));'

/** 一份「全部齐活」的产物快照，逐条用例从这里派生 */
function goodArtifacts() {
	return {
		pages: [{ path: 'index.html', html: GOOD_PAGE }],
		css: COLLAPSE_CLASSES.map(c => `.${c}{transition:max-height .1s}`).join('\n'),
		js: [{ path: 'BlogSidebar.js', text: `${GOOD_JS_KEYCAP}${GOOD_JS_COLLAPSE}` }],
		// 内联那一路默认留空：m) 单独覆盖。js 那一半不在这里——内联脚本按「一段 = 一个
		// chunk」进 js 数组，与外链同列（判据 1 的 320 字窗口就是这么保住粒度的）
		inline: { css: [] },
		sources: {
			'src/components/BlogHeader.astro': false,
			'src/components/partial/DlGroup.astro': false,
			'src/components/blog/BlogHeader.astro': true,
			'src/components/blog/DlGroup.astro': true,
		},
	}
}

const problemsOf = art => evaluate(art)
const withPage = (art, html) => ({ ...art, pages: [{ path: 'index.html', html }] })
const withJs = (art, text) => ({ ...art, js: [{ path: 'BlogSidebar.js', text }] })

const good = goodArtifacts()

const SELF_TESTS = [
	{ name: 'a) 全部齐活 → 不报', art: good, expect: [] },
	{
		// 本轮真实缺陷 1：press 一直在派发，但全树没有消费者
		name: 'b) press 派发了但没人消费（现状即此）',
		art: withJs(good, `document.addEventListener(\`keydown\`,()=>r.dispatchEvent(new CustomEvent(\`press\`)));${GOOD_JS_COLLAPSE}`),
		expect: ['没有 `.search-btn [data-key-root]` 的消费者'],
	},
	{
		name: 'c) 找到消费者但没监听 press',
		art: withJs(good, `t.querySelector(\`.search-btn [data-key-root]\`)?.focus();${GOOD_JS_COLLAPSE}`),
		expect: ['没有 press 监听'],
	},
	{
		name: 'd) 监听了 press 但没打开 search',
		art: withJs(good, `t.querySelector(\`.search-btn [data-key-root]\`)?.addEventListener(\`press\`,()=>console.log(\`hi\`));${GOOD_JS_COLLAPSE}`),
		expect: ['没有打开 search 布局态'],
	},
	{
		// 本轮真实缺陷 2
		name: 'e) 外链缺 rel',
		art: withPage(good, GOOD_PAGE.replace(' rel="noopener noreferrer"', '')),
		expect: ['没有 noopener'],
	},
	{
		name: 'f) 外链只有 noopener（与 Nuxt 基线同形，单独归类）',
		art: withPage(good, GOOD_PAGE.replace('rel="noopener noreferrer"', 'rel="noopener"')),
		expect: ['缺 noreferrer'],
	},
	{
		name: 'g) 同源链接带了 noopener',
		art: withPage(good, GOOD_PAGE.replace('<a href="/about" class="sidebar-nav-item">', '<a href="/about" class="sidebar-nav-item" rel="noopener">')),
		expect: ['同源链接带了 noopener'],
	},
	{
		// 下面两条给新加的 PARITY_SAME_ORIGIN_NOOPENER 上边界：
		// 登记的那个 class 放行，**换个 class 立刻照红**。放行范围必须窄。
		name: 't) 站内链接带 noopener 且 class 已登记为 parity → 不算失败',
		art: withPage(good, GOOD_PAGE.replace('<a href="/about" class="sidebar-nav-item">', '<a href="/about" class="detail-link" target="_blank" rel="noopener noreferrer">')),
		expect: [],
	},
	{
		name: 'u) 同样带 noopener，但 class 没登记 → 照红（放行范围不能是整类）',
		art: withPage(good, GOOD_PAGE.replace('<a href="/about" class="sidebar-nav-item">', '<a href="/about" class="brand-new-thing" target="_blank" rel="noopener noreferrer">')),
		expect: ['同源链接带了 noopener'],
	},
	{
		// 本轮真实缺陷 3
		name: 'h) data-zoom 配图没有 zoom-in 光标',
		art: withPage(good, GOOD_PAGE.replace(' style="cursor:zoom-in"', '')),
		expect: ['没有 cursor: zoom-in'],
	},
	{
		name: 'i) 全站没有 data-zoom 配图（判据为空，必须报，不能当过）',
		art: withPage(good, GOOD_PAGE.replace(/ data-zoom[^>]*>/, '>')),
		expect: ['判据是空的'],
	},
	{
		// 本轮真实缺陷 4：CSS 全套都在，JS 一个类名都没打
		name: 'j) collapse 类名只在 CSS 里（动画是死的）',
		art: withJs(good, 't.dataset.sidebarReady=`1`;'),
		expect: ['产物 JS 里没有'],
	},
	{
		name: 'k) 孤儿组件回来了',
		art: { ...good, sources: { ...good.sources, 'src/components/BlogHeader.astro': true } },
		expect: ['孤儿组件回来了'],
	},
	{
		name: 'l) 活件被误删',
		art: { ...good, sources: { ...good.sources, 'src/components/blog/DlGroup.astro': false } },
		expect: ['活件不见了'],
	},
	{
		// 本门禁自己踩过的坑：Astro 7 把够小的组件 CSS 直接内联进页面，
		// 只读 dist/*.css 会把这一大半样式当不存在
		name: 'm) collapse 类名只内联在 <style> 里、外链 CSS 一个都没有 → 不报',
		art: { ...good, css: '', inline: { css: [good.css] } },
		expect: [],
	},
	{
		// 内联脚本按「一段 = 一个 chunk」收：判据 1 的 320 字窗口在它身上照样成立
		name: 'n) 键帽消费者内联在页面里 → 窗口判据照样生效（只报 collapse 缺类名）',
		art: { ...good, js: [{ path: 'archive/index.html#inline-1', text: GOOD_JS_KEYCAP }] },
		expect: ['产物 JS 里没有'],
	},
	{
		name: 'n2) 内联块里的消费者附近没有 press 监听 → 必须报（窗口不能被拆散后失效）',
		art: { ...good, js: [{ path: 'archive/index.html#inline-1', text: 't.querySelector(`.search-btn [data-key-root]`)?.focus();' }] },
		expect: ['没有 press 监听'],
	},
	{
		// isExtLink 语义：`/atom.xml` 末段命中扩展名白名单 → 外链，rel 齐全，不报
		name: 'o) /atom.xml 订阅链接按 isExtLink 算外链（不是「同源却带 noopener」）',
		art: withPage(good, `${GOOD_PAGE}<a href="/atom.xml" target="_blank" rel="noopener noreferrer" aria-label="Atom订阅"></a>`),
		expect: [],
	},
	{
		// 收窄后判据仍然抓得到：真·站内链接带 noopener 依旧红。
		//
		// ⚠️ 这里刻意用**未登记**的 class。`detail-link` /games/galgames/aokana
		// 那个组合曾一度用在本测试里，随后被登记为 parity（NuxtLink 见到显式
		// target="_blank" 就补 rel，Nuxt 基线同形），于是本测试会理所当然地转绿——
		// 那就等于把「判据还抓得住」这个断言本身给废掉了。
		// 断言判据有效，就不能让 fixture 落进放行区。
		name: 'p) 真·站内链接（/games/… 无扩展名）带 noopener → 必须报',
		art: withPage(good, `${GOOD_PAGE}<a class="unregistered-link" href="/games/galgames/aokana" target="_blank" rel="noopener noreferrer"></a>`),
		expect: ['同源链接带了 noopener'],
	},
	{
		// parity 放行只认登记过的 class：换个 class 写同样的 rel 照样红
		name: 'q) 未登记的 class 写 rel="noopener" → 必须报（判据没被削平）',
		art: withPage(good, `${GOOD_PAGE}<a class="brand-new-link" href="https://example.com" target="_blank" rel="noopener"></a>`),
		expect: ['缺 noreferrer'],
	},
	{
		name: 'r) feed-card / download-btn 的 rel="noopener" 是 parity 形态 → 不报',
		art: withPage(good, `${GOOD_PAGE}<a class="feed-card gradient-card" href="https://example.com" target="_blank" rel="noopener"></a><a class="download-btn" href="https://example.com" target="_blank" rel="noopener"></a>`),
		expect: [],
	},
	{
		name: 's) 外链完全没有 noopener → 必须报（parity 放行没顺手放过这一类）',
		art: withPage(good, `${GOOD_PAGE}<a class="feed-card" href="https://example.com" target="_blank"></a>`),
		expect: ['没有 noopener'],
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	const got = problemsOf(t.art).problems
	const ok = t.expect.length === 0
		? got.length === 0
		: got.some(g => t.expect.every(k => g.includes(k)))
	if (!ok) {
		selfOk = false
		console.error(`  自检失败：${t.name}`)
		console.error(`    期望含 [${t.expect.join(', ')}]，实得 ${JSON.stringify(got)}`)
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

// 允许指向别的目录（自检/复现用），默认读本仓库的 dist/
const distArg = process.argv.indexOf('--dist')
const DIST = distArg === -1 ? join(ROOT, 'dist') : process.argv[distArg + 1]

if (!statSync(DIST, { throwIfNoEntry: false })) {
	console.error(`FAIL: 找不到产物目录 ${DIST}。先构建再跑本门禁。`)
	process.exit(1)
}

const artifacts = collectArtifacts(DIST)
const { problems, relOffenders, parityBlank, paritySameOrigin } = evaluate(artifacts)

console.log('===== 可交互提示 / affordance 门禁 =====')
console.log(`  产物：${artifacts.pages.length} 个页面`)
console.log(`    CSS 外链 ${artifacts.css.length} 字节 + 内联 ${artifacts.inline.css.length} 段 <style>（${artifacts.inline.css.reduce((n, s) => n + s.length, 0)} 字节）`)
console.log(`    JS  ${artifacts.js.length} 段（外链 chunk + 内联 <script>，同权同列）`)
console.log('  判据只读 dist/，不读注释——本轮四处缺陷里有三处的成因写在注释里，而且注释是错的。')

console.log('\n  孤儿组件的判定记录（删掉的理由，代码里查不到出处才留在这）：')
for (const [path, why] of Object.entries(ORPHANS))
	console.log(`    ✗ ${path} —— ${why}`)
for (const path of LIVE)
	console.log(`    ✓ ${path} —— 活件，必须在`)

if (parityBlank.length) {
	console.log('\n  rel 的 parity 记录（与 Nuxt 基线逐字相同，源码明写要保留 → 记录但不算失败）：')
	for (const [cls, n] of parityBlank)
		console.log(`    ${String(n).padStart(4)}  class 含 "${cls}" —— ${PARITY_BLANK_NO_NOREFERRER[cls]}`)
	console.log('    这类若换个 class 出现、或干脆没有 noopener，判据照样红。')
}

if (paritySameOrigin.length) {
	console.log('\n  「站内链接带 noopener」的 parity 记录（NuxtLink 见到显式 target="_blank" 就补 rel，与 isExtLink 无关）：')
	for (const [cls, n] of paritySameOrigin)
		console.log(`    ${String(n).padStart(4)}  class 含 "${cls}" —— ${PARITY_SAME_ORIGIN_NOOPENER[cls]}`)
	console.log('    未登记的 class 照红；改成按 isExtLink 决定 rel 反而会制造一处与线上的差异。')
}

if (!problems.length) {
	console.log('\n  PASS: 键帽、外链 rel、配图光标、折叠动画四层提示都真的接上了。')
	process.exit(0)
}

console.log(`\n  FAIL: ${problems.length} 处未接线\n`)
for (const p of problems)
	console.log(`    - ${p}`)

if (relOffenders.length) {
	console.log('\n  外链 rel 违规分布：')
	for (const [k, n] of relOffenders)
		console.log(`    ${String(n).padStart(4)}  ${k}`)
	console.log('    cid 是**调用方**组件的 scope id：Astro 会把父组件的 cid 传给子组件的根元素，')
	console.log('    所以「cid=lmha4phn 且无 class」= 经 UtilLink 渲染、调用方是 BlogSidebar（已修）。')
	console.log('    UtilLink 自己没有 <style>，不留 cid。')
}

console.log('\n  排查顺序：')
console.log('    1. 源码里事件派发出去没人消费 —— 组件存在 ≠ 行为存在（看产物 JS，不看源码）')
console.log('    2. 外链 rel：NuxtLink 自动加，Astro 的裸 <a> 必须自己写，或改用 UtilLink')
console.log('    3. 动画类名：CSS 在、JS 不在 = 死 CSS；两边的类名字符串都要对得上')
console.log('    4. 这四处都曾被"注释说是设计如此"盖住 —— 注释与产物冲突时以产物为准')
process.exit(1)
