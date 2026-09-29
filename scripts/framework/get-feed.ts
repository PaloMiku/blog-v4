#!/usr/bin/env node

import type { FeedEntry } from '../../app/types/feed'
import process from 'node:process'
import { cancel, intro, isCancel, outro, select, text } from '@clack/prompts'
import { mapValues } from 'es-toolkit/object'
import { Temporal } from 'temporal-polyfill'
import { entries, getLinkInfo } from './utils'

function displayName(e: FeedEntry): string {
	return (e.title || e.sitenick || e.author || '(无标题)').trim()
}

function matches(q: string, e: FeedEntry): boolean {
	const hay = Object.values(e).join('\n').toLowerCase()
	return hay.includes(q.toLowerCase())
}

intro('🔎 获取友链的托管服务')

const query = await text({
	message: '输入关键字或任意链接：',
	placeholder: '例如: nuxt / vercel / 站点名 / 域名片段 / 任意完整域名',
})
if (isCancel(query)) {
	cancel('已取消')
	process.exit(0)
}

// SSRF 防护：动态输入与静态配置严格分离。仅静态配置（app/feeds.ts）中的条目
// 会被送入 getLinkInfo 发起网络检测；CLI 动态输入的链接只作展示，绝不请求。
const staticList: FeedEntry[] = query?.trim()
	? entries.filter(e => matches(String(query), e))
	: entries
const dynamicList: FeedEntry[] = query?.startsWith('http')
	? [{
			author: query,
			link: query,
			icon: '',
			avatar: '',
			date: Temporal.Now.zonedDateTimeISO().toLocaleString('sv'),
		}]
	: []

if (!staticList.length && !dynamicList.length) {
	cancel('未找到匹配的友链。')
	process.exit(0)
}

const selected = await select({
	message: `选择一个：`,
	options: [
		...staticList.map((e, idx) => ({
			value: `s${idx}`,
			label: displayName(e),
			hint: e.link,
		})),
		...dynamicList.map((e, idx) => ({
			value: `d${idx}`,
			label: `${displayName(e)}（不检测）`,
			hint: e.link,
		})),
	],
})
if (isCancel(selected)) {
	cancel('已取消')
	process.exit(0)
}

const selectedValue = String(selected)

if (selectedValue.startsWith('d')) {
	const choice = dynamicList[Number(selectedValue.slice(1))]!
	console.table(mapValues({ name: choice.author, url: choice.link }, v => ({ '(value)': v })))
	outro('动态输入的链接不执行网络检测 ✅')
	process.exit(0)
}

const choice = staticList[Number(selectedValue.slice(1))]!

const info = await getLinkInfo(choice)

console.table(mapValues(info, v => ({ '(value)': v })))

outro('完成 ✅')
