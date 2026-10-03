import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'

// Diagnostic endpoint: dumps parsed content-entry data so the migration can diff
// frontmatter parsing against the Nuxt baseline. Not linked from the site.
export const prerender = true

export const GET: APIRoute = async () => {
	const entries = await getCollection('content')
	const data = entries
		.map(e => ({
			id: e.id,
			title: e.data.title ?? null,
			isPost: e.data.isPost ?? null,
			date: e.data.date ?? null,
			updated: e.data.updated ?? null,
			published: e.data.published ?? null,
			categories: e.data.categories,
			tags: e.data.tags,
			type: e.data.type,
			draft: e.data.draft,
			recommend: e.data.recommend ?? null,
			collection: e.data.collection ?? null,
			aside: e.data.aside ?? null,
			readingTime: e.data.readingTime
				? { words: e.data.readingTime.words, minutes: e.data.readingTime.minutes }
				: null,
		}))
		.sort((a, b) => a.id.localeCompare(b.id))

	return new Response(JSON.stringify(data, null, 2), {
		headers: { 'Content-Type': 'application/json' },
	})
}
