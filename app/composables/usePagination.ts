interface UsePaginationOptions {
	initialPage?: number
	perPage?: number
	bindQuery?: string
}

export default function usePagination<T>(list: MaybeRefOrGetter<T[]>, options?: UsePaginationOptions) {
	const appConfig = useAppConfig()
	const {
		initialPage = 1,
		perPage = appConfig.pagination.perPage || 10,
		bindQuery,
	} = options || {}

	const totalPages = computed(() => Math.ceil(toValue(list).length / perPage) || initialPage)

	function transformPage(val: string) {
		const page = Number(val)
		return page >= 1 && page <= totalPages.value ? page : initialPage
	}

	// 仅从无查询参数增加 query 时 push 一次
	const mode = computed({
		get: () => bindQuery && useRoute().query[bindQuery] ? 'replace' : 'push',
		set() { },
	})

	const page = bindQuery
		? useRouteQuery(bindQuery, initialPage.toString(), { transform: transformPage, mode })
		: ref(initialPage)

	const listPaged = computed(() => {
		const start = (page.value - 1) * perPage
		return toValue(list).slice(start, start + perPage)
	})

	// 不应在此处 watch list

	return {
		totalPages,
		page,
		listPaged,
	}
}

/**
 * 生成分页数组
 *
 * 根据当前页码、扩展范围和总页数，生成一个用于显示的分页数组，包含起始页、结束页和省略符号位置。
 *
 * @param current 当前页码
 * @param total 总页数
 * @param expand 当前页码的扩展范围，默认值为1
 * @returns  返回一个包含可显示页码的数组。
 * 数组中的 `Number.NEGATIVE_INFINITY` 表示向前省略页码符号（...）的位置；
 * 数组中的 `Number.POSITIVE_INFINITY` 表示向后省略页码符号（...）的位置。
 *
 */
export function getPaginationIndicator(current: number, total: number, expand = 2) {
	const pages: number[] = [1]
	const start = Math.max(2, current - expand)
	const end = Math.min(total - 1, current + expand)
	if (start > 2) pages.push(-1) // ponytail: -1 means ellipsis
	for (let i = start; i <= end; i++) pages.push(i)
	if (end < total - 1) pages.push(-1)
	if (total > 1) pages.push(total)
	return pages
}
