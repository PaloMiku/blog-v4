/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`src/lib/stats.ts` 的 SQL LIKE → RegExp 语义与 stem 归一的直测。
// likeToRegExp / toStem 现为导出（只加了 export 关键字，行为不变）。
// 本测试通过 `tests/harness.mjs` 的 resolve hook 导入 stats.ts ——
// 其 `astro:content` 依赖（经 ./content）被映射为 stub：getCollection 一旦被调用即报错，
// 而这两个纯函数不触碰数据层，因此可安全单测。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { likeToRegExp, toStem } from '../src/lib/stats.ts'

describe('likeToRegExp：SQL LIKE 通配语义', () => {
	it('% 匹配任意长度（含空串）', () => {
		const re = likeToRegExp('posts/%')
		assert.equal(re.test('posts/'), true) // % 可为零个字符
		assert.equal(re.test('posts/a'), true)
		assert.equal(re.test('posts/a/b/c'), true) // 跨多级，不挡斜杠
	})

	it('% 不是「必须存在」：模式前缀不匹配就整串不匹配', () => {
		const re = likeToRegExp('posts/%')
		assert.equal(re.test('posts'), false)
		assert.equal(re.test('postsx/a'), false)
		assert.equal(re.test('games/index'), false)
	})

	it('前导 % 为任意前缀（子串语义）', () => {
		const re = likeToRegExp('%foo')
		assert.equal(re.test('foo'), true)
		assert.equal(re.test('barfoo'), true)
		assert.equal(re.test('foobar'), false)
	})

	it('_ 精确匹配单个字符', () => {
		const re = likeToRegExp('posts/_')
		assert.equal(re.test('posts/a'), true)
		assert.equal(re.test('posts/番'), true) // 单字符不要求 ASCII
		assert.equal(re.test('posts/'), false) // _ 必须占一个字符
		assert.equal(re.test('posts/ab'), false) // 只吃一个，不多吃
	})

	it('_% 组合：至少一个字符', () => {
		const re = likeToRegExp('_%')
		assert.equal(re.test(''), false)
		assert.equal(re.test('a'), true)
		assert.equal(re.test('anything'), true)
	})

	it('整串锚定（^…$），不是子串搜索', () => {
		const re = likeToRegExp('a')
		assert.equal(re.test('a'), true)
		assert.equal(re.test('ab'), false)
		assert.equal(re.source.startsWith('^'), true)
		assert.equal(re.source.endsWith('$'), true)
	})

	it('空模式只匹配空串', () => {
		const re = likeToRegExp('')
		assert.equal(re.test(''), true)
		assert.equal(re.test('a'), false)
	})

	it('正则元字符全部按字面量处理，不抛错', () => {
		// 这条是 EC-005 点名的回归：`posts/a+b` 若不转义会编译成量词正则（甚至抛错）
		const plus = likeToRegExp('posts/a+b')
		assert.equal(plus.test('posts/a+b'), true)
		assert.equal(plus.test('posts/aaab'), false) // '+' 若漏转义，这条会误匹配

		for (const lit of ['posts/(x)', 'posts/[a]', 'posts/{2}', 'posts/a.b', 'posts/a?b', 'posts/a|b', 'posts/^a$', 'posts/a\\b', 'posts/*b']) {
			const re = likeToRegExp(lit)
			assert.equal(re.test(lit), true, `字面量模式应匹配自身: ${lit}`)
		}

		// '.' 未被转义的话 'a.b' 会匹配 'axb'
		assert.equal(likeToRegExp('a.b').test('axb'), false)
		// '%' 与元字符混用：只有 '.' 是字面点
		const mixed = likeToRegExp('%b.c%')
		assert.equal(mixed.test('xb.cyz'), true)
		assert.equal(mixed.test('abc'), false)
	})
})

describe('toStem：Nuxt Content stem 语义', () => {
	it('content 根相对路径去扩展名', () => {
		assert.equal(toStem('content/posts/a.mdx', 'ignored'), 'posts/a')
		assert.equal(toStem('/abs/path/content/posts/a.mdx', 'ignored'), 'posts/a')
	})

	it('反斜杠（Windows 产物路径）归一为正斜杠', () => {
		assert.equal(toStem('content\\posts\\a.mdx', 'ignored'), 'posts/a')
		assert.equal(toStem('D:\\repo\\content\\posts\\b.mdx', 'ignored'), 'posts/b')
	})

	it('多点文件名只剥最后一个扩展名', () => {
		assert.equal(toStem('content/archive/my.post.mdx', 'x'), 'archive/my.post')
	})

	it('filePath 缺失 → 回退 id', () => {
		assert.equal(toStem(undefined, 'foo/bar'), 'foo/bar')
	})

	it('路径里没有 content 段 / 没有扩展名 → 回退 id（现状合同）', () => {
		assert.equal(toStem('src/posts/a.ts', 'foo'), 'foo')
		assert.equal(toStem('content/posts/no-ext', 'fallback'), 'fallback')
	})

	it('与 likeToRegExp 复合：posts/% 恰好圈住文章 stem', () => {
		const re = likeToRegExp('posts/%')
		assert.equal(re.test(toStem('content/posts/hello.mdx', 'x')), true)
		assert.equal(re.test(toStem('content/games/index.mdx', 'x')), false)
	})
})
