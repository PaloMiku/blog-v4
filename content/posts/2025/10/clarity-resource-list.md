---
title: 为 Clarity 主题增加 ResourceList 资源列表组件
date: 2025-10-20 22:00:00
description: 本文介绍了为Clarity博客主题增加ResourceList资源列表组件的方法，提供了完整的Vue组件代码与使用语法，用于创建包含标题、链接、密码等信息的资源下载列表。
categories: [站点魔改]
tags: [Clarity,Vue]
image: https://blog-files.101045700.xyz/2025/10/ResourceList.webp
---

## 前言

本站使用的是纸鹿的 Clarity 博客主题（个人修改）版，最近加上了一个资源列表和下载组件，用来替换部分页面组件和未来准备的可能性下载需求。

本篇文章讲解如何添加和使用本组件到 Clarity 主题博客中。

## 组件文件

在 `/app/components/content/` 目录下新建 `ResourceList.vue` 并填入以下代码：

### Github Gist

https://gist.github.com/PaloMiku/11e5c3e6ccdad906e0dca2aea26228ba

### 本站

```vue
<script setup lang="ts">
interface ResourceItem {
  id?: string | number
  title: string
  subtitle?: string
  tags?: string[]
  link?: string
  summary?: string
  extractPassword?: string
  downloadPassword?: string
}

defineProps<{
  items: ResourceItem[]
}>()
</script>

<template>
<ol class="resource-list">
	<li v-for="item in items" :key="item.id ?? item.title" class="resource-item card">
		<div class="resource-content">
			<div>
				<div class="resource-title">
					{{ item.title }}
				</div>
				<p v-if="item.subtitle" class="resource-subtitle">
					{{ item.subtitle }}
				</p>
				<p v-if="item.summary" class="resource-summary">
					{{ item.summary }}
				</p>
			</div>

			<div class="resource-meta">
				<div v-if="item.extractPassword || item.downloadPassword" class="passwords">
					<span v-if="item.extractPassword">解压: {{ item.extractPassword }}</span>
					<span v-if="item.downloadPassword">下载: {{ item.downloadPassword }}</span>
				</div>
				<div class="tags">
					<Badge v-for="tag in item.tags" :key="tag" :text="tag" />
				</div>
			</div>
		</div>

		<ZRawLink
			v-if="item.link"
			:to="item.link"
			class="download-btn"
			aria-label="下载资源"
			title="下载资源"
			target="_blank"
			rel="noopener"
		>
			<Icon name="ph:download-simple" />
		</ZRawLink>
		<button
			v-else
			class="download-btn"
			disabled
			aria-label="下载资源"
			title="下载资源"
		>
			<Icon name="ph:download-simple" />
		</button>
	</li>
</ol>
</template>

<style lang="scss" scoped>
.resource-list {
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1em;

  @media (max-width: 600px) {
    gap: 0.75em;
  }
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 1em;
  padding: 1em;

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5em;
    padding: 0.75em;
  }
}

.resource-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75em;
  min-width: 0;

  > div {
    display: flex;
    flex-direction: column;
    gap: 0.3em;
  }
}

.resource-title {
  font-weight: 700;
  font-size: 1.05em;
  color: var(--c-text);
}

.resource-subtitle,
.resource-summary {
  margin: 0;
  font-size: 0.9em;
}

.resource-subtitle {
  color: var(--c-text-2);
}

.resource-summary {
  color: var(--c-text-1);
}

.resource-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  font-size: 0.8em;

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: flex-start;
  }
}

.passwords span {
  color: var(--c-text-2);
  background: var(--c-bg-2);
  padding: 0.2em 0.4em;
  border-radius: 0.3em;
}

.passwords,
.tags {
  display: flex;
  flex-wrap: wrap;
}

.passwords {
  gap: 0.5em;
}

.tags {
  gap: 0.25em;
}

.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.4em;
  height: 2.4em;
  border-radius: 0.5em;
  background: var(--c-primary);
  color: white;
  font-size: 1.1em;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 0.5em 1em var(--ld-shadow);
  }

  &:disabled {
    opacity: 0.5;
  }

  @media (max-width: 600px) {
    width: 2.2em;
    height: 2.2em;
    font-size: 1em;
  }
}
</style>
```

## 使用

保存组件并启动开发服务器测试。

::tab{:tabs='["组件","语法"]'}
#tab1
::resource-list
---
items:
  - id: 1
    title: 示例资源 1
    subtitle: 这是一个副标题
    summary: 这是资源的简短描述
    tags: ["标签1", "标签2"]
    link: "https://example.com/download1"
    extractPassword: "abc123"
    downloadPassword: "def456"
  - id: 2
    title: 示例资源 2
    subtitle: 另一个副标题
    summary: 另一个资源的简短描述
    tags: ["标签3"]
    link: "https://example.com/download2"
---
::

# tab2
```mdc wrap expand
::resource-list
---
items:
  - id: 1
    title: 示例资源 1
    subtitle: 这是一个副标题
    summary: 这是资源的简短描述
    tags: ["标签1", "标签2"]
    link: "https://example.com/download1"
    extractPassword: "abc123"
    downloadPassword: "def456"
  - id: 2
    title: 示例资源 2
    subtitle: 另一个副标题
    summary: 另一个资源的简短描述
    tags: ["标签3"]
    link: "https://example.com/download2"
---
::
```
::

成功渲染如上“组件”所示效果即成功应用。
