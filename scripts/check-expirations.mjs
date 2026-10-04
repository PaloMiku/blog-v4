#!/usr/bin/env node
/**
 * 豁免台账门禁（`scripts/exemptions.json` 自身的治理门禁）。
 *
 * ## 它盯的是什么
 *
 * 顶层裸 `:global()` 的豁免清单以前是 `check-scope-anchors.mjs` 里的一个纯字符串数组。
 * 那份形态有个已被反复验证的性质：**它只会被追加，不会被偿还**。理由不写在数据里，
 * 就只能写在源码注释里；而注释不产生偿还压力——ICTSS 2023 对 12 个项目 19 种 test smell
 * 的实证里，只靠注释标记的债务，19 种中有 3 种被快速清除，9 种既不快也不慢。
 * 另一份实测（Bavota & Russo, MSR'16, 159 个项目）更狠：自认的技术债在「修复」之后
 * 平均仍存活 1000+ commits。注释标注的债务就是这种债务。
 *
 * 所以判据不能停在「把理由写下来」，必须绑定**治理强制力**：到期日 + 条数上限，
 * 两者都写进数据文件，于是「续期」和「新增」一样会产生 diff，会被 review 到。
 *
 * ## 为什么独立成一道门禁，而不是加在 check-scope-anchors 末尾
 *
 * 三个理由，都不是「拆开更清楚」这种审美：
 *
 * 1. **依赖不同。** `check-scope-anchors` 要读 `dist/` 复算可达性不变式；本门禁只读
 *    `scripts/exemptions.json`、`src/config/blog.ts` 和当前时刻。一条豁免到期跟产物
 *    是不是新构建的毫无关系，绑在一起会让「dist 旧了」和「债务到期了」两种红混在
 *    同一段输出里——而这两件事的处理人根本不是同一个。
 * 2. **失效方式不同。** `dist/` 缺失时 `check-scope-anchors` 的不变式会在空页集上
 *    「按 0 自动成立」地绿掉（它自己文件头写了这条）。把到期判据挂在它后面，就等于
 *    让偿还压力挂在一个可以被环境悄悄放过的门禁上。**判据的严格性不能寄生在别人的
 *    严格性上。**
 * 3. **归属档位不同。** `check-scope-anchors` 归默认档，而本门禁必须在任何时候都跑，
 *    包括 `--skip-build` 之外只想快速问一句「台账还合法吗」的时候。名字独立，
 *    `node scripts/check-expirations.mjs` 就能单跑，不需要一个能跑起来的 dist。
 *
 * ## 判据（全部是硬失败，没有一条是「只警告」）
 *
 * 0. 文件存在且能解析。**不写 try/catch 兜底**：解析失败必须 exit 1，
 *    否则一个坏掉的 JSON 会让这道门禁变成永远绿的沉默旁路（check-ci-triggers 判据 0
 *    记的就是这一族：门禁自己没跑起来，但汇报上看着像跑过了）。
 * 1. 形状：每条必须有 key / reason / added / expires；日期必须是 YYYY-MM-DD；
 *    expires 严格晚于 added；key 必须恰好一个制表符分隔的 `组件\t选择器`；key 不得重复。
 * 2. reason 不得是占位符（「已复核」「待定」「TODO」之类），且长度有下限。
 *    这条是为了让「迁移时批量写 29 条『已复核』」这种交付方式当场红掉。
 * 3. **棘轮**：条目总数不得超过 `meta.baseline`。
 * 4. **到期**：逾期条目数不得超过 `meta.maxOverdue`。分级是允许的（一次全红太陡，
 *    陡到没人想修），但绝不能降级成只警告不失败。
 * 5. `meta.timezone` 必须等于 `src/config/blog.ts` 的 `blogConfig.timeZone`。
 *
 * ## 时区：按纯日期比，不碰裸墙上时钟
 *
 * 坑位 26 的原样重演：`check-dates` 靠跑门禁那台机器的本地时区解释 source 里的裸
 * 墙上时钟，在 CI 的 `TZ=UTC` runner 上 40 页全红。日期比较一旦依赖本机时区，
 * 就会在 UTC+8 跑绿、UTC 跑红——两个答案都不对，是**两台机器**的答案。
 * 这里把「今天」按**站点时区**算成一个 `YYYY-MM-DD` 字符串，再和 `expires` 做
 * 字符串比较：两边都是纯日期，不涉及时刻，也就不涉及时区偏移。
 *
 * ## 门禁自己也要能被证伪
 *
 * `--selftest` 在**内存里**造若干份台账，逐条断言判据会红 / 会绿（`runSelfTest`）。
 * 它不读也不写 `scripts/exemptions.json`，所以可以随时跑、不会污染真实台账。
 * 其中必须包含一条**期望为绿**的样本：只测红的话，判据写死了也会全过。
 *
 * 用法：node scripts/check-expirations.mjs [--selftest]
 * 退出码：0 = 合法；1 = 有问题（含 JSON 解析失败、自检失败）
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FILE = join(ROOT, 'scripts', 'exemptions.json')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 占位符黑名单。
 *
 * 「已复核」「已确认」「TBD」这类词不是理由，是把复核这件事**记为已完成**。
 * 放进黑名单是为了让「迁移时批量填同一句话」当场红——那种交付在纯字符串数组时代
 * 根本无法被察觉（数组里只有 key，理由写在源码注释，而注释早就写在那了）。
 */
const PLACEHOLDER_RE = /已复核|已确认|已检查|无特殊理由|待定|待补|TODO|TBD|同上|略/

/** reason 长度下限（按字符计）。低于它的理由不可能说清「为什么这条确实加不了锚点」。 */
const MIN_REASON = 20

/**
 * 站点时区。
 *
 * 唯一事实源是 `blogConfig.timeZone`，不是 process.env.TZ、不是本机时区、
 * 也不是写死的 +08:00——与 `check-dates` 同一套读法（坑位 26 的教训）。
 * 读不到时返回 null，由调用方判红，而不是悄悄回落到某个默认值：
 * 「配置读不到就按默认时区算」在 CI 上就是一个会飘的绿。
 */
function siteTimeZone() {
	const cfg = join(ROOT, 'src', 'config', 'blog.ts')
	if (!existsSync(cfg))
		return null
	const m = readFileSync(cfg, 'utf8').match(/timeZone:\s*'([^']+)'/)
	return m ? m[1] : null
}

/**
 * 某一瞬间在指定时区的 `YYYY-MM-DD`。
 *
 * 用 formatToParts 手工拼，不依赖 `en-CA` 在各 ICU 版本下的输出格式。
 * `nowMs` 显式传参是为了让 `--selftest` 能喂固定时刻——否则自检的结论会随
 * 跑门禁的日期变化，测试就会在某一天无缘无故地红。
 */
function civilDate(nowMs, timeZone) {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
		.formatToParts(new Date(nowMs))
	const get = t => parts.find(p => p.type === t)?.value ?? ''
	return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * 全部判据。纯函数：只吃台账对象和「今天」，不碰文件系统和时钟。
 *
 * 这样 `--selftest` 才能在内存里造样本、断言判据会红；判据和 IO 混在一起的话，
 * 故障注入就只能靠改真实文件，而改真实文件的那一次往往就是没人复核的那一次。
 *
 * @param {object} doc exemptions.json 解析后的内容
 * @param {string} today 站点时区的今天，YYYY-MM-DD
 * @param {string|null} siteTz blogConfig.timeZone
 * @returns {{code: string, detail: string}[]} 每条一处，code 用来在汇总里归类
 */
function audit(doc, today, siteTz) {
	const problems = []
	const bad = (code, detail) => problems.push({ code, detail })

	if (!doc || typeof doc !== 'object' || Array.isArray(doc))
		return [{ code: '形状', detail: '顶层不是一个对象。' }]

	const meta = doc.meta
	const list = doc.exemptions

	if (!meta || typeof meta !== 'object') {
		bad('形状', '缺 meta 段。棘轮基线和到期上限都住在那里，缺了就等于没有上限。')
	}
	if (!Array.isArray(list))
		return [{ code: '形状', detail: 'exemptions 不是一个数组。' }]

	// 时区先查：后面所有日期比较的基准都来自它，配置本身错了的话其余结论都不可信。
	if (meta && meta.timezone !== siteTz) {
		bad('时区', `meta.timezone=${JSON.stringify(meta.timezone)} 与 src/config/blog.ts 的 timeZone=${JSON.stringify(siteTz)} 不一致。`
		+ '日期比较的基准必须和构建管线用同一个时区，否则「今天」在两台机器上是两个日子。')
	}

	// ---- 逐条字段 ----
	const seen = new Map()
	list.forEach((e, i) => {
		const at = `exemptions[${i}]`
		if (!e || typeof e !== 'object' || Array.isArray(e)) {
			bad('字段', `${at} 不是一个对象。`)
			return
		}
		for (const k of ['key', 'reason', 'added', 'expires']) {
			if (typeof e[k] !== 'string' || e[k].trim() === '')
				bad('字段', `${at} 缺 ${k}。`)
		}
		if (typeof e.key === 'string') {
			// 制表符是键的分隔符。多一个少一个都会让 check-scope-anchors 那边匹配不上，
			// 而那种失配的表现是「新增了一条裸 global 被报红」，报错指向错误的行。
			if (e.key.split('\t').length !== 2 || e.key.includes('\n'))
				bad('字段', `${at} 的 key 必须是「组件\\t选择器」两段，实得 ${JSON.stringify(e.key)}。`)
			if (seen.has(e.key))
				bad('字段', `${at} 的 key 与 exemptions[${seen.get(e.key)}] 重复：${JSON.stringify(e.key)}。重复项会让棘轮数虚高。`)
			else
				seen.set(e.key, i)
		}
		if (typeof e.reason === 'string' && e.reason.trim() !== '') {
			if (PLACEHOLDER_RE.test(e.reason)) {
				bad('理由', `${at} 的 reason 是占位符：「${e.reason.trim().slice(0, 24)}」。`
				+ '理由要写清「主体由谁渲染 / 为什么加不了锚点」，不是写清「有人看过」。')
			}
			else if (e.reason.trim().length < MIN_REASON) {
				bad('理由', `${at} 的 reason 只有 ${e.reason.trim().length} 字（下限 ${MIN_REASON}）。`
				+ '短到这个程度通常意味着写的是代码在做什么，而不是为什么它可以豁免。')
			}
		}
		for (const k of ['added', 'expires']) {
			if (typeof e[k] === 'string' && e[k].trim() !== '' && !DATE_RE.test(e[k]))
				bad('字段', `${at} 的 ${k}=${JSON.stringify(e[k])} 不是 YYYY-MM-DD。带时刻就会把时区问题引回来。`)
		}
		if (DATE_RE.test(e.added || '') && DATE_RE.test(e.expires || '') && e.expires <= e.added)
			bad('字段', `${at} 的 expires（${e.expires}）不晚于 added（${e.added}），这条一进台账就已经到期。`)
	})

	// ---- 棘轮 ----
	const baseline = meta?.baseline
	if (!Number.isInteger(baseline) || baseline < 0) {
		bad('棘轮', `meta.baseline=${JSON.stringify(baseline)} 不是一个非负整数——上限没写等于没上限。`)
	}
	else if (list.length > baseline) {
		bad('棘轮', `条目数 ${list.length} 超过基线 ${baseline}。`
		+ '新增豁免必须同时把 meta.baseline 往上改一行，那一行 diff 就是 review 的落点；'
		+ '如果这次新增本来就该被拒，别改基线。')
	}

	// ---- 到期 ----
	// 「到期」= expires 早于今天（纯日期字符串比较）。等于今天不算：当天到期当天还看得见。
	const overdue = list.filter(e => DATE_RE.test(e.expires || '') && e.expires < today)
	const max = meta?.maxOverdue
	if (!Number.isInteger(max) || max < 0) {
		bad('到期', `meta.maxOverdue=${JSON.stringify(max)} 不是一个非负整数。`)
	}
	else if (overdue.length > max) {
		const lines = overdue.map(e => `      ${e.key.replace(/\t/g, ' → ')}（expires ${e.expires}）`).join('\n')
		bad('到期', `逾期 ${overdue.length} 条，超过上限 ${max} 条：\n${lines}\n`
		+ '    三个出口：给规则补锚点（删条目）/ 复核后写清具体理由（重写条目）/ 直接删。'
		+ '批量续期要改这个文件，有 diff，会被 review 到。')
	}

	return problems
}

function report(problems) {
	for (const p of problems)
		console.log(`\n  [${p.code}] ${p.detail}`)
	console.log('')
}

/**
 * 门禁自检：在内存里造台账，逐条断言判据的红 / 绿。
 *
 * 为什么必须包含**期望为绿**的样本：只测红的话，「判据里写了个恒真条件」这种
 * 最常见的门禁 bug 会全数通过。绿样本把「判据放过了合法台账」也变成可观测的。
 */
function runSelfTest() {
	const good = (over = {}) => ({
		meta: { baseline: 1, maxOverdue: 1, timezone: 'Asia/Shanghai', ...over },
		exemptions: [{ key: 'X\t:global(.a)', reason: '主体由子组件渲染，元素带的是子组件的 cid，本组件的 scoped 选择器永远匹配不到。', added: '2026-10-01', expires: '2099-01-01' }],
	})
	const T = '2026-10-04'
	const cases = [
		['合法台账必须绿', good(), T, 0],
		['条目数超过基线必须红', (() => {
			const d = good()
			d.meta.baseline = 1
			d.exemptions.push({ ...d.exemptions[0], key: 'Y\t:global(.b)' })
			return d
		})(), T, 1],
		['逾期条数超上限必须红', (() => {
			const d = good()
			d.meta.maxOverdue = 0
			d.exemptions[0].expires = '2026-01-01'
			d.exemptions[0].added = '2025-12-01'
			return d
		})(), T, 1],
		['逾期在上限内不得红（分级不是全红）', (() => {
			const d = good()
			d.meta.maxOverdue = 1
			d.exemptions[0].expires = '2026-01-01'
			d.exemptions[0].added = '2025-12-01'
			return d
		})(), T, 0],
		['expires 等于今天不算逾期', (() => {
			const d = good()
			d.exemptions[0].expires = T
			return d
		})(), T, 0],
		['占位符理由必须红', (() => {
			const d = good()
			d.exemptions[0].reason = '已复核'
			return d
		})(), T, 1],
		['过短理由必须红', (() => {
			const d = good()
			d.exemptions[0].reason = '需要'
			return d
		})(), T, 1],
		['expires 不晚于 added 必须红', (() => {
			const d = good()
			d.exemptions[0].expires = d.exemptions[0].added
			return d
		})(), T, 1],
		['重复 key 必须红', (() => {
			const d = good()
			d.meta.baseline = 2
			d.exemptions.push({ ...d.exemptions[0] })
			return d
		})(), T, 1],
		// 站点时区被换成 UTC（模拟「有人在 JSON 里单方面改时区」）：判据要红。
		['时区与配置不符必须红', good(), T, 1, 'UTC'],
		['顶层不是对象必须红', [], T, 1],
		['exemptions 不是数组必须红', { meta: {} }, T, 1],
		['缺 meta.baseline 必须红', (() => {
			const d = good()
			delete d.meta.baseline
			return d
		})(), T, 1],
	]

	let failed = 0
	for (const [name, doc, today, expect, forceTz] of cases) {
		const got = audit(doc, today, forceTz ?? doc?.meta?.timezone ?? 'Asia/Shanghai').length > 0 ? 1 : 0
		const ok = got === expect
		if (!ok)
			failed++
		console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}（期望 ${expect ? '红' : '绿'}，实得 ${got ? '红' : '绿'}）`)
	}
	console.log(`\nselftest: ${cases.length - failed}/${cases.length} 通过`)
	return failed
}

const args = process.argv.slice(2)

if (args.includes('--selftest')) {
	console.log('=== 门禁自检（内存台账，不碰 scripts/exemptions.json）===')
	const failed = runSelfTest()
	process.exit(failed ? 1 : 0)
}

// ---- 真实台账 ----
if (!existsSync(FILE)) {
	console.log(`FAIL: ${FILE} 不存在。豁免台账没了，check-scope-anchors 会把所有顶层裸 :global() 判红。`)
	process.exit(1)
}

const raw = readFileSync(FILE, 'utf8')

// 刻意不写 try/catch：JSON 坏了必须红。兜一个默认值放行，等于把「门禁自己没跑起来」
// 变成一道永远绿的旁路——这是 check-ci-triggers 判据 0 记的那一族失败。
let doc
try {
	doc = JSON.parse(raw)
}
catch (err) {
	console.log(`FAIL: scripts/exemptions.json 解析失败：${err.message}`)
	process.exit(1)
}

const tz = siteTimeZone()
if (!tz) {
	console.log('FAIL: 读不到 src/config/blog.ts 的 timeZone。不猜时区——猜错的话「今天」就是错的，'
		+ '而一个按错误基准算出来的到期判据会稳定地给出错误答案。')
	process.exit(1)
}

const today = civilDate(Date.now(), tz)
const problems = audit(doc, today, tz)
const list = Array.isArray(doc?.exemptions) ? doc.exemptions : []

console.log(`=== 豁免台账 scripts/exemptions.json ===`)
console.log(`  站点时区      ${tz}`)
console.log(`  今天（该时区）${today}`)
console.log(`  条目数        ${list.length} / 基线 ${doc?.meta?.baseline}`)
console.log(`  逾期          ${list.filter(e => DATE_RE.test(e.expires || '') && e.expires < today).length} / 上限 ${doc?.meta?.maxOverdue}`)
console.log('')

if (problems.length) {
	console.log(`FAIL: ${problems.length} 处`)
	report(problems)
	process.exit(1)
}
console.log('OK: 台账在棘轮上限内、没有超过到期上限，每条都有具体理由和到期日。')
