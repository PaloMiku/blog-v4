/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`generateId`（条目 id = URL 合同）的直接单测。
// 被测模块 `src/lib/shared/content-id.ts` 无 astro 依赖，可被 Node 原生 type stripping 求值。
// 注意：`hidePostPrefix` 分支读取真实 blogConfig（当前为 true），与构建期同一份配置。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateId } from '../src/lib/shared/content-id.ts'

const base = new URL('file:///repo/content/')
const entry = rel => `${base}${rel}`

function id(rel, data = {}) {
	return generateId({ entry: entry(rel), data, base })
}

describe('generateId：permalink 优先', () => {
	it('permalink 直接作为 id，覆盖文件路径', () => {
		assert.equal(id('posts/whatever.mdx', { permalink: 'Custom-Link' }), 'Custom-Link')
	})

	it('permalink 的前后斜杠都被剥掉', () => {
		assert.equal(id('posts/a.mdx', { permalink: '/foo' }), 'foo')
		assert.equal(id('posts/a.mdx', { permalink: 'foo/' }), 'foo')
		assert.equal(id('posts/a.mdx', { permalink: '/foo/bar/' }), 'foo/bar')
		assert.equal(id('posts/a.mdx', { permalink: '//x//' }), 'x')
	})

	it('中间的斜杠不动（多级 permalink 合法）', () => {
		assert.equal(id('posts/a.mdx', { permalink: '/a/b/c' }), 'a/b/c')
	})

	it('空字符串 permalink 落空到文件路径', () => {
		assert.equal(id('posts/a.mdx', { permalink: '' }), 'a')
	})

	it('非字符串 permalink（number/boolean/object）同样落空', () => {
		assert.equal(id('posts/a.mdx', { permalink: 42 }), 'a')
		assert.equal(id('posts/a.mdx', { permalink: true }), 'a')
		assert.equal(id('posts/a.mdx', { permalink: {} }), 'a')
	})
})

describe('generateId：index 塌缩为所在目录', () => {
	it('games/index.mdx → games', () => {
		assert.equal(id('games/index.mdx'), 'games')
	})

	it('posts/games/index.mdx → games（塌缩后再剥 posts/ 前缀）', () => {
		assert.equal(id('posts/games/index.mdx'), 'games')
	})

	it('index 只在路径末尾生效，中间或前缀的 index 不动', () => {
		assert.equal(id('index/foo.mdx'), 'index/foo')
		assert.equal(id('indexes/foo.mdx'), 'indexes/foo')
		assert.equal(id('foo/index-bar.mdx'), 'foo/index-bar')
	})

	it('根级 index.mdx → 空串（内容根自身，无对应文章 URL）', () => {
		assert.equal(id('index.mdx'), '')
	})
})

describe('generateId：posts/ 前缀剥离（hidePostPrefix=true）', () => {
	it('/posts/foo → foo', () => {
		assert.equal(id('posts/foo.mdx'), 'foo')
	})

	it('/posts/a/b → a/b（多级）', () => {
		assert.equal(id('posts/a/b.mdx'), 'a/b')
	})

	it('只剥一层：posts/posts/x → posts/x', () => {
		assert.equal(id('posts/posts/x.mdx'), 'posts/x')
	})

	it('相对路径边界：不以 posts/ 开头的路径原样保留', () => {
		assert.equal(id('games/foo.mdx'), 'games/foo')
		assert.equal(id('about.mdx'), 'about')
	})

	it('前缀必须是目录段：postsy/foo 不受影响', () => {
		assert.equal(id('postsy/foo.mdx'), 'postsy/foo')
	})

	it('孤立的 posts（没有斜杠后缀）不受影响', () => {
		assert.equal(id('posts.mdx'), 'posts')
	})
})

describe('generateId：路径规范化细节', () => {
	it('去掉 base 与末级扩展名，多点的文件名只剥最后一个扩展名', () => {
		assert.equal(id('posts/my.post.mdx'), 'my.post')
	})

	it('无扩展名的 entry 原样（剥扩展名的正则要求点后有非点字符）', () => {
		assert.equal(id('posts/foo'), 'foo')
	})

	it('大小写与中文路径不做任何转换（合同是逐字透传）', () => {
		assert.equal(id('posts/README.mdx'), 'README')
		assert.equal(id('posts/番剧/第一话.mdx'), '番剧/第一话')
	})
})
