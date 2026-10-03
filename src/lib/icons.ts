/**
 * 图标名解析：把调用方传入的 Iconify 名解析到 astro-icon 已加载的集合里。
 *
 * ## 为什么需要这一层
 * `astro-icon/components/Icon.astro` 在名字解析不到时是**直接 throw** `AstroIconError`，
 * 会让整站 `pnpm build` 失败。本项目有 50+ 处调用点、名字又有一部分来自内容数据
 * （`getDomainIcon(url)` 按文章里的外链域名算出来的），无法保证全部命中。
 * 所以在 `Icon.astro` 里先自行解析，解析不到就走**显式降级**（`data-icon-missing`），
 * 既不炸构建，也不会静默丢图标。
 *
 * ## 集合前缀的两处历史包袱
 * 1. Nuxt 侧 `@nuxt/icon` 的自定义集合前缀是 `zi`（`nuxt.config.ts` 的
 *    `icon.customCollections`），本地文件在 `app/assets/icons/`。
 *    但 astro-icon 1.2.0 的 `loadLocalCollection.js` 把本地集合前缀**硬编码**为
 *    `local`，且引用时**不带前缀**（`name="zhilu"`），没有 `addCollection` 之类的
 *    自定义前缀 API。这里把 `zi:` 映射到 `local:`，保住既有 `zi:` 契约。
 * 2. Nuxt 会把 `SolarRewindBackBoldDuotone` 归一化成
 *    `solar-rewind-back-bold-duotone`（构建时有 WARN），故 `astro-site/src/icons/`
 *    下的文件已按归一化后的 kebab-case 命名。
 */

// @ts-ignore astro-icon 的虚拟模块，类型见其 typings/virtual.d.ts
import collections from 'virtual:astro-icon'

/** astro-icon 本地集合的固定前缀（loadLocalCollection.js 里硬编码） */
const LOCAL_SET = 'local'

/** Nuxt 侧自定义集合前缀，映射到 astro-icon 的 local */
const ZI_SET = 'zi'

export interface ResolvedIcon {
	set: string
	name: string
}

function lookup(set: string, iconName: string): boolean {
	if (!set || !iconName)
		return false
	const collection = collections[set]
	if (!collection)
		return false
	// 与 astro-icon 内部 `getIconData` 的判定保持一致：本体或别名
	return iconName in collection.icons || iconName in (collection.aliases ?? {})
}

/** 解析图标名；解析不到返回 null（调用方应走降级分支） */
export function resolveIcon(raw?: string): ResolvedIcon | null {
	const name = (raw ?? '').trim()
	if (!name)
		return null

	const sep = name.indexOf(':')
	// 不带前缀：astro-icon 约定为本地图标
	if (sep < 0)
		return lookup(LOCAL_SET, name) ? { set: LOCAL_SET, name } : null

	const prefix = name.slice(0, sep)
	const iconName = name.slice(sep + 1)
	const set = prefix === ZI_SET ? LOCAL_SET : prefix
	return lookup(set, iconName) ? { set, name: iconName } : null
}
