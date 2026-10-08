/**
 * 门禁：dist/subscriptions.opml 的去重、created 语义与可复现前提。
 *
 * ## 判据（两条 + 自证）
 * 1. **myFeed 恰好 1 个**：`src/pages/subscriptions.opml.ts` 曾在分组之外再
 *    显式 `mapEntry(myFeed)` 一次，而 `src/lib/feeds.ts:13` 已把 myFeed 放进
 *    第一个分组——订阅器里同一站点出现两遍。稳定标识取「本站自己的 atom.xml」
 *    （`new URL('/atom.xml', blogConfig.url)`），不靠计数以外的易漂字段。
 * 2. **created 可演化判据**：所有条目的 `created` 取值必须 ∈
 *    {各条目自己的 `date`} ∪ {`CREATED_EPOCH` 固定纪元}。
 *    判据**不是**「所有 created 相同」：将来给 feeds 条目补了 `date`，
 *    该条目的 created 就该取它自己的日期而不是纪元——补日期是演进，不是回归。
 *    允许的 date 集合从 `src/lib/feeds.ts` 的 `date:` 字面量与
 *    `config/blog.ts` 的 myFeed date（= `timeEstablished`）现场推导。
 * 3. **自证**：opml 缺失、outline 解析数为 0、纪元常量找不到（created 退回
 *    构建时钟的形态）都判 FAIL——样本为空不许静默通过。
 *
 * 纯静态读产物，不起浏览器。产物可复现（两次 build 无 diff）由验收流程的
 * 双构建 diff 验，本门禁钉的是「created 不偷取当前时间」这一语义根因。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { DIST, REPO_ROOT } from './lib/paths.mjs'

/**
 * date-only（`YYYY-MM-DD`）按 `toZonedTemporal` 的 PlainDateTime 分支解释：
 * 在 `blogConfig.timeZone`（Asia/Shanghai，固定 +08、无 DST）的零点。
 */
function toMs(s) {
	if (/^\d{4}-\d{2}-\d{2}$/.test(s))
		return Date.parse(`${s}T00:00:00+08:00`)
	return Date.parse(s)
}

const opmlFile = join(DIST, 'subscriptions.opml')
if (!existsSync(opmlFile)) {
	console.error('FAIL  dist/subscriptions.opml 不存在，先跑 pnpm build')
	console.error('RESULT: FAIL - 产物缺失，无法核对 OPML')
	process.exit(1)
}
const opml = readFileSync(opmlFile, 'utf8')
const outlines = [...opml.matchAll(/<outline\b([^>]*)>/g)].map(m => m[1])
if (!outlines.length) {
	console.error('FAIL  subscriptions.opml 里解析出的 <outline> 数为 0 —— 断言没接到东西，不能算通过')
	console.error('RESULT: FAIL - OPML 解析为空')
	process.exit(1)
}

function attr(attrs, name) {
	return new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1]
}

const problems = []

/* ── 判据 1：myFeed 恰好 1 个（稳定标识 = 本站 atom.xml）── */
const cfgSrc = readFileSync(join(REPO_ROOT, 'src/config/blog.ts'), 'utf8')
// blogConfig 的 url 是 basicConfig 里**单 tab 缩进**的那条；
// copyright.url（两 tab）同为 `url:` 键，不能按「第一个匹配」取。
const siteUrl = /^\turl:\s*'([^']+)'/m.exec(cfgSrc)?.[1]
if (!siteUrl) {
	console.error('FAIL  无法从 src/config/blog.ts 解析站点 url —— myFeed 的稳定标识推不出来，断言没接线')
	console.error('RESULT: FAIL - 门禁自证失败')
	process.exit(1)
}
const myFeedXmlUrl = new URL('/atom.xml', siteUrl).toString()
const mine = outlines.filter(a => attr(a, 'xmlUrl') === myFeedXmlUrl).length
if (mine !== 1)
	problems.push(`myFeed（本站 ${myFeedXmlUrl}）的 <outline> 有 ${mine} 个，应恰好 1 个`)

/* ── 判据 2：created ∈ {各条目 date} ∪ {CREATED_EPOCH} ── */
const pageSrc = readFileSync(join(REPO_ROOT, 'src/pages/subscriptions.opml.ts'), 'utf8')
const epoch = /const CREATED_EPOCH = '([^']+)'/.exec(pageSrc)?.[1]
if (!epoch)
	problems.push('src/pages/subscriptions.opml.ts 里找不到 CREATED_EPOCH 常量 —— created 若退回取构建时刻，产物即不可复现')

const allowed = new Map()
// 各条目自己的 date：feeds.ts 里的 `date: '...'` 字面量（当前为空集，补了即自动放行）
for (const m of readFileSync(join(REPO_ROOT, 'src/lib/feeds.ts'), 'utf8').matchAll(/\bdate:\s*'([^']+)'/g))
	allowed.set(toMs(m[1]), m[1])
// myFeed 的 date = blogConfig.timeEstablished（config/blog.ts 的 myFeed 块写死了这条关系）
const established = /timeEstablished:\s*'([^']+)'/
const establishedMatch = established.exec(cfgSrc)
if (establishedMatch)
	allowed.set(toMs(establishedMatch[1]), `timeEstablished=${establishedMatch[1]}`)
if (epoch)
	allowed.set(toMs(epoch), `CREATED_EPOCH=${epoch}`)

for (const attrs of outlines) {
	const created = attr(attrs, 'created')
	const who = attr(attrs, 'xmlUrl')
	if (created === undefined) {
		problems.push(`${who} 的 outline 缺 created 属性`)
		continue
	}
	const ms = Date.parse(created)
	if (Number.isNaN(ms))
		problems.push(`${who} 的 created ${JSON.stringify(created)} 不是合法时间戳`)
	else if (!allowed.has(ms))
		problems.push(`${who} 的 created ${created} 不在允许集合（各条目 date ∪ 纪元 ${epoch ?? '（常量缺失）'}）`)
}

console.log(`检查 ${outlines.length} 个 outline；允许 created 集合：${[...allowed.values()].join(' / ') || '（空）'}${epoch ? ` ∪ ${epoch}` : ''}`)
if (!problems.length) {
	console.log(`RESULT: OK - myFeed 恰好 1 个，${outlines.length} 个条目的 created 全部 ∈ {各条目 date} ∪ {固定纪元}`)
	process.exit(0)
}
for (const p of problems)
	console.error(`  - ${p}`)
console.error(`RESULT: FAIL - ${problems.length} 条 OPML 问题`)
process.exit(1)
