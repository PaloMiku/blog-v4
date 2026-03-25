<script setup lang="ts">
const props = withDefaults(defineProps<{
	/** tab 下标从 1 开始 */
	tabs: string[]
	center?: boolean
	active?: string | number
	/** 使用下拉框样式 */
	combobox?: boolean
	/** 是否显示边框 */
	border?: boolean
}>(), {
	center: false,
	active: 1,
	combobox: false,
	border: false,
})

const emit = defineEmits<{
	(e: 'update:active', value: number): void
	(e: 'change', value: number, label: string): void
}>()

// 使用 v-bind:active 以传递 Number 值
const activeTab = ref(Math.min(Math.max(Number(props.active) || 1, 1), props.tabs.length))
const isDropdownOpen = ref(false)
const dropdownRef = ref<HTMLElement>()

// 监听 props.active 变化
watch(() => props.active, (newVal) => {
	const newValNum = Number(newVal) || 1
	activeTab.value = Math.min(Math.max(newValNum, 1), props.tabs.length)
})

function handleSelectTab(index: number) {
	activeTab.value = index + 1
	emit('update:active', index + 1)
	emit('change', index + 1, props.tabs[index] || '')
	isDropdownOpen.value = false
}

function toggleDropdown() {
	isDropdownOpen.value = !isDropdownOpen.value
}
</script>

<template>
<div :class="{ center }">
	<div v-if="props.combobox" class="combobox-wrapper" :class="{ 'has-border': props.border }">
		<!-- Combobox 下拉框样式 -->
		<div ref="dropdownRef" class="combobox-container">
			<button
				class="combobox-trigger"
				:aria-expanded="isDropdownOpen"
				@click.stop="toggleDropdown"
			>
				<span class="combobox-label">{{ tabs[activeTab - 1] }}</span>
				<svg class="combobox-icon" :class="{ open: isDropdownOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			<Transition name="dropdown">
				<div v-if="isDropdownOpen" class="combobox-dropdown" @click.stop>
					<div class="combobox-list">
						<button
							v-for="(tab, index) in tabs"
							:key="index"
							class="combobox-item"
							:class="{ active: activeTab === index + 1 }"
							@click="handleSelectTab(index)"
						>
							<span>{{ tab }}</span>
							<svg v-if="activeTab === index + 1" class="combobox-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</button>
					</div>
				</div>
			</Transition>
		</div>

		<div class="tab-content">
			<slot :name="`tab${activeTab}`" />
		</div>
	</div>
	<div v-else :class="{ center, 'has-border': props.border }">
		<!-- 原始 tabs 样式 -->
		<div class="tabs">
			<button
				v-for="(tab, index) in tabs"
				:key="index"
				:class="{ active: activeTab === index + 1 }"
				@click="handleSelectTab(index)"
			>
				{{ tab }}
			</button>
		</div>
		<div class="tab-content">
			<slot :name="`tab${activeTab}`" />
		</div>
	</div>
</div>
</template>

<style lang="scss" scoped>
.float-in-leave-active {
	/* stylelint-disable-next-line declaration-no-important */
	position: revert !important;
}

.center {
	width: fit-content;
	max-width: 100%;
	margin-inline: auto;
}

/* ===== 边框包装器样式 ===== */
.has-border {
	padding: 1.2em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	background-color: var(--ld-bg-card);
}

/* ===== 原始 Tabs 样式 ===== */
.tabs {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 0.5em;
	position: relative;
	width: fit-content;
	margin: 0 auto;
	font-size: 0.9em;
	line-height: 1.4;

	button {
		position: relative;
		margin-bottom: 0.5em;
		padding: 0.3em 0.5em;
		border-radius: 0.4em;
		color: var(--c-text-2);
		transition: all 0.2s;

		&:hover {
			background-color: var(--c-bg-soft);
			color: var(--c-text);
		}

		&::before, &::after {
			display: block;
			position: absolute;
			bottom: -0.5em;
			inset-inline: 0.8em;
			height: 2px;
			border-radius: 1em;
			pointer-events: none;
		}

		&::after {
			content: "";
			inset-inline: -0.8em;
			background-color: var(--c-border);
		}

		&.active {
			box-shadow: 0 1px 0.5em var(--ld-shadow);
			background-color: var(--ld-bg-card);
			color: var(--c-text);

			&::before {
				content: "";
				background-color: var(--c-primary);
				z-index: 1;
			}
		}
	}
}

/* ===== Combobox 下拉框样式 ===== */
.combobox-wrapper {
	width: 100%;
}

.combobox-container {
	position: relative;
	width: fit-content;
	max-width: 100%;
	padding: 0;
}

.combobox-trigger {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5em;
	min-width: 140px;
	max-width: 100%;
	padding: 0.4em 0.7em;
	border: 1px solid var(--c-border);
	border-radius: 0.5em;
	box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
	background-color: var(--ld-bg-card);
	font-size: 0.85em;
	font-weight: 500;
	color: var(--c-text);
	transition: all 0.2s ease;
	cursor: pointer;

	.dark & {
		border-color: hsl(var(--hue-theme) 10% 40%);
	}

	&:hover {
		border-color: var(--c-primary);
		box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
		background-color: var(--c-bg-soft);
	}

	&:focus {
		box-shadow: 0 0 0 2px var(--c-bg), 0 0 0 4px var(--c-primary);
		outline: none;
	}

	&[aria-expanded="true"] {
		border-color: var(--c-primary);
		background-color: var(--c-bg-soft);
	}
}

.combobox-label {
	flex: 1;
	overflow: hidden;
	white-space: nowrap;
	text-align: left;
	text-overflow: ellipsis;
}

.combobox-icon {
	flex-shrink: 0;
	opacity: 0.7;
	width: 1em;
	height: 1em;
	color: var(--c-text-2);
	transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);

	&.open {
		opacity: 1;
		color: var(--c-primary);
		transform: rotate(180deg);
	}
}

.combobox-dropdown {
	position: absolute;
	overflow: hidden;
	top: calc(100% + 0.4em);
	right: 0;
	left: 0;
	min-width: 100%;
	max-width: 100%;
	border: 1px solid var(--c-border);
	border-radius: 0.6em;
	box-shadow: 0 8px 20px rgb(0 0 0 / 12%);
	background-color: var(--ld-bg-card);
	z-index: 10;
}

.combobox-search {
	display: flex;
	align-items: center;
	gap: 0.4em;
	padding: 0.4em 0.5em;
	border-bottom: 1px solid var(--c-border);
	background-color: var(--c-bg-soft);
}

.search-icon {
	flex-shrink: 0;
	opacity: 0.5;
	width: 0.9em;
	height: 0.9em;
	color: var(--c-text-2);
}

.search-input {
	flex: 1;
	min-width: 0;
	padding: 0.15em 0;
	border: none;
	outline: none;
	background-color: transparent;
	font-size: 0.85em;
	color: var(--c-text);

	&::placeholder {
		color: var(--c-text-3);
	}

	&:focus {
		color: var(--c-text);
	}
}

.combobox-list {
	display: flex;
	flex-direction: column;
	overflow-y: auto;
	max-height: 220px;

	/* 自定义滚动条样式 */
	&::-webkit-scrollbar {
		width: 6px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		border-radius: 3px;
		background: var(--c-border);

		&:hover {
			background: var(--c-text-2);
		}
	}
}

.combobox-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	padding: 0.4em 0.6em;
	border: none;
	background-color: transparent;
	font-size: 0.85em;
	text-align: left;
	color: var(--c-text-2);
	transition: all 0.12s ease;
	cursor: pointer;

	&:hover {
		padding-left: 0.8em;
		background-color: var(--c-bg-soft);
		color: var(--c-text);
	}

	&.active {
		background-color: var(--c-primary-soft);
		font-weight: 600;
		color: var(--c-primary);
	}

	&:focus {
		outline: none;
		background-color: var(--c-bg-soft);
	}
}

.combobox-check {
	flex-shrink: 0;
	width: 1em;
	height: 1em;
	margin-left: 0.3em;
	color: var(--c-primary);
	animation: checkmark 0.3s ease;
}

.combobox-empty {
	padding: 1.5em 0.7em;
	font-size: 0.9em;
	text-align: center;
	color: var(--c-text-2);
}

.tab-content {
	margin-top: 0.5em;
	padding: 0.5em 0;
}

/* ===== Dropdown 动画 ===== */
.dropdown-enter-active,
.dropdown-leave-active {
	transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-enter-from {
	opacity: 0;
	transform: translateY(-10px) scaleY(0.95);
}

.dropdown-leave-to {
	opacity: 0;
	transform: translateY(-10px) scaleY(0.95);
}

@keyframes checkmark {
	0% {
		opacity: 0;
		transform: scale(0) rotate(-45deg);
	}

	50% {
		transform: scale(1.1);
	}

	100% {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}
}
</style>
