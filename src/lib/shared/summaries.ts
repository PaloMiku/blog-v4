/**
 * 摘要数据的读取与派生规则。`src/data/summaries.json` 是摘要的唯一真相源，
 * 内容源仍是 src/content 下的 mdx——两者职责分得很清楚：
 * mdx 管**写了什么**，JSON 管**怎么向读者描述它**。
 *
 * 本模块无 astro 依赖，`pnpm summary` 与 `scripts/check-summaries.mjs`
 * 与站点构建共用同一份规则（见 CLAUDE.md 坑位 23 的同族教训：
 * 判据与写入口若各持一份算法，漂移只是时间问题）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface SummaryEntry {
	/** 完整长摘要：Excerpt / JSON-LD / Atom / llms.txt / 列表卡片 */
	summary?: string
	/** ≤ SEO_DESCRIPTION_MAX 字：meta description 与 og:description */
	seo?: string
	/** 上次生成时正文的 sha256，用于增量跳过（见 hashSource） */
	sourceHash?: string
}

export interface SummaryFile {
	$meta?: {
		/** 完整的模型 ID（复现调用需要的那个字符串），空串 ⇒ 徽章不渲染 */
		model?: string
		/** 徽章显示用的短名；缺省时由 deriveModelLabel 从 model 推导 */
		modelLabel?: string
	}
	entries?: Record<string, SummaryEntry>
}

/**
 * meta description 的截断上限与截断规则。
 *
 * 实现已移到 `shared/seo.ts`（纯函数，渲染期与生成期共用一份），
 * 这里只做转出，让既有调用方的写法不变。
 */
export { clampDescription, SEO_DESCRIPTION_MAX } from './seo'

/**
 * 正文的规范化指纹，用作增量判据。
 *
 * ⚠️ **frontmatter 必须整段排除**：否则指纹会随 frontmatter 的任何改动而变，
 * 而 frontmatter 里恰恰存着与摘要生成相关的字段（title / tags / categories
 * 都进了 prompt）。整段排除后指纹只反映**正文**——「文章内容改了才重新生成摘要」
 * 这个判据才成立。代价是改标题不会触发重生成，但对摘要而言标题本就不是主输入。
 *
 * 换行统一为 `\n`，并剥掉 BOM：`src/content` 里 CRLF / LF 混用，而 git 配置、
 * Windows 与 CI 的 checkout 会给出不同的实际字节；不归一会让同一份内容
 * 在不同机器上算出不同哈希，增量判据随即失效（跨机器失效的判据等于没有判据）。
 */
export function normalizeSource(body: string): string {
	return body
		.replace(/^\uFEFF/, '')
		.replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
		.replace(/\r\n/g, '\n')
		.trimEnd()
}

/** sha256 前 16 位十六进制，够短以便人眼比对，又足以避免日常碰撞 */
export function hashSource(body: string): string {
	return createHash('sha256').update(normalizeSource(body), 'utf8').digest('hex').slice(0, 16)
}

/** 徽章短名的长度上限；超了说明推导没起到「给人话看」的作用 */
const LABEL_MAX = 40

/**
 * 这些是**路由 / 版本标记**，不是产品名的一部分。
 *
 * ⚠️ 别把 `flash` / `turbo` 放进来：DeepSeek Flash、GPT-4 Turbo 都是**正式产品名**，
 * 删掉会得到 `DeepSeek` 这种丢掉型号的标签 —— 那是另一种撒谎。判据是
 * 「这一段单独出现就没有意义」，而 `flash` 单独是能说的。
 */
const ROUTE_NOISE = new Set([
	'free',
	'preview',
	'latest',
	'beta',
	'v1',
])

/**
 * 这些词天生全大写，是它们**自己**的品牌写法，与厂商无关。
 *
 * 型号段一旦被搬到首位，它就成了标签的主词：`gpt-5` → `GPT 5`。而
 * `deepseek` 不在表里 —— 厂商 slug 与型号首词相同时会被去重，那个词**根本不会
 * 出现**在结果里。留在这里的只有「型号自带的品牌词」。
 */
const ALWAYS_UPPER = new Set(['gpt', 'llm'])

/** 版本戳：`20250901`（八位）、`0925`（四位月日，如 kimi-k2-0905-preview） */
const VERSION_STAMP = /^(?:\d{8}|\d{4})$/

/** 切词：小数点版本（4.5）必须保持为一段，`:` / `@` 路由后缀（xxx:free）先切掉 */
function splitWords(text: string): string[] {
	return text
		.replace(/[:@].*$/, '')
		.split(/-/)
		.flatMap((part) => {
			// `4.5` / `v3.1` 里的点不是分隔符；仅当点两侧都是纯数字才保留
			if (/^\d+\.\d+$/.test(part))
				return [part]
			return part.split('_').filter(Boolean)
		})
		.filter(Boolean)
}

/**
 * 拼出徽章要显示的词组。
 *
 * ## 只用型号段，不拼厂商名
 *
 * 厂商 slug 是**路由命名空间**，读者不认识：`moonshotai/kimi-k2-instruct` 拼出来
 * 是 `Moonshotai Kimi K2 Instruct`，前一个词纯属噪音。所以标签只由型号段构成。
 *
 * 唯一的去重判据是**厂商首词 == 型号首词**：`deepseek/deepseek-flash` 两边都是
 * `deepseek`，剥掉首词即可（否则是 `DeepSeek DeepSeek Flash`）；而 `moonshotai/kimi`
 * 两边不同，一个都不动。
 *
 * ⚠️ 判据必须限定在**首词**。早先按「厂商各词与型号任意词求交集」判断，
 * `meta-llama` 的 `llama` 命中了 `llama-4-70b` 的首词，于是整个型号被剥成 `4 70b`
 * ——只剩版本号碎片，读者完全不知道是什么模型。这比显示长名字糟得多。
 *
 * 裸 ID（`gpt-5`，自建端点常见）没有厂商段，判据自然不成立，直接用尾段。
 */
function labelWords(vendor: string, tail: string): string[] {
	const tailWords = splitWords(tail).filter(w => !ROUTE_NOISE.has(w.toLowerCase()))
	const vendorHead = vendor ? splitWords(vendor)[0] : ''
	if (vendorHead && tailWords[0]?.toLowerCase() === vendorHead.toLowerCase())
		return tailWords.slice(1)
	return tailWords
}

function titleize(word: string): string {
	if (ALWAYS_UPPER.has(word.toLowerCase()))
		return word.toUpperCase()
	// 版本号原样：`4o`、`70b`、`3.1`、`5` 都不能被首字母大写规则改写
	if (/^\d/.test(word))
		return word
	return word[0].toUpperCase() + word.slice(1)
}

/**
 * 从模型 ID 推出给人看的短名。
 *
 * ## 为什么需要它
 *
 * 徽章是 `0.75rem` 加粗胶囊，和「智能摘要」标签并排。模型 ID 是**路由标识**不是产品名：
 * `deepseek/deepseek-v3.1-terminus:free` 35 个字符，`moonshotai/kimi-k2-0905-preview`
 * 31 个 —— 原样塞进徽章既占地方又读不懂。JSON 里存完整 ID（复现调用需要那个字符串），
 * 界面显示短名，两件事分开。
 *
 * ## 推导不出就退回原值
 *
 * 宁可让徽章长着，也不要空，也不要只剩 `4 70B` 这种碎片 —— 那比原样显示还糟，
 * 读者完全不知道是什么模型。剥到空、或剥完超出长度上限，都退回完整 ID。
 *
 */
export function deriveModelLabel(model?: string, label?: string): string {
	const explicit = typeof label === 'string' ? label.trim() : ''
	if (explicit)
		return explicit
	const id = typeof model === 'string' ? model.trim() : ''
	if (!id)
		return ''

	const slash = id.indexOf('/')
	const vendor = slash > 0 ? id.slice(0, slash) : ''
	const tail = slash > 0 ? id.slice(slash + 1) : id

	// 尾段剥空说明整个型号都是路由标记（`vendor/preview`、`vendor/free`）：
	// 那时只剩厂商展示名，读起来像断言「摘要由 DeepSeek 生成」却没说清哪个型号。
	// 退回原 ID —— 长着也比误导好。
	const raw = splitWords(tail).filter(w => !ROUTE_NOISE.has(w.toLowerCase()))
	if (!raw.some(w => !VERSION_STAMP.test(w)))
		return id

	// 版本戳（0905 / 20250901）是发布批次，对读者没有信息量
	const words = labelWords(vendor, tail).filter(w => !VERSION_STAMP.test(w))
	const titled = words.map(titleize).join(' ')
	return titled.length > LABEL_MAX ? id : titled
}

/** 读出后 `$meta` / `entries` 一定存在（缺字段时补空对象），调用方不必再判空 */
export interface LoadedSummaries {
	$meta: { model?: string, modelLabel?: string }
	entries: Record<string, SummaryEntry>
}

export function readSummaries(filePath: string): LoadedSummaries {
	const raw = readFileSync(filePath, 'utf8')
	const parsed = JSON.parse(raw) as SummaryFile
	return {
		$meta: parsed.$meta ?? {},
		entries: parsed.entries ?? {},
	}
}

export function getSummary(file: LoadedSummaries, id: string): SummaryEntry | undefined {
	return file.entries[id]
}

/** 条目缺失时的占位，保证「每个条目都有 description」这个不变量有单一出口 */
export function fallbackDescription(title: string, siteName: string): string {
	return `「${title}」——${siteName}`
}
