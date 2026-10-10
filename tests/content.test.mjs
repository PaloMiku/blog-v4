/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// src/lib/content.ts 的合同测试（EC-005）：排序、合集、surroundings、分类、精选。
// 经 stub 注入假条目（tests/stubs/astro-content.mjs），不触真实数据层。
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { __resetCollection, __setCollection } from './stubs/astro-content.mjs'

const { categorizeArticles, getByCollection, getPostsSorted, getRecommended, getSurroundings, sortArticles, toPath } = await import('../src/lib/content.ts')

function e(id, data = {}) {
	return { id, data: { isPost: false, ...data } }
}

// 共享夹具：3 篇文章（date 有同值对）+ 1 篇非文章 + 1 篇带 collection + 1 篇带 recommend
const FIXTURE = [
	e('b-second', { isPost: true, date: '2025-01-02', updated: '2025-06-01', categories: ['tech', 'x'] }),
	e('a-tie', { isPost: true, date: '2025-01-02', updated: '2025-05-01', categories: ['life'] }),
	e('c-first', { isPost: true, date: '2025-01-01', updated: '2025-07-01', categories: ['tech'] }),
	e('about', { title: '非文章' }),
	e('series-x-1', { isPost: true, date: '2025-03-01', collection: 'series-x' }),
	e('recommended-hot', { isPost: true, date: '2024-01-01', recommend: 5 }),
	e('recommended-old', { isPost: true, date: '2023-01-01', recommend: 5 }),
	e('recommend-null', { isPost: true, date: '2026-01-01', recommend: null }),
]

before(() => __setCollection(() => FIXTURE))
after(() => __resetCollection())

describe('getPostsSorted', () => {
	it('只含文章且按 date 升序；同 date 时保持比较器语义（localeCompare 相等 → 稳定序）', async () => {
		const list = await getPostsSorted()
		assert.ok(!list.some(x => x.id === 'about'))
		assert.deepEqual(list.map(x => x.id), [
			'recommended-old',
			'recommended-hot',
			'c-first',
			'b-second',
			'a-tie',
			'series-x-1',
			'recommend-null',
		])
		// b-second 与 a-tie 同值排序：Array.sort 稳定性 ⇒ 保持输入相对序（b 在 a 前）
		assert.ok(list.findIndex(x => x.id === 'b-second') < list.findIndex(x => x.id === 'a-tie'))
	})
})

describe('getSurroundings', () => {
	it('中间条目返回前后各一；上一篇更早、下一篇更晚', async () => {
		const { prev, next } = await getSurroundings('a-tie')
		assert.equal(prev.id, 'b-second')
		assert.equal(next.id, 'series-x-1')
	})
	it('最早条目无上一篇；最晚条目无下一篇', async () => {
		assert.equal((await getSurroundings('recommended-old')).prev, null)
		assert.equal((await getSurroundings('recommend-null')).next, null)
	})
	it('未知 id 与非文章 id → 双侧 null（surroundings 只认文章序）', async () => {
		assert.deepEqual(await getSurroundings('nope'), { prev: null, next: null })
		assert.deepEqual(await getSurroundings('about'), { prev: null, next: null })
	})
})

describe('getByCollection', () => {
	it('空/undefined key 直接返回 []，不查集合', async () => {
		assert.deepEqual(await getByCollection(undefined), [])
		assert.deepEqual(await getByCollection(''), [])
	})
	it('按 key 过滤并升序', async () => {
		const list = await getByCollection('series-x')
		assert.deepEqual(list.map(x => x.id), ['series-x-1'])
		assert.deepEqual(await getByCollection('missing'), [])
	})
})

describe('sortArticles', () => {
	it('默认按 date 降序（initialAscend=false）', () => {
		const posts = FIXTURE.filter(x => x.data.isPost)
		const { sorted, sortOrder, isAscending } = sortArticles(posts)
		assert.equal(sortOrder, 'date')
		assert.equal(isAscending, false)
		assert.equal(sorted[0].id, 'recommend-null') // date 最大的 2026 篇
	})
	it('按 updated 升序 + 同值回退 date（同向），不改动入参', () => {
		const posts = FIXTURE.filter(x => x.data.isPost)
		const snapshot = posts.map(x => x.id)
		const { sorted } = sortArticles(posts, { initialAscend: true, initialOrder: 'updated' })
		assert.deepEqual(posts.map(x => x.id), snapshot)
		// 无 updated 的条目按空串排最前，组内回退 date 升序；随后按 updated 升序
		assert.deepEqual(sorted.map(x => x.id), [
			'recommended-old',
			'recommended-hot',
			'series-x-1',
			'recommend-null',
			'a-tie',
			'b-second',
			'c-first',
		])
	})
	it('缺排序字段按空串参与比较而不是抛错', () => {
		const { sorted } = sortArticles([e('x', { date: '2025-01-01' }), e('y', { date: '2025-01-02' })], { initialOrder: 'updated' })
		// updated 全空 → 回退 date；默认降序 → y 在前
		assert.equal(sorted[0].id, 'y')
	})
})

describe('categorizeArticles', () => {
	it('categories 是首分类去重集合（保序）；按首分类过滤', () => {
		const posts = FIXTURE.filter(x => x.data.isPost)
		const { categories, byCategory } = categorizeArticles(posts)
		assert.deepEqual(categories, ['tech', 'life']) // series-x-1/recommended 无 categories → 被 filter(Boolean) 丢弃
		assert.deepEqual(byCategory('tech').map(x => x.id), ['b-second', 'c-first'])
		assert.deepEqual(byCategory('nope'), [])
	})
	it('undefined key 返回全量副本（新数组，不改入参）', () => {
		const posts = FIXTURE.filter(x => x.data.isPost)
		const { byCategory } = categorizeArticles(posts)
		const all = byCategory(undefined)
		assert.equal(all.length, posts.length)
		assert.notEqual(all, posts)
	})
})

describe('getRecommended', () => {
	it('recommend 有值才入选；同 recommend 时 date 降序', async () => {
		const list = await getRecommended()
		assert.deepEqual(list.map(x => x.id), ['recommended-hot', 'recommended-old'])
	})
	it('recommend: null 不入选（Nuxt 语义：有值才精选）', async () => {
		assert.ok(!(await getRecommended()).some(x => x.id === 'recommend-null'))
	})
})

describe('toPath', () => {
	it('条目 id 加前导斜杠即 URL 路径', () => {
		assert.equal(toPath(e('a/b')), '/a/b')
		assert.equal(toPath(e('link')), '/link')
	})
})
