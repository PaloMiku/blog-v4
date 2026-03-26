<script setup lang="ts">
import type { ArticleProps } from '~/types/article'

defineOptions({ inheritAttrs: false })
const props = defineProps<ArticleProps>()
const appConfig = useAppConfig()

const title = computed(() => props.title || '')
const path = computed(() => props.path || '')
const date = computed(() => props.date)
const updated = computed(() => props.updated)
const references = computed(() => props.references)
const meta = computed(() => props.meta)

function formatDate(dateStr?: string): string {
	if (!dateStr)
		return ''
	try {
		const d = new Date(dateStr)
		if (Number.isNaN(d.getTime()))
			return ''
		return d.toLocaleDateString('zh-CN', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		})
	}
	catch (e) {
		console.error(`Invalid date: ${dateStr}`, e)
		return ''
	}
}

const formattedDate = computed(() => formatDate(date.value))
const formattedUpdatedDate = computed(() => formatDate(updated.value))
const fullUrl = computed(() => {
	if (!path.value)
		return ''
	try {
		return new URL(path.value, appConfig.url).href
	}
	catch {
		return ''
	}
})
</script>

<template>
<div v-if="!meta?.hideInfo" class="post-footer">
	<section class="author-card">
		<div class="copyright-badge">
			<Icon name="ph:copyright-bold" />
		</div>

		<div class="card-left">
			<div class="card-header">
				<div class="author-info">
					<h3 class="title">
						{{ title }}
					</h3>
					<div v-if="path" class="url-wrapper">
						<p class="url">
							{{ fullUrl }}
						</p>
					</div>
				</div>
			</div>

			<div class="card-meta">
				<div class="meta-column">
					<div class="meta-item">
						<span class="label">文章作者</span>
						<span class="value">{{ appConfig.author.name }}</span>
					</div>
					<div v-if="date" class="meta-item">
						<span class="label">发布时间</span>
						<span class="value">{{ formattedDate }}</span>
					</div>
					<div v-if="updated && updated !== date" class="meta-item">
						<span class="label">更新时间</span>
						<span class="value">{{ formattedUpdatedDate }}</span>
					</div>
					<div class="meta-item">
						<span class="label">版权信息</span>
						<a :href="appConfig.copyright.url" class="value copyright-link">
							{{ appConfig.copyright.name }}
						</a>
					</div>
				</div>
			</div>
		</div>

		<div class="card-signature-text">
			PaloMiku
		</div>

		<section v-if="references" class="reference">
			<div id="references" class="title text-creative">
				参考链接
			</div>
			<div class="content">
				<ul>
					<li v-for="({ title: rt, link }, i) in references" :key="i">
						<ProseA :href="link || ''">
							{{ rt ?? link }}
						</ProseA>
					</li>
				</ul>
			</div>
		</section>
	</section>
</div>
</template>

<style lang="scss" scoped>
.post-footer {
	margin: 2rem 0.5rem;
	border: 1px solid var(--c-border);
	border-radius: 1rem;
	background-color: var(--c-bg-2);
}

section {
	padding: 1.2rem;

	& + section {
		border-top: 1px solid var(--c-border);
	}
}

.title {
	font-weight: bold;
	color: var(--c-text);
}

.content {
	margin-top: 0.5em;
	font-size: 0.9rem;

	li {
		margin: 0.5em 0;
	}
}

.author-card {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	position: relative;
	padding: 1.5rem !important;
}

.copyright-badge {
	position: absolute;
	top: 1.5rem;
	right: 1.5rem;
	font-size: 2rem;
	color: var(--c-border);
	opacity: 0.5;
}

.card-left {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.card-header {
	display: flex;
	align-items: flex-start;
}

.author-info .title {
	margin: 0 0 0.5rem;
	font-size: 1.1rem;
	line-height: 1.4;
}

.url-wrapper { display: flex; align-items: center; gap: -0.05rem; }

.url {
	flex: 1;
	min-width: 0;
	margin: 0;
	font-size: 0.85rem;
	word-break: break-all;
	color: var(--c-text-soft);
}

.card-meta {
	.meta-column { display: flex; flex-direction: column; gap: 0.8rem; }
	.meta-item { display: flex; flex-direction: column; gap: 0.3rem; }
	.label { font-size: 0.75rem; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--c-text-soft); }
	.value { font-size: 0.9rem; font-weight: 500; color: var(--c-text-1); }
	.copyright-link { text-decoration: none; color: var(--c-primary); transition: opacity 0.2s; }
	.copyright-link:hover { opacity: 0.8; }
}

.card-signature-text {
	position: absolute;
	right: 1.5rem;
	bottom: 1.5rem;
	font-family: 'Ephesis', var(--font-creative), sans-serif;
	font-size: 2rem;
	font-weight: 700;
	color: var(--c-text);
	opacity: 0.95;
	text-shadow: 0 0 4px rgba(255, 255, 255, 0.25);
	z-index: 2;
	padding: 0.25rem 0.4rem;
	background-color: transparent;
	border-radius: 0.35rem;
}

@media (max-width: 768px) {
	.card-signature-text {
		position: relative;
		right: auto;
		bottom: auto;
		align-self: flex-end;
		margin-top: 0.7rem;
		text-align: right;
		background-color: transparent;
	}
}

@media (prefers-color-scheme: dark) {
	.card-signature-text {
		background-color: transparent;
		text-shadow: 0 0 3px rgba(0, 0, 0, 0.35);
	}
}

.dark .card-signature-text {
	background-color: transparent;
	text-shadow: 0 0 3px rgba(0, 0, 0, 0.35);
}

.reference .content ul { margin: 0; padding: 0; list-style: none; }
.reference .content li { margin: 0.6rem 0; }
</style>
