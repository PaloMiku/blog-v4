interface ReporterLatestResponse {
	ok?: boolean
	latest?: {
		payload?: {
			window?: {
				appId?: string
				appName?: string
			} | null
			media?: {
				playerIdentity?: string
				isPlaying?: boolean
				trackTitle?: string
				trackArtist?: string
				trackArtUrl?: string
			} | null
		} | null
	} | null
	presence?: {
		isOnline?: boolean
		status?: 'online' | 'offline'
		lastSeenAgeSeconds?: number | null
	} | null
}

export interface OnlineStatusData {
	ok: boolean
	presence: {
		isOnline: boolean
		status: 'online' | 'offline'
		lastSeenAgeSeconds: number | null
	}
	window: {
		appId: string
		appName: string
	}
	media: {
		playerIdentity: string
		isPlaying: boolean
		trackTitle: string
		trackArtist: string
		trackArtUrl: string
	}
}

const FALLBACK_STATUS: OnlineStatusData = {
	ok: false,
	presence: {
		isOnline: false,
		status: 'offline',
		lastSeenAgeSeconds: null,
	},
	window: {
		appId: '',
		appName: '',
	},
	media: {
		playerIdentity: '',
		isPlaying: false,
		trackTitle: '',
		trackArtist: '',
		trackArtUrl: '',
	},
}

function normalizeResponse(response: ReporterLatestResponse): OnlineStatusData {
	const status = response.presence?.status === 'online' ? 'online' : 'offline'
	const isOnline = response.presence?.isOnline ?? status === 'online'

	return {
		ok: Boolean(response.ok),
		presence: {
			isOnline,
			status,
			lastSeenAgeSeconds: response.presence?.lastSeenAgeSeconds ?? null,
		},
		window: {
			appId: response.latest?.payload?.window?.appId || '',
			appName: response.latest?.payload?.window?.appName || '',
		},
		media: {
			playerIdentity: response.latest?.payload?.media?.playerIdentity || '',
			isPlaying: Boolean(response.latest?.payload?.media?.isPlaying),
			trackTitle: response.latest?.payload?.media?.trackTitle || '',
			trackArtist: response.latest?.payload?.media?.trackArtist || '',
			trackArtUrl: response.latest?.payload?.media?.trackArtUrl || '',
		},
	}
}

export default function useOnlineStatus() {
	const appConfig = useAppConfig()
	const { public: { processReporterLatestEndpoint } } = useRuntimeConfig()
	const visibility = useDocumentVisibility()

	const data = useState<OnlineStatusData>('online-status-data', () => ({ ...FALLBACK_STATUS }))
	const pending = useState<boolean>('online-status-pending', () => false)
	const hasError = useState<boolean>('online-status-error', () => false)
	const lastSnapshot = useState<string>('online-status-snapshot', () => '')

	const refreshInterval = computed(() => Math.max(5000, appConfig.component.presence.refreshInterval || 15000))

	function toSnapshot(value: OnlineStatusData) {
		return JSON.stringify([
			value.ok,
			value.presence.isOnline,
			value.presence.status,
			value.presence.lastSeenAgeSeconds,
			value.window.appId,
			value.window.appName,
			value.media.playerIdentity,
			value.media.isPlaying,
			value.media.trackTitle,
			value.media.trackArtist,
			value.media.trackArtUrl,
		])
	}

	async function refresh() {
		if (pending.value)
			return

		if (!processReporterLatestEndpoint) {
			hasError.value = true
			if (!data.value.ok)
				data.value = { ...FALLBACK_STATUS }
			return
		}

		pending.value = true
		try {
			const response = await $fetch<ReporterLatestResponse>(processReporterLatestEndpoint, {
				method: 'GET',
				headers: { accept: 'application/json' },
				timeout: 6000,
			})
			const nextData = normalizeResponse(response)
			const nextSnapshot = toSnapshot(nextData)
			if (nextSnapshot !== lastSnapshot.value) {
				data.value = nextData
				lastSnapshot.value = nextSnapshot
			}
			hasError.value = false
		}
		catch (error) {
			console.warn('获取在线状态失败', error)
			hasError.value = true
			if (!data.value.ok)
				data.value = { ...FALLBACK_STATUS }
		}
		finally {
			pending.value = false
		}
	}

	const { pause, resume } = useIntervalFn(() => {
		if (visibility.value === 'visible')
			refresh()
	}, refreshInterval, { immediate: false })

	onMounted(() => {
		if (!data.value.ok && !pending.value)
			refresh()
		resume()
	})

	onUnmounted(() => {
		pause()
	})

	watch(visibility, (state) => {
		if (state === 'visible')
			refresh()
	})

	return {
		data,
		status: computed(() => pending.value ? 'pending' : 'success'),
		hasError,
		refresh,
	}
}
