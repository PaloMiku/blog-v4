<script setup lang="ts">
const { timeEstablished } = useAppConfig()

const blogLog = [
	{ label: '2026-03-25', value: '博客整体轻量化重构，准备开源' },
	{ label: '2025-08-20', value: '升级到 Nuxt 4 + Nuxt Content v3' },
	{ label: '2025-05-11', value: '重构到 Nuxt 3 + Nuxt Content v2' },
	{ label: '2023-05-24', value: '更换框架为 Hexo，升级博客' },
	{ label: timeEstablished, value: '博客建立' },
]
</script>

<template>
<BlogWidget card title="更新日志">
	<ZDlGroup size="large" :items="blogLog" />
</BlogWidget>
</template>
