<script setup lang="ts">
import type { TocLink } from '@nuxt/content'

const [DefineTemplate, ReuseTemplate] = createReusableTemplate<{
	tocTree: TocLink[]
}>({ inheritAttrs: false })

const contentStore = useContentStore()
const { toc } = storeToRefs(contentStore)
const { activeHeadingId } = useToc(toc)

function scrollToTop() {
	if (!import.meta.client)
		return

	window.scrollTo({ top: 0, behavior: 'smooth' })
}

function hasHeading(tocTree: TocLink, heading?: string): boolean {
	return tocTree.id === heading || !!tocTree.children?.some(child => hasHeading(child, heading))
}
</script>

<template>
<BlogWidget>
	<template #title>
		<span class="title">文章目录</span>
		<div class="toc-actions">
			<button class="back-to-top" type="button" aria-label="返回开头" @click="scrollToTop">
				<Icon name="tabler:arrow-up-circle" />
			</button>

			<a class="comment-btn" href="#twikoo" aria-label="评论区">
				<Icon name="tabler:message-circle" />
			</a>
		</div>
	</template>

	<!-- 放在顶层会导致 Transition 失效 -->
	<DefineTemplate v-slot="{ tocTree }">
		<ol>
			<li
				v-for="(entry, index) in tocTree"
				:key="index"
				:class="{
					'has-active': hasHeading(entry, activeHeadingId),
					'active': entry.id === activeHeadingId,
				}"
			>
				<!-- 使用 <a> 确保键盘焦点切换 -->
				<a :href="`#${entry?.id}`" :title="entry.text">{{ entry.text }}</a>
				<ReuseTemplate v-if="entry.children" :toc-tree="entry.children" />
			</li>
		</ol>
	</DefineTemplate>

	<UtilHydrateSafe>
		<ReuseTemplate v-if="toc?.links.length" :toc-tree="toc.links" />
		<p v-else class="no-toc">
			暂无目录信息
		</p>
	</UtilHydrateSafe>
</BlogWidget>
</template>

<style lang="scss" scoped>
:deep(.widget-body) {
	position: relative;

	&::before {
		content: "";
		position: absolute;
		inset: 0.3rem;
		width: 3px;
		border-radius: 1rem;
		background-color: var(--c-bg-3);
	}

	ol {
		padding-inline-start: 0.8rem;
	}

	li {
		opacity: 0.6;
		font-size: 0.94em;
		color: var(--c-text);
		transition: opacity 0.2s;

		&:hover {
			opacity: 0.94;
		}

		&.has-active, &.active {
			opacity: 1;
			font-size: 1em;
		}

		&.active::before {
			content: "";
			position: absolute;
			inset-inline-start: 0.3rem;
			margin: 0.2rem 0;
			padding: 0.6rem 1.5px;
			border-radius: 1rem;
			background-color: var(--c-primary);
		}

		a {
			display: block;
			overflow: hidden;
			padding: 0.2em 0.5em;
			border-radius: 0.5em;
			white-space: nowrap;
			text-overflow: ellipsis;
			transition: all 0.2s;

			&:hover {
				background-color: var(--c-bg-soft);
			}
		}
	}
}

.title {
	flex-grow: 1;
}

.toc-actions {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 0.4rem;
	margin-left: auto;
}

.toc-actions button,
.toc-actions a {
	position: relative;
	border: 0;
	background: transparent;
	color: var(--c-text);
	width: 2.2rem;
	height: 2.2rem;
	padding: 0;
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	outline: none;
	box-shadow: inset 0 0 0 1px var(--c-border);
	transition: all 0.2s;
}

.toc-actions button:hover,
.toc-actions a:hover {
	color: var(--c-primary);
	box-shadow: inset 0 0 0 1px var(--c-primary);
}

.back-to-top,
.comment-btn {
	position: relative;
}

.back-to-top svg,
.comment-btn svg {
	position: relative;
	z-index: 1;
}

.no-toc {
	padding: 1em;
	text-align: center;
	color: var(--c-text-3);
}
</style>
