/**
 * Phase 4 交互层接线门禁。
 *
 * ## 它在防什么失败模式
 *
 * 这道门禁防的是「源码里有、产物里没有」这一族失败。
 *
 * Astro 会**静默丢弃**没被引用到的组件：文件还在、`import` 还在编辑器里能跳转、
 * 类型检查也过，只是没人用它，于是它一个字节都不会进产物。而交互层——弹窗栈、
 * 灯箱、搜索、图片缩放——**没有 DOM 标记就等于不存在**，页面上什么都不会少一块，
 * 只有真的点一下才会发现。所以这里每个标记都在**构建产物**里查，不看源码。
 *
 * 第二条防线是 code-splitting。Astro 把 `<script>` 拆成独立的 chunk，
 * 只搜内联 `<script>` 会给每一个拿到自己 chunk 的组件报假阴性（"标记不见了"）。
 * 所以客户端逻辑同时在 `_astro/*.js` 里搜。
 *
 * 第三条是「结构已删」的反向断言。分享功能在 Nuxt 与 Astro 两侧都被删干净了；
 * 那三条断言是**故意倒过来写**而不是删掉的：结构一旦删掉，它唯一能悄悄回来的方式
 * 就是有人重新引入那些标记，而这三条正是唯一会因此变红的判据。任何正向断言在这里
 * 都不会红。
 *
 * ## 相对 PowerShell 版的改动
 *
 * 逻辑、判据条数、判据本身逐条不变。只换掉运行环境相关的部分：
 *
 * - 根目录从**脚本自身位置**解析（`import.meta.url`），不跟进程 CWD。
 *   原 PS 版用 `Resolve-Path '.\dist'`，跟的是调用者的 CWD——从别的目录
 *   `powershell -File` 调它就会去读错的地方、或者 SKIP 掉。
 * - PowerShell 的 `-match` 默认**大小写不敏感**，翻译成 JS 正则时逐条加了 `i` 标志。
 *   （`Has` 走的是 `.Contains`，大小写敏感，对应 `String.includes`，不加标志。）
 * - 去掉 PowerShell 专属的告警（ANSI 码页、必须 ASCII-only、`$PSScriptRoot` 一类）；
 *   那些限制在 Node 下不存在。
 * - 产物目录下的文件按名字排序后拼接。`Get-ChildItem` 在 Windows 上本来就是按名字
 *   排序的，这里只是把顺序钉死，免得扫描顺序随文件系统变化。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { DIST } from './lib/paths.mjs'

const ASSETS = join(DIST, '_astro')

const PAGE = join(DIST, '2025', '11', 'riddle-joker', 'index.html')

if (!existsSync(PAGE)) {
	console.log('SKIP: page not built')
	// 原 PS 版在这里也是 exit 1：门禁跑不起来等于没验过，不该算通过。
	process.exit(1)
}

const html = readFileSync(PAGE, 'utf8')

/**
 * 拼接 `_astro` 下某个扩展名的全部产物。
 * 逐字对应原版 `Get-ChildItem <dir> -Filter *.ext | ForEach-Object { ReadAllText }` -join "`n"：
 * 非递归、按扩展名过滤（PowerShell 的 -Filter 大小写不敏感）、不含子目录。
 */
function concatAssets(ext) {
	let names
	try {
		names = readdirSync(ASSETS, { withFileTypes: true })
	}
	catch (e) {
		console.error(`ERROR: 读不到 ${ASSETS}（${e.code || e.message}）`)
		process.exit(1)
	}
	return names
		.filter(d => d.isFile() && d.name.toLowerCase().endsWith(ext))
		.map(d => d.name)
		.sort()
		.map(name => readFileSync(join(ASSETS, name), 'utf8'))
		.join('\n')
}

const jsAll = concatAssets('.js')
const cssAll = concatAssets('.css')

const all = html + jsAll

const has = (hay, needle) => hay.includes(needle)

/**
 * 判据表。顺序与原 PS 版的有序哈希表逐条一致，正向/反向语义不变。
 * `hint` 只在失败时打印出来给人看，不参与判定。
 */
const checks = [
	// modal stack wiring
	['modal host mounted', () => has(html, 'data-modal-host'), 'HTML 里没有 data-modal-host：弹窗栈根节点没渲染'],
	['modal scrim present', () => has(html, 'data-modal-scrim'), 'HTML 里没有 data-modal-scrim：遮罩没渲染'],
	['search modal registered', () => has(html, 'data-modal="search"'), '搜索弹窗没有注册到弹窗栈'],
	['lightbox registered', () => has(html, 'data-modal="lightbox"'), '灯箱没有注册到弹窗栈'],
	['lightbox trigger script', () => has(all, 'openModal'), '产物（HTML + JS chunk）里找不到 openModal：客户端逻辑被 tree-shake 掉了'],
	// The share feature was removed on both sides (Nuxt + Astro).
	// These three assertions are inverted rather than deleted on purpose: once the
	// structure is gone, the only way it can silently come back is someone
	// reintroducing those markers, and no positive assertion here would go red.
	// Scan $all (HTML + JS chunks), not just $html: the trigger markup and the modal
	// root are in the HTML, the init code is in a client chunk.
	['share fully removed', () => !/data-share|data-modal="share"|blog-share|shareReady|share-(?:card|qr|menu|item|icon)/i.test(all), '分享功能的标记又回来了：data-share / data-modal="share" / blog-share / shareReady / share-*(card|qr|menu|item|icon)'],
	// Button.astro data-* regression (trap: undeclared props are dropped)
	['button primary class', () => has(html, 'z-button button primary'), 'Button.astro 把 data-* 吞了：产物里没有 "z-button button primary"'],
	// image zoom intent
	['pic zoom hook', () => has(html, 'data-zoom-caption'), '图片没有挂上 data-zoom-caption：点图放大失效'],
	// article features
	['AI excerpt', () => has(html, 'ai-excerpt'), 'AI 摘要标记缺失'],
	['excerpt content id', () => has(html, 'excerpt-content'), '摘要容器 id 缺失'],
	['twikoo container', () => has(html, 'id="twikoo"'), 'twikoo 容器缺失：评论区挂不上'],
	['twikoo init call', () => has(all, 'envId'), '产物里找不到 envId：twikoo 初始化代码没了'],
	// layout shell
	['blog-root', () => has(html, 'id="blog-root"'), '布局外壳 #blog-root 缺失'],
	['main content', () => has(html, 'id="main-content"'), '布局外壳 #main-content 缺失'],
	// css regressions
	['no invalid :hover>&', () => !/\[[^\]]+\]:hover>&/i.test(cssAll), '产物 CSS 里有非法的 `[...]:hover>&`（死规则，不报错也不生效）'],
	['no double-scoped article', () => !/article\[data-astro-cid-[^\]]+\]\s*\./i.test(cssAll), '产物 CSS 里有 article 叠加 data-astro-cid 的二次作用域规则'],
]

let pass = 0
let fail = 0
/** @type {string[]} */
const failed = []

for (const [name, run, hint] of checks) {
	if (run()) {
		console.log(`  OK    ${name}`)
		pass++
	}
	else {
		console.log(`  FAIL  ${name}`)
		failed.push(`${name} — ${hint}`)
		fail++
	}
}

console.log('')
console.log(`PASS: ${pass}  FAIL: ${fail}`)

if (fail === 0) {
	console.log('RESULT: PASS - phase 4 integration intact')
	process.exit(0)
}

console.log(`RESULT: FAIL - ${fail} issue(s)`)
console.log('')
for (const f of failed)
	console.log(`  - ${f}`)
// 门禁是被当子进程跑的，退出码就是裁决。只打印 RESULT: FAIL 不够：
// 没有显式非零退出码，子进程返回 0，这道门禁永远红不了。
process.exit(1)
