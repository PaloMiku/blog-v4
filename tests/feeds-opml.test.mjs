/* eslint-disable test/no-import-node-test -- EC-005 钉死零新依赖：用 Node 内置 node:test（vitest 不在本仓库依赖里，见 package.json 的 test 脚本）。 */
// EC-005：`src/pages/subscriptions.opml.ts` 的确定性规则直测。
// 该端点不碰 astro:content（友链是 feeds.ts 的静态数据），所以**整页可求值**：
// 经 harness hook 解析 ./config/blog、./lib/feeds、../lib/shared 等无扩展名相对导入后，
// 直接 await GET() 拿产物。不可达的部分：仅 `APIRoute` 类型（import type，被擦除）与
// Astro 的路由挂载本身——后者不属于纯逻辑，无需在此验证。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import blogConfig, { myFeed } from '../src/config/blog.ts'
import feeds from '../src/lib/feeds.ts'
import { GET } from '../src/pages/subscriptions.opml.ts'

// 与实现里的 CREATED_EPOCH 对齐（判据由 scripts/check-feeds.mjs 在构建侧钉另一头）。
const CREATED_EPOCH = '2000-01-01T00:00:00Z'

// 合同里的 flattenGroups：只收「有 feed 字段的 FeedEntry 且 feed 非空」。
const outlined = feeds
	.flatMap(g => g.entries)
	.filter(e => 'feed' in e && e.feed)

async function getXml() {
	const res = await GET()
	assert.match(res.headers.get('Content-Type') ?? '', /application\/xml/)
	return await res.text()
}

describe('subscriptions.opml：确定性（无构建时钟）', () => {
	it('两次调用输出逐字节相同（dateCreated/dateModified 不取构建时刻）', async () => {
		assert.equal(await getXml(), await getXml())
	})

	it('head 的 dateCreated === dateModified === timeEstablished 换算的 instant', async () => {
		const xml = await getXml()
		const established = '2022-08-31T16:00:00Z' // 2022-09-01 上海零点 → UTC 前一日 16:00
		assert.equal(xml.includes(`dateCreated>${established}`), true)
		assert.equal(xml.includes(`dateModified>${established}`), true)
		assert.equal(xml.includes(blogConfig.timeEstablished), false) // 原文按合同转成 instant
	})

	it('无 date 条目的 created 一律钉在固定纪元', async () => {
		const xml = await getXml()
		const dated = outlined.filter(e => e.date)
		const epochCount = xml.split(CREATED_EPOCH).length - 1
		assert.equal(epochCount, outlined.length - dated.length)
		// 当前数据里唯一带 date 的是 myFeed（date=timeEstablished）
		assert.deepEqual(dated.map(e => e.title || e.sitenick || e.author), [myFeed.title])
	})
})

describe('subscriptions.opml：flattenGroups 过滤规则', () => {
	it('outline 数 = 有 feed 的条目数（缺 feed 的条目被滤掉，不递归展开子分组）', async () => {
		const xml = await getXml()
		assert.equal(xml.split('<outline').length - 1, outlined.length)
	})

	it('无 feed 条目的链接不出现在产物里', async () => {
		const xml = await getXml()
		const skipped = feeds.flatMap(g => g.entries).filter(e => !('feed' in e && e.feed))
		assert.ok(skipped.length > 0, '若数据里不再有「无 feed 条目」，请复核此判据的前提')
		for (const entry of skipped)
			assert.equal(xml.includes(entry.link), false, `无 feed 条目不应进 OPML: ${entry.link}`)
	})

	it('myFeed 去重规则：本站 feed 恰好出现一次（不再单独预置）', async () => {
		const xml = await getXml()
		assert.ok(myFeed.feed)
		assert.equal(xml.split(myFeed.feed).length - 1, 1)
	})

	it('OPML 2.0 头与 owner 字段来自 blogConfig', async () => {
		const xml = await getXml()
		assert.equal(xml.includes('version="2.0"'), true)
		assert.equal(xml.includes(blogConfig.author.name), true)
		assert.equal(xml.includes(blogConfig.author.email), true)
		assert.equal(xml.includes(blogConfig.title), true)
	})
})
