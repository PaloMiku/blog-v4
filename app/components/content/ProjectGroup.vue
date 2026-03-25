<script setup lang="ts">
/**
 * 项目分组组件
 * 用于展示单个或多个项目卡片，支持分组标题和网格布局
 *
 * 使用方式：
 * - 单个项目：传入 title/description/icon/link 即可
 * - 多个项目：传入 items 数组
 */
interface ProjectItem {
	/** 项目标题 */
	title: string
	/** 项目描述，可选 */
	description?: string
	/** 项目图标，支持 Iconify 图标名或图片 URL */
	icon?: string
	/** 项目链接，可选 */
	link?: string
}

interface Props {
	/** 分组标题，可选（仅 items 模式下显示） */
	title?: string
	/** 项目标题（单项目模式） */
	singleTitle?: string
	/** 项目描述（单项目模式） */
	singleDescription?: string
	/** 项目图标（单项目模式） */
	singleIcon?: string
	/** 项目链接（单项目模式） */
	singleLink?: string
	/** 项目列表（多项目模式） */
	items?: ProjectItem[]
}

const props = withDefaults(defineProps<Props>(), {
	singleTitle: undefined,
	singleDescription: undefined,
	singleIcon: undefined,
	singleLink: undefined,
	items: undefined,
})

// 判断是否为单项目模式
const isSingleMode = computed(() => {
	return props.singleTitle !== undefined || !props.items || props.items.length === 0
})

// 单项目的数据
const singleItem = computed(() => ({
	title: props.singleTitle ?? '',
	description: props.singleDescription,
	icon: props.singleIcon,
	link: props.singleLink,
}))

// 解析图标类型
function resolveIcon(icon?: string) {
	if (!icon)
		return null
	// 如果 icon 是 URL（包含 http 或 /），使用图片；否则作为 Iconify 图标名
	if (icon.includes('http') || icon.startsWith('/')) {
		return { type: 'img', value: icon }
	}
	return { type: 'iconify', value: icon }
}
</script>

<template>
<!-- 单项目模式 -->
<template v-if="isSingleMode && singleItem.title">
	<component
		:is="singleItem.link ? 'a' : 'div'"
		v-bind="singleItem.link ? {
			href: singleItem.link,
			target: '_blank',
			rel: 'noopener noreferrer',
			class: 'project-card',
			title: joinWith([singleItem.title, singleItem.description, singleItem.link]),
		} : {
			class: 'project-card',
			title: singleItem.title,
		}"
	>
		<slot name="icon">
			<Icon v-if="resolveIcon(singleItem.icon)?.type === 'iconify'" :name="resolveIcon(singleItem.icon)!.value" class="project-icon" />
			<NuxtImg v-else-if="resolveIcon(singleItem.icon)?.type === 'img'" :src="resolveIcon(singleItem.icon)!.value" :alt="singleItem.title" class="project-icon-img" />
		</slot>
		<div class="project-info">
			<div class="project-title">
				{{ singleItem.title }}
			</div>
			<div v-if="singleItem.description" class="project-description">
				{{ singleItem.description }}
			</div>
		</div>
	</component>
</template>

<!-- 多项目模式 -->
<section v-else-if="items && items.length > 0" class="project-group">
	<h2 v-if="title" class="project-group-title">
		{{ title }}
	</h2>
	<div class="project-grid">
		<component
			:is="item.link ? 'a' : 'div'"
			v-for="(item, index) in items"
			:key="index"
			v-bind="item.link ? {
				href: item.link,
				target: '_blank',
				rel: 'noopener noreferrer',
				class: 'project-card',
				title: joinWith([item.title, item.description, item.link]),
			} : {
				class: 'project-card',
				title: item.title,
			}"
		>
			<slot name="icon" :item="item">
				<Icon v-if="resolveIcon(item.icon)?.type === 'iconify'" :name="resolveIcon(item.icon)!.value" class="project-icon" />
				<NuxtImg v-else-if="resolveIcon(item.icon)?.type === 'img'" :src="resolveIcon(item.icon)!.value" :alt="item.title" class="project-icon-img" />
			</slot>
			<div class="project-info">
				<div class="project-title">
					{{ item.title }}
				</div>
				<div v-if="item.description" class="project-description">
					{{ item.description }}
				</div>
			</div>
		</component>
	</div>
</section>
</template>

<style lang="scss" scoped>
.project-group {
	margin: 1.5rem 0;
	padding: 1rem;
	border: 1px solid var(--c-border);
	border-radius: 0.5rem;
	background-color: var(--c-bg-1);
}

.project-group-title {
	margin: 0 0 0.8rem;
	font-size: 1rem;
	font-weight: 600;
	color: var(--c-text-1);
}

.project-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
	gap: 0.6rem;

	@media (max-width: $breakpoint-mobile) {
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	@media (max-width: $breakpoint-phone) {
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
}

.project-card {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.6rem 0.8rem;
	border-radius: 0.4rem;
	line-height: 1.3;
	text-decoration: none;
	color: inherit;
	transition: all 0.2s ease;

	&[href]:hover {
		box-shadow: 0 2px 8px var(--ld-shadow);
		background-color: var(--c-bg-soft);
		transform: translateY(-1px);
	}
}

.project-icon {
	flex-shrink: 0;
	font-size: 1.6rem;
}

.project-icon-img {
	flex-shrink: 0;
	width: 1.8rem;
	height: 1.8rem;
	border-radius: 0.3rem;
	object-fit: cover;
}

.project-info {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.1rem;
	min-width: 0;
}

.project-title {
	display: -webkit-box;
	overflow: hidden;
	margin: 0;
	font-size: 0.95rem;
	font-weight: 500;
	-webkit-line-clamp: 1;
	line-clamp: 1;
	line-height: 1.2;
	-webkit-box-orient: vertical;
}

.project-description {
	display: -webkit-box;
	overflow: hidden;
	opacity: 0.6;
	margin: 0;
	font-size: 0.75rem;
	-webkit-line-clamp: 1;
	line-clamp: 1;
	line-height: 1.2;
	-webkit-box-orient: vertical;
}
</style>
