/**
 * 前后台 date 时刻一致性门禁。
 *
 * ## 它盯的是什么
 *
 * 每篇 source frontmatter 的 `date`，必须和产物页里 `<time datetime="...">` 渲染成
 * **同一个时刻**。之前那版把两者当**字符串**比，报了 40/40 全错——100% 失败率本身就是
 * 信号：那不是 40 个缺陷，是一次不兼容的比较。
 *
 *     source: date: 2025-05-26 17:00:00          ← 裸墙上时钟
 *     产物:   datetime="2025-05-26T09:00:00Z"     ← UTC ISO
 *
 * 同一个瞬间，差了 8 小时的**写法**。字符串比较永远不可能成功。
 *
 * ## 为什么「按本地时间读 source」才是对的读法
 *
 * 内容管线用 JS 的 Date 构造函数解析这个非 ISO 字符串，**按构建机的时区**解释它，
 * 再序列化成 UTC。所以这道门禁必须用同一套解释方式——代价是：结论只在**跑门禁的机器
 * 和构建机器时区一致**时成立。因此摘要里会把当前 UTC 偏移打出来，时区对不上时是可诊断的，
 * 而不是玄学。同一类约束见 docs/astro-phase1-findings.md 26 的字体基线：基线的有效性
 * 建立在一条被明说的前提上，而不是建立在检查上。
 *
 * （PowerShell 原版靠 `AssumeUniversal` + `AdjustToUniversal` 让产物侧那个 `Z` 真的是 UTC；
 * JS 的 `new Date()` 遇到 `Z` 本身就按 UTC 解析，语义天然相同，无需再转换。）
 *
 * ## 路径
 *
 * 全部从 `import.meta.url` 解析，不依赖进程 CWD。PS 原版踩过这个坑：
 * `Resolve-Path '..\x'` 跟的是 CWD 而不是脚本位置。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

// 仓库根。不写死 'D:\...'，也不读 process.cwd()——收敛到共享的 REPO_ROOT，
// 理由见 scripts/lib/paths.mjs 文件头。
const ROOT = REPO_ROOT
const CONTENT_ROOT = join(ROOT, 'src', 'content')
const DIST = join(ROOT, 'dist')

let checked = 0
const mismatches = []
const skipped = []

/** 等价于 `Get-ChildItem $contentRoot -Recurse -File -Filter *.mdx`。 */
function collectMdx(dir) {
	// `-Filter` 在 Windows 上大小写不敏感，这里保持一致 → 谓词而非 ext。
	return walkFiles(dir, { test: (full, name) => /\.mdx$/i.test(name) })
}

/** .NET 的 File.ReadAllText 会吃掉 BOM，Node 的 readFileSync 不会。 */
function readText(file) {
	const text = readFileSync(file, 'utf8')
	return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

/**
 * source 的裸墙上时钟按**站点时区**（`blogConfig.timeZone`，即 Asia/Shanghai）解释，
 * 不用跑门禁那台机器的时区。
 *
 * 为什么必须钉死时区：source 写的是 `date: 2025-05-26 17:00:00`，产物是
 * `datetime="2025-05-26T09:00:00Z"`——17:00 +08:00 就是 09:00Z，两者是同一瞬间。
 * 「按本地时区读」只在跑门禁的机器恰好也是 +08:00 时成立。
 * PowerShell 原版就是这么过的：它一直在这台 +08:00 的开发机上跑，于是**这道门禁
 * 从来没有真正与时区无关**。2026-10-04 门禁迁到 Node、CI 第一次在 ubuntu runner
 * 上跑它（TZ=UTC），40 页全部差 8 小时——不是移植写错了，是原判据一直靠环境兜着。
 *
 * 与构建的一致性来自 `blogConfig.timeZone`（提交 7e3029c 已把它锁成显式值），
 * 不是来自「构建机碰巧在东八区」。所以这里从配置里读，不写死 +08:00。
 */
const SITE_TZ = (readText(join(ROOT, 'src', 'config', 'blog.ts')).match(/timeZone:\s*'([^']+)'/) || [])[1] || 'Asia/Shanghai'

/** 站点时区在某一瞬间的 UTC 偏移（分钟）。不硬编码偏移量，夏令时也不会错。 */
function siteOffsetMinutes(instantMs) {
	const part = new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, timeZoneName: 'longOffset' })
		.formatToParts(new Date(instantMs))
		.find(p => p.type === 'timeZoneName')
		?.value ?? 'GMT+00:00'
	const m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(part)
	if (!m)
		return 0
	return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/**
 * 把裸墙上时钟按站点时区折算成瞬间。
 *
 * `new Date("2025-05-26 17:00:00")` 在非 ISO 形式上按**本机**时区解析（V8 的实现
 * 细节），所以不能直接用它的 getTime()。做法是：先把这个墙上时钟当成 UTC 读
 * （`Date.UTC`），得到一个「无偏移」的基准，再减去该时刻站点时区的偏移。
 */
function parseSourceInstant(srcDate) {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(srcDate)
	if (!m) {
		// 带偏移或纯日期的输入：交给 Date 解析，并明确按 UTC 读，避免又依赖本机时区。
		const t = Date.parse(/Z|[+-]\d{2}:?\d{2}$/i.test(srcDate) ? srcDate : `${srcDate}Z`)
		return Number.isNaN(t) ? null : t
	}
	const [, y, mo, d, h, mi, s] = m
	const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))
	if (Number.isNaN(naive))
		return null
	// 偏移本身取决于时刻，用基准值查一次即可（Asia/Shanghai 无夏令时，
	// 即便有，用基准查出的偏移也足以定位正确的那个瞬间）。
	return naive - siteOffsetMinutes(naive) * 60_000
}

/**
 * 复刻 ParseExact($s, "yyyy-MM-ddTHH:mm:ss\Z", AssumeUniversal|AdjustToUniversal)：
 * 格式必须逐字符吻合，字段按 UTC 读。
 * PS 原版这行没有 try/catch，格式不符会直接把脚本打断（连带 exit 1）。这里改成记一条
 * mismatch——判定结论一致（仍然是红），但不会因为一页坏 HTML 就丢掉其余 39 页的报告。
 */
const OUT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
function parseOutputInstant(outDate) {
	if (!OUT_FORMAT.test(outDate))
		return null
	const t = new Date(outDate).getTime()
	return Number.isNaN(t) ? null : t
}

/** .NET 的 'yyyy-MM-ddTHH:mm:ss\Z' 自定义格式串在 JS 里的等价物。 */
function formatInstant(t) {
	return `${new Date(t).toISOString().slice(0, 19)}Z`
}

/** .NET TimeSpan 默认 ToString()：08:00:00 / -05:00:00。 */
function localUtcOffset() {
	const mins = -new Date().getTimezoneOffset()
	const sign = mins < 0 ? '-' : '+'
	const abs = Math.abs(mins)
	const p = n => String(n).padStart(2, '0')
	return `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}:00`
}

for (const full of collectMdx(resolve(CONTENT_ROOT))) {
	// mirror content.config.ts generateId(): strip extension, strip /posts, strip index
	// NOTE: 相对 content root 的切片会留下一个前导斜杠，必须先 trim 掉，
	// 否则 'posts/' 那一步对每条路径都不成立。
	const rel = relative(CONTENT_ROOT, full).replace(/\\/g, '/').replace(/^\/+/, '')
	const raw = readText(full)

	let relId = rel.replace(/\.mdx$/, '')
	if (relId.startsWith('posts/'))
		relId = relId.slice('posts/'.length)
	relId = relId.replace(/(^|\/)index$/, '$1').replace(/\/+$/, '')
	if (relId === '') {
		skipped.push(rel)
		continue
	}

	const page = join(DIST, relId, 'index.html')
	if (!existsSync(page)) {
		skipped.push(`${rel} (no page)`)
		continue
	}

	// 保持与 PS 原版 `(?m)^date:\s*(.+)$` 逐字一致：`\s*` 跨行贪婪、再由 `(.+)` 回退的
	// 那段语义是判据的一部分（裸 `date:` 会把下一行吃掉并报 unparseable），改写它等于偷偷
	// 换判据。输入是仓库自有的 mdx，不是攻击面。
	// eslint-disable-next-line regexp/no-super-linear-backtracking
	const srcDate = ((raw.match(/^date:\s*(.+)$/m) || [])[1] || '').trim()
	if (srcDate === '') {
		skipped.push(`${rel} (no date)`)
		continue
	}

	const html = readText(page)
	const mm = html.match(/datetime="([^"]*)"/)
	if (!mm) {
		skipped.push(`${rel} (no <time>)`)
		continue
	}

	checked++
	const outDate = mm[1]

	const srcInstant = parseSourceInstant(srcDate)
	if (srcInstant === null) {
		mismatches.push(`${rel}  unparseable source date: ${srcDate}`)
		continue
	}

	const outInstant = parseOutputInstant(outDate)
	if (outInstant === null) {
		mismatches.push(`${rel}  rendered datetime is not yyyy-MM-ddTHH:mm:ssZ: ${outDate}`)
		continue
	}

	if (srcInstant !== outInstant) {
		mismatches.push(
			`${rel}  src=${srcDate} (${formatInstant(srcInstant)})  out=${outDate}`,
		)
	}
}

console.log(`pages with a source date and a rendered <time> : ${checked}`)
console.log(`mismatches                                     : ${mismatches.length}`)
console.log(`skipped                                        : ${skipped.length}`)
console.log(`runner UTC offset                              : ${localUtcOffset()}`)
console.log('')

if (mismatches.length) {
	console.log('mismatches (first 10):')
	for (const m of mismatches.slice(0, 10))
		console.log(`  ${m}`)
	console.log('')
	console.log('RESULT: FAIL')
	process.exit(1)
}

console.log('RESULT: PASS - every rendered datetime is the same instant as its source frontmatter date')
process.exit(0)
