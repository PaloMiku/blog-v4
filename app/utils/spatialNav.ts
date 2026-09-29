export type SpatialDirection = 'up' | 'down' | 'left' | 'right'

/** 可被手柄方向键聚焦的元素 */
const focusableSelector = [
	'a[href]',
	'button',
	'input',
	'select',
	'textarea',
	'summary',
	'[tabindex]:not([tabindex="-1"])',
].join(',')

const directionVectors: Record<SpatialDirection, { x: number, y: number }> = {
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
}

function isVisible(el: HTMLElement) {
	if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true')
		return false
	if (typeof el.checkVisibility === 'function')
		return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
	return Boolean(el.offsetParent) || el.getClientRects().length > 0
}

function getCenter(el: Element) {
	const rect = el.getBoundingClientRect()
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * 在 container 范围内，把焦点移动到 direction 方向上几何距离最近的元素
 * 无当前焦点时以视口中心为原点；成功移动返回 true
 */
export function spatialNavigate(direction: SpatialDirection, container: ParentNode = document) {
	const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
	const current = activeEl && container.contains(activeEl) ? activeEl : null
	const origin = current ? getCenter(current) : { x: window.innerWidth / 2, y: window.innerHeight / 2 }

	const vector = directionVectors[direction]
	let best: HTMLElement | undefined
	let bestScore = Number.POSITIVE_INFINITY

	for (const el of container.querySelectorAll<HTMLElement>(focusableSelector)) {
		if (el === current || !isVisible(el))
			continue

		const center = getCenter(el)
		const dx = center.x - origin.x
		const dy = center.y - origin.y
		// 目标必须位于方向前方，评分偏向与当前焦点同轴的元素
		const forward = dx * vector.x + dy * vector.y
		const lateral = Math.abs(dx * vector.y) + Math.abs(dy * vector.x)
		if (forward < 4)
			continue

		const score = forward + lateral * 2.5
		if (score < bestScore) {
			bestScore = score
			best = el
		}
	}

	if (!best)
		return false

	best.focus({ preventScroll: true })
	best.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	return true
}
