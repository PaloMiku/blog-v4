// astro:content 虚拟模块的最小 stub。
// 单测只验证纯逻辑，不真正取内容：默认 getCollection 一律抛错——一旦被调用
// 即说明测试越界到了构建期数据层。需要假数据时由测试显式 __setCollection
// 注入（见 tests/content.test.mjs），测试结束必须 __resetCollection 还原，
// 让「没有隐式数据层」保持默认状态。
let impl = () => {
	throw new Error('astro:content getCollection() called from unit test stub without an injected fixture — not allowed')
}

export function __setCollection(fn) {
	impl = fn
}

export function __resetCollection() {
	impl = () => {
		throw new Error('astro:content getCollection() called from unit test stub without an injected fixture — not allowed')
	}
}

export function getCollection(name) {
	return Promise.resolve(impl(name))
}

export function defineCollection() {
	throw new Error('astro:content defineCollection() called from unit test stub — not allowed')
}

export const z = {}
