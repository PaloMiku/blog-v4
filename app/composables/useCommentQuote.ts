const INLINE_SPACE_RE = /\s+/g

function normalizeQuoteText(text: string) {
	return text.replace(INLINE_SPACE_RE, ' ').trim()
}

function formatQuote(text: string) {
	const normalized = normalizeQuoteText(text)
	return normalized ? `> ${normalized}\n\n` : ''
}

function getCommentInput() {
	const root = document.querySelector('#twikoo')
	if (!root)
		return null

	const inputSelectors = [
		'textarea',
		'.el-textarea__inner',
		'[contenteditable="plaintext-only"]',
		'[contenteditable="true"]',
	]

	for (const selector of inputSelectors) {
		const target = root.querySelector(selector)
		if (target instanceof HTMLTextAreaElement)
			return target
		if (target instanceof HTMLElement && target.isContentEditable)
			return target
	}

	return null
}

function setInputContent(target: HTMLTextAreaElement | HTMLElement, value: string) {
	if (target instanceof HTMLTextAreaElement) {
		const current = target.value.trim()
		target.value = current
			? `${current}\n\n${value.trim()}`
			: value
		target.dispatchEvent(new Event('input', { bubbles: true }))
		target.dispatchEvent(new Event('change', { bubbles: true }))
		target.focus()
		return
	}

	const current = target.textContent?.trim()
	target.textContent = current
		? `${current}\n\n${value.trim()}`
		: value
	target.dispatchEvent(new Event('input', { bubbles: true }))
	target.dispatchEvent(new Event('change', { bubbles: true }))
	target.focus()
}

async function waitCommentInput(timeout = 6000, step = 120) {
	const start = Date.now()

	while ((Date.now() - start) < timeout) {
		const target = getCommentInput()
		if (target)
			return target
		await new Promise(resolve => setTimeout(resolve, step))
	}

	return null
}

export default function useCommentQuote() {
	const { copy } = useClipboard({ legacy: true })

	async function insertQuote(text: string) {
		if (!import.meta.client)
			return false

		const quoteText = formatQuote(text)
		if (!quoteText)
			return false

		const commentEl = document.querySelector('#twikoo')
		commentEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })

		const input = await waitCommentInput()
		if (input) {
			setInputContent(input, quoteText)
			return true
		}

		await copy(quoteText)
		return false
	}

	return {
		insertQuote,
	}
}
