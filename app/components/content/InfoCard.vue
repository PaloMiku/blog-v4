<script setup lang="ts">
/**
 * InfoCard：Bangumi 信息卡，支持条目（media）与角色（character）。
 * 数据在客户端挂载后拉取；apiBase 为空时走同源 /api，未配置数据源则落入错误态。
 * 文章内用法：
 * ::info-card
 * ---
 * type: media
 * id: 315069
 * ---
 * ::
 */
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'

interface BgmEntity {
	id: number
	name?: string
	name_cn?: string
	img?: string
	images?: { common?: string, grid?: string, large?: string, medium?: string, small?: string }
	summary?: string
	url?: string
	rating?: { score: number, total: number }
}

const props = defineProps<{
	/** media=条目 / character=角色 */
	type?: 'media' | 'character'
	id: number | string
}>()

const WHITESPACE_RE = /\s+/g
const TRAILING_SLASH_RE = /\/+$/

const isCharacter = computed(() => props.type === 'character')
const entityId = computed(() => Number(props.id))
const typeLabel = computed(() => (isCharacter.value ? '角色' : '条目'))

const apiBase = computed(() => (useRuntimeConfig().public.bangumi as { apiBase?: string } | undefined)?.apiBase ?? '')
const data = shallowRef<BgmEntity | null>(null)
const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle')

let controller: AbortController | null = null
let disposed = false

async function load(): Promise<void> {
	if (!import.meta.client || disposed)
		return
	controller?.abort()
	controller = new AbortController()
	status.value = 'loading'
	try {
		const path = isCharacter.value ? `/api/character/${entityId.value}` : `/api/subject/${entityId.value}`
		const base = apiBase.value.replace(TRAILING_SLASH_RE, '')
		const response = await fetch(`${base}${path}`, { signal: controller.signal })
		if (!response.ok)
			throw new Error(`HTTP ${response.status}`)
		data.value = await response.json() as BgmEntity
		status.value = 'success'
	}
	catch {
		if (!disposed)
			status.value = 'error'
	}
}

onMounted(load)
onUnmounted(() => {
	disposed = true
	controller?.abort()
})

const name = computed(() => data.value?.name_cn || data.value?.name || '')
const originalName = computed(() => {
	const entity = data.value
	return entity?.name_cn && entity.name && entity.name !== entity.name_cn ? entity.name : ''
})
const cover = computed(() => data.value?.img || data.value?.images?.common || '')
const summary = computed(() => (data.value?.summary ?? '').replace(WHITESPACE_RE, ' ').trim())
const link = computed(() => data.value?.url || `https://bgm.tv/${isCharacter.value ? 'character' : 'subject'}/${entityId.value}`)
const rating = computed(() => {
	const score = data.value?.rating?.score
	return score && score > 0 ? score : null
})
</script>

<template>
<section class="info-card card">
	<!-- 加载骨架 -->
	<div v-if="status === 'loading'" class="info-card-body" aria-hidden="true">
		<div class="info-card-cover info-card-skeleton" />
		<div class="info-card-content">
			<div class="info-card-line info-card-skeleton info-card-line--eyebrow" />
			<div class="info-card-line info-card-skeleton info-card-line--title" />
			<div class="info-card-line info-card-skeleton info-card-line--summary" />
		</div>
	</div>

	<!-- 错误态 -->
	<div v-else-if="status === 'error'" class="info-card-body info-card-body--error">
		<p class="info-card-error-text">
			暂时无法加载{{ typeLabel }}信息
		</p>
		<button class="info-card-retry" type="button" @click="load">
			重新加载
		</button>
	</div>

	<!-- 内容 -->
	<a v-else-if="data" class="info-card-body" :href="link" target="_blank" rel="noopener">
		<img v-if="cover" class="info-card-cover" :src="cover" :alt="name" loading="lazy" decoding="async">
		<div class="info-card-content">
			<span class="info-card-eyebrow">
				{{ typeLabel }}
				<span v-if="rating !== null" class="info-card-rating">★ {{ rating.toFixed(1) }}</span>
			</span>
			<span class="info-card-title">{{ name }}</span>
			<span v-if="originalName" class="info-card-original">{{ originalName }}</span>
			<p v-if="summary" class="info-card-summary">
				{{ summary }}
			</p>
		</div>
	</a>
</section>
</template>

<style lang="scss" scoped>
.info-card {
	margin: 1em 0;
	font-size: 0.9em;

	&:hover {
		box-shadow: var(--box-shadow-2);
	}
}

.info-card-body {
	display: flex;
	align-items: center;
	gap: 0.8em;
	padding: 0.8em;

	&--error {
		gap: 0.5em;
	}
}

.info-card-cover {
	flex-shrink: 0;
	width: 4em;
	height: 4em;
	border-radius: 0.3em;
	background-color: var(--c-bg-2);
	object-fit: cover;
}

.info-card-content {
	display: flex;
	flex-direction: column;
	gap: 0.2em;
	min-width: 0;
}

.info-card-line {
	height: 0.8em;
	border-radius: 0.3em;

	&--eyebrow {
		width: 30%;
	}

	&--title {
		width: 60%;
		height: 1.2em;
	}

	&--summary {
		width: 100%;
		height: 2.4em;
	}
}

.info-card-eyebrow {
	display: flex;
	align-items: center;
	gap: 0.4em;
	font-size: 0.85em;
	color: var(--c-text-3);
}

.info-card-rating {
	color: var(--c-warning);
}

.info-card-title {
	font-size: 1.1em;
	font-weight: 700;
	color: var(--c-text);
}

.info-card-original {
	font-size: 0.9em;
	color: var(--c-text-2);
}

.info-card-summary {
	display: -webkit-box;
	overflow: hidden;
	font-size: 0.95em;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	color: var(--c-text-2);
	-webkit-box-orient: vertical;
}

.info-card-error-text {
	font-size: 0.9em;
	color: var(--c-text-2);
}

.info-card-skeleton {
	background:
		linear-gradient(
			90deg,
			var(--c-bg-2) 25%,
			var(--ld-bg-card) 50%,
			var(--c-bg-2) 75%
		);
	background-size: 200% 100%;
	animation: info-card-shimmer 1.4s ease-in-out infinite;
}

@keyframes info-card-shimmer {
	from {
		background-position: 200% 0;
	}

	to {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.info-card-skeleton {
		animation: none;
	}
}

.info-card-retry {
	flex-shrink: 0;
	padding: 0.2em 0.6em;
	border-radius: 0.3em;
	background-color: var(--c-primary);
	font-size: 0.85em;
	color: #FFF;
}
</style>
