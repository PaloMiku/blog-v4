import { fromUrl, parseDomain, ParseResultType } from 'parse-domain'

/**
 * `isPathFile` 内联拷贝。
 *
 * 原先来自 `site-config-stack/urls`，而那是 Nuxt 根的依赖（astro-site 没装）。
 * 该包是一整套 SEO 工具集，为一个谓词把整包拖进来并不划算——但这个谓词
 * **不是**「看起来像文件路径」那种粗判断，而是**扩展名白名单**：
 * 末段带任意后缀并不算文件，命中下面这份清单才返回 true（所以 `/foo.xyz` 是 false）。
 * 清单与 `FILE_EXT_RE` 逐字照抄自 site-config-stack@4.2.3 的 `dist/urls.mjs`（MIT），
 * 与迁移前 `shared/utils/link.ts` 实际执行的那份实现完全一致。
 */
const FILE_EXT_RE = /\.[0-9a-z]+$/i

const fileExtensions = [
	// Images
	'jpg',
	'jpeg',
	'png',
	'gif',
	'bmp',
	'webp',
	'svg',
	'ico',
	// Documents
	'pdf',
	'doc',
	'docx',
	'xls',
	'xlsx',
	'ppt',
	'pptx',
	'txt',
	'md',
	'markdown',
	// Archives
	'zip',
	'rar',
	'7z',
	'tar',
	'gz',
	// Audio
	'mp3',
	'wav',
	'flac',
	'ogg',
	'opus',
	'm4a',
	'aac',
	'midi',
	'mid',
	// Video
	'mp4',
	'avi',
	'mkv',
	'mov',
	'wmv',
	'flv',
	'webm',
	// Web
	'html',
	'css',
	'js',
	'json',
	'xml',
	'tsx',
	'jsx',
	'ts',
	'vue',
	'svelte',
	'xsl',
	'rss',
	'atom',
	// Programming
	'php',
	'py',
	'rb',
	'java',
	'c',
	'cpp',
	'h',
	'go',
	// Data formats
	'csv',
	'tsv',
	'sql',
	'yaml',
	'yml',
	// Fonts
	'woff',
	'woff2',
	'ttf',
	'otf',
	'eot',
	// Executables/Binaries
	'exe',
	'msi',
	'apk',
	'ipa',
	'dmg',
	'iso',
	'bin',
	// Scripts/Config
	'bat',
	'cmd',
	'sh',
	'env',
	'htaccess',
	'conf',
	'toml',
	'ini',
	// Package formats
	'deb',
	'rpm',
	'jar',
	'war',
	// E-books
	'epub',
	'mobi',
	// Common temporary/backup files
	'log',
	'tmp',
	'bak',
	'old',
	'sav',
]

function isPathFile(path: string) {
	const lastSegment = path.split('/').pop()
	const ext = (lastSegment || path).match(FILE_EXT_RE)?.[0]
	return !!(ext && fileExtensions.includes(ext.replace('.', '')))
}

const domainTip: Record<string, string> = {
	'github.io': 'GitHub Pages 域名',
	'netlify.app': 'Netlify 域名',
	'pages.dev': 'Cloudflare 域名',
	'thisis.host': '纸鹿提供的域名',
	'vercel.app': 'Vercel 域名',
	'zeabur.app': 'Zeabur 域名',
}

export function getDomain(url: string) {
	const domain = fromUrl(url)
	return typeof domain === 'symbol' ? url : domain
}

export function getMainDomain(url: string, useIcann?: boolean) {
	const hostname = getDomain(url)
	const parseResult = parseDomain(hostname)
	if (parseResult.type !== ParseResultType.Listed)
		return hostname
	const { domain, topLevelDomains } = useIcann ? parseResult.icann : parseResult
	return `${domain}.${topLevelDomains.join('.')}`
}

export function getDomainType(mainDomain: string) {
	return domainTip[mainDomain]
}

const githubUsernameRegex = /github\.com\/([a-zA-Z0-9-]+)(?:\/[^/]+)?(\/?)$/

export function getGithubUsername(url?: string) {
	if (!url)
		return ''
	return url.match(githubUsernameRegex)?.[1] ?? ''
}

export function isExtLink(url?: string) {
	return url
		? url.includes(':') || url.startsWith('//') || !!isPathFile(url)
		: false
}

export function safelyDecodeUriComponent(str: string) {
	try {
		return decodeURIComponent(str)
	}
	catch {
		return str
	}
}

/** 静态托管添加的尾斜杠不应改变页面身份或 Content 缓存键。 */
export function normalizeContentPath(path: string) {
	return path.replace(/\/+$/, '') || '/'
}

/**
 * vue-router `aria-current="page"` 的静态等价物。
 *
 * ## 为什么需要它
 *
 * 线上每个指向当前页的链接都带 `aria-current="page"`——那是 `NuxtLink` 的
 * **自动行为**，不需要作者写。实测（2026-10-03 部署后取线上 HTML）：
 * 首页 `/` 上有 4 个 `href="/"` 的链接，**4 个全部**带 `aria-current="page"`
 * （页首 logo、侧栏「文章」、侧栏页脚菜单、main 里的 h1 站名），
 * 而 `/2024/03/takagi` 上同样这批链接**一个都没有**——
 * 正是「精确匹配当前页才标 page」这条语义。
 *
 * Astro 侧原本只有 `BlogSidebar` 自己算的 `currentMark`，
 * 于是首页 4 个里只有 1 个（侧栏那条）带标记。
 * `[aria-current]` 在两侧 CSS 里都是 **0 条规则**（已普查），所以这不影响外观，
 * 但它是屏幕阅读器会念出来的信息，属于功能差异。
 *
 * ## 为什么不「静态化固有地做不到」
 *
 * 每个页面是独立构建的，`Astro.url.pathname` 就是该页的路径，
 * 静态构建里完全可用（`layouts/Base.astro` 的 canonical、
 * `BlogSidebar.astro` 的 `currentMark`、`BlogAside.astro` 都在用）。
 *
 * ## 边界
 *
 * - `to` 带 query 或 hash → **一律不标**。静态构建拿不到访问者运行时的
 *   `location.search` / `location.hash`（见 `prose-enhance` 里同源的注意事项），
 *   标了就可能是错的。vue-router 会连 query/hash 一起比，这里比不了就不猜。
 * - 外链、页内锚点、`to` 未定义 → 不标（`NuxtLink` 对这些也不标）。
 */
export function currentPageHref(to: string | undefined, pathname: string): 'page' | undefined {
	if (!to || !to.startsWith('/') || to.startsWith('//') || isExtLink(to))
		return undefined
	// 带 query / hash 的交给上面的说明：无法判定，直接不标
	if (to.includes('?') || to.includes('#'))
		return undefined
	return normalizeContentPath(to) === normalizeContentPath(pathname) ? 'page' : undefined
}
