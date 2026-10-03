<script setup lang="ts">
import type { ArticleProps } from '~/types/article'

defineOptions({ inheritAttrs: false })
const props = defineProps<ArticleProps>()

const coverFilter = computed(() => props.meta?.coverFilter || (props.meta?.coverDim && 'brightness(0.75)') || undefined)
const categoryLabel = computed(() => props.categories?.[0])
const categoryIcon = computed(() => getCategoryIcon(categoryLabel.value))
const subtitle = computed(() => props.subtitle || props.meta?.subtitle)
</script>

<template>
<div class="post-header" :class="{ 'has-cover': image }">
	<Pic v-if="image" class="post-cover" :src="image" :alt="title" :filter="coverFilter" />

	<div class="post-header-content">
		<h1 class="post-title" :class="`text-${type || 'tech'}`">
			{{ title }}
		</h1>

		<p v-if="subtitle" class="post-subtitle">
			{{ subtitle }}
		</p>

		<div class="post-nav">
			<div class="post-info">
				<UtilDate
					v-if="date"
					v-tip
					:tip-transform="d => `创建于${d}`"
					:date
					icon="tabler:pencil"
				/>

				<UtilDate
					v-if="updated && isTimeDiffSignificant(date, updated, 1)"
					v-tip
					:tip-transform="d => `修改于${d}`"
					:date="updated"
					icon="tabler:history"
				/>

				<span v-if="categoryLabel">
					<Icon :name="categoryIcon" />
					{{ categoryLabel }}
				</span>

				<span>
					<Icon name="tabler:pilcrow" />
					{{ formatNumber(readingTime?.words) }} 字
				</span>
			</div>
		</div>
	</div>
</div>
</template>

<style scoped>
.post-header {
	overflow: hidden;
	margin: 0.5rem;
	border-radius: 1rem;
	box-shadow: var(--box-shadow-2);
	background-color: var(--c-bg-2);
	color: var(--c-text);
	transition: transform 0.2s ease;

	@media (max-width: 768px) {
		margin: 0;
		border-radius: 0;
	}

	&:hover {
		transform: translateY(-2px);
	}
}

.post-cover {
	width: 100%;
	height: auto;
	aspect-ratio: 16/9;

	> :deep(img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
}

.post-header-content {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	padding: 1rem;
}

.post-title {
	margin: 0;
	font-size: 1.75rem;
	font-weight: 700;
	line-height: 1.3;
	color: var(--c-text);
}

.post-subtitle {
	max-width: 100%;
	margin: 0;
	font-size: 1rem;
	line-height: 1.4;
	color: var(--c-text-2);
}

.post-nav {
	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.85rem;
	color: var(--c-text-1);
}

.post-info {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 1rem;
}

.post-info span,
.post-info :deep(.icon) {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
}
</style>
