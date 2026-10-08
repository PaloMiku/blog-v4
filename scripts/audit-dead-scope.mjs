/**
 * 在**产物**里找 scoped CSS 的死规则。
 *
 * ## 它抓的是什么
 *
 * Astro 的 scoped 样式会加 `[data-astro-cid-…]`。当选择器指向的是
 * **别的组件渲染的元素**（典型：class 经由 `<Child class="x" />` 传下去），
 * 编译出的 cid 是**父组件**的，而元素身上是**子组件**的 cid —— 规则静默失效。
 * Vue 没有这个问题，因为子组件根元素会同时带父组件的 scope id。
 * 实测代价：文章头图 `.post-cover` 的 `aspect-ratio:16/9` 整组失效，547px 变 3355px。
 *
 * ## 为什么扫产物而不是扫源码
 *
 * 源码推断试过两版都不可用：正则会跨标签边界把 class 误安到组件标签头上，
 * `.title`/`.content`/`.date` 这些通用 class 全被误报（45 条、19 条，
 * **一条真的都没有**）。产物验证读的是浏览器真正会看到的东西，没有这个问题。
 *
 * ## 三个曾经的误报，各自的成因
 *
 * 1. 要求"每个 class+cid 都配对" → 把 `父锚点 + :global 子元素` 这种
 *    **正确**的修法误报。scoped 只需要**一个**锚点。
 * 2. 用 `/([^{}]+)\{([^{}]*)\}/g` 切规则 → 不跟踪嵌套深度，会从一条规则的
 *    **声明中间**起匹配，抓出 `opacity:.5;…;.active[cid] &` 这种以属性开头的
 *    假选择器，把活规则误报成死规则。
 * 3. 早于本文件的第一版：把 class 不存在的死 CSS 也算进来（那是「产物 CSS 里有
 *    规则但全站没有落点」那一族的职责，`check-dead-css` 2026-10-04 退役后暂无人接手，
 *    见 CLAUDE.md 开放项）。
 *
 * `--self-test` 覆盖这三种情形 + 真正的死规则；
 * **一个从没抓到真问题的检查器，它的"无发现"没有任何意义。**
 */
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import process from 'node:process'
import { DIST } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

/**
 * 取出**所有**规则的选择器（含嵌套在 `&` 里的），而不是只取最外层。
 *
 * ## 为什么必须递归（实测漏掉了一个每页都中招的 bug）
 *
 * 第一版只看 depth 0 的规则。问题在于 Astro/Lightning CSS **保留原生嵌套**：
 * `.surround-link[cid] { … > .surround-text[cid] { … > .date[cid] { … } } }`。
 * 外层 `.surround-link` 的 class 在产物里**存在且 cid 对得上**，于是外层被判为
 * 「活的」，整条链就被跳过了——里面的 `.date[cid]` 从来没被检查过。
 *
 * 而 `.date` 恰恰是经 `<UtilDate class="date" />` 传给子组件的，元素带的是
 * 子组件的 cid，那条 `display: block` **永不匹配**。后果是每篇文章的上下篇
 * 导航日期不再独占一行：`.surround-link` 41px → 32px，链接还宽了 116px，
 * 于是一行放得下的两个链接被挤成两行，`.surround-post` 41px → 80px。
 *
 * 换句话说：**「外层活着」不等于「里面的选择器也活着」**，
 * 而组件边界最容易出现在嵌套深处。
 */
function allSelectors(css) {
	const out = []
	// 选择器总是「上一个 `{` / `}` / `;` 之后，到下一个 `{` 之前」这一段。
	// 嵌套规则前面是父规则的**声明分号**，所以 `;` 也必须推进起点——
	// 只认 `{` / `}` 的话嵌套里的选择器会被上一条声明粘住，取不出来。
	let segStart = 0
	for (let i = 0; i < css.length; i++) {
		const ch = css[i]
		if (ch === '{') {
			out.push(css.slice(segStart, i))
			segStart = i + 1
		}
		else if (ch === '}' || ch === ';') {
			segStart = i + 1
		}
	}
	return out
		.map(s => s.trim().replace(/\s+/g, ' '))
		.filter(s => s && !/^\s*[-a-z]+\s*:/i.test(s) && !s.includes('{'))
}

/**
 * 从一组 (css 文件名 → CSS 内容) 里找出死规则。
 * live / cidsOf / cidTotals 分别是「(class|cid) → 次数」「class → 出现过的 cid 集合」
 * 与「cid → 该 cid 在产物里出现过的元素数」。
 *
 * ⚠️ 这里只回答「这条规则够不到任何元素」，**不回答为什么**。
 * 两种成因在产物层面长得一模一样：
 *   (a) class 经 `<Child class="x" />` 传下去，元素带的是子组件 cid → 改 :global()
 *   (b) 该元素在本内容集里**从不渲染** → 改 :global() 是错的，且对任何页面无影响
 * 判据分不出 (a)(b)（§52 已实测：PostFooter 的 `.content` 属 (b)，`post-cover` 属 (a)，
 * 二者在产物里的特征完全相同）。所以这里**只报证据，不下结论**——
 * 报一个听起来很专业的成因，比不报更糟。
 */
function findDead(cssFiles, live, cidsOf, cidTotals = new Map()) {
	const dead = new Map()
	for (const [name, css] of cssFiles) {
		for (const sel of allSelectors(css)) {
			const want = /\[data-astro-cid-(\w+)\]/.exec(sel)?.[1]
			if (!want)
				continue
			const pairs = [...sel.matchAll(/\.([A-Z][\w-]*)/gi)].map(x => `${x[1]}|${want}`)
			if (!pairs.length)
				continue
			if (pairs.some(p => live.has(p)))
				continue // 有一个锚点在，规则就是活的
			const cls = pairs[0].split('|')[0]
			if (!cidsOf.get(cls))
				continue // class 压根不存在 → 属于「死 CSS」那一族，不是本文件的判据范围
			// 键是**语义身份**：选择器文本本身就带着 cid（cid 是组件内容的哈希，
			// 组件的 <style> 一改 cid 就变，于是「改过就重新判一次 (a)/(b)」这个
			// 初衷仍然成立）。
			//
			// 早先把 css 文件名也算进键里，那是错的：文件名带**内容哈希**，而
			// `Blog.*.css` 是共享 bundle——同组任何一个组件改样式都会换哈希，
			// 于是「这个组件被改过」被放大成「这个 bundle 里所有规则都变过」。
			// 代价是每跑一次构建就要手工重钉一次名单：2026-10-03 已经因此重钉过
			// 一次（文件名从 D_MlPnCq 变成 CCRJAYdU），今天又来一次
			// （CCRJAYdU → B2ldWKv-），而选择器与 cid 逐字未变。
			// 文件名只留作给人看的定位信息，不进键。
			const key = sel
			const prev = dead.get(key)
			if (prev) {
				prev.n++
			}
			else {
				dead.set(key, {
					n: 1,
					want,
					bundle: name,
					classes: pairs.map(p => p.split('|')[0]),
					cidAlive: cidTotals.get(want) || 0,
					otherCids: [...new Set([...(cidsOf.get(cls) || [])])].sort(),
				})
			}
		}
	}
	return dead
}

/* ────────────────────────── 自检 ────────────────────────── */

if (process.argv.includes('--self-test')) {
	const live = new Map([
		['a|scope9', 1], // .a 只在 scope9 上 → 配 scope1 就是死规则
		['anchor|scope1', 1], // 活
		['host|scope1', 1], // 嵌套规则的外层 → 活
		['dead-class|scope9', 1], // class 存在但 cid 对不上，且无其他锚点
	])
	const cidsOf = new Map([
		['a', new Set(['scope9'])],
		['anchor', new Set(['scope1'])],
		['host', new Set(['scope1'])],
		['dead-class', new Set(['scope9'])],
	])
	const cases = [
		['a) 真死规则', '.a[data-astro-cid-scope1]{color:red}', true],
		['b) 父锚点 + global 子元素（正确修法）', '.anchor[data-astro-cid-scope1] .g[data-astro-cid-scope1]{color:red}', false],
		['c) class 不存在（死 CSS，不归本检查）', '.gone[data-astro-cid-scope1]{color:red}', false],
		['d) 嵌套规则（Lightning CSS 输出 &）', '.host[data-astro-cid-scope1]{color:blue;&.active[data-astro-cid-scope1] &{transform:scale(2)}}', false],
		['e) 死规则（class 存在、cid 对不上、无其他锚点）', '.dead-class[data-astro-cid-scope1]{color:red}', true],
		// 这一条是本轮的真实漏报：外层活着，但嵌套里的 `.date` 跨了组件边界。
		// 只查最外层时整条链被跳过，于是「每篇文章上下篇导航都错位」隐身了很久。
		['f) 嵌套里的跨组件规则（外层活着也必须报出）', '.anchor[data-astro-cid-scope1]{color:red;& .dead-class[data-astro-cid-scope1]{display:block}}', true],
		['g) 嵌套里 class 完全不存在（归死 CSS，不归本检查）', '.anchor[data-astro-cid-scope1]{color:red;& .gone[data-astro-cid-scope1]{display:block}}', false],
	]
	let ok = true
	for (const [label, css, shouldReport] of cases) {
		const found = findDead([[label, css]], live, cidsOf)
		const got = found.size > 0
		const pass = got === shouldReport
		if (!pass)
			ok = false
		console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}  →  ${got ? '报出' : '放过'}${pass ? '' : `  (期望 ${shouldReport ? '报出' : '放过'})`}`)
	}
	console.log(ok ? 'SELF-TEST PASS' : 'SELF-TEST FAIL: 判据有误，结论不可信。')
	process.exit(ok ? 0 : 1)
}

/* ────────────────────────── 实际扫描 ────────────────────────── */

const files = walkFiles(DIST)
const htmls = files.filter(f => f.endsWith('.html'))
const csss = files.filter(f => f.endsWith('.css'))

const live = new Map()
const cidsOf = new Map()

const cidTotals = new Map()
function note(cls, cid) {
	const key = `${cls}|${cid}`
	live.set(key, (live.get(key) || 0) + 1)
	cidTotals.set(cid, (cidTotals.get(cid) || 0) + 1)
	if (!cidsOf.has(cls))
		cidsOf.set(cls, new Set())
	cidsOf.get(cls).add(cid)
}

for (const f of htmls) {
	const html = readFileSync(f, 'utf8')
	// class 在 cid 之前 / cid 在 class 之前，两种属性顺序都要收：
	// 先切出单个标签再各自取属性，避免「两段 [^>]* 夹一个 \w+」的歧义量词
	for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
		const cid = tag[0].match(/data-astro-cid-(\w+)/)
		const cls = tag[0].match(/\sclass="([^"]+)"/)
		if (!cid || !cls)
			continue
		for (const c of cls[1].split(/\s+/))
			note(c, cid[1])
	}
}

const dead = findDead(
	csss.map(f => [relative(DIST, f).split(sep).join('/'), readFileSync(f, 'utf8')]),
	live,
	cidsOf,
	cidTotals,
)

if (!dead.size) {
	console.log('PASS: 产物里没有「选择器够不到任何元素」的 scoped 死规则。')
	console.log(`      （已扫 ${htmls.length} 个 HTML、${csss.length} 个 CSS；`)
	console.log('        判定依据是 class 与 cid 的实际配对，不是源码推断。）')
	process.exit(0)
}

console.log(`WARN: ${dead.size} 处 scoped 规则够不到任何元素\n`)
for (const [k, d] of dead) {
	console.log(`  ${k}${d.n > 1 ? `   ×${d.n}` : ''}`)
	console.log(`      cid ${d.want}：产物里有 ${d.cidAlive} 个元素带它（说明这个组件在渲染）`)
	for (const c of d.classes)
		console.log(`      class \`${c}\`：产物里只出现在 cid ${d.otherCids.join(' / ') || '(无)'} 上，从未与 ${d.want} 同现`)
}

/*
 * 这里**故意不给结论**。产物层面无法区分两种成因：
 *   (a) class 经子组件传下去，元素带子组件 cid → Vue 侧有效，Astro 侧须 :global()
 *   (b) 该元素在本内容集里从不渲染 → :global() 是错的，且对任何页面都没有影响
 * 二者的产物特征完全相同（`post-cover` 属 a，`PostFooter .content` 属 b）。
 * 判别方法：拿 Nuxt 基线同页比对——基线里也没有这个元素，就是 (b)。
 */
console.log('\n  成因有两种可能，本工具分不出来，请勿直接套用 :global()：')
console.log('   (a) class 经 <Child class="x" /> 传下去，元素带的是子组件 cid')
console.log('       -> Vue 侧靠「子组件根元素同时带父 scope id」生效，Astro 侧须整体 :global(...)')
console.log('   (b) 该元素在本内容集里从不渲染')
console.log('       -> 与迁移无关，:global() 反而会把选择器放宽到全站')
console.log('  判别办法：比对冻结基线同页（baseline/nuxt/），基线里同样没有这个元素就是 (b)。')

/**
 * 已查明并接受的三条。
 *
 * 这个工具此前是「只要有死规则就退 1」，于是这三条让 acceptance 流水线**永久红**——
 * 一道永远红的门禁等价于没有门禁：没人会去看它是新问题还是老熟人。
 * 现在按 key 白名单判定：三条都在 → 退 0；**多出任何一条** → 退 1 并点名是哪条。
 *
 * 键就是**选择器文本本身**，它自带 `data-astro-cid-<hash>`；cid 是组件内容的哈希，
 * 所以「改过那个组件的 `<style>` 就重新判一次 (a)/(b)」这个初衷仍然成立。
 * 早先的键是 `<css 文件名> | <选择器>`，而 css 文件名带内容哈希、`Blog.*.css` 又是
 * 共享 bundle，于是同组任意一个组件改样式都会让**全部**键失效——2026-10-03 与今天
 * 各因此手工重钉过一次，而选择器与 cid 逐字未变。文件名只留作定位信息。
 */
const KNOWN = new Set([
	// (b) 类：主体在本内容集里从不渲染。`.content` 只出现在 Blog 的 cid 上，
	//     PostFooter 自己的 cid 上一个元素都没有 ⇒ :global() 反而会把选择器放宽。
	'.content[data-astro-cid-2z6spp2e]',
	'&>.title[data-astro-cid-hchfoe34]',
	// (b) 类：SearchModal 的 `.search-item.active`，弹层未打开时该组合不存在。
	//     两次重新钉住（2026-10-03、2026-10-04）都只是因为 css bundle 的内容哈希变了。
	'.active[data-astro-cid-66nxmncj] &',
])

const fresh = [...dead.keys()].filter(k => !KNOWN.has(k))
const stale = [...KNOWN].filter(k => !dead.has(k))

if (fresh.length) {
	console.error(`\n✗ 多出 ${fresh.length} 条未查明的死规则（已查明 ${KNOWN.size} 条）：`)
	for (const k of fresh)
		console.error(`  - ${k}  [${dead.get(k).bundle}]`)
	console.error('\n先按上面的 (a)/(b) 判别，再决定是加 :global() 还是接受它。')
	console.error('确认属于 (b) 之后，把它连同判据写进本文件的 KNOWN 集合。')
	process.exit(1)
}

if (stale.length) {
	console.log(`\n  注：KNOWN 里的 ${stale.length} 条这次没出现（该规则已被删掉，可以从名单里划掉）:`)
	for (const k of stale)
		console.log(`    ${k}`)
}
console.log(`\nOK: ${dead.size} 条死规则全部在已查明名单内，没有新面孔。`)
process.exit(0)
