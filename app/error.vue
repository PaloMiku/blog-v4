<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
	error: NuxtError & { url?: string }
}>()

const errorStack = removeHtmlTags(props.error?.stack)

onMounted(() => {
	console.error(errorStack)
})
</script>

<template>
<NuxtLayout>
	<template #aside>
		<WidgetBlogLog />
	</template>

	<div class="app-error">
		<ZError
			:code="errorStack"
			:message="error.url"
			:title="`[${error.statusCode}] ${error.message}`"
		>
			<template #operation>
				<ZButton text="返回主页" @click="clearError({ redirect: '/' })" />
				<ZButton text="尝试忽略" @click="clearError()" />
			</template>
		</ZError>
	</div>
</NuxtLayout>
</template>

<style lang="scss" scoped>
.app-error {
	margin: 1rem;

	pre {
		text-align: start;
	}

	.error-stack {
		font-size: 0.9em;
		white-space: pre-wrap;
	}
}
</style>
