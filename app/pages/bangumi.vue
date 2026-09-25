<script setup lang="ts">
const appConfig = useAppConfig()

useSeoMeta({
	title: '追番',
	description: `${appConfig.title}的 Bangumi 追番收藏与放送日历。`,
})
</script>

<template>
<div class="mobile-only">
	<BlogHeader to="/" suffix="追番" tag="h1" />
</div>

<BgmBangumiPage :categories="['anime', 'book', 'game', 'real']" class="proper-height" />
</template>
