/**
 * 评论系统 CDN 依赖检查。
 *
 * 那条 twikoo 脚本挂在 head 的 defer 上，失败时**在浏览器里与正常完全一样**：
 * 评论区框在、评论加载不出来。脚本 404、CDN 回源失败、CDN 对不存在的路径返回
 * 200 + HTML——这三种在产物里都看不出异常，构建 / 页高 / 计算样式全绿。
 *
 * 判据三条：HTTP 200、响应是 JS 而非 HTML、**内容含配置中那一版版本号**。
 * 第三条才是关键——CDN 撤版本或路径拼错到别的文件，前两条可能仍成立。
 * 版本号从 blogConfig 解析，不写死。
 *
 * 联网；网络不通时 SKIP 而非 FAIL（一次网络抖动不该把部署卡死）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = join(ROOT, 'src', 'config', 'blog.ts')

/**
 * 从配置里取出 twikoo 那条脚本的 URL 与版本，不写死任何一处。
 * 两种路径写法都要认：
 *   npm 风格  .../twikoo@2.0.12/dist/…   ← zstatic / jsdelivr / unpkg
 *   库风格    .../twikoo/2.0.12/…          ← BootCDN / staticfile
 */
function readTwikooScript() {
	const src = readFileSync(CONFIG, 'utf8')
	// 分两步取，不用一条大正则：`[^']*` 后面跟 `\d+` 会构成可被利用的回溯
	// （regexp/no-super-linear-backtracking），先定位到 twikoo 那一行、再取版本号。
	const line = src.split('\n').find(l => l.includes('twikoo') && l.includes('src:'))
	if (!line)
		return null
	const url = (line.match(/'(https:\/\/[^']+)'/) || [])[1]
	const version = url ? (url.match(/twikoo[/@](\d+\.\d+\.\d+)/) || [])[1] : null
	if (!url || !version)
		return null
	return { url, version }
}

const conf = readTwikooScript()
if (!conf) {
	console.error('FAIL: 在 src/config/blog.ts 里找不到 twikoo 脚本配置')
	console.error('  这本身是问题：评论系统要么被删了、要么配置写法变了，门禁应当跟着改。')
	process.exit(1)
}

console.log(`配置：twikoo@${conf.version}`)
console.log(`  ${conf.url}`)

let res
try {
	res = await fetch(conf.url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(20_000),
		headers: { 'User-Agent': 'blog-v4 acceptance gate' },
	})
}
catch (e) {
	// 网络不通 ≠ 站点有缺陷。谎报失败比不报更糟——它会让人去改本来正确的配置。
	console.log(`SKIP: 无法访问 CDN（${e.name}: ${e.message}）`)
	console.log('  这道门禁本次没跑。网络恢复后重跑。')
	process.exit(0)
}

const problems = []

if (!res.ok)
	problems.push(`HTTP ${res.status} ${res.statusText}`)

const ctype = (res.headers.get('content-type') || '').toLowerCase()
const body = await res.text()

// 状态码过了不代表拿到的是 JS：CDN 对不存在的路径普遍返回 200 + HTML 错误页。
if (ctype && !/javascript|ecmascript/.test(ctype))
	problems.push(`Content-Type 是 "${ctype}"，不是 JavaScript（多半是 CDN 的 HTML 错误页）`)

if (/^\s*(?:<!doctype|<html)/i.test(body))
	problems.push('响应体是 HTML 文档，不是脚本')

if (!problems.length && !body.includes(conf.version))
	problems.push(`内容里找不到版本号 "${conf.version}" —— CDN 上的文件可能不是这一版`)

if (problems.length) {
	console.log(`\nRESULT: FAIL - ${problems.length} 处问题`)
	for (const p of problems)
		console.log(`  - ${p}`)
	console.log('\n  评论会在浏览器里静默失效：评论区框架照常渲染，评论永远加载不出来。')
	process.exit(1)
}

console.log(`\n  Content-Type: ${ctype}`)
console.log(`  体积: ${(body.length / 1024).toFixed(0)} KB`)
console.log(`  含版本号 ${conf.version} ✓`)
console.log('\nRESULT: PASS - CDN 上确实是这一版 twikoo，拿到的是 JavaScript')
