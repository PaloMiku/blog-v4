<script setup lang="ts">
const { data: comments, status, error } = useFetch('/api/recent-comments', {
	default: () => [],
})

function fallbackAvatar(event: Event) {
	const img = event.target
	if (!(img instanceof HTMLImageElement))
		return

	img.onerror = null
	img.src = '/favicon.ico'
}
</script>

<template>
<BlogWidget card title="最新评论">
	<p v-if="status === 'pending'" class="tip">
		加载中...
	</p>

	<p v-else-if="error || !comments.length" class="tip">
		暂无最新评论
	</p>

	<menu v-else class="comment-list">
		<li v-for="item in comments" :key="item.id">
			<NuxtLink class="comment-link" :to="`${item.url}#twikoo`">
				<img
					class="avatar"
					:src="item.avatar"
					alt=""
					loading="lazy"
					decoding="async"
					referrerpolicy="no-referrer"
					@error="fallbackAvatar"
				>

				<div class="content">
					<p class="meta">
						<strong class="nick">{{ item.nick }}</strong>
						<UtilDate class="date" :date="item.created" relative />
					</p>
					<p class="excerpt" v-text="item.commentText" />
				</div>
			</NuxtLink>
		</li>
	</menu>
</BlogWidget>
</template>

<style lang="scss" scoped>
.tip {
	font-size: 0.92em;
	color: var(--c-text-2);
}

.comment-list {
	display: grid;
	gap: 0.5rem;

	> li {
		min-width: 0;
	}
}

.comment-link {
	display: grid;
	grid-template-columns: 2rem 1fr;
	align-items: center;
	gap: 0.55rem;
	padding: 0.4rem 0.5rem;
	border-radius: 0.5rem;
	background-color: var(--c-bg-soft);
	transition: background-color 0.2s;

	&:hover {
		background-color: var(--c-bg-a50);
	}
}

.avatar {
	width: 2rem;
	height: 2rem;
	border-radius: 50%;
	object-fit: cover;
	background-color: var(--c-bg-3);
}

.content {
	min-width: 0;
}

.meta {
	display: flex;
	justify-content: space-between;
	gap: 0.5rem;
	font-size: 0.86em;
	line-height: 1.2;
	color: var(--c-text-2);
}

.nick {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: var(--font-creative);
	font-weight: 550;
	color: var(--c-text-1);
}

.date {
	flex-shrink: 0;
	font-size: 0.92em;
}

.excerpt {
	margin-top: 0.15rem;
	font-size: 0.88em;
	line-height: 1.3;
	color: var(--c-text);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
