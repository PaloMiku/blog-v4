/* eslint-disable test/no-import-node-test -- 与其余纯逻辑测试一致：钉死用 Node 内置 node:test（vitest 不在依赖里，见 package.json 的 test 脚本）。 */
// `src/lib/admin.ts` 的直测：frontmatter 往返、YAML 标量转义、列表解析、会话校验。
// 本模块刻意不 import `astro:*`，因此测试进程无需 stub 内容层，可直接引入。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	composeMdx,
	draftKey,
	estimateReading,
	formatListInput,
	formatYamlValue,
	isValidSession,
	needsYamlQuote,
	parseListInput,
	resolveExportSlug,
	serializeFrontMatter,
	splitFrontMatter,
	toFileSlug,
} from '../src/lib/admin.ts'

describe('splitFrontMatter：只拆开头的围栏', () => {
	it('拆出 frontmatter 与正文', () => {
		const { raw, content } = splitFrontMatter('---\ntitle: hi\n---\n正文\n')
		assert.equal(raw, 'title: hi')
		assert.equal(content, '正文\n')
	})

	it('没有 frontmatter 时整体是正文', () => {
		const { raw, content } = splitFrontMatter('直接正文')
		assert.equal(raw, '')
		assert.equal(content, '直接正文')
	})

	it('正文里的 --- 不会被当成围栏', () => {
		const { content } = splitFrontMatter('正文\n\n---\n\n后文')
		assert.equal(content, '正文\n\n---\n\n后文')
	})

	it('未闭合的开头围栏不误拆', () => {
		const body = '---\ntitle: 没有闭合'
		const { raw, content } = splitFrontMatter(body)
		assert.equal(raw, '')
		assert.equal(content, body)
	})
})

describe('YAML 标量转义：往返后仍被解析为原字符串', () => {
	it('纯文本不加引号', () => {
		assert.equal(formatYamlValue('普通标题'), '普通标题')
	})

	it('空串必须加引号（否则被解析成 null）', () => {
		assert.equal(needsYamlQuote(''), true)
		assert.equal(formatYamlValue(''), '""')
	})

	it('看起来像数字 / 布尔的串必须加引号', () => {
		assert.equal(formatYamlValue('2024'), '"2024"')
		assert.equal(formatYamlValue('true'), '"true"')
		assert.equal(formatYamlValue('null'), '"null"')
	})

	it('含冒号 / 井号的串加引号', () => {
		assert.equal(formatYamlValue('a: b'), '"a: b"')
		assert.equal(formatYamlValue('# 标题'), '"# 标题"')
	})

	it('引号被转义', () => {
		assert.equal(formatYamlValue('say "hi"'), '"say \\"hi\\""')
	})

	it('反斜杠在 plain 标量里是字面量，不必加引号（YAML 语义）', () => {
		// plain 标量中 `\` 无转义含义，`a\b` 解析回来仍是 `a\b`
		assert.equal(formatYamlValue('a\\b'), 'a\\b')
		// 但一旦因含 `:` 被迫加引号，双引号内的反斜杠就**必须**转义
		assert.equal(formatYamlValue('a:b\\c'), '"a:b\\\\c"')
	})

	it('数字 / 布尔不加引号', () => {
		assert.equal(formatYamlValue(5), '5')
		assert.equal(formatYamlValue(true), 'true')
	})

	it('数组用流式语法，逐项按需加引号', () => {
		assert.equal(formatYamlValue(['技术', '2024']), '[技术, "2024"]')
	})
})

describe('serializeFrontMatter / composeMdx：成品的形状', () => {
	it('跳过空字段与空数组，不写噪声', () => {
		const yaml = serializeFrontMatter({ title: 'T', subtitle: '', tags: [], description: '  ' })
		assert.equal(yaml, '---\ntitle: T\n---\n')
	})

	it('空对象也给一个空围栏', () => {
		assert.equal(serializeFrontMatter({}), '---\n\n---\n')
	})

	it('composeMdx 输出围栏 + 空行 + 正文', () => {
		const out = composeMdx({ title: 'T' }, '\n正文\n')
		assert.equal(out, '---\ntitle: T\n---\n\n正文\n')
	})

	it('composeMdx 产出能被 splitFrontMatter 还原', () => {
		const data = { title: '往返', categories: ['技术', '开发'] }
		const body = '第一段\n\n第二段'
		const file = composeMdx(data, body)
		const { raw, content } = splitFrontMatter(file)
		assert.equal(raw, 'title: 往返\ncategories: [技术, 开发]')
		assert.equal(content.trim(), body)
	})
})

describe('列表输入解析', () => {
	it('支持中英文逗号与顿号，去空去重', () => {
		assert.deepEqual(parseListInput('技术, 开发，运维、技术'), ['技术', '开发', '运维'])
	})

	it('空串得到空数组', () => {
		assert.deepEqual(parseListInput('   '), [])
	})

	it('数组与输入串往返', () => {
		assert.equal(formatListInput(parseListInput('a, b')), 'a, b')
	})
})

describe('estimateReading：CJK 按字、拉丁按词', () => {
	it('中英混排都能给出非零估算', () => {
		const r = estimateReading('你好 world')
		assert.ok(r.words >= 3)
		assert.ok(r.minutes >= 1)
	})
})

describe('toFileSlug：导出文件名安全', () => {
	it('去掉路径分隔符与非法字符', () => {
		assert.equal(toFileSlug('a/b:c*d'), 'a-b-c-d')
	})

	it('空白折叠为单个连字符', () => {
		assert.equal(toFileSlug('  hello   world  '), 'hello-world')
	})

	it('空输入回退 untitled', () => {
		assert.equal(toFileSlug('   '), 'untitled')
	})
})

describe('resolveExportSlug：空标题拒绝导出 + 重名去重', () => {
	it('标题与 id 都为空时拒绝，不再静默导出 untitled', () => {
		const r = resolveExportSlug({ title: '   ', id: '', existingIds: ['2024/01/a'] })
		assert.equal(r.slug, '')
		assert.ok(r.error)
	})

	it('有标题时给出可用文件名', () => {
		const r = resolveExportSlug({ title: 'Hello World', id: '', existingIds: [] })
		assert.equal(r.slug, 'hello-world')
		assert.equal(r.error, undefined)
	})

	it('与既有文章重名时加 -2', () => {
		const r = resolveExportSlug({ title: 'Hello World', existingIds: ['hello-world'] })
		assert.equal(r.slug, 'hello-world-2')
		assert.equal(r.deduplicated, true)
	})

	it('-2 也被占用时继续递增到 -3', () => {
		const r = resolveExportSlug({ title: 'Hello World', existingIds: ['hello-world', 'hello-world-2'] })
		assert.equal(r.slug, 'hello-world-3')
	})

	it('重导正在编辑的那一篇不算冲突', () => {
		const r = resolveExportSlug({ title: 'Hello World', id: 'hello-world', existingIds: ['hello-world'] })
		assert.equal(r.slug, 'hello-world')
		assert.equal(r.deduplicated, undefined)
	})

	it('没有标题时退回当前 id 参与去重', () => {
		const r = resolveExportSlug({ title: '', id: '2024/01/abc', existingIds: ['other'] })
		assert.equal(r.slug, '2024-01-abc')
	})
})

describe('会话与草稿键', () => {
	it('draftKey 对空 id 回退 new', () => {
		assert.equal(draftKey(''), 'blog-admin:draft:new')
		assert.equal(draftKey('abc'), 'blog-admin:draft:abc')
	})

	it('isValidSession 只接受 { email, at }', () => {
		assert.equal(isValidSession({ email: 'a@b.c', at: 1 }), true)
		assert.equal(isValidSession({ email: '', at: 1 }), false)
		assert.equal(isValidSession({ email: 'a@b.c' }), false)
		assert.equal(isValidSession('nope'), false)
		assert.equal(isValidSession(null), false)
	})
})
