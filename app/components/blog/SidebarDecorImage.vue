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
  width: 100%;
  border-radius: 0.5rem;
  overflow: hidden;
  background-color: transparent;
  background-origin: border-box;
  background-clip: border-box;
  pointer-events: none;
  position: relative;
  z-index: 0;

  &::before,
  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 1.5rem;
    pointer-events: none;
    z-index: 1;
    background: linear-gradient(
      to bottom,
      var(--ld-bg-card, var(--c-bg, #fff)) 0%,
      rgba(255, 255, 255, 0) 100%
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
</style>
