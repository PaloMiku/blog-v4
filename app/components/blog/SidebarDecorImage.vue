<script setup lang="ts">
import { computed } from 'vue'

interface DecorativeImage {
	url?: string
	opacity?: number
	height?: string
	backgroundSize?: string
	backgroundPosition?: string
	backgroundRepeat?: string
}

const props = defineProps<{ image?: DecorativeImage | null }>()

const style = computed(() => {
	const image = props.image

	if (!image?.url) {
		return {
			display: 'none',
		}
	}

	return {
		backgroundImage: `url(${image.url})`,
		opacity: image.opacity ?? 0.25,
		height: image.height ?? '6rem',
		backgroundSize: image.backgroundSize ?? 'cover',
		backgroundPosition: image.backgroundPosition ?? 'center',
		backgroundRepeat: image.backgroundRepeat ?? 'no-repeat',
	}
})
</script>

<template>
<div v-if="props.image?.url" class="sidebar-decor" :style="style" />
</template>

<style scoped lang="scss">
.sidebar-decor {
	position: relative;
	overflow: hidden;
	width: 100%;
	border-radius: 0.5rem;
	background-clip: border-box;
	background-color: transparent;
	background-origin: border-box;
	pointer-events: none;
	z-index: 0;

	&::before,
	&::after {
		content: "";
		position: absolute;
		right: 0;
		left: 0;
		height: 1.5rem;
		background:
			linear-gradient(
				to bottom,
				rgb(255 255 255 / 80%) 0%,
				rgb(255 255 255 / 0%) 100%
			);
		pointer-events: none;
		z-index: 1;
	}

	:global(.dark) &::before,
	:global(.dark) &::after {
		background:
			linear-gradient(
				to bottom,
				rgb(0 0 0 / 55%) 0%,
				rgb(0 0 0 / 0%) 100%
			);
	}

	&::before {
		top: 0;
	}

	&::after {
		bottom: 0;
		transform: rotate(180deg);
	}
}

:global(.dark) .sidebar-decor {
	filter: brightness(1.1) saturate(1.1);
}

:global(.light) .sidebar-decor {
	filter: brightness(1) saturate(1);
}
</style>
