export const useGamepadStore = defineStore('gamepad', () => {
	const router = useRouter()

	/** 是否有手柄连接 */
	const connected = ref(false)
	/** 大屏模式（Steam Big Picture 风格）是否激活 */
	const bigPicture = ref(false)
	/** 大屏模式的主菜单覆盖层是否展开 */
	const menuOpen = ref(false)
	/** 连接提示是否已关闭（超时或进入大屏模式） */
	const toastDismissed = ref(false)

	/** 连接提示气泡，仅在手柄连接且未进入大屏模式时短暂显示 */
	const toastVisible = computed(() => connected.value && !bigPicture.value && !toastDismissed.value)

	let toastTimer: ReturnType<typeof setTimeout> | undefined

	// 手柄断开时自动退出大屏模式，连接时短暂展示提示气泡
	watch(connected, (value) => {
		clearTimeout(toastTimer)
		if (value) {
			toastDismissed.value = false
			toastTimer = setTimeout(() => {
				toastDismissed.value = true
			}, 8000)
		}
		else {
			bigPicture.value = false
			menuOpen.value = false
		}
	})

	function enterBigPicture() {
		bigPicture.value = true
		menuOpen.value = true
	}

	function exitBigPicture() {
		bigPicture.value = false
		menuOpen.value = false
	}

	function toggleMenu() {
		menuOpen.value = !menuOpen.value
	}

	/** 有历史记录时后退并返回 true */
	function goBack() {
		if (!history.state?.back)
			return false
		router.back()
		return true
	}

	// 菜单内导航后自动收起
	router.afterEach(() => {
		menuOpen.value = false
	})

	return {
		connected,
		bigPicture,
		menuOpen,
		toastVisible,
		enterBigPicture,
		exitBigPicture,
		toggleMenu,
		goBack,
	}
})
