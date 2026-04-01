<script setup lang="ts">
const props = defineProps<{
	id?: string
}>()

const INLINE_SPACE_RE = /\s+/g

const paragraphEl = useTemplateRef('paragraph')
const hasCommentTarget = ref(false)
const isDesktopPointer = useMediaQuery('(hover: hover) and (pointer: fine)')

const { insertQuote } = useCommentQuote()

const showQuoteButton = computed(() => hasCommentTarget.value && isDesktopPointer.value)

function getParagraphText() {
	if (!paragraphEl.value)
		return ''

	const clone = paragraphEl.value.cloneNode(true) as HTMLElement
	clone.querySelector('.paragraph-quote-btn')?.remove()
	return clone.textContent?.replace(INLINE_SPACE_RE, ' ').trim() || ''
}

async function quoteParagraph() {
	const text = getParagraphText()
	if (!text)
		return
	await insertQuote(text)
}

onMounted(() => {
	hasCommentTarget.value = Boolean(document.querySelector('#twikoo'))
})
</script>

<template>
<p
	:id="props.id"
	ref="paragraph"
	class="prose-paragraph"
	:class="{ 'has-quote-button': showQuoteButton }"
>
	<slot />
	<button
		v-if="showQuoteButton"
		type="button"
		class="paragraph-quote-btn"
		aria-label="引用整段到评论区"
		@click="quoteParagraph"
	>
		<Icon name="ph:chat-circle-text" />
	</button>
</p>
</template>

<style scoped lang="scss">
.prose-paragraph {
	position: relative;

	&.has-quote-button {
		padding-inline-end: 1.8em;
	}

	>.paragraph-quote-btn {
		position: absolute;
		top: 0.15em;
		right: 0.15em;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.16em;
		border-radius: 0.35em;
		line-height: 1;
		color: var(--c-text-2);
		opacity: 0;
		pointer-events: auto;
		transition: 0.2s;
	}

	@media (hover: hover) and (pointer: fine) {
		&:hover > .paragraph-quote-btn,
		>.paragraph-quote-btn:hover,
		>.paragraph-quote-btn:focus-visible {
			opacity: 0.85;
		}
	}

	@media (hover: none), (pointer: coarse) {
		>.paragraph-quote-btn {
			opacity: 0;
			transition: opacity 0.2s;
		}
		&.has-quote-button > .paragraph-quote-btn {
			opacity: 1;
		}
	}

	>.paragraph-quote-btn:hover,
	>.paragraph-quote-btn:focus-visible {
		color: var(--c-primary);
		opacity: 1;
	}
}
</style>
