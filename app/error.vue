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
			:title="`[${error.status}] ${error.message}`"
		>
			<template #operation>
				<ZButton text="返回主页" @click="clearError({ redirect: '/' })" />
				<ZButton text="尝试忽略" @click="clearError()" />
			</template>
		</ZError>
	</div>
</NuxtLayout>
</template>

<style scoped>
.app-error {
	margin: 1rem;
}
</style>
