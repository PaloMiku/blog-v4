/* eslint-disable test/no-import-node-test -- 同 content-id.test.mjs：用 Node 内置 node:test，vitest 不在本仓库依赖里。 */
/**
 * `src/lib/shared/summaries.ts` 纯函数的单测。
 *
 * 这里只测**纯逻辑**（截断规则、指纹归一、读取容错）。三件事：
 *
 * 1. `clampDescription` 的句子边界回退规则——它在 meta description 上生效，
 *    规则一改就影响全站 38 页的 head，所以必须有单测钉住。
 * 2. `normalizeSource` / `hashSource` 的归一——CRLF 与 LF 混用的仓库里，
 *    归一失效会让增量判据**跨机器失效**（同一份内容在 Windows 与 CI 上算出
 *    不同哈希，于是每次构建都判定全部待生成）。这类失效在本机看不出来。
 * 3. `readSummaries` 对残缺 JSON 的容错——`$meta` / `entries` 缺失时补空对象，
 *    调用方（loader）因此不必判空。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { REPO_ROOT } from '../scripts/lib/paths.mjs'
import {
	clampDescription,
	hashSource,
	normalizeSource,
	readSummaries,
	SEO_DESCRIPTION_MAX,
} from '../src/lib/shared/summaries.ts'

const FM = '---\ntitle: t\n---\n\n正文。\n'

describe('clampDescription', () => {
	it('不超长时原样返回（只 trim）', () => {
		assert.equal(clampDescription('短摘要。'), '短摘要。')
		assert.equal(clampDescription('  前后空白  '), '前后空白')
	})

	it('正好等于上限时不截断', () => {
		const exact = '字'.repeat(SEO_DESCRIPTION_MAX)
		assert.equal(clampDescription(exact), exact)
	})

	it('超长且能在 60% 后找到句号时，回退到句末（末尾是句号+省略号）', () => {
		const text = `${'前'.repeat(100)}。${'后'.repeat(100)}`
		const out = clampDescription(text)
		// 切在第 100 个字的句号处（index 100），并补省略号
		assert.equal(out.length, 102)
		assert.ok(out.endsWith('。…'), `实际结尾 ${JSON.stringify(out.slice(-4))}`)
		assert.ok(out.length <= SEO_DESCRIPTION_MAX)
	})

	it('超长但 60% 前无句子边界时硬切，仍不超过上限', () => {
		const text = '长'.repeat(400)
		const out = clampDescription(text)
		assert.ok(out.length <= SEO_DESCRIPTION_MAX, `实际 ${out.length}`)
		assert.ok(out.endsWith('…'))
	})

	it('英文句号边界同样识别', () => {
		const text = `${'a'.repeat(100)}. ${'b'.repeat(200)}`
		const out = clampDescription(text)
		assert.ok(out.length <= SEO_DESCRIPTION_MAX)
	})

	it('输出永不超过上限（对多种长度做性质断言）', () => {
		for (let n = 1; n <= 500; n += 7) {
			const out = clampDescription('测'.repeat(n))
			assert.ok(out.length <= SEO_DESCRIPTION_MAX, `输入 ${n} 字 → 输出 ${out.length} 字`)
		}
	})
})

describe('normalizeSource / hashSource', () => {
	it('frontmatter 整段排除：改标题不改哈希', () => {
		const a = '---\ntitle: 甲\n---\n\n正文。\n'
		const b = '---\ntitle: 乙\n---\n\n正文。\n'
		assert.equal(hashSource(a), hashSource(b), 'frontmatter 变了但正文没变，指纹必须相同')
	})

	it('CRLF 与 LF 算出同一哈希（跨机器一致）', () => {
		const lf = '---\ntitle: t\n---\n\n正文。\n'
		const crlf = lf.replace(/\n/g, '\r\n')
		assert.notEqual(lf, crlf, '前提：两者字节确实不同')
		assert.equal(hashSource(lf), hashSource(crlf))
	})

	it('正文改了哈希就变（增量判据的方向性）', () => {
		const a = `${FM}第一段。\n`
		const b = `${FM}第一段。\n第二段。\n`
		assert.notEqual(hashSource(a), hashSource(b))
	})

	it('文件末尾多个换行不影响哈希', () => {
		assert.equal(hashSource(`${FM}\n\n`), hashSource(`${FM}\n\n\n`))
	})

	it('BOM 不影响哈希', () => {
		assert.equal(hashSource(`\uFEFF${FM}`), hashSource(FM))
	})

	it('指纹是 16 位十六进制', () => {
		assert.match(hashSource(FM), /^[\da-f]{16}$/)
	})

	it('normalizeSource 剥掉 frontmatter 并保留正文', () => {
		assert.equal(normalizeSource('---\na: 1\n---\n正文\n').trim(), '正文')
	})
})

describe('readSummaries', () => {
	function writeTmp(obj) {
		const dir = mkdtempSync(join(tmpdir(), 'summaries-'))
		const p = join(dir, 'summaries.json')
		writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')
		return p
	}

	it('完整文件原样读出', () => {
		const p = writeTmp({ $meta: { model: 'M' }, entries: { a: { summary: 's', seo: 'e' } } })
		const r = readSummaries(p)
		assert.equal(r.$meta.model, 'M')
		assert.equal(r.entries.a.summary, 's')
	})

	it('$meta 缺失时补空对象（调用方不必判空）', () => {
		const r = readSummaries(writeTmp({ entries: {} }))
		assert.deepEqual(r.$meta, {})
	})

	it('entries 缺失时补空对象', () => {
		const r = readSummaries(writeTmp({ $meta: { model: 'M' } }))
		assert.deepEqual(r.entries, {})
	})

	it('model 为空串时是合法值（徽章据此不渲染）', () => {
		const r = readSummaries(writeTmp({ $meta: { model: '' }, entries: {} }))
		assert.equal(r.$meta.model, '')
	})
})

describe('门禁常量与 seo.ts 同值', () => {
	/*
	 * `scripts/check-summaries.mjs` 刻意不 import `.ts`（accept.mjs 的 runNode
	 * 不带 --experimental-transform-types），所以它持有一份字面量。
	 * 那份字面量与 `seo.ts` 的漂移是静默的：门禁会按另一个上限判红绿，
	 * 而产物完全正常。所以这里读**源码文本**取值再比对——
	 * 各写一个期望值（`assert.equal(GATE_MAX, 150)`）是钉不住的，
	 * 两处都改成 200 时它照样绿。
	 */
	const gateSrc = readFileSync(join(REPO_ROOT, 'scripts', 'check-summaries.mjs'), 'utf8')

	it('check-summaries.mjs 的字面量 === seo.ts 的 SEO_DESCRIPTION_MAX', () => {
		const m = gateSrc.match(/^const SEO_DESCRIPTION_MAX = (\d+)$/m)
		assert.ok(m, 'check-summaries.mjs 里找不到 `const SEO_DESCRIPTION_MAX = <数字>`')
		assert.equal(Number(m[1]), SEO_DESCRIPTION_MAX, '门禁侧与源侧的上限不一致，改一处必须同时改另一处')
	})

	it('seo.ts 是 clampDescription 的唯一定义处（没有第二份实现）', () => {
		// 私有副本曾经存在两份（Base.astro 与 summaries.ts 各一）。
		// 复制会随时间漂移，而漂移的表现是「门禁全绿但描述偶发超长」。
		const baseSrc = readFileSync(join(REPO_ROOT, 'src', 'layouts', 'Base.astro'), 'utf8')
		assert.ok(
			!/function clampDescription\s*\(/.test(baseSrc),
			'Base.astro 里又出现了 clampDescription 的本地实现，应改为从 lib/shared/seo 引入',
		)
	})
})
