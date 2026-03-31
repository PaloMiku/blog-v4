<script setup lang="ts">
import useOnlineStatus from '~/composables/useOnlineStatus'

const { data } = useOnlineStatus()

const shouldShowMusic = computed(() => {
	const media = data.value.media
	return media.isPlaying && Boolean(media.trackTitle || media.trackArtist)
})

const songTitle = computed(() => data.value.media.trackTitle || '未知曲目')
const songArtist = computed(() => data.value.media.trackArtist || '未知歌手')
const coverUrl = computed(() => data.value.media.trackArtUrl || '')
</script>

<template>
<BlogWidget v-if="shouldShowMusic" card title="在听音乐">
	<div class="music-box">
		<img
			v-if="coverUrl"
			class="cover"
			:src="coverUrl"
			alt=""
			loading="lazy"
			decoding="async"
			referrerpolicy="no-referrer"
		>

		<div class="music-meta">
			<p class="title" :title="songTitle">
				{{ songTitle }}
			</p>
			<p class="artist" :title="songArtist">
				{{ songArtist }}
			</p>
		</div>
	</div>
</BlogWidget>
</template>

<style lang="scss" scoped>
.music-box {
	display: grid;
	grid-template-columns: auto 1fr;
	align-items: start;
	gap: 0.65rem;
	min-width: 0;
}

.cover {
	width: 2.8rem;
	height: 2.8rem;
	border-radius: 0.5rem;
	object-fit: cover;
	background: var(--c-bg-3);
	box-shadow: var(--box-shadow-2);
}

.music-meta {
	min-width: 0;
}

.title,
.artist {
	margin: 0;
	overflow: hidden;
}

.title {
	display: -webkit-box;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	font-size: 0.92em;
	line-height: 1.3;
	color: var(--c-text-1);
	font-weight: 600;
}

.artist {
	margin-top: 0.2rem;
	font-size: 0.85em;
	color: var(--c-text-2);
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
