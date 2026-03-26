<script setup lang="ts">
import { Icon } from "#components";

const props = withDefaults(
	defineProps<{
		url?: string;
		name?: string;
		artist?: string;
	}>(),
	{
		url: "",
		name: "",
		artist: "",
	},
);

const URL_REGEX = /^https?:\/\//;

const providerMeta = computed(() => {
	const known = {
		netease: {
			label: "网易云音乐",
			icon: "simple-icons:neteasecloudmusic",
		},
		qq: {
			label: "QQ 音乐",
			icon: "simple-icons:qq",
		},
		spotify: {
			label: "Spotify",
			icon: "simple-icons:spotify",
		},
		apple: {
			label: "Apple Music",
			icon: "simple-icons:applemusic",
		},
		raw: {
			label: "音频链接",
			icon: "simple-icons:music",
		},
	} as const;

	const parsed = parseUrl(props.url);
	if (parsed.provider && parsed.provider in known)
		return known[parsed.provider as keyof typeof known];

	if (parsed.provider) {
		return {
			label: parsed.provider,
			icon: "ph:music-note",
		};
	}

	return {
		label: "音乐",
		icon: "ph:music-note",
	};
});

function parseUrl(url: string) {
	const fallback = { provider: "raw", id: "", link: url };
	if (!url) return fallback;

	let parsed: URL;
	try {
		const normalized = URL_REGEX.test(url) ? url : `https://${url}`;
		parsed = new URL(normalized);
	} catch {
		return fallback;
	}

	const host = parsed.hostname.toLowerCase();
	const hash = parsed.hash;

	if (host.includes("music.163.com")) {
		const sid =
			parsed.searchParams.get("id") ||
			new URLSearchParams(hash.slice(1)).get("id") ||
			"";
		return { provider: "netease", id: sid, link: url };
	}

	if (host.includes("qq.com")) {
		const sid =
			parsed.searchParams.get("id") ||
			parsed.pathname.split("/").filter(Boolean).pop() ||
			"";
		return { provider: "qq", id: sid, link: url };
	}

	if (host.includes("spotify.com")) {
		const sid = parsed.pathname.split("/").filter(Boolean).pop() || "";
		return { provider: "spotify", id: sid, link: url };
	}

	if (host.includes("music.apple.com")) {
		const sid = parsed.searchParams.get("i") || "";
		return { provider: "apple", id: sid, link: url };
	}

	return fallback;
}

const parsedUrl = computed(() => parseUrl(props.url));

const meta = computed(() => ({
	provider: providerMeta.value.label,
	icon: providerMeta.value.icon,
	id: parsedUrl.value.id,
	link: parsedUrl.value.link,
}));

const titleText = computed(() => {
	if (props.name) return props.name;

	if (meta.value.id) return `${meta.value.provider} 音乐 - ${meta.value.id}`;

	return `${meta.value.provider} 音乐`;
});

const subtitleText = computed(() => {
	if (props.artist) return props.artist;

	if (meta.value.id) return `id: ${meta.value.id}`;

	return meta.value.link || "无效音乐链接";
});
</script>

<template>
	<a
		v-if="meta.link"
		:href="meta.link"
		class="music-embed"
		target="_blank"
		rel="noopener noreferrer"
	>
		<span class="music-embed-icon">
			<Icon :name="meta.icon" />
		</span>
		<span class="music-embed-single-line"
			>{{ titleText }}，{{ subtitleText }}</span
		>
	</a>
	<div v-else class="music-embed-empty">无效音乐链接</div>
</template>

<style scoped lang="scss">
.music-embed {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.65rem 0.8rem;
	border-radius: 0.8rem;
	background-color: var(--c-bg-2);
	color: var(--c-text-1);
	border: 1px solid var(--c-border);
	text-decoration: none;
	min-height: 3rem;
	transition:
		box-shadow 0.2s ease,
		border-color 0.2s ease,
		color 0.2s ease;

	article & {
		margin: 1rem auto;
		max-width: 100%;
		width: min(100%, 720px);
	}

	&:hover {
		border-color: var(--c-primary);
		box-shadow: var(--box-shadow-2);
		color: var(--c-primary);
	}
}

.music-embed-icon {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	flex-shrink: 0;
	border-radius: 50%;
	background-color: var(--c-bg-3);
}

.music-embed-icon :deep(svg) {
	width: 1.2rem;
	height: 1.2rem;
}

.music-embed-text {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	display: grid;
	row-gap: 0.15rem;
}

.music-embed-single-line {
	flex: 1;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.music-embed-subtitle {
	font-size: 0.85em;
	opacity: 0.72;
}

/* 去掉箭头操作 */

.music-embed-empty {
	padding: 0.65rem 0.8rem;
	border-radius: 0.8rem;
	background-color: var(--c-bg-2);
	border: 1px dashed var(--c-border);
	color: var(--c-text-3);
	text-align: center;
	margin: 1rem auto;
	width: min(100%, 720px);
}
</style>
