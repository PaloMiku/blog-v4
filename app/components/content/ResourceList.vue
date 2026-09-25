<script setup lang="ts">
interface ResourceItem {
	id?: string | number
	title: string
	subtitle?: string
	tags?: string[]
	link?: string
	summary?: string
	extractPassword?: string
	downloadPassword?: string
}

defineProps<{
	items: ResourceItem[]
}>()
</script>

<template>
<ol class="resource-list">
	<li v-for="item in items" :key="item.id ?? item.title" class="resource-item card">
		<div class="resource-content">
			<div>
				<div class="resource-title">
					{{ item.title }}
				</div>
				<p v-if="item.subtitle" class="resource-subtitle">
					{{ item.subtitle }}
				</p>
				<p v-if="item.summary" class="resource-summary">
					{{ item.summary }}
				</p>
			</div>

			<div class="resource-meta">
				<div v-if="item.extractPassword || item.downloadPassword" class="passwords">
					<span v-if="item.extractPassword">解压: {{ item.extractPassword }}</span>
					<span v-if="item.downloadPassword">下载: {{ item.downloadPassword }}</span>
				</div>
				<div class="tags">
					<Badge v-for="tag in item.tags" :key="tag" :text="tag" />
				</div>
			</div>
		</div>

		<a
			v-if="item.link"
			class="download-btn"
			:href="item.link"
			aria-label="下载资源"
			title="下载资源"
			target="_blank"
			rel="noopener"
		>
			<Icon name="tabler:download" />
		</a>
		<button
			v-else
			class="download-btn"
			type="button"
			disabled
			aria-label="下载资源"
			title="下载资源"
		>
			<Icon name="tabler:download" />
		</button>
	</li>
</ol>
</template>

<style lang="scss" scoped>
.resource-list {
	display: grid;
	gap: 1em;
	margin: 0;
	padding: 0;

	@media (max-width: $breakpoint-phone) {
		gap: 0.75em;
	}
}

.resource-item {
	display: flex;
	align-items: center;
	gap: 1em;
	padding: 1em;

	@media (max-width: $breakpoint-phone) {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5em;
		padding: 0.75em;
	}
}

.resource-content {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 0.75em;
	min-width: 0;

	> div {
		display: flex;
		flex-direction: column;
		gap: 0.3em;
	}
}

.resource-title {
	font-size: 1.05em;
	font-weight: 700;
	color: var(--c-text);
}

.resource-subtitle,
.resource-summary {
	margin: 0;
	font-size: 0.9em;
}

.resource-subtitle {
	color: var(--c-text-2);
}

.resource-summary {
	color: var(--c-text-1);
}

.resource-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5em;
	font-size: 0.8em;

	@media (max-width: $breakpoint-phone) {
		flex-direction: column;
		align-items: flex-start;
	}
}

.passwords span {
	padding: 0.2em 0.4em;
	border-radius: 0.3em;
	background: var(--c-bg-2);
	color: var(--c-text-2);
}

.passwords,
.tags {
	display: flex;
	flex-wrap: wrap;
}

.passwords {
	gap: 0.5em;
}

.tags {
	gap: 0.25em;
}

.download-btn {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	width: 2.4em;
	height: 2.4em;
	border-radius: 0.5em;
	background: var(--c-primary);
	font-size: 1.1em;
	color: white;
	transition: all 0.2s;

	&:hover:not(:disabled) {
		box-shadow: 0 0.5em 1em var(--ld-shadow);
		transform: translateY(-2px);
	}

	&:disabled {
		opacity: 0.5;
	}

	@media (max-width: $breakpoint-phone) {
		width: 2.2em;
		height: 2.2em;
		font-size: 1em;
	}
}
</style>
