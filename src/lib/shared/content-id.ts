// 条目 id 即 URL 合同（Nuxt→Astro 迁移期定型，此后改动会断开线上既有链接，
// 属产品规则而非临时兼容分支；历史背景见 docs/plan/analysis/engineering-inventory.md §4）：
//   1. frontmatter.permalink 优先，直接作为条目 id
//   2. `index` 表示所在目录本身：`games/index` → `games`
//   3. blogConfig.article.hidePostPrefix 去掉 /posts 前缀
//      （`/posts/foo` → `/foo`，`/posts/a/b` → `/a/b`）
//
// 本模块是从 `src/content.config.ts` 提取出的纯函数版本（EC-005）：不依赖 astro，
// 可被 `tests/content-id.test.mjs` 直接单测。`src/content.config.ts` 只 import 使用，
// 改动这里等价于改动 URL 合同，先读上面三条再动手。
import blogConfig from '../../config/blog'

export function generateId({ entry, data, base }: { entry: string, data: Record<string, unknown>, base: URL }) {
	const permalink = data.permalink
	if (typeof permalink === 'string' && permalink)
		return permalink.replace(/^\/+|\/+$/g, '')

	// 去掉 base 与扩展名，得到相对内容根的路径
	let rel = entry.replace(String(base), '').replace(/\.[^./]+$/, '')
	rel = rel.replace(/^\/+/, '')

	// index.md 表示所在目录本身，与 Nuxt 的文件路由一致：`games/index.md` → `games`
	rel = rel.replace(/(^|\/)index$/, '$1')
	rel = rel.replace(/\/+$/, '')

	if (blogConfig.article.hidePostPrefix && rel.startsWith('posts/'))
		rel = rel.slice('posts/'.length)

	return rel
}
