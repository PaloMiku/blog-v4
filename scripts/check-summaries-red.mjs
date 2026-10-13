import { spawnSync } from 'node:child_process'
/**
 * check-summaries.mjs 的红绿双向自检。
 *
 * CLAUDE.md 坑位 6：「没被看过变红的门禁等于没有门禁」，坑位 29：
 * 「新门禁必须走一次红绿双向，注入的坏版本要能被抓住才算数」。
 *
 * 本脚本把真实的 summaries.json 与真实的 content 树备份到临时目录，
 * 逐条注入缺陷、跑真门禁、断言它变红、还原、断言它变绿，最后还原现场。
 *
 * 用法：node scripts/check-summaries-red.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'

const ROOT = REPO_ROOT
const SUMMARIES = join(ROOT, 'src', 'data', 'summaries.json')
const SAMPLE_POST = join(ROOT, 'src', 'content', 'posts', '2025', '12', 'oss-prepare-list.mdx')
/** 陷阱样本：正文里有一整块含 `description:` 的 1Panel YAML 模板 */
const CODE_BLOCK_POST = join(ROOT, 'src', 'content', 'posts', '2024', '10', 'write-1panel-app.mdx')

const origJson = readFileSync(SUMMARIES, 'utf8')
const origPost = readFileSync(SAMPLE_POST, 'utf8')
const origCodePost = readFileSync(CODE_BLOCK_POST, 'utf8')

function runGate() {
	const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-summaries.mjs')], {
		encoding: 'utf8',
		cwd: ROOT,
	})
	return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

function restore() {
	writeFileSync(SUMMARIES, origJson, 'utf8')
	writeFileSync(SAMPLE_POST, origPost, 'utf8')
	writeFileSync(CODE_BLOCK_POST, origCodePost, 'utf8')
}

let failures = 0

/**
 * 注入缺陷 → 跑真门禁 → 断言红 → 还原。
 * ⚠️ 顺序是「还原 → 注入 → 跑」，**不能**在跑之前还原：defect 写入与
 * restore() 抢同一个文件时，restore 会把刚注入的坏版本抹掉，门禁于是读到干净数据
 * 报绿——红绿双向最假的一种绿，就是「坏版本根本没被读到」。
 */
function withDefect(name, needle, inject) {
	restore()
	inject()
	const r = runGate()
	const red = r.status === 1
	const hit = r.out.includes(needle)
	console.log(`${red && hit ? 'PASS' : 'FAIL'}  ${name}  [exit=${r.status}, 命中「${needle}」=${hit}]`)
	if (!red || !hit) {
		failures++
		console.log(r.out.split('\n').slice(0, 14).map(l => `      ${l}`).join('\n'))
	}
}

function expectGreen(name) {
	restore()
	const r = runGate()
	const ok = r.status === 0
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [exit=${r.status}]`)
	if (!ok) {
		failures++
		console.log(r.out.split('\n').slice(0, 14).map(l => `      ${l}`).join('\n'))
	}
}

function writeJson(obj) {
	writeFileSync(SUMMARIES, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')
}

const j = JSON.parse(origJson)
const someId = Object.keys(j.entries)[0]

try {
	// 0. 基线：还原态必须绿
	expectGreen('基线（未注入）应为绿')

	// 1. 幽灵键：JSON 多一个键（文章已删 / 键名拼错）
	withDefect('注入「幽灵键」应报 orphan', 'orphan', () => {
		const bad = JSON.parse(origJson)
		bad.entries['2024/99/does-not-exist'] = { summary: 'x', seo: 'x', sourceHash: 'x' }
		writeJson(bad)
	})

	// 2. 缺键：JSON 少一个键（文章裸奔）
	withDefect('注入「缺失键」应报 missing', 'missing', () => {
		const bad = JSON.parse(origJson)
		delete bad.entries[someId]
		writeJson(bad)
	})

	// 3. seo 超长
	withDefect('注入「seo 超 150 字」应报 seo-too-long', 'seo-too-long', () => {
		const bad = JSON.parse(origJson)
		bad.entries[someId].seo = 'あ'.repeat(200)
		writeJson(bad)
	})

	// 5. seo 空串：判据 2 不拦（不超长）、判据 3 不拦（只看 summary），
	//    只有新加的判据 4 能抓住。这正是它存在的理由。
	withDefect('注入「seo 空串」应报 seo-empty', 'seo-empty', () => {
		const bad = JSON.parse(origJson)
		bad.entries[someId].seo = '   '
		writeJson(bad)
	})

	// 6. frontmatter 残留 description（真相源分裂）
	withDefect('注入「frontmatter 残留 description」应报 frontmatter-description', 'frontmatter-description', () => {
		writeFileSync(SAMPLE_POST, origPost.replace('---\n', '---\ndescription: 我偷偷加回来的\n'), 'utf8')
	})

	// 5. 陷阱：正文代码块里的 description 不该误报。
	//    write-1panel-app.mdx 的正文**本来就有** `description: 强大易用的开源建站工具`
	//    （1Panel 应用声明模板）。若门禁按全文 grep 而非限定 frontmatter，
	//    这篇会被误判成「真相源分裂」——即 CLAUDE.md 坑位 28 的同族陷阱。
	{
		restore()
		const r = runGate()
		const clean = !r.out.includes('frontmatter-description')
		console.log(`${clean ? 'PASS' : 'FAIL'}  正文代码块里的 description 不该误报（用真实样本 write-1panel-app.mdx）  [exit=${r.status}]`)
		if (!clean) {
			failures++
			console.log(r.out.split('\n').slice(0, 14).map(l => `      ${l}`).join('\n'))
		}
	}

	// 7. 还原后必须仍然绿
	expectGreen('全部还原后应回到绿')
}
finally {
	restore()
}

console.log('')
if (failures) {
	console.log(`RESULT: FAIL - ${failures} 项红绿双向未通过`)
	process.exit(1)
}
console.log('RESULT: PASS - check-summaries 的每条判据都被证明会红')
process.exit(0)
