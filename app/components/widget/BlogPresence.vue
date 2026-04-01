<script setup lang="ts">
import useOnlineStatus from '~/composables/useOnlineStatus'
import { appIdConfig } from '~/utils/presence'

const { data, hasError, status, refresh } = useOnlineStatus()

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
		<button
			type="button"
			class="refresh-btn"
			title="手动刷新状态"
			:disabled="status === 'pending'"
			@click="refresh()"
		>
			<Icon name="ph:arrows-clockwise-bold" :class="{ spinning: status === 'pending' }" />
		</button>
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

.refresh-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.15rem;
	height: 1.15rem;
	padding: 0;
	border: none;
	border-radius: 50%;
	background: transparent;
	color: var(--c-text-2);
	cursor: pointer;
	transition: color 0.2s, background-color 0.2s;

	&:hover:not(:disabled) {
		color: var(--c-primary);
		background-color: var(--c-bg-soft);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
}

.spinning {
	animation: spin 0.8s linear infinite;
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
