<script setup lang="ts">
import { delay } from 'es-toolkit/promise'

const props = defineProps<{
	excerpt: string
}>()

const appConfig = useAppConfig()

const excerpt = ref(props.excerpt)
const caret = ref('')
const isFolded = ref(true)
const isNarrowScreen = ref(false)
const isReducedMotion = ref(false)

const showToggle = computed(() => props.excerpt.length > 80 && isNarrowScreen.value)

function updateNarrowScreen() {
	isNarrowScreen.value = window.matchMedia('(max-width: 768px)').matches
}

function updateReducedMotion() {
	isReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function toggleFold() {
	isFolded.value = !isFolded.value
}

async function runTypingAnimation(content: string) {
	excerpt.value = ''
	caret.value = appConfig.component.excerpt?.caret ?? '_'
	for (const char of content) {
		excerpt.value += char
		await delay(50)
	}
	caret.value = ''
}

function renderExcerpt() {
	if (appConfig.component.excerpt?.animation !== false && !isReducedMotion.value) {
		runTypingAnimation(props.excerpt)
	}
	else {
		excerpt.value = props.excerpt
		caret.value = ''
	}
}

onMounted(() => {
	if (typeof window !== 'undefined') {
		updateNarrowScreen()
		updateReducedMotion()

		const media = window.matchMedia('(max-width: 768px)')
		const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')

		media.addEventListener('change', updateNarrowScreen)
		reducedMotionMedia.addEventListener('change', updateReducedMotion)

		onBeforeUnmount(() => {
			media.removeEventListener('change', updateNarrowScreen)
			reducedMotionMedia.removeEventListener('change', updateReducedMotion)
		})
	}

	renderExcerpt()
})

if (import.meta.dev) {
	watch(() => props.excerpt, (newExcerpt) => {
		excerpt.value = newExcerpt
		isFolded.value = true
		renderExcerpt()
	})
}
</script>

<template>
<div v-if="props.excerpt" class="md-excerpt ai-excerpt">
	<div class="ai-excerpt-header">
		<div class="ai-excerpt-title">
			<span class="ai-icon-gpt">
				<Icon name="simple-icons:openai" class="ai-gpt-icon" />
			</span>
			<span class="ai-excerpt-label">{{ appConfig.component.excerpt?.label || '智能摘要' }}</span>
		</div>
		<span class="ai-excerpt-badge">{{ appConfig.component.excerpt?.badge || 'AI 生成后摘要' }}</span>
	</div>

	<div
		id="excerpt-content"
		class="ai-excerpt-content"
		:class="{
			'ai-excerpt-content-folded': isFolded && isNarrowScreen,
			'ai-excerpt-content-unfolded': !isFolded && isNarrowScreen,
		}"
		role="region"
		:aria-expanded="!isFolded"
	>
		{{ excerpt }}{{ caret }}
	</div>

	<div v-if="showToggle" class="ai-excerpt-toggle-outer hide-on-wide">
		<div class="ai-excerpt-toggle-wrap">
			<button
				class="ai-excerpt-toggle"
				aria-controls="excerpt-content"
				:aria-expanded="!isFolded"
				@click="toggleFold"
			>
				{{ isFolded ? '展开全部' : '收起' }}
			</button>
		</div>
	</div>
</div>
</template>

<style lang="scss" scoped>
.ai-excerpt {
	--excerpt-folded-max-height: 4.8em;
	--excerpt-unfolded-max-height: 28em;

	margin: 1rem 0.5rem;
	padding: 0.8rem;
	border-radius: 0.5em;
	box-shadow: var(--box-shadow-2);
	background: var(--ld-bg-card);
	color: var(--c-text);
	transition: box-shadow 0.3s ease, transform 0.2s ease;
}

.ai-excerpt-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 0.6rem;
}

.ai-excerpt-title {
	display: inline-flex;
	align-items: center;
	gap: 0.32rem;
	font-weight: 700;
	color: var(--c-primary);
}

.ai-icon-gpt {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	border-radius: 0.5em;
	background: linear-gradient(135deg, var(--c-primary), var(--c-primary-soft));
	color: var(--c-bg);
}

.ai-gpt-icon {
	width: 0.85rem;
	height: 0.85rem;
}

.ai-excerpt-label {
	font-size: 0.95rem;
}

.ai-excerpt-badge {
	padding: 0.15rem 0.5rem;
	border-radius: 999px;
	background: var(--c-primary-soft);
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--c-primary);
}

.ai-excerpt-content {
	overflow: hidden;
	overflow-wrap: break-word;
	opacity: 1;
	max-height: none;
	padding: 0.75rem;
	border-radius: 0.5em;
	background: var(--c-bg-1);
	font-size: 0.88rem;
	line-height: 1.6;
	white-space: pre-wrap;
	color: var(--c-text-2);
	transition: max-height 0.28s ease, opacity 0.22s ease;
}

.ai-excerpt-content-folded {
	opacity: 0.96;
	max-height: var(--excerpt-folded-max-height);
}

.ai-excerpt-content-unfolded {
	max-height: var(--excerpt-unfolded-max-height);
}

.hide-on-wide {
	@media (min-width: 769px) {
		display: none;
	}
}

.ai-excerpt-toggle-outer {
	margin-top: 0.5rem;
}

.ai-excerpt-toggle-wrap {
	display: flex;
	justify-content: flex-end;
}

.ai-excerpt-toggle {
	padding: 0.3rem 0.75rem;
	border: 1px solid var(--c-border);
	border-radius: 999px;
	background: var(--c-primary-soft);
	font-size: 0.8rem;
	font-weight: 700;
	color: var(--c-primary);
	transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
	cursor: pointer;
}

.ai-excerpt-toggle:hover {
	background: var(--c-bg-3);
}

@media (prefers-reduced-motion: reduce) {
	.ai-excerpt,
	.ai-excerpt-content,
	.ai-excerpt-toggle {
		transition: none;
	}
}
</style>
