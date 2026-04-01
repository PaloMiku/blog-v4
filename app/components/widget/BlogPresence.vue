<script setup lang="ts">
import useOnlineStatus from '~/composables/useOnlineStatus'
import { appIdConfig } from '~/utils/presence'

const { data, hasError } = useOnlineStatus()

const statusLabel = computed(() => data.value.presence.status === 'online' ? '在线' : '离线')

const appInfo = computed(() => {
	if (!data.value.presence.isOnline)
		return null

	const appId = data.value.window.appId
	if (appId && appIdConfig[appId])
		return appIdConfig[appId]

	if (data.value.window.appName)
		return { name: data.value.window.appName }

	if (appId)
		return { name: appId }

	return { name: '未知应用' }
})

const appName = computed(() => {
	if (!data.value.presence.isOnline)
		return '无'

	return appInfo.value?.name ?? '未知应用'
})

const appIcon = computed(() => {
	if (!data.value.presence.isOnline)
		return ''

	return appInfo.value?.icon || ''
})
</script>

<template>
<BlogWidget card title="在线状态">
	<template #title>
		<span>在线状态</span>
		<small class="status-hint" title="非实时状态，需手动刷新页面">（非实时）</small>
	</template>

	<p v-if="hasError && !data.ok" class="tip">
		状态暂不可用
	</p>

	<dl v-else class="status-list">
		<div>
			<dt>状态</dt>
			<dd :class="data.presence.isOnline ? 'online' : 'offline'">
				{{ statusLabel }}
			</dd>
		</div>

		<div>
			<dt>使用中</dt>
			<dd :title="data.presence.isOnline ? data.window.appId || appName : '离线'">
				<span v-if="data.presence.isOnline" class="app-entry">
					<Icon v-if="appIcon" :name="appIcon" class="app-icon" />
					{{ appName }}
				</span>
				<span v-else>离线</span>
			</dd>
		</div>
	</dl>
</BlogWidget>
</template>

<style lang="scss" scoped>
.title-side {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.8em;
	font-weight: 400;
	color: var(--c-text-2);

	small {
		line-height: 1;
	}
}

.app-entry {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
}

.app-icon {
	font-size: 0.95em;
	color: var(--c-primary);
}

.status-hint {
	margin-left: 0.4rem;
	font-size: 0.75em;
	color: var(--c-text-2);
}

.tip {
	font-size: 0.92em;
	color: var(--c-text-2);
}

.status-list {
	display: grid;
	gap: 0.5rem;

	> div {
		display: grid;
		grid-template-columns: 2.4rem 1fr;
		gap: 0.45rem;
		align-items: baseline;
		min-width: 0;
	}

	dt {
		font-size: 0.84em;
		color: var(--c-text-2);
	}

	dd {
		margin: 0;
		font-size: 0.92em;
		line-height: 1.35;
		color: var(--c-text-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}

.online {
	color: var(--c-success);
	font-weight: 600;
}

.offline {
	color: var(--c-text-2);
}
</style>
