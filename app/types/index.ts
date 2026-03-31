declare global {
	interface Window {
		twikoo?: {
			init: (options: {
				envId: string
				el: string
				region?: string
				path?: string
				lang?: string
			}) => void
			getRecentComments?: (options: {
				envId: string
				region?: string
				urls?: string[]
				pageSize?: number
				includeReply?: boolean
			}) => Promise<Array<{
				id: string
				url: string
				nick: string
				mailMd5?: string
				link?: string
				comment?: string
				commentText?: string
				created?: number
				avatar?: string
				relativeTime?: string
			}>>
			version: string
		}
	}
}
