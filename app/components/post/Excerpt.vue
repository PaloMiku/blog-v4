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
	<div class="ai-excerpt__header">
		<div class="ai-excerpt__title">
			<span class="ai-icon-gpt">
				<Icon name="simple-icons:openai" class="ai-gpt-icon" />
			</span>
			<span class="ai-excerpt__label">{{ appConfig.component.excerpt?.label || '智能摘要' }}</span>
		</div>
		<span class="ai-excerpt__badge">{{ appConfig.component.excerpt?.badge || 'AI 生成后摘要' }}</span>
	</div>

	<div
		id="excerpt-content"
		class="ai-excerpt__content"
		:class="{
			'ai-excerpt__content--folded': isFolded && isNarrowScreen,
			'ai-excerpt__content--unfolded': !isFolded && isNarrowScreen,
		}"
		role="region"
		:aria-expanded="!isFolded"
	>
		{{ excerpt }}{{ caret }}
	</div>

	<div v-if="showToggle" class="ai-excerpt__toggle-outer hide-on-wide">
		<div class="ai-excerpt__toggle-wrap">
			<button
				class="ai-excerpt__toggle"
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
	margin: 1rem 0.5rem;
	padding: 0.8rem;
	border-radius: 1rem;
	border: 1px solid var(--c-border, rgba(150, 165, 185, 0.3));
	background: var(--ld-bg-card, var(--c-bg, rgba(255, 255, 255, 0.95)));
	box-shadow: 0 10px 26px var(--ld-shadow, rgba(5, 12, 27, 0.07));
	color: var(--c-text, #1b2330);
	transition: box-shadow 0.3s ease, transform 0.2s ease;
	--excerpt-folded-max-height: 4.8em;
	--excerpt-unfolded-max-height: 28em;
}

.ai-excerpt__header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 0.6rem;
}

.ai-excerpt__title {
	display: inline-flex;
	align-items: center;
	gap: 0.32rem;
	font-weight: 700;
	color: var(--c-primary-base, var(--c-primary, #2f4f7d));
}

.ai-icon-gpt {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	border-radius: 0.5rem;
	background: linear-gradient(135deg, var(--c-primary), var(--c-primary-soft));
	color: var(--c-bg, #fff);
}

.ai-gpt-icon {
	width: 0.85rem;
	height: 0.85rem;
}

.ai-excerpt__label {
	font-size: 0.95rem;
}

.ai-excerpt__badge {
	font-size: 0.75rem;
	font-weight: 600;
	padding: 0.15rem 0.5rem;
	border-radius: 999px;
	background: var(--c-primary-soft, rgba(44, 126, 196, 0.14));
	color: var(--c-primary, #1b577f);
}

.ai-excerpt__content {
	max-height: none;
	overflow: hidden;
	transition: max-height 0.28s ease, opacity 0.22s ease;
	white-space: pre-wrap;
	word-break: break-word;
	line-height: 1.6;
	padding: 0.75rem;
	border: 1px solid var(--c-border, rgba(180, 190, 205, 0.35));
	border-radius: 0.8rem;
	background: var(--c-bg-1, rgba(240, 246, 255, 0.8));
	color: var(--c-text-2, #44506a);
	font-size: 0.88rem;
	opacity: 1;
}

.ai-excerpt__content--folded {
	max-height: var(--excerpt-folded-max-height);
	opacity: 0.96;
}

.ai-excerpt__content--unfolded {
	max-height: var(--excerpt-unfolded-max-height);
}

.hide-on-wide {
	@media (min-width: 769px) {
		display: none !important;
	}
}

.ai-excerpt__toggle-outer {
	margin-top: 0.5rem;
}

.ai-excerpt__toggle-wrap {
	display: flex;
	justify-content: flex-end;
}

.ai-excerpt__toggle {
	padding: 0.3rem 0.75rem;
	border-radius: 999px;
	border: 1px solid rgba(91, 121, 161, 0.35);
	background: rgba(100, 141, 190, 0.12);
	color: #1f4a79;
	font-size: 0.8rem;
	font-weight: 700;
	cursor: pointer;
	transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.ai-excerpt__toggle:hover {
	background: rgba(50, 101, 164, 0.2);
}

@media (prefers-reduced-motion: reduce) {
	.ai-excerpt,
	.ai-excerpt__content,
	.ai-excerpt__toggle {
		transition: none !important;
	}
}
</style>
