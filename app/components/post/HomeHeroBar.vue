<script setup lang="ts">
import { onMounted } from 'vue'

const props = defineProps<{ articleCount: number }>()

const appConfig = useAppConfig()

const isClosed = useState('homeHeroBarClosed', () => false)
const isCollapsed = useState('homeHeroBarCollapsed', () => false)

const localStorageKey = 'homeHeroBarClosed'

onMounted(() => {
	if (process.client) {
		const closed = localStorage.getItem(localStorageKey)
		if (closed === 'true') {
			isClosed.value = true
		}
	}
})

const { data: stats } = useFetch('/api/stats')

const totalWords = computed(() => {
	const words = stats.value?.total?.words
	if (typeof words === 'number')
		return new Intl.NumberFormat().format(words)
	if (typeof words === 'string' && words)
		return words
	return '--'
})

const operateTime = computed(() => {
	try {
		return timeElapse(appConfig.timeEstablished)
	}
	catch {
		return '--'
	}
})

const actionItems = computed(() => (appConfig.footer?.iconNav ?? []).filter((item: any) => item.url))

function close() {
	isClosed.value = true
	if (process.client)
		localStorage.setItem(localStorageKey, 'true')
}

function toggleCollapse() {
	isCollapsed.value = !isCollapsed.value
}
</script>

<template>
<div v-if="!isClosed" class="home-hero-bar">
	<div class="hero-left">
		<div class="hero-control">
			<button class="hero-control-btn" type="button" @click="toggleCollapse">
				<Icon name="ph:caret-double-down-bold" :class="{ open: isCollapsed }" />
				<span>{{ isCollapsed ? '展开' : '收起' }}</span>
			</button>
			<button class="hero-control-btn" type="button" @click="close">
				<Icon name="ph:x-bold" />
				<span>关闭</span>
			</button>
		</div>

		<div class="hero-actions">
			<a
				v-for="(item, idx) in actionItems"
				:key="idx"
				:href="item.url"
				target="_blank"
				rel="noopener noreferrer"
				class="action-btn"
				:title="item.text || item.url"
			>
				<Icon :name="item.icon || 'ph:link-bold'" />
			</a>
			<span v-if="actionItems.length === 0" class="no-action">暂无社交链接</span>
		</div>
	</div>

	<div class="hero-right" :class="{ collapsed: isCollapsed }">
		<div class="stat-item">
			<div class="stat-value">
				{{ props.articleCount }}
			</div>
			<div class="stat-label">
				文章数
			</div>
		</div>
		<div class="stat-item">
			<div class="stat-value">
				{{ totalWords }}
			</div>
			<div class="stat-label">
				总字数
			</div>
		</div>
		<div class="stat-item">
			<div class="stat-value">
				{{ operateTime }}
			</div>
			<div class="stat-label">
				运营时长
			</div>
		</div>
	</div>
</div>
</template>

<style scoped lang="scss">
.home-hero-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.8rem 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-border);
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.hero-control {
  display: flex;
  gap: 0.5rem;
}

.hero-control-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
  color: var(--c-text-2);
  background-color: var(--c-bg);
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background-color: var(--c-bg);
  border: 1px solid var(--c-border);
  color: var(--c-text);
}

.no-action {
  color: var(--c-text-2);
  font-size: 0.8rem;
}

.hero-right {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.hero-right.collapsed {
  display: none;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-width: max-content;
}

.stat-value {
  font-weight: bold;
  font-size: 1rem;
}

.stat-label {
  font-size: 0.76rem;
  color: var(--c-text-2);
}

@media (max-width: 900px) {
  .home-hero-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-right {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
