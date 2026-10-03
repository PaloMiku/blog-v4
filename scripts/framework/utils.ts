import type { FeedEntry, FeedGroup } from '../../src/lib/types/feed'
import { Console } from 'node:console'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { Writable } from 'node:stream'
import tls from 'node:tls'
import { promisify } from 'node:util'
import stripAnsi from 'strip-ansi'
import feeds from '../../src/lib/feeds'

export const entries = flattenFeedGroups(feeds)

const DNS_PREFIX_RE = /^DNS:/
const dnsLookup = promisify(dns.lookup) as (hostname: string) => Promise<{ address: string, family: number }>

/** 私网/环回/链路本地地址段，SSRF 防护：友链检测不得探测内网 */
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|f[cd][0-9a-f]{2}:)/i

function isPrivateIp(ip: string): boolean {
	if (PRIVATE_IP_RE.test(ip))
		return true
	// 172.16.0.0/12
	const v4 = ip.match(/^(\d+)\.(\d+)\./)
	if (v4 && Number(v4[1]) === 172 && Number(v4[2]) >= 16 && Number(v4[2]) <= 31)
		return true
	return false
}

function flattenFeedGroups(groups: FeedGroup[]): FeedEntry[] {
	return groups.flatMap(g => g.entries)
}

export function displayName(e: FeedEntry): string {
	return (e.title?.trim() || e.sitenick?.trim() || e.author?.trim() || '(无标题)')!
}

export interface ServerResp {
	name: string
	url: string
	code: number
	time: number
	archs: string[]
	server: string
	certDomains: string[]
	ipCertDomains: string[]
	error: string
}

export async function getLinkInfo(e: FeedEntry): Promise<ServerResp> {
	const basicResp: ServerResp = {
		name: displayName(e),
		url: e.link,
		code: -1,
		time: -1,
		archs: e.archs ?? [],
		server: '',
		certDomains: [],
		ipCertDomains: [],
		error: '',
	}

	const start = Date.now()
	let url: URL
	try {
		url = new URL(e.link)
	}
	catch {
		return { ...basicResp, error: '无效的链接' }
	}
	// 友链来自仓库内的静态配置，仍限定 http(s)，避免其它协议被请求
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		return { ...basicResp, error: `不支持的协议 ${url.protocol}` }
	// 解析目标主机，私网/环回地址一律拒绝，防止 CLI 探测内网
	const { address: resolvedIp } = await dnsLookup(url.hostname)
	if (isPrivateIp(resolvedIp))
		return { ...basicResp, error: `目标解析到内网地址 ${resolvedIp}，已拒绝` }
	const lib = url.protocol === 'https:' ? https : http

	return new Promise<ServerResp>((resolve) => {
		const req = lib.request(url, { method: 'HEAD', timeout: 5000 })

		req.on('response', async (res) => {
			const code = res.statusCode as number
			const server = res.headers.server as string
			const rawIp = res.socket.remoteAddress as string
			const ipHost = rawIp?.includes(':') ? `[${rawIp}]` : rawIp
			// const ip = `${url.protocol}//${ipHost}`
			const time = Date.now() - start
			res.resume()
			if (url.protocol === 'https:') {
				const certDomains = await getCertDomains({ host: url.hostname, servername: url.hostname })
				const ipCertDomains = await getCertDomains({ host: ipHost, rejectUnauthorized: false })
				resolve({ ...basicResp, code, time, server, certDomains, ipCertDomains })
			}
			else {
				resolve({ ...basicResp, code, time, server })
			}
		})

		req.on('timeout', () => req.destroy() && resolve({ ...basicResp, error: '请求超时' }))
		req.on('error', err => resolve({ ...basicResp, error: err.message }))
		req.end()
	})
}

export async function getCertDomains(options: tls.ConnectionOptions): Promise<string[]> {
	options = { port: 443, timeout: 5000, ...options }
	return new Promise((resolve) => {
		const socket = tls.connect(options, () => {
			const cert = socket.getPeerCertificate(true)
			const san: string[] = cert.subjectaltname
				?.split(', ')
				.map(s => s.replace(DNS_PREFIX_RE, '')) ?? []
			const domains = san.length ? san : [cert.subject.CN] as string[]
			resolve(domains)
			socket.end()
		})
		socket.on('error', () => resolve([]))
	})
}

export function toCsv(data: any[], columns: string[]) {
	const lines: string[] = []
	lines.push(columns.join(','))
	for (const row of data) {
		const vals = columns.map((col) => {
			const v = row[col]
			if (Array.isArray(v))
				return v.join('; ').replaceAll('"', '""')
			return v
		})
		lines.push(vals.join(','))
	}
	return lines.join('\n')
}

export function tableToString(data: any[], columns?: string[]) {
	let output = ''
	new Console(new Writable({
		write(chunk, encoding, callback) {
			output += chunk.toString()
			callback()
		},
	})).table(data, columns)
	return stripAnsi(output)
}
