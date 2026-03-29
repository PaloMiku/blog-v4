<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
	type?: 'subject' | 'media' | 'character'
	id?: number | string
	apiBase?: string
}>(), {
	type: 'subject',
})
const TRIM_SLASH_RE = /\/+$/
const NEWLINE_RE = /\n{2,}/g

const appConfig = useAppConfig()
const runtimeConfig = useRuntimeConfig()

const bangumiType = computed(() => (props.type === 'character' ? 'character' : 'subject'))
const resolvedId = computed(() => String(props.id ?? '').trim())

const apiBase = computed(() => {
	return props.apiBase
		|| (appConfig.component as any)?.infoCard?.apiBase
		|| runtimeConfig.public.bangumiApiBase
})

const fetchUrl = computed(() => {
	if (!resolvedId.value || !apiBase.value)
		return ''
	const base = apiBase.value.replace(TRIM_SLASH_RE, '')
	return `${base}/api/${bangumiType.value}?id=${encodeURIComponent(resolvedId.value)}`
})

const { data, pending, error } = await useAsyncData(
	() => `bangumi-info-${bangumiType.value}-${resolvedId.value}`,
	async () => {
		if (!fetchUrl.value) {
			return null
		}

		return $fetch(fetchUrl.value, {
			headers: {
				Accept: 'application/json',
			},
			retry: 0,
			timeout: 10000,
		})
	},
)

const response = computed(() => (data.value as any) ?? {})

const GENDER_MAN_RE = /^(?:男|male|m|男性|man)$/
const GENDER_WOMAN_RE = /^(?:女|female|f|女性|woman)$/

function normalizeGender(raw?: string): string {
	if (!raw)
		return ''
	const normalized = String(raw).trim().toLowerCase()
	if (GENDER_MAN_RE.test(normalized))
		return '男'
	if (GENDER_WOMAN_RE.test(normalized))
		return '女'
	return ''
}

const title = computed(() => {
	if (!response.value)
		return ''
	if (bangumiType.value === 'character')
		return response.value.name ?? '--'
	return response.value.name_cn || response.value.name || '--'
})

const genderLabel = computed(() => {
	if (bangumiType.value !== 'character')
		return ''
	return normalizeGender(response.value?.gender)
})

const voiceActorsLabel = computed(() => {
	if (bangumiType.value !== 'character')
		return ''
	const arr = (response.value?.voiceActors || [])
		.map((vo: any) => String(vo.name || '').trim())
		.filter(Boolean)
		.filter((name: string, idx: number, list: string[]) => list.indexOf(name) === idx)
	return arr.join(' / ')
})

const genderIcon = computed(() => {
	if (genderLabel.value === '男')
		return 'ph:gender-male'
	if (genderLabel.value === '女')
		return 'ph:gender-female'
	return ''
})

const titleRightInfo = computed(() => voiceActorsLabel.value || '')

const subtitle = computed(() => {
	if (!response.value)
		return ''
	if (bangumiType.value === 'character')
		return response.value.name_jp || ''
	return response.value.name && response.value.name_cn && response.value.name_cn !== response.value.name
		? response.value.name
		: ''
})

const image = computed(() => {
	if (!response.value)
		return ''
	if (bangumiType.value === 'character')
		return response.value.images?.large || response.value.images?.medium || ''
	return response.value.images?.large || response.value.images?.common || ''
})

const summary = computed(() => {
	if (!response.value)
		return ''
	return (response.value.summary || '').trim().replace(NEWLINE_RE, '\n\n').split('\n').slice(0, 5).join('\n')
})

const metaLines = computed(() => {
	if (!response.value)
		return []

	if (bangumiType.value === 'character') {
		const values: string[] = []
		if (response.value.birthday)
			values.push(`生日: ${response.value.birthday}`)
		return values
	}

	const values: string[] = []
	if (response.value.status)
		values.push(`状态: ${response.value.status}`)
	if (response.value.date)
		values.push(`开播: ${response.value.date}`)
	if (response.value.eps !== undefined)
		values.push(`集数: ${response.value.eps}`)
	if (response.value.rating?.score)
		values.push(`评分: ${response.value.rating.score} (${response.value.rating.total || 0})`)
	return values
})

const tags = computed(() => {
	if (!response.value)
		return []
	if (bangumiType.value === 'character')
		return []
	return (response.value.tags || []).slice(0, 8).map((t: any) => t.name || t)
})

const loadError = computed(() => {
	if (!resolvedId.value || !apiBase.value)
		return true
	return Boolean(error.value)
})
</script>

<template>
<div v-if="pending" class="info-card-state">
	正在加载 Bangumi 信息...
</div>
<template v-else-if="loadError" />
<article v-else class="info-card">
	<div class="info-card-grid">
		<div class="info-card-cover">
			<UtilImg v-if="image" :src="image" :alt="title" :style="{ objectFit: 'contain' }" />
			<div v-else class="no-image">
				暂无封面
			</div>
		</div>

		<div class="info-card-main">
			<h3 class="info-card-title">
				{{ title }}
				<span v-if="genderLabel" class="info-card-gender">
					<Icon :name="genderIcon" />
					{{ genderLabel }}
				</span>
				<small v-if="titleRightInfo" class="info-card-title-meta">{{ titleRightInfo }}</small>
			</h3>
			<p v-if="subtitle" class="info-card-subtitle">
				{{ subtitle }}
			</p>
			<div class="info-card-description-box">
				<div class="info-card-description">
					{{ summary }}
				</div>
			</div>
			<ul class="info-card-meta">
				<li v-for="line in metaLines" :key="line">
					{{ line }}
				</li>
				<li v-if="tags.length">
					标签: {{ tags.join(' / ') }}
				</li>
			</ul>
		</div>
	</div>
</article>
</template>

<style lang="scss" scoped>
.info-card {
	position: relative;
	margin: 1em auto;
	padding: 0.8rem;
	border-radius: 0.8rem;
	background-color: var(--ld-bg-card);
	box-shadow: var(--box-shadow-2);
	transition: transform 0.2s ease, box-shadow 0.2s ease;

	&:hover {
		transform: translateY(-1px);
	}

	&.loading,
	&.error {
		opacity: 0.85;
	}
}

.info-card-state {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	padding: 1rem;
	font-size: 0.95rem;
	color: var(--c-text-2);
}

.info-card-state.error {
	color: var(--c-danger);
}

.info-card-grid {
	display: grid;
	grid-template-columns: 160px 1fr;
	grid-template-rows: auto;
	gap: 0.8rem;
	align-items: start;
}

.info-card-cover {
	width: 100%;
	height: 100%;
	min-height: 10rem;
	overflow: hidden;
	border-radius: 0.65rem;
	background-color: var(--ld-bg-2);
	position: relative;

	:deep(img) {
		width: 100%;
		height: 100%;
		object-fit: cover !important;
		object-position: top !important;
	}

	min-height: 10rem;
}

@media (max-width: 1024px) {
	.info-card-grid {
		grid-template-columns: 120px 1fr;
		gap: 0.6rem;
	}

	.info-card-cover {
		height: 12rem;
		min-height: 12rem;
	}

	.info-card-main {
		min-height: 10rem;
	}
}

@media (max-width: 640px) {
	.info-card {
		padding: 0.6rem;
	}

	.info-card-title {
		font-size: 1rem;
	}

	.info-card-subtitle,
	.info-card-summary,
	.info-card-meta {
		font-size: 0.82rem;
	}

	.info-card-cover {
		min-height: 10rem;
	}
}

.info-card-title {
	margin: 0.2rem 0;
	font-size: 1.1rem;
	font-weight: 700;
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.info-card-gender {
	display: inline-flex;
	align-items: center;
	gap: 0.2rem;
	font-size: 0.85rem;
	color: var(--c-text-2);
	font-weight: 500;
}

.info-card-title-meta {
	font-size: 0.75rem;
	color: var(--c-text-2);
	font-weight: 500;
}

.info-card-subtitle {
	margin: 0 0 0.5rem;
	color: var(--c-text-2);
	font-size: 0.85rem;
}

.info-card-description {
	margin: 0.5rem 0;
	padding: 0.5rem;
	font-size: 0.88rem;
	line-height: 1.6;
	white-space: pre-wrap;
	word-break: break-word;
}

.info-card-description-box {
	position: relative;
}

.info-card-meta {
	margin: 0 0 0.7rem;
	padding: 0;
	list-style: none;
	font-size: 0.8rem;
	color: var(--c-text-2);
	line-height: 1.3;
}

.info-card-spoiler-overlay {
	position: absolute;
	inset: 0;
	z-index: 10;
	background: rgba(0, 0, 0, 0.75);
	color: #fff;
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 1rem;
	cursor: pointer;
	border-radius: 0.8rem;
}

.info-card.spoiler-hidden .info-card-cover,
.info-card.spoiler-hidden .info-card-main {
	filter: blur(1px);
}
</style>
