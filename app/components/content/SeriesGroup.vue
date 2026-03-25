<script setup lang="ts">
interface Props {
	/** 系列标题 */
	title: string
	/** 系列描述 */
	description?: string
	/** 系列封面图，支持多张 */
	cover?: string | string[]
	/** 系列详情路由 */
	link?: string
	/** 作品总数 */
	count?: number
	/** 是否在新标签页打开 */
	openInNewTab?: boolean
}

const props = withDefaults(defineProps<Props>(), {
	openInNewTab: true,
})

// 规范化封面图为数组
const covers = computed(() => {
	if (!props.cover)
		return []
	if (Array.isArray(props.cover))
		return props.cover
	return [props.cover]
})

const isExpanded = ref(false)

function toggleExpand() {
	isExpanded.value = !isExpanded.value
}
</script>

<template>
<div class="series-group">
	<!-- 封面图区域 -->
	<div class="cover-section">
		<div class="cover-container">
			<!-- 堆叠图片 -->
			<div class="cover-stack">
				<div
					v-for="(coverItem, index) in covers"
					:key="`${coverItem}-${index}`"
					class="stack-item"
					:style="{
						'zIndex': covers.length - index,
						'--i': index,
					}"
				>
					<NuxtImg
						:src="coverItem"
						:alt="title"
						class="cover-image"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- 信息区域 -->
	<div class="info-section">
		<!-- 左侧信息内容 -->
		<div class="info-content">
			<h2 class="series-title">
				{{ title }}
			</h2>
			<p v-if="description" class="series-description">
				{{ description }}
			</p>
		</div>

		<!-- 统计和操作区域 -->
		<div class="meta-actions">
			<!-- 统计信息 -->
			<div v-if="count" class="series-count">
				<Icon name="ph:game-controller-bold" />
				<span>共 {{ count }} 部 Galgame</span>
			</div>

			<!-- 操作按钮 -->
			<div class="action-area">
				<!-- 展开/收起按钮 -->
				<button
					v-if="covers.length > 1"
					class="expand-btn"
					:title="isExpanded ? '收起' : '展开'"
					@click="toggleExpand"
				>
					<Icon :name="isExpanded ? 'ph:caret-up-bold' : 'ph:caret-down-bold'" />
				</button>

				<!-- 查看详情按钮 -->
				<NuxtLink
					v-if="link"
					:to="link"
					class="detail-link"
					target="_blank"
					title="查看详情"
				>
					<Icon name="ph:arrow-right-bold" />
					<span>查看详情</span>
				</NuxtLink>
			</div>
		</div>
	</div>
</div>
</template>

<style lang="scss" scoped>
.series-group {
	display: flex;
	flex-direction: column;
	gap: 0;
	overflow: hidden;
	border: 1px solid var(--c-border);
	border-radius: 0.5rem;
	background-color: transparent;
	transition: all 0.2s ease;
}

// 封面图部分
.cover-section {
	flex-shrink: 0;
	position: relative;
	width: 100%;
}

.cover-container {
	position: relative;
	width: 100%;
	aspect-ratio: 16 / 6;
	background-color: var(--c-bg-mute);
	cursor: pointer;
}

.cover-wrapper {
	overflow: hidden;
	width: 100%;
	height: 100%;
}

// 堆叠图片容器
.cover-stack {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	position: relative;
	width: 100%;
	height: 100%;
	padding-left: 2rem;
}

.stack-item {
	position: absolute;
	overflow: hidden;
	top: 50%;
	width: auto;
	height: 80%;
	aspect-ratio: 16 / 9;
	border-radius: 0.3rem;
	box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
	transform: translateY(-50%) translateX(calc(var(--i, 0) * 60px));
	transition: transform 0.5s ease-out;

	@media (prefers-color-scheme: dark) {
		box-shadow: 0 2px 8px rgb(0 0 0 / 40%);
	}
}

.cover-stack:hover .stack-item {
	transform: translateY(-50%) translateX(calc(var(--i, 0) * 50%));
}

.cover-image {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.cover-placeholder {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	background: linear-gradient(135deg, var(--c-bg-mute), var(--c-bg-soft));
	color: var(--c-text-softer);

	:deep(svg) {
		opacity: 0.4;
		width: 2rem;
		height: 2rem;
	}
}

// 信息部分
.info-section {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding: 1rem;
	border-top: none;

	@media (prefers-color-scheme: dark) {
		border-top-color: var(--c-border-dark, rgb(255 255 255 / 10%));
	}
}

.info-content {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.4rem;
	min-width: 0;
}

.series-title {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
	line-height: 1.2;
	word-break: break-word;
	color: var(--c-text);
}

.series-description {
	display: -webkit-box;
	overflow: hidden;
	margin: 0;
	font-size: 0.8rem;
	-webkit-line-clamp: 1;
	line-clamp: 1;
	line-height: 1.4;
	word-break: break-word;
	color: var(--c-text-soft);
	-webkit-box-orient: vertical;
}

// 统计和操作区域
.meta-actions {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

// 统计信息
.series-count {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	margin-top: 0;
	font-size: 0.75rem;
	color: var(--c-text-soft);

	:deep(svg) {
		opacity: 0.7;
		width: 0.9em;
		height: 0.9em;
	}
}

// 操作区域
.action-area {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: flex-end;
	gap: 0.5rem;
}

// 展开/收起按钮
.expand-btn {
	display: none;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	padding: 0;
	border: 1px solid var(--c-border-light, rgb(0 0 0 / 10%));
	border-radius: 0.3rem;
	background-color: var(--c-bg-soft);
	color: var(--c-text-soft);
	transition: all 0.2s ease;
	cursor: pointer;

	&:hover {
		border-color: var(--ld-primary, #4F46E5);
		background-color: var(--c-bg-mute);
		color: var(--c-text);
	}

	:deep(svg) {
		width: 1.2rem;
		height: 1.2rem;
	}
}

// 查看详情按钮
.detail-link {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	gap: 0.25rem;
	padding: 0.5rem 1rem;
	font-size: 0.8rem;
	text-decoration: none;
	color: var(--c-text-soft);
	transition: color 0.2s ease;

	&:hover {
		color: var(--c-text);
	}

	:deep(svg) {
		width: 1em;
		height: 1em;
	}
}

// 展开动画
.expand-enter-active,
.expand-leave-active {
	transition: all 0.3s ease;
}

.expand-enter-from,
.expand-leave-to {
	opacity: 0;
	max-height: 0;
}

@media (max-width: 640px) {
	.cover-container {
		aspect-ratio: 8 / 2.5;
	}

	.info-section {
		gap: 0.75rem;
		padding: 0.75rem;
	}

	.series-title {
		font-size: 0.95rem;
	}

	.action-area {
		flex-wrap: wrap;
	}

	.detail-link {
		flex: 1;
		min-width: 120px;
	}
}
</style>
