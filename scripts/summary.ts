/**
 * `pnpm summary` —— 摘要的增量生成入口。
 *
 * ## 增量判据
 *
 * 每个条目存 `sourceHash`（正文 sha256 前 16 位，见 `summaries.ts` 的 hashSource，
 * 整段排除 frontmatter + 归一换行）。正文没变 ⇒ 哈希相同 ⇒ **跳过，不调模型、不写盘**。
 * 因此「每次更新不重复更新」由 sourceHash 保证，不靠人工记忆。
 *
 * 手工改过 summary 文字后，源哈希未变 ⇒ 默认**不会**被覆盖（这是刻意的：
 * 人工润色应当胜过机器重写）。想强制重写用 `--force` 或 `--only <id>`。
 *
 * ## 失败绝不标记完成
 *
 * 调用失败或返回形状不对时，`applyEntry` **一个字都不碰那个键**，
 * sourceHash 保持旧值 ⇒ 下次自动回到待生成列表。若失败也盖上新哈希，
 * 那篇文章的摘要将永远判成 unchanged：命令报「已同步」、`check-summaries` 报绿，
 * 唯独它再也不会生成，且没有任何信号（CLAUDE.md 坑位 29）。
 *
 * ## $meta.model 的署名规则
 *
 * 只有**真的生成过东西**才更新署名，一次都没生成就不动它——否则跑个 no-op
 * 就能把 38 篇的来源标注全改掉。`--model` 显式给了就听它的。
 *
 * ## 用法
 *
 *   pnpm summary                 增量：只列出「该生成但还没生成 / 源变了」的条目
 *   pnpm summary --write         真正写入（先打 diff 预览，再调模型落盘）
 *   pnpm summary --force         忽略 sourceHash，全部重算（覆盖人工润色）
 *   pnpm summary --only <id>     只处理指定条目 id
 *   pnpm summary --model <name>  写入 $meta.model（徽章的来源）
 *
 * 模型配置读 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，由 package.json 里
 * `--env-file-if-exists=.env` 注入，见 `.env.example`。**不读 dry-run 之外的东西。**
 *
 * ## 路径
 *
 * 全部从 import.meta.url 解析，不读 process.cwd()（CLAUDE.md 坑位 24）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { deriveModelLabel, hashSource } from '../src/lib/shared/summaries.ts'
import { complete, readConfig } from './lib/llm.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import { applyEntry, buildPrompt, parseSummaryResponse, SUMMARY_SYSTEM_PROMPT } from './lib/summary-core.mjs'
import { walkFiles } from './lib/walk.mjs'

const ROOT = REPO_ROOT
const CONTENT_ROOT = join(ROOT, 'src', 'content')
const SUMMARIES = join(ROOT, 'src', 'data', 'summaries.json')

const args = process.argv.slice(2)
const flag = name => args.includes(name)
function opt(name) {
	const i = args.indexOf(name)
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined
}

const WRITE = flag('--write')
const FORCE = flag('--force')
const ONLY = opt('--only')
const MODEL = opt('--model')
/** 徽章显示用的短名；不给就从模型 ID 推导（`deepseek/deepseek-flash` → `DeepSeek Flash`） */
const MODEL_LABEL = opt('--model-label')

if (!existsSync(SUMMARIES)) {
	console.log(`找不到 ${relative(ROOT, SUMMARIES)}；它入库吗？建好再跑本命令。`)
	process.exit(1)
}

const json = JSON.parse(readFileSync(SUMMARIES, 'utf8'))
json.$meta ??= {}
json.entries ??= {}

/** 与 content-id.ts 的 generateId 同源（离线版，无 loader） */
function entryIdFor(normContentPath, permalink) {
	if (typeof permalink === 'string' && permalink)
		return permalink.replace(/^\/+|\/+$/g, '')
	let rel = normContentPath.replace(/\.mdx$/, '')
	rel = rel.replace(/(^|\/)index$/, '$1').replace(/\/+$/, '')
	if (rel.startsWith('posts/'))
		rel = rel.slice('posts/'.length)
	return rel
}

/**
 * 从 frontmatter 里取出 prompt 要的四个字段。
 *
 * ⚠️ 只用正则按行取，**不引入 yaml 依赖**——要的字段形状都是扁平标量或行内数组，
 * 而 `yaml` 是 devDependency：这个脚本要在任何 checkout 上跑，不能假设 devDeps 已装。
 * 数组两种写法都认（行内 `[a, b]` 与块状 `- a`）。
 */
function promptFields(frontmatter, body) {
	const line = key => frontmatter.match(new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? ''

	const inline = (key) => {
		const raw = line(key)
		if (!raw.startsWith('['))
			return []
		return raw.replace(/^[[\]]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
	}
	const block = (key) => {
		const m = frontmatter.match(new RegExp(`^${key}[ \\t]*:[ \\t]*\\n((?:[ \\t]+-[ \\t].*\\n?)+)`, 'm'))
		if (!m)
			return []
		return m[1].split('\n').map(s => s.replace(/^[ \t]*-[ \t]*/, '').trim()).filter(Boolean)
	}

	const date = line('date')
	return {
		title: line('title') || undefined,
		date: date ? date.replace(/^["']|["']$/g, '') : undefined,
		categories: inline('categories').length ? inline('categories') : block('categories'),
		tags: inline('tags').length ? inline('tags') : block('tags'),
		body,
	}
}

const toProcess = []
const unchanged = []
let scanned = 0

for (const full of walkFiles(CONTENT_ROOT, { ext: '.mdx' })) {
	const norm = relative(ROOT, full).replace(/\\/g, '/')
	if (!norm.startsWith('src/content/posts/'))
		continue
	const src = readFileSync(full, 'utf8')
	const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
	if (!fm)
		continue
	scanned++
	const permalink = fm[1].match(/^permalink[ \t]*:[ \t]*(\S+)/m)?.[1]
	const id = entryIdFor(norm.replace('src/content/', ''), permalink)
	const hash = hashSource(src)
	const rec = json.entries[id]

	// ⚠️ `--only` 必须压过 `--force`，不能是 OR：`pnpm summary --force --only x/y`
	// 表达的是「只重算这一条」。写成 `FORCE || ONLY === id` 会让 only 被 force 吃掉，
	// 于是 --force --only 静默变成全量重算 38 篇，把人工润色全刷掉——
	// 而命令照常打印列表，看着完全正常。
	const need = ONLY
		? id === ONLY
		: FORCE || !rec || rec.sourceHash !== hash
	if (need)
		toProcess.push({ id, hash, hasSummary: !!rec?.summary, post: promptFields(fm[1], src.slice(fm[0].length)) })
	else unchanged.push(id)
}

if (ONLY && !toProcess.length && !unchanged.includes(ONLY)) {
	console.log(`--only ${ONLY}：没有匹配的文章（id 应形如 2025/12/oss-prepare-list）`)
	process.exit(1)
}

console.log(`scanned posts      : ${scanned}`)
console.log(`unchanged (skip)   : ${unchanged.length}`)
console.log(`to (re)generate    : ${toProcess.length}`)
if (MODEL !== undefined)
	console.log(`$meta.model        : ${json.$meta.model || '(空)'} → ${MODEL || '(清空)'}`)
if (MODEL_LABEL !== undefined)
	console.log(`$meta.modelLabel   : ${json.$meta.modelLabel || '(空)'} → ${MODEL_LABEL || '(清空，改回自动推导)'}`)

if (toProcess.length) {
	console.log('')
	console.log('will generate:')
	for (const p of toProcess)
		console.log(`  ${p.id}${p.hasSummary ? '  (覆盖已有)' : '  (新增)'}`)
}

if (!WRITE) {
	console.log('')
	console.log('(dry run — 加 --write 才会真正调用模型并写入)')
	process.exit(0)
}

/**
 * 生成一篇摘要。形状判定与 seo 兜底都在 summary-core 里，
 * 这里只负责「发请求 → 拿到结果」，失败返回 null（不碰那个键）。
 */
async function generateSummary(id, post, config) {
	try {
		const res = await complete(
			{ system: SUMMARY_SYSTEM_PROMPT, user: buildPrompt(post) },
			config,
		)
		const parsed = parseSummaryResponse(res)
		if (!parsed)
			throw new Error('响应里没有可用的 JSON（可能是散文、围栏、或被安全策略拦回）')
		return parsed
	}
	catch (err) {
		console.error(`  ✗ ${id}: ${err.message}`)
		return null
	}
}

let config
try {
	config = readConfig()
}
catch (err) {
	console.error(err.message)
	process.exit(1)
}

console.log('')
console.log(`model              : ${config.model}`)
console.log(`endpoint           : ${config.baseUrl}/chat/completions`)
console.log('')

const succeeded = []
const failed = []

for (const [i, p] of toProcess.entries()) {
	process.stdout.write(`[${i + 1}/${toProcess.length}] ${p.id} … `)
	// 先打点再等：fetch 期间没有输出，几十篇连着跑时看不出卡在哪
	const result = await generateSummary(p.id, p.post, config)
	if (!result) {
		console.log('失败')
		failed.push(p.id)
		continue
	}
	const before = json.entries[p.id]?.summary ?? ''
	applyEntry(json, p.id, result, p.hash)
	const after = json.entries[p.id].summary
	const tag = before ? (before === after ? '内容相同' : '已改写') : '新增'
	console.log(`${tag}（summary ${before.length} → ${after.length} 字，seo ${json.entries[p.id].seo.length} 字）`)
	succeeded.push({ id: p.id, from: before, to: after })
}

/*
 * 署名更新与 `$meta.modelLabel` 的连带规则。
 *
 * 短名**跟着 model 一起更新**，否则会出现「署名说 A、徽章显示 B」这种自相矛盾——
 * 比徽章长更糟。`--model-label ''` 是显式「改回自动推导」，不是「清空」。
 */
if (MODEL !== undefined)
	json.$meta.model = MODEL
else if (succeeded.length)
	json.$meta.model = config.model

if (MODEL_LABEL !== undefined) {
	json.$meta.modelLabel = MODEL_LABEL
}
else if (succeeded.length || MODEL !== undefined) {
	const label = deriveModelLabel(json.$meta.model)
	// 推导失败（退回原 ID）时**删掉**旧的显式 label，
	// 否则 model 换了自己还挂着上一个模型的短名
	if (label === json.$meta.model && json.$meta.modelLabel === label)
		delete json.$meta.modelLabel
	else
		json.$meta.modelLabel = label
}

// 只写一次盘：中途崩溃不会留下半截 JSON
writeFileSync(SUMMARIES, `${JSON.stringify(json, null, 2)}`, 'utf8')

console.log('')
console.log(`succeeded ${succeeded.length}${failed.length ? ` / failed ${failed.length}` : ''}`)
if (succeeded.length) {
	const changed = succeeded.filter(s => s.from && s.from !== s.to)
	console.log(`其中内容有变化 ${changed.length} 条、人工润色被覆盖 ${changed.length} 条（--force 时请复核上面逐条的新旧字数）`)
}
if (failed.length) {
	console.log('')
	console.log('失败的条目**没有**被写入，sourceHash 保持旧值，下次运行会自动重试：')
	for (const id of failed)
		console.log(`  ${id}`)
	process.exit(1)
}
process.exit(0)
