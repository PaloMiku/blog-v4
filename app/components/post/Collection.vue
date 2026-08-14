<script setup lang="ts">
import collections from '~/collections'

const route = useRoute()
const { post } = useArticle()

const collectionKey = computed(() => post.value?.collection)
const setting = computed(() => collectionKey.value ? collections[collectionKey.value] : undefined)

const { data: items } = await useAsyncData(
	`collection:${route.path}`,
	() => {
		const key = collectionKey.value
		return key
			? queryCollection('content')
					.where('collection', '=', key)
					.select('date', 'path', 'title', 'type')
					.order('date', 'ASC')
					.all()
			: Promise.resolve([])
	},
	{ default: () => [] },
)
</script>

<template>
<section v-if="collectionKey && items.length" class="post-collection">
	<!-- 原生折叠：无 JS 状态，键盘与无障碍支持由浏览器提供 -->
	<details class="collection" open>
		<summary class="collection-header">
			<Icon
				class="collection-icon"
				:name="setting?.icon || 'tabler:folder'"
				:style="{ color: setting?.color }"
			/>
			<span class="header-text">
				<strong class="title text-creative">{{ setting?.title || collectionKey }}</strong>
				<span v-if="setting?.description" class="description">
					{{ setting.description }}
				</span>
			</span>
			<span class="separator" />
			<span class="count">{{ items.length }} 篇</span>
			<Icon class="chevron" name="tabler:chevron-down" />
		</summary>
		<div class="collection-body">
			<ul class="collection-list">
				<li
					v-for="item in items"
					:key="item.path"
					class="collection-item"
					:class="{ current: item.path === route.path }"
				>
					<UtilLink class="collection-link" :to="item.path">
						<span class="article-title text-creative">
							{{ item.title }}
						</span>
						<UtilDate v-if="item.date" class="date" :date="item.date" />
						<span v-if="item.path === route.path" class="current-tag">当前</span>
					</UtilLink>
				</li>
			</ul>
		</div>
	</details>
</section>
</template>

<style lang="scss" scoped>
.post-collection {
	margin: 2rem 0.5rem 0;
	border: 1px solid var(--c-border);
	border-radius: 0.5em;
	box-shadow: var(--box-shadow-1);
	background-color: var(--c-bg-2);
	transition: box-shadow 0.2s, transform 0.2s;

	&:hover {
		box-shadow: var(--box-shadow-3);
		transform: translateY(-2px);
	}
}

.collection-header {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.85rem 1.25rem;
	border-radius: 0.5em;
	font-size: 0.9rem;
	color: var(--c-text-2);
	transition: background-color 0.2s;

	// 隐藏原生 details 标记符，使用自绘 chevron
	list-style: none;
	cursor: pointer;

	&::-webkit-details-marker {
		display: none;
	}

	&:hover {
		background-color: var(--c-bg-soft);
	}

	> .collection-icon {
		display: flex;
		flex: none;
		font-size: 1.6em;
	}

	> .header-text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;

		> .title {
			font-size: 1.1rem;
			font-weight: 550;
			color: var(--c-text);
		}

		> .description {
			font-size: 0.8rem;
			line-height: 1.4;
			color: var(--c-text-3);
		}
	}

	> .separator {
		flex: 1;
	}

	> .count {
		flex: none;
		font-size: 0.8em;
	}

	> .chevron {
		flex: none;
		opacity: 0.5;
		font-size: 1.2em;
		transition: transform 0.2s;

		// 展开时箭头朝上
		.collection[open] & {
			transform: rotate(180deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		> .chevron {
			transition: none;
		}
	}
}

.collection-body {
	display: none;
	padding: 0 1.25rem 1rem;
}

// 显式声明折叠，不依赖浏览器对 <details> 内容的 UA 隐式隐藏
.collection[open] .collection-body {
	display: block;
}

.collection-list {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.collection-item {
	position: relative;
	border-radius: 0.5em;

	&.current::before {
		content: "";
		position: absolute;
		inset-block: 20%;
		inset-inline-start: 0.15rem;
		width: 0.2rem;
		border-radius: 999px;
		background-color: var(--c-primary);
	}

	&.current .collection-link {
		color: var(--c-primary);
	}
}

.collection-link {
	display: flex;
	align-items: baseline;
	gap: 0.8em;
	padding: 0.45em 0.7em;
	border-radius: 0.5em;
	transition: background-color 0.2s;

	.article-title {
		flex: 1;
		overflow: hidden;
		min-width: 0;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.date {
		flex: none;
		font-size: 0.8em;
		color: var(--c-text-3);
	}

	.current-tag {
		flex: none;
		padding: 0.05em 0.5em;
		border: 1px solid var(--c-primary);
		border-radius: 999px;
		font-size: 0.7em;
	}

	&:hover {
		background-color: var(--c-bg-soft);
	}
}
</style>
