import blogConfig from '../../blog.config'

interface TwikooRecentComment {
	id: string
	url: string
	nick?: string
	avatar?: string
	commentText?: string
	created?: number
}

interface TwikooRecentCommentsResponse {
	data?: TwikooRecentComment[]
}

interface RecentCommentItem {
	id: string
	url: string
	nick: string
	avatar: string
	commentText: string
	created: string
}

const WHITESPACE_RE = /\s+/g

function normalizeUrl(url: string) {
	if (!url)
		return '/'

	return url.startsWith('/') ? url : `/${url}`
}

function normalizeCommentText(text?: string) {
	const compact = (text || '').replace(WHITESPACE_RE, ' ').trim()
	if (compact.length <= 80)
		return compact
	return `${compact.slice(0, 80)}...`
}

export default defineEventHandler(async () => {
	const endpoint = blogConfig.twikoo?.envId
	if (!endpoint)
		return <RecentCommentItem[]>[]

	try {
		const response = await $fetch<TwikooRecentCommentsResponse>(endpoint, {
			method: 'POST',
			body: {
				event: 'GET_RECENT_COMMENTS',
				pageSize: 5,
				includeReply: false,
			},
			timeout: 6000,
		})

		return (response.data || [])
			.filter(item => item?.id && item?.url)
			.map(item => ({
				id: item.id,
				url: normalizeUrl(item.url),
				nick: (item.nick || '').trim() || '匿名访客',
				avatar: (item.avatar || '').trim() || '/favicon.ico',
				commentText: normalizeCommentText(item.commentText) || '暂无内容',
				created: item.created ? new Date(item.created).toISOString() : new Date(0).toISOString(),
			}))
	}
	catch (error) {
		console.warn('获取最新评论失败', error)
		return <RecentCommentItem[]>[]
	}
})
