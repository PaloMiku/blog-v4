/**
 * 受测页面清单。
 *
 * ## 为什么不能只靠 sitemap
 *
 * `compare-ui-parity.mjs` / `check-dom-semantics.mjs` 的 URL 清单来自
 * `https://blog.sotkg.com/sitemap.xml`。而 `robots.txt` 里有 `Disallow`，
 * 把三页挡在 sitemap 之外：
 *
 *     User-agent: *
 *     Disallow: /preview
 *     Disallow: /previews/
 *
 * 这三页**线上真实存在**（都返回 200，且是**预渲染**的，HTML 里带完整内容），
 * 本地 `dist/` 也都构建出来了，但它们因此**从来没有被页高对比、样式对比、
 * 任何浏览器门禁量过**。
 *
 * 代价是实打实的：`content/previews/**` 里用到的 19 个 MDC 组件，
 * 有 12 个只出现在 previews、在 `content/posts/**` 里一次都没用过——
 *
 *     blur  card-list  link-banner  link-card  meta-aside-bar  meta-aside-foo
 *     meta-copyright  poetry  project-group  series-group  timeline  video-embed
 *
 * 也就是说这 12 个组件的迁移正确性**没有任何测量背书**。
 * 手工核对 `/preview` 的 HTML 立刻就抓到一个真实缺陷：
 * `app/pages/preview.vue:19-23` 的 h1 里有「返回首页」箭头链接，
 * Astro 侧只写了裸文本「预览」。
 *
 * 所以这里显式补上这三页。清单只有这一个来源，避免两个脚本各写一份。
 */

/** robots `Disallow` 挡住、但线上真实存在的三页。 */
export const PREVIEW_PATHS = ['/preview', '/previews/example', '/previews/bangumi-components']

/**
 * 从线上 sitemap 取路径（生产站的 URL 带 origin，转成 pathname）。
 *
 * ## 为什么这里必须有重试和上下文
 *
 * 2026-10-03 实测：`--width=390` 那一趟跑到 preflight 之后，
 * 这一行抛了 `TypeError: fetch failed`，被 `compare-ui-parity.mjs` 的
 * `unhandledRejection` 兜底接住，输出一句
 *
 *     FAIL: fetch failed
 *
 * ——**没有 URL、没有次数、没有原因**，一整趟 28 分钟的测量直接作废。
 * 而失败的只是一次普通请求的网络抖动。
 *
 * 这和 `compare-ui-parity.mjs:276-278` 记的那条是同一类：
 * `stdio: 'ignore'` 把 preview 的报错整个丢掉了，只剩一句没线索的报错。
 * **一句没有线索的报错，比没有报错更难查**——它让人去查错的方向。
 *
 * 所以三件事一起做：有限次重试、单次请求超时、失败时把 URL 与
 * 底层原因一起抛出来。宁可慢，也不要让一次抖动废掉一整趟。
 */
export async function sitemapPaths(remote = 'https://blog.sotkg.com', { retries = 3, timeoutMs = 15000 } = {}) {
	// 线上 sitemap 形状随托管产物变：2026-10-03 起线上是 Astro（sitemap-index.xml+分片），
	// Nuxt 时代的 /sitemap.xml 已 404。两种形状都认，index 形态递归取分片。
	const bases = [`${remote}/sitemap-index.xml`, `${remote}/sitemap.xml`]
	const locs = t => [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname)
	let last
	for (const url of bases) {
		for (let i = 1; i <= retries; i++) {
			try {
				const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
				if (!res.ok)
					throw new Error(`HTTP ${res.status} ${res.statusText}`)
				const text = await res.text()
				const paths = locs(text)
				if (paths.length === 0)
					throw new Error('200 但解析不出任何 <loc>')
				if (!url.endsWith('sitemap-index.xml'))
					return paths
				const shards = await Promise.all(paths.map(async p => locs(await (await fetch(`${remote}${p}`, { signal: AbortSignal.timeout(timeoutMs) })).text())))
				return shards.flat()
			}
			catch (e) {
				last = e
				if (i < retries)
					await new Promise(r => setTimeout(r, 800 * i))
			}
		}
	}
	throw new Error(`取 sitemap 失败（两种形状 × 重试 ${retries} 次）：${bases.join(' / ')}\n       最后一次的原因：${last?.cause?.message || last?.message || last}`)
}

/** 受测全集 = sitemap + previews，按字典序去重。 */
export async function allPaths(remote) {
	return [...new Set([...await sitemapPaths(remote), ...PREVIEW_PATHS])].sort()
}
