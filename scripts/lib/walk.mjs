/**
 * 文件系统目录遍历器的**唯一**实现。
 *
 * ## 收敛前是什么样
 *
 * 门禁脚本里有 17 处各自抄的递归遍历，同一份逻辑写了 6 种签名：
 *
 *     walk(dir, out = [])            ×10   最常见：`readdirSync` + `statSync`，无过滤
 *     walk(dir)                       ×2   同上但返回新数组、且对目录不存在时返回 []
 *     walk(dir, ext)                  ×1   按扩展名筛（`check-scope-anchors`）
 *     walk(dir, test, out = [])       ×2   按自定义谓词筛（`check-mdc-eval` / `check-text-literal`）
 *     箭头函数                        ×2   额外跳过若干目录（`compare-remote-sitemap`）
 *     walkFiles(dir)                  ×1   `withFileTypes` 版，只收 `isFile()`
 *     walkMdx(dir, out = [])          ×1   硬编码 `.mdx`
 *
 * 签名不统一本身不是问题，**问题是它们互相不等价，而差异没有任何地方写着**。
 * 三种已经咬过人的等价性假设：
 *
 * 1. **目录不存在时返回什么。** 一半的版本直接 `readdirSync` 让 ENOENT 抛出去，
 *    另一半先 `existsSync` 再返回空数组。前者让「产物没构建」红成崩溃堆栈，
 *    后者让门禁安静地扫 0 个文件然后报 PASS——后者更坏，因为它把「没跑」伪装成
 *    「跑过了」。「从别的目录调用时会安静地扫空目录然后报 PASS」这条教训就写在
 *    `check-content-preservation.mjs:44`。本实现选择**抛出去**（`readdirSync` 的
 *    原生行为），由调用方在**入口**决定「产物缺失」怎么编码（门禁里统一是
 *    `SKIP:` + exit 0，见 `accept.mjs` 的 `SKIP_MARKERS`）。
 *    遍历器不该替调用方做这个判断：判「没跑」的判据属于门禁，不属于遍历。
 *
 * 2. **排序——本次收敛里唯一真实咬人的一处。** 收敛前一半版本排序、一半不排序，
 *    而**排不排会改变门禁的报告顺序**：`audit-dead-scope` 把死规则按 CSS 文件的
 *    遍历顺序逐条插入 Map，不排序时报告里 3 条规则的先后就跟着文件系统走。
 *    把它改成默认排序，一句话的 diff 让它的输出整段换了顺序——而这次重构的硬约束
 *    是「输出逐字不变」，所以**排序必须是 opt-in，不能是默认**。
 *    两个真需要可复现顺序的门禁显式声明：`audit-deferred`（注释写着「排序只为让
 *    报告逐次可复现」）与 `check-content-preservation`（「顺序决定 unmapped 列表的
 *    「前 10 个」」）。顺带记一笔：**其余那些不排序的门禁，报告顺序本来就不可复现**
 *    ——同��份源码两次跑可能给出不同的条目次序。这不是本次要改的（改了就是行为变更），
 *    但要改的话得单独一次改动、逐个门禁对着基线验。
 *
 * 3. **符号链接与 `isFile()`。** `statSync` 跟随符号链接而 `Dirent.isFile()` 不跟。
 *    收敛前有一半版本用 `statSync`（跟随）、一半用 `Dirent`（不跟随）。
 *    本实现固定用 `Dirent`（**不跟随**），理由是 `check-assets.mjs:147` 已经把这条
 *    写成了规格：「不跟随符号链接目录，与 `Get-ChildItem -Recurse -File` 一致」。
 *    另一重考虑：`dist` 在本机是指向 `.output/public` 的 junction，跨平台跑时
 *    两条路径都真实存在，跟随可能把同一份产物走两遍、门禁时长翻倍。
 *    实测本仓库 `src/` 与 `dist/` 下没有任何符号链接，所以这一条**不改变当前任何
 *    输出**；它是把「两版里没写下来的一半」钉死，不是行为变更。
 *
 * ## 为什么 `ext` 与 `test` 要并存
 *
 * 两者表达同一件事，但适用面不同，写成互斥选项会让调用处在两者之间二选一、
 * 于是出现「有些门禁用 ext、有些用 test」的隐形分裂：
 *
 * - `ext` 是**声明式**的：`.html` / `['.astro', '.css']`。适合筛选条件就是扩展名时。
 * - `test` 是**命令式**的：`(fullPath, name) => boolean`。适合条件里还有别的东西。
 *   例如 `check-content-preservation` 要的是「大小写不敏感的 `.mdx`」——NTFS 上的
 *   `Get-ChildItem -Filter *.mdx` 就是大小写不敏感，写成 `ext: '.mdx'` 会**丢掉**
 *   `.MDX` 文件，而这种丢法在 Linux CI 上是静默的（源里本来就没有大写扩展名，
 *   门禁永远绿）。它的谓词与大小写无关的匹配必须留在调用方。
 *
 * 两者同时给是**与**的关系，不是二选一。
 *
 * ## 各门禁保留的刻意差异
 *
 * 遍历机制统一了，**业务判断一律留在调用方**。收敛时明确保留的有：
 *
 * - `check-scope-anchors` 收 `.astro` / `.ts` / `.css` 三种扩展名，谓词还要排除
 *   某些组件目录——那不是遍历的事。
 * - `compare-remote-sitemap` 显式传 `skipDirs: ['_astro', 'api']`：它要把 dist
 *   当成「站点路由清单」枚举，`_astro` 是资源目录、`api` 是端点，两者都不是页面。
 *   这**不是**与其他门禁的不一致，是它枚举的对象不同——其他门禁要的是「产物里的
 *   文件」，它要的是「站点的页面」。写进调用处而不是塞进默认值，就是为了让这个
 *   区别可见；`node_modules` / `.git` 在 dist 里不存在，所以这里覆盖掉默认值无影响。
 * - `check-self-contained` 的 `collectFiles` 还处理「目标本身是文件」的分支
 *   （`SCAN_TARGETS` 里混了 `astro.config.mjs`），且 `SKIP_DIRS` 含产物目录。
 *   那个入口分支留在本地，只把目录递归换成共享遍历器。
 *
 * 名字也统一成 `walkFiles`：收敛前 `walk` / `htmlFiles` / `collectMdx` /
 * `listMdx` / `walkFiles` / `walkMdx` 六个名字指同一件事。看到 `walkMdx` 就知道
 * 它硬编码了扩展名，而看到 `walkFiles` 就知道扩展名是参数——名字承载的那部分信息
 * 不该在被替换掉的那次重构里一起丢掉。同理，`walk` 这个名字被 `probe-subtree` /
 * `interaction-check` 用在**遍历 DOM 元素**上，所以共享模块选了 `walkFiles`
 * 这个不会撞名的。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 默认跳过的目录名：依赖树与版本库，遍历它们既慢又与「本仓库的源」无关 */
const DEFAULT_SKIP_DIRS = ['node_modules', '.git']

/**
 * 递归列出 `dir` 下的文件。
 *
 * 目录不存在时**抛 ENOENT**（不吞）：见文件头第 1 条，遍历器不替调用方决定
 * 「产物缺失」该算红还是算跳过。
 *
 * @param {string} dir 起始目录
 * @param {object} [opts]
 * @param {string|string[]} [opts.ext] 只收这些扩展名（含点，如 `.html`），大小写不敏感。与 `test` 是「与」关系
 * @param {string[]} [opts.skipDirs] 目录名黑名单。**替换**默认值（不是追加），
 *   所以想保留 `node_modules` / `.git` 又要加自己的，两个都得写出来
 * @param {(fullPath: string, name: string) => boolean} [opts.test] 自定义谓词，收文件时调用
 * @param {boolean|((a: string, b: string) => number)} [opts.sort] 遍历顺序。
 *   默认 `false` = 保持文件系统返回的顺序（收敛前多数门禁的行为）；
 *   `true` = 每层按 `.sort()`（UTF-16 码元序）；传比较函数则用它。
 *   **不要**图省事改成默认排序：报告顺序是门禁输出的一部分，见文件头第 2 条
 * @returns {string[]} 文件绝对路径
 */
export function walkFiles(dir, { ext, skipDirs, test, sort } = {}) {
	const skip = new Set(skipDirs ?? DEFAULT_SKIP_DIRS)
	const exts = ext === undefined
		? null
		: new Set((Array.isArray(ext) ? ext : [ext]).map(e => e.toLowerCase()))
	const cmp = typeof sort === 'function' ? sort : sort ? (a, b) => a.name.localeCompare(b.name) : null
	const out = []

	let entries = fs.readdirSync(dir, { withFileTypes: true })
	if (cmp)
		entries = entries.sort(cmp)
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (!skip.has(entry.name))
				out.push(...walkFiles(full, { ext, skipDirs, test, sort }))
			continue
		}
		// 只收 `isFile()`：符号链接（`isSymbolicLink()`）既不是文件也不是目录，
		// 按上面第 3 条被有意排除。
		if (!entry.isFile())
			continue
		if (exts && !exts.has(path.extname(entry.name).toLowerCase()))
			continue
		if (test && !test(full, entry.name))
			continue
		out.push(full)
	}
	return out
}
