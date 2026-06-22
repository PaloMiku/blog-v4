import { Temporal } from 'temporal-polyfill'
import blogConfig from '~~/blog.config'

export function isSameUnit(date1: string, date2: string, unit: 'year' | 'month' | 'day') {
	try {
		const d1 = new Date(date1)
		const d2 = new Date(date2)
		if (unit === 'year')
			return d1.getFullYear() === d2.getFullYear()
		if (unit === 'month')
			return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()
		return d1.toDateString() === d2.toDateString()
	}
	catch {
		return false
	}
}

/** 检查两个时间相对现在是否相差显著 */
export function isTimeDiffSignificant(
	date1?: string,
	date2?: string,
	/** 对于时间差的敏感程度，0~1 之间，1:不同则认为显著，>1:始终认为显著 */
	threshold = 0.6,
) {
	if (!date1 || !date2 || threshold <= 0)
		return false
	if (threshold > 1)
		return true
	try {
		const now = Date.now()
		const diff1 = now - new Date(date1).getTime()
		const diff2 = now - new Date(date2).getTime()
		return diff1 / diff2 < threshold || diff2 / diff1 < threshold
	}
	catch {
		return true
	}
}

export function timeElapse(date: string) {
	const diffMs = Date.now() - new Date(date).getTime()
	if (diffMs < 0)
		return '刚刚'
	const totalSeconds = Math.floor(diffMs / 1000)
	const intervals: [label: string, seconds: number][] = [
		['年', 31536000],
		['个月', 2592000],
		['天', 86400],
		['小时', 3600],
		['分', 60],
	]
	let remaining = totalSeconds
	const parts: string[] = []
	for (const [label, secs] of intervals) {
		if (parts.length >= 2)
			break
		const count = Math.floor(remaining / secs)
		if (count > 0) {
			parts.push(`${count}${label}`)
			remaining -= count * secs
		}
	}
	return parts.join('') || '刚刚'
}

export function toInstantString(date: string | Temporal.ZonedDateTime) {
	return (typeof date === 'string' ? toZonedTemporal(date) : date).toInstant().toString()
}

export function toZonedTemporal(date?: string) {
	if (!date)
		return Temporal.Now.zonedDateTimeISO()
	try {
		return Temporal.ZonedDateTime.from(date)
	}
	catch {
		try {
			return Temporal.Instant.from(date).toZonedDateTimeISO(blogConfig.timeZone)
		}
		catch {
			return Temporal.PlainDateTime.from(date).toZonedDateTime(blogConfig.timeZone)
		}
	}
}

export const dateTimeFormat = {
	date: {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	},
	monthDay: {
		month: '2-digit',
		day: '2-digit',
	},
	full: {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'long',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		timeZoneName: 'long',
	},
} satisfies Record<string, Intl.DateTimeFormatOptions>

export type dateTimeFormatOptions = keyof typeof dateTimeFormat | Intl.DateTimeFormatOptions

export function toZdtLocaleString(date: string | Temporal.ZonedDateTime, format: dateTimeFormatOptions = 'full') {
	return (typeof date === 'string' ? toZonedTemporal(date) : date)
		.toLocaleString(undefined, typeof format === 'string' ? dateTimeFormat[format] : format)
}
