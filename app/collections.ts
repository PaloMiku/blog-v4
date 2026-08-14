export interface CollectionSetting {
	/** 合集在卡片上显示的标题 */
	title: string
	/** 可选副标题，显示在合集卡片标题下方 */
	description?: string
	/** 可选 Iconify 图标名，默认 tabler:folder */
	icon?: string
	/** 可选图标颜色，参考 article.categories 的 color 配置，留空使用默认文本色 */
	color?: string
}

/**
 * 文章合集设置
 * 文章 frontmatter 的 `collection` 字段为 key，对应此中的条目。
 * 未登记的 key 仍会正常展示，标题显示为 key 本身。
 */
const collections: Record<string, CollectionSetting> = {
	'galgame-notes': {
		title: 'Galgame',
		description: 'Galgame 相关合集测试',
		icon: 'tabler:device-gamepad-2',
		color: '#f6a',
	},
	// 示例：
	// 'some-collection': {
	// 	title: '合集显示名',
	// 	description: '合集副标题',
	// 	icon: 'tabler:folder',
	// 	color: '#f6a',
	// },
}

export default collections
