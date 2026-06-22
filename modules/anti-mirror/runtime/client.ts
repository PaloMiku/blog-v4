export default (sources: string[], target: string) => {
	const isBadMirror = sources.some(domain => location.hostname === domain || location.hostname.endsWith('.' + domain))
	if (isBadMirror) {
		const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
		if (canonical)
			canonical.href = canonical.href.replace(location.host, target)
		location.host = target
	}
}