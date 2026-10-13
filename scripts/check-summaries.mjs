/**
 * 摘要数据一致性门禁。
 *
 * ## 它盯的是什么
 *
 * `src/data/summaries.json` 是摘要的唯一真相源（frontmatter 里已无 `description`）。
 * 这道门禁盯五条不变量：
 *
 *   1. **键集合 == glob loader 的条目 id 集合**。多一个键 = 有幽灵摘要（文章删了键没删）；
 *      少一个键 = 有裸奔文章（走了「标题——站点名」的占位兜底，却没人知道该补）。
 *   2. **每条 `seo` ≤ `SEO_DESCRIPTION_MAX`（150）**。超长的会被 `clampDescription`
 *      在渲染期截断，于是 meta 与 JSON 源不一致——判据应该拦在源头，而不是
 *      依赖渲染期兜底。
 *   3. **frontmatter 里不再出现 `description:`**。真相源分裂是这类迁移最常见的
 *      残留：改 JSON 不生效，因为有人还在改 frontmatter。
 *   4. **每条 `seo` 非空**。空串既不超长（判据 2 放行）也覆盖不到 summary
 *      （判据 3 只看 summary），而它在渲染期的后果是 meta description 空白，
 *      详见判据处的注释。
 *   5. **summary 与 seo 不含换行**。`Excerpt.astro` 的摘要块是 `pre-wrap`，
 *      JSON 里的 `\n` 会原样渲染成硬回车；seo 则不该带换行进 meta。
 *
 * ## 为什么第 1 条不能靠「数一下相等」
 *
 * 只比数量的话，一个键拼错 + 另一个键重复，数量照样相等。
 * 判据是**集合差集**，双向都要报（多余 / 缺失各列各的）。
 *
 * ## 为什么第 3 条要限定在 frontmatter 内
 *
 * `src/content/posts/2024/10/write-1panel-app.mdx` 的**正文**里有一整块 1Panel
 * 应用声明的 YAML 模板，其中就有 `description: 强大易用的开源建站工具`——
 * 那是文章内容的一部分，不是 frontmatter。按全文 grep 会把这 25 个正常文章
 * 全报成「真相源分裂」。同类约束见 CLAUDE.md 坑位 28：判据必须剥掉代码块与注释
 * 再数落点，认结构不认字面量。
 *
 * ## 键是怎么算出来的
 *
 * 必须与 `src/lib/shared/content-id.ts` 的 `generateId` 逐字同源（permalink 优先、
 * 去 `/posts` 前缀、`index` 指目录本身）。这里不 import 它——`generateId` 的签名
 * 需要 glob loader 构造的 entry 对象，而这个门禁要处理的是**磁盘上还没有被 loader
 * 加载**的纯文件。两份算法靠测试（`tests/summaries.test.mjs`）钉住同一条 id 规则。
 *
 * ## 路径
 *
 * 全部从 `import.meta.url` 解析（`scripts/lib/paths.mjs`），不依赖进程 CWD。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

/**
 * 与 `src/lib/shared/seo.ts` 的 `SEO_DESCRIPTION_MAX` 同值。
 *
 * 这里**刻意不 import** 那个 `.ts`：`accept.mjs` 的 `runNode` 不带
 * `--experimental-transform-types`，从纯 `.mjs` 引 `.ts` 会直接失败。
 * 门禁侧持有一份字面量，源侧若改了上限，这里的判据会先红——这正是我们要的
 * （改上限必然伴随「现网 seo 全部超限或全部偏短」的可观测后果，不该静默）。
 * 唯一的成本是这行数字要在两处同步，由 `tests/summaries.test.mjs` 里
 * 「门禁侧常量与 seo.ts 同值」那条用例钉住——它读本文件的源码文本取值再比对，
 * 不是各写一个期望值。
 */
const SEO_DESCRIPTION_MAX = 150

const ROOT = REPO_ROOT
const CONTENT_ROOT = join(ROOT, 'src', 'content')
const SUMMARIES = join(ROOT, 'src', 'data', 'summaries.json')

if (!existsSync(SUMMARIES)) {
	console.log(`SKIP: summaries.json 不存在（${relative(ROOT, SUMMARIES)}）`)
	console.log('RESULT: PASS - 没有摘要数据可查')
	process.exit(0)
}

const raw = JSON.parse(readFileSync(SUMMARIES, 'utf8'))
const entries = raw.entries ?? {}

/**
 * 与 content-id.ts 的 generateId 同源的离线版。
 * generateId 需要 loader 构造的 entry（entry/data/base 三件套），
 * 这里只有磁盘路径，所以取其中与「路径 + frontmatter.permalink」有关的部分。
 */
function entryIdFor(normContentPath, permalink) {
	if (typeof permalink === 'string' && permalink)
		return permalink.replace(/^\/+|\/+$/g, '')
	let rel = normContentPath.replace(/\.mdx$/, '')
	rel = rel.replace(/(^|\/)index$/, '$1').replace(/\/+$/, '')
	if (rel.startsWith('posts/'))
		rel = rel.slice('posts/'.length)
	return rel
}

const problems = []
let postCount = 0
/** 发现的文章 id 集合，供「幽灵键」判据（判据 1 的另一半）反查 */
const postIds = new Set()

for (const full of walkFiles(CONTENT_ROOT, { ext: '.mdx' })) {
	const norm = relative(ROOT, full).replace(/\\/g, '/')
	const src = readFileSync(full, 'utf8')

	// frontmatter 边界：必须是文件**开头**的 `---`，不是正文里任意位置的 `---`
	const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!fm)
		continue

	// 判据 3：只在 frontmatter 块内找 description
	if (/^description[ \t]*:/m.test(fm[1]))
		problems.push({ kind: 'frontmatter-description', id: norm, detail: 'frontmatter 仍有 description（真相源分裂）' })

	// 只对文章（posts/ 下）要求 JSON 条目；games/ 等独立页没有摘要是现状，不是缺陷
	if (!norm.startsWith('src/content/posts/'))
		continue
	postCount++

	const permalink = fm[1].match(/^permalink[ \t]*:[ \t]*(\S+)/m)?.[1]
	const id = entryIdFor(norm.replace('src/content/', ''), permalink)
	postIds.add(id)

	// 判据 1：少一个键
	if (!(id in entries)) {
		problems.push({ kind: 'missing', id, detail: 'summaries.json 无此条目' })
		continue
	}

	// 判据 2：seo 长度
	const seo = entries[id]?.seo ?? ''
	if (seo.length > SEO_DESCRIPTION_MAX)
		problems.push({ kind: 'seo-too-long', id, detail: `seo ${seo.length} 字 > ${SEO_DESCRIPTION_MAX}` })

	if (!entries[id]?.summary)
		problems.push({ kind: 'no-summary', id, detail: '条目缺 summary' })

	/*
	 * 判据 4：seo 非空。
	 *
	 * ⚠️ 上面两条都放得过空串：`seo.length > 150` 对 `''` 不成立，`no-summary`
	 * 只看 summary。而空 seo 有**真实**后果，不是洁癖——loader 的 `if (rec?.seo)`
	 * 把空串挡掉不注入，`[...slug].astro` 里 `entry.data.seo ?? fallback` 对空串
	 * **不生效**（空串非 nullish），于是那篇文章的 meta description 是空白。
	 * 迁移期 38 条 seo 全满，碰不到；`pnpm summary` 接上模型后，模型漏掉 seo
	 * 就成了真实触发路径（生成侧已有 clampDescription 兜底，两侧都要堵）。
	 */
	if (entries[id] && !seo.trim())
		problems.push({ kind: 'seo-empty', id, detail: 'seo 为空 → meta description 会是空白' })

	/*
	 * 判据 5：summary 不含换行。
	 *
	 * `Excerpt.astro` 的摘要块是 `white-space: pre-wrap`，所以 JSON 里的
	 * `\n` 会**原样**渲染成硬回车 —— 同一页里只有这一条摘要是分段落的，
	 * 与其余每条单段的视觉不一致。实测曾有 2 条中招（sickly-days-linux-run、
	 * fedora-silverblue-…），后随摘要重写消失，但成因还在：模型完全可能
	 * 在正文里换行，而现有的长度 / 非空判据一条都拦不住。
	 *
	 * `seo` 同理 —— 它要进 meta description，换行在那里没有意义。
	 *
	 * 归一化放在生成侧（`clampDescription` 附近），这里只拦结果：门禁要防的是
	 * 「数据里出现了不该有的字符」，不是「谁写进去的」。
	 */
	if (typeof entries[id]?.summary === 'string' && /[\r\n]/.test(entries[id].summary))
		problems.push({ kind: 'summary-newline', id, detail: 'summary 含换行 → 页面渲染成硬回车' })

	if (/[\r\n]/.test(seo))
		problems.push({ kind: 'seo-newline', id, detail: 'seo 含换行 → meta description 不该有换行' })
}

// 判据 1：多一个键（幽灵摘要）
for (const id of Object.keys(entries)) {
	if (!postIds.has(id))
		problems.push({ kind: 'orphan', id, detail: 'JSON 有键但无对应文章' })
}

const byKind = new Map()
for (const p of problems) {
	if (!byKind.has(p.kind))
		byKind.set(p.kind, [])
	byKind.get(p.kind).push(p)
}

console.log(`posts in content            : ${postCount}`)
console.log(`entries in summaries.json   : ${Object.keys(entries).length}`)
console.log(`seo max length              : ${SEO_DESCRIPTION_MAX}`)
console.log(`problems                    : ${problems.length}`)
console.log('')

if (problems.length) {
	for (const [kind, list] of byKind) {
		console.log(`${kind} (${list.length}):`)
		for (const p of list.slice(0, 20))
			console.log(`  ${p.id}  — ${p.detail}`)
		if (list.length > 20)
			console.log(`  …还有 ${list.length - 20} 条`)
		console.log('')
	}
	console.log('RESULT: FAIL')
	process.exit(1)
}

console.log('RESULT: PASS - 摘要 JSON 与内容一一对应，seo 全部在限内，frontmatter 无残留 description')
process.exit(0)
