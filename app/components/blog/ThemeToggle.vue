<script setup lang="ts">
const appConfig = useAppConfig()
const colorMode = useColorMode()

// 主题色相关
const primaryColor = useLocalStorage('blog-primary-color', '#f38e8c') as Ref<string | undefined>
const colorPickerRef = ref<HTMLInputElement>()
const isMounted = ref(false)
const currentColor = computed(() => (isMounted.value ? primaryColor.value : undefined))

// 将 hex 转换为 hsl
const HEX_TO_HSL_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i

function hexToHsl(hex: string): { h: number, s: number, l: number } | null {
	const result = HEX_TO_HSL_RE.exec(hex)
	if (!result)
		return null

	const rr = result[1]!
	const gg = result[2]!
	const bb = result[3]!

	const r = Number.parseInt(rr, 16) / 255
	const g = Number.parseInt(gg, 16) / 255
	const b = Number.parseInt(bb, 16) / 255

	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	let h = 0
	let s = 0
	const l = (max + min) / 2

	if (max !== min) {
		const d = max - min
		if (l > 0.5) {
			s = d / (2 - max - min)
		}
		else {
			s = d / (max + min)
		}

		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6
				break
			case g:
				h = ((b - r) / d + 2) / 6
				break
			case b:
				h = ((r - g) / d + 4) / 6
				break
		}
	}

	return {
		h: Math.round(h * 360),
		s: Math.round(s * 100),
		l: Math.round(l * 100),
	}
}

// 更新 CSS 变量
function updatePrimaryColor(color: string | undefined) {
	if (!color)
		return

	const hsl = hexToHsl(color)
	if (!hsl)
		return

	const root = document.documentElement
	root.style.setProperty('--c-primary-h', `${hsl.h}deg`)
	root.style.setProperty('--c-primary-s', `${hsl.s}%`)
	root.style.setProperty('--c-primary-l', `${hsl.l}%`)
	root.style.setProperty('--c-primary-base', color)
}

// 处理颜色选择
function handleColorChange(event: Event) {
	const target = event.target as HTMLInputElement
	const color = target.value
	primaryColor.value = color
	updatePrimaryColor(color)
}

// 打开颜色选择器
function openColorPicker() {
	colorPickerRef.value?.click()
}

// 初始化主题色
onMounted(() => {
	isMounted.value = true
	updatePrimaryColor(primaryColor.value)
})

// 监听主题色变化
watch(primaryColor, (newColor) => {
	if (!isMounted.value)
		return

	updatePrimaryColor(newColor)
})
</script>

<template>
<div class="theme-toggle-wrapper">
	<div class="theme-toggle">
		<button
			v-for="(themeData, themeName) in appConfig.themes"
			:key="themeName"
			v-tip="themeData.tip"
			:aria-label="themeData.tip"
			:class="{ active: colorMode.preference === themeName }"
			@click="colorMode.preference = themeName"
		>
			<Icon :name="themeData.icon" />
		</button>
	</div>

	<!-- 颜色选择器 -->
	<button
		v-tip="'切换主题色'"
		class="color-picker-btn"
		aria-label="切换主题色"
		@click="openColorPicker"
	>
		<span class="color-dot" :style="{ '--current-color': currentColor }" />
		<input
			ref="colorPickerRef"
			type="color"
			class="color-input"
			:value="primaryColor"
			@input="handleColorChange"
		>
	</button>
</div>
</template>

<style lang="scss" scoped>
.theme-toggle-wrapper {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
}

.theme-toggle {
	display: flex;
	gap: 3px;
	width: fit-content;
	padding: 2px;
	border: 1px solid var(--c-border);
	border-radius: 1rem;
	background-color: var(--c-bg-2);

	>button {
		padding: 4px 1rem;
		border-radius: 1rem;
		transition: all 0.1s;

		&:hover {
			background-color: var(--c-bg-soft);
			color: var(--c-text-1);
		}

		&.active {
			box-shadow: var(--box-shadow-2);
			background-color: var(--ld-bg-card);
			color: var(--c-text-1);
			cursor: auto;
		}
	}
}

.color-picker-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
	width: 24px;
	height: 24px;
	padding: 0;
	border: none;
	background-color: transparent;
	transition: all 0.2s;
	cursor: pointer;
}

.color-dot {
	display: block;
	position: relative;
	width: 20px;
	height: 20px;
	border-radius: 50%;
	background-color: var(--current-color, var(--c-primary-base));
	transition: transform 0.2s;

	// 外层黑白圆圈 - 跟随日夜主题
	&::before {
		content: "";
		position: absolute;
		inset: -3px;
		border: 2px solid var(--c-text-2);
		border-radius: 50%;
		transition: all 0.2s;
	}

	// 内层高亮边框
	&::after {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
	}
}

.color-input {
	position: absolute;
	opacity: 0;
	inset: 0;
	width: 100%;
	height: 100%;
	cursor: pointer;
	pointer-events: none;
}
</style>
