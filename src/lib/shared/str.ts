import { escape, escapeRegExp } from 'es-toolkit/string'

/**
 * `toArray` 内联拷贝。
 *
 * 原先来自 `@vueuse/core`（Nuxt 根依赖，astro-site 没装）。照抄
 * @vueuse/core@14.4.0 dist 的实现，即 `Array.isArray(value) ? value : [value]`。
 * ⚠️ 它**不做** null/undefined 兜底——`toArray(undefined)` 得到的是 `[undefined]`。
 * 本文件唯一调用点 `highlightHtml` 紧跟着 `.filter(t => !!t?.trim())`，
 * 那个可选链会把 `[undefined]` 里的元素滤掉，所以有没有兜底结果相同。
 * 但仍按原样实现、不额外加兜底，免得悄悄改变上游语义。
 */
function toArray<T>(value: T | T[]): T[] {
	return Array.isArray(value) ? value : [value]
}

// @keep-sorted
const promptLanguageMap: Record<string, string> = {
	'#': 'sh',
	'$': 'sh',
	'CMD': 'bat',
	'PS': 'powershell',
}

export function formatNumber(num?: number) {
	if (typeof num !== 'number')
		return ''
	const intervals = [
		{ label: '万亿', threshold: 1e12 },
		{ label: '亿', threshold: 1e8 },
		{ label: '万', threshold: 1e4 },
	]
	for (const interval of intervals) {
		if (num >= interval.threshold)
			return `${(num / interval.threshold).toFixed(2)}${interval.label}`
	}
	return num.toString()
}

interface FormatBytesOptions {
	decimals?: number
	binary?: boolean
	unitSeparator?: string
}

export function formatBytes(bytes: number, options: FormatBytesOptions = {}) {
	const {
		decimals = 2,
		binary = true,
		unitSeparator = ' ',
	} = options

	if (bytes === 0)
		return `0${unitSeparator}Bytes`

	const base = binary ? 1024 : 1000
	const units = binary
		? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']
		: ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

	const i = Math.floor(Math.log(bytes) / Math.log(base))
	const value = Number.parseFloat((bytes / base ** i).toFixed(decimals))

	return `${value}${unitSeparator}${units[i]}`
}

export function getPromptLanguage(prompt: string | boolean) {
	if (typeof prompt === 'boolean')
		return 'text'
	for (const promptPrefix in promptLanguageMap) {
		if (prompt.startsWith(promptPrefix))
			return promptLanguageMap[promptPrefix] ?? 'text'
	}
	return 'text'
}

export function joinWith(strings: (string | undefined)[], separator = '\n') {
	return strings.filter(Boolean).join(separator)
}

const HTML_TAG_RE = /<[^>]+(>|$)/g
const NEWLINE_RE = /\n+/g

export function highlightHtml(text: string, words: string | string[] | undefined, className?: string) {
	const validTerms = toArray(words)
		.filter((t): t is string => !!t?.trim())
		.map(t => t.toLowerCase())

	const highlightRegex = new RegExp(`(${Array.from(validTerms, escapeRegExp).join('|')})`, 'gi')

	return text
		.split(highlightRegex)
		.map(part => part && validTerms.includes(part.toLowerCase())
			? `<mark${className ? ` class="${className}"` : ''}>${escape(part)}</mark>`
			: escape(part))
		.join('')
		.replace(NEWLINE_RE, '<br>')
}

export function removeHtmlTags(str?: string) {
	if (typeof str !== 'string')
		return ''
	return str.replace(HTML_TAG_RE, '')
}
