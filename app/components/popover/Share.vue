<script setup lang="ts">
import type { ModalEmits, ModalProps } from '#modals'
import QRCode from 'qrcode'

interface ShareProps {
	url: string
	title?: string
	description?: string
}

const props = defineProps<ModalProps & ShareProps>()

const emit = defineEmits<ModalEmits>()

const appConfig = useAppConfig()
const qrCodeDataUrl = ref('')

const shareTitle = computed(() => props.title ? `【${appConfig.title}】${props.title}` : appConfig.title)

const { copy, copied } = useCopy(props.url)

watch(() => props.url, async (url) => {
	if (!url) {
		qrCodeDataUrl.value = ''
		return
	}

	try {
		qrCodeDataUrl.value = await QRCode.toDataURL(url, {
			margin: 1,
			width: 320,
			color: {
				dark: '#111827',
				light: '#0000',
			},
		})
	}
	catch {
		qrCodeDataUrl.value = ''
	}
}, { immediate: true })

function openShareTarget(type: 'weibo' | 'qq' | 'mail') {
	const url = encodeURIComponent(props.url)
	const title = encodeURIComponent(shareTitle.value)
	const summary = encodeURIComponent(props.description || '')

	const target = type === 'weibo'
		? `https://service.weibo.com/share/share.php?url=${url}&title=${title}`
		: type === 'qq'
			? `https://connect.qq.com/widget/shareqq/index.html?url=${url}&title=${title}&summary=${summary}&source=${encodeURIComponent(appConfig.title)}`
			: `mailto:?subject=${title}&body=${encodeURIComponent(`${props.description ? `${props.description}\n\n` : ''}${props.url}`)}`

	window.open(target, '_blank', 'noopener,noreferrer')
}
</script>

<template>
<Transition name="float-in">
	<div v-if="open" class="blog-share" role="dialog" aria-modal="true" aria-label="文章分享">
		<div class="share-card">
			<div class="share-qr">
				<div class="qr-frame">
					<img v-if="qrCodeDataUrl" :src="qrCodeDataUrl" alt="文章二维码">
					<div v-else class="qr-loading">
						<Icon name="line-md:loading-twotone-loop" />
					</div>
				</div>
			</div>

			<div class="share-menu">
				<h3>分享方式</h3>

				<button class="share-item" @click="openShareTarget('weibo')">
					<Icon name="ri:weibo-fill" />
					微博
				</button>

				<button class="share-item" @click="openShareTarget('qq')">
					<Icon name="ri:qq-fill" />
					QQ
				</button>

				<button class="share-item" @click="openShareTarget('mail')">
					<Icon name="ri:mail-fill" />
					邮件
				</button>

				<button class="share-item" @click="copy()">
					<Icon :name="copied ? 'ph:check-bold' : 'ph:link-bold'" />
					{{ copied ? '已复制链接' : '复制链接' }}
				</button>
			</div>
		</div>

		<button class="close" aria-label="关闭分享弹窗" @click="emit('close')">
			<Icon name="ph:x-bold" />
		</button>
	</div>
</Transition>
</template>

<style lang="scss" scoped>
.blog-share {
	--float-distance: 20vh;

	position: fixed;
	overflow: hidden;
	inset: 0;
	width: min(40rem, calc(100% - 1.5rem));
	height: fit-content;
	margin: auto;
	border: 1px solid var(--c-primary-soft);
	border-radius: 1rem;
	box-shadow: var(--box-shadow-2), var(--box-shadow-3);
	background:
		radial-gradient(circle at right top, color-mix(in oklab, var(--c-primary) 20%, transparent), transparent 40%),
		var(--ld-bg-card);
}

.share-card {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 1rem;
	padding: 1.1rem;
}

.share-qr {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.8rem;
	padding: 0.8rem;
	border-radius: 0.8rem;
	background-color: var(--c-bg-soft);
}

.qr-frame {
	display: grid;
	place-items: center;
	width: min(16rem, 100%);
	aspect-ratio: 1;
	padding: 0.6rem;
	border: 1px solid color-mix(in oklab, var(--c-border), transparent 20%);
	border-radius: 0.8rem;
	background: #FFF;

	img {
		width: 100%;
		height: auto;
	}
}

.qr-loading {
	font-size: 2rem;
	color: var(--c-text-3);
}

.share-menu {
	display: flex;
	flex-direction: column;
	gap: 0.55rem;

	h3 {
		font-size: 1.05rem;
		line-height: 1.2;
	}
}

.share-item {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	width: 100%;
	padding: 0.55rem 0.7rem;
	border: 1px solid var(--c-border);
	border-radius: 0.6rem;
	background-color: var(--c-bg-1);
	color: var(--c-text-1);
	transition: background-color 0.2s, color 0.1s;

	&:hover {
		background-color: var(--c-primary-soft);
		color: var(--c-primary);
	}
}

.close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	top: 0.5rem;
	right: 0.5rem;
	padding: 0.3rem;
	border-radius: 0.5rem;
	background-color: var(--c-bg-a80);
	backdrop-filter: blur(3px);
	transition: background-color 0.2s;

	&:hover {
		background-color: var(--c-primary-soft);
	}
}

@media (max-width: $breakpoint-mobile) {
	.blog-share {
		width: calc(100% - 1rem);
		border-radius: 0.8rem;
	}

	.share-card {
		grid-template-columns: 1fr;
		padding: 0.9rem;
	}

	.qr-frame {
		width: min(14rem, 100%);
	}
}

:global(.dark) .qr-frame {
	box-shadow: 0 0 0 0.4rem color-mix(in oklab, var(--c-bg), transparent 70%);
}
</style>
