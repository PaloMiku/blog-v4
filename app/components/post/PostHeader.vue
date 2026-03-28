<script setup lang="ts">
import type { ArticleProps } from '~/types/article'

defineOptions({ inheritAttrs: false })
const props = defineProps<ArticleProps>()

const appConfig = useAppConfig()

const coverFilter = computed(() => props.meta?.coverFilter || (props.meta?.coverDim && 'brightness(0.75)') || undefined)
const categoryLabel = computed(() => props.categories?.[0])
const categoryIcon = computed(() => getCategoryIcon(categoryLabel.value))
const subtitle = computed(() => props.subtitle || props.meta?.subtitle)

const shareText = `【${appConfig.title}】${props.title}\n\n${
	props.description ? `${props.description}\n\n` : ''}${
	new URL(props.path!, appConfig.url).href}`

const { copy, copied } = useCopy(shareText)
</script>

<template>
<div class="post-header" :class="{ 'has-cover': image }">
	<Pic v-if="image" class="post-cover" :src="image" :alt="title" :filter="coverFilter" />

	<div class="post-header-content">
		<h1 class="post-title" :class="getPostTypeClassName(type)">
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
					icon="ph:pencil-simple-line-bold"
				/>

				<UtilDate
					v-if="updated && isTimeDiffSignificant(date, updated, 1)"
					v-tip
					:tip-transform="d => `修改于${d}`"
					:date="updated"
					icon="ph:clock-counter-clockwise-bold"
				/>

				<span v-if="categoryLabel">
					<Icon :name="categoryIcon" />
					{{ categoryLabel }}
				</span>

				<span>
					<Icon name="ph:paragraph-bold" />
					{{ formatNumber(readingTime?.words) }} 字
				</span>
			</div>

			<div class="operations">
				<ZButton
					:icon="copied ? 'ph:check-bold' : 'ph:share-bold'"
					@click="copy()"
				>
					文字分享
				</ZButton>
			</div>
		</div>
	</div>
</div>
</template>

<style lang="scss" scoped>
.post-header {
	margin: 0.5rem;
	border-radius: 1rem;
	background-color: var(--c-bg-2);
	color: var(--c-text);
	overflow: hidden;
	box-shadow: var(--shadow-elevation-2);
	transition: transform 0.2s ease;

	@media (max-width: $breakpoint-mobile) {
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
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.post-title {
	margin: 0;
	font-size: 1.75rem;
	line-height: 1.3;
	font-weight: 700;
	color: var(--c-text);
}

.post-subtitle {
	margin: 0;
	font-size: 1rem;
	line-height: 1.4;
	color: var(--c-text-2);
	max-width: 100%;
}

.post-nav {
	display: flex;
	flex-direction: row;
	justify-content: space-between;
	align-items: center;
	gap: 0.75rem;
	font-size: 0.85rem;
	color: var(--c-text-1);
}

.operations {
	flex-shrink: 0;
	opacity: 1;
}

.post-info {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 1rem;
	align-items: center;
}

.post-info span,
.post-info :deep(.icon) {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
}
</style>
