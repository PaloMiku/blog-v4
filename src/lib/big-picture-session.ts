/**
 * 大屏模式的**标签页会话**：同一标签页内跨整页跳转存活，关掉标签页即结束。
 *
 * ## 为什么单独一层、且必须零 DOM
 * 和 `gamepad-input.ts` 同一判据：这里最容易被悄悄写错的恰恰是最平凡的几行——
 * 「存进去的 `active` 会不会被一个 `null` 读成别的东西」「坏 JSON 会不会从点击
 * 处理里冒出去」「隐私模式下 `setItem` 抛错会不会把整个页面带崩」。它们都得能在
 * 没有浏览器的 Node 里被钉死，所以：
 * - 模块作用域不出现 `window` / `document` / `navigator`；
 * - 存储**由调用方传入**。本模块只认 `StorageLike` 这三个方法，测试传内存替身，
 *   浏览器里传 `sessionStorage`。这两边走的是同一条代码路径。
 *
 * ## 存储不可用时的降级
 * 无痕模式、用户禁用站点数据、第三方 iframe 里被拦策略时，`getItem` / `setItem`
 * 会直接抛（Safari 是在**取属性**时抛）。规格要求「存储异常时退回常规页面和可用的
 * 手动入口，页面功能正常可用」——也就是说大屏模式可以降级，页面不能。所以每一次
 * 存储访问都走 `guarded()`：首次抛错即把该 storage 判为不可用并转入进程内内存，
 * 之后不再反复试错（一个每次点击都抛一次的 storage 会把日志与耗时一起放大）。
 * 内存兜底只保证**本次标签页内**的往返一致，刷新即失效——这正是可接受的降级。
 * 「压根没有 storage 对象」（传进来的就是 `null`）走同一条降级：它和抛错的 storage
 * 在结果上没区别，都是这一标签页只剩内存，所以共用一个兜底而不是各自造一个。
 *
 * ## 键名
 * 统一用 `blog-<域>:<语义>` 前缀，便于在同一份站点数据里辨认来源。
 */

/** 会话里的模式值。刻意只有两态：设备连接与提示状态另行记录，不进这个联合 */
export type BigPictureMode = 'inactive' | 'active'

/** 本模块只用到 `Storage` 的这三个方法；浏览器 `sessionStorage` 与测试替身都满足 */
export interface StorageLike {
	getItem: (key: string) => string | null
	setItem: (key: string, value: string) => void
	removeItem: (key: string) => void
}

/** 会话模式键。缺省按 `inactive` 解析：没有记录不等于「上次进过模式」 */
export const SESSION_KEY = 'blog-big-picture:mode'

/** 「本标签页不再自动进入」标记键。只由手动退出写入 */
export const AUTO_ENTRY_SUPPRESSED_KEY = 'blog-big-picture:auto-entry'

/** 站内跳转来源记录键。落地页消费一次即清 */
export const SOURCE_KEY = 'blog-big-picture:source'

/**
 * 来源记录的过期上限，规格写死 30 分钟。
 * 过期不返回的理由是「返回」这个动作会真的离开当前页：一条几小时前的记录多半属于
 * 用户早就放弃的那条时间线，拿它导航等于把用户送到一个他不记得去过的地方。
 */
const SOURCE_TTL_MS = 30 * 60 * 1000

/** 某个 storage 的兜底状态。以 storage 对象为键：不同标签页/不同替身互不污染 */
interface StorageFallback {
	/** 一旦某次访问抛错就永久降级到内存，不再回头碰坏存储 */
	broken: boolean
	data: Map<string, string>
}

const fallbacks = new WeakMap<StorageLike, StorageFallback>()

/** 压根没拿到 storage 时用的共享兜底。`broken` 直接为真：没有对象可试错 */
let missingStorage: StorageFallback | null = null

/**
 * 取（必要时建立）某个 storage 的兜底状态。
 *
 * `null` / `undefined` 也走这里：`WeakMap` 的键必须是对象，喂 `null` 会抛
 * `Invalid value used as weak map key`，而「拿不到存储」恰恰是本模块声明要扛住的
 * 情形之一——调用方给不出 storage 时应当得到降级，不是 TypeError。
 */
function fallbackOf(storage: StorageLike | null): StorageFallback {
	if (typeof storage !== 'object' || storage === null) {
		missingStorage ??= { broken: true, data: new Map() }
		return missingStorage
	}
	let entry = fallbacks.get(storage)
	if (!entry) {
		entry = { broken: false, data: new Map() }
		fallbacks.set(storage, entry)
	}
	return entry
}

/**
 * 包一层，保证三个方法都不抛（**包括 storage 本身为 `null`**）。
 * 读：能读真存储就读真存储；已降级或抛错则读内存。
 * 写/删：成功即止（不同时写内存，避免真存储一旦恢复又被陈旧值盖回去）；
 * 抛错则标记降级并落到内存。
 */
function guarded(storage: StorageLike | null): StorageLike {
	const entry = fallbackOf(storage)
	// `storage &&` 是承重的那一半：storage 为 null 时 `entry` 直接就是共享兜底
	// （`broken` 为真），下面三处永远不会去解引用一个空对象。
	return {
		getItem(key: string): string | null {
			if (storage && !entry.broken) {
				try {
					return storage.getItem(key)
				}
				catch {
					entry.broken = true
				}
			}
			return entry.data.get(key) ?? null
		},
		setItem(key: string, value: string): void {
			if (storage && !entry.broken) {
				try {
					storage.setItem(key, value)
					return
				}
				catch {
					entry.broken = true
				}
			}
			entry.data.set(key, value)
		},
		removeItem(key: string): void {
			if (storage && !entry.broken) {
				try {
					storage.removeItem(key)
					return
				}
				catch {
					entry.broken = true
				}
			}
			entry.data.delete(key)
		},
	}
}

/**
 * 读会话模式。
 * 任何非 `'active'` 的取值（含 `null`、脏值）一律收敛成 `'inactive'`：
 * 这个联合只有两态，宁可少判也不能造出第三种模式。
 *
 * @param storage `null` 表示拿不到存储，走共享内存兜底
 */
export function readSessionMode(storage: StorageLike | null): BigPictureMode {
	return guarded(storage).getItem(SESSION_KEY) === 'active' ? 'active' : 'inactive'
}

/**
 * 写会话模式。
 * 两种取值都写死而不是「false 就删键」：键的取值本身就是契约，
 * 删键会让「上一次是什么」无从判断，而下一次读本来就会把缺失当 `inactive`。
 *
 * @param storage `null` 表示拿不到存储，走共享内存兜底
 */
export function writeSessionMode(storage: StorageLike | null, active: boolean): void {
	guarded(storage).setItem(SESSION_KEY, active ? 'active' : 'inactive')
}

/**
 * 读「本标签页不再自动进入」标记；非 `'true'` 一律按未抑制解析。
 * @param storage `null` 表示拿不到存储，走共享内存兜底
 */
export function readAutoEntrySuppressed(storage: StorageLike | null): boolean {
	return guarded(storage).getItem(AUTO_ENTRY_SUPPRESSED_KEY) === 'true'
}

/**
 * 写「本标签页不再自动进入」标记。
 * 与模式同理，`false` 也落盘——`isAutoEntrySuppressed()` 把它当可读状态读回来，
 * 而不是靠「键不存在」推断当前值。
 *
 * @param storage `null` 表示拿不到存储，走共享内存兜底
 */
export function writeAutoEntrySuppressed(storage: StorageLike | null, suppressed: boolean): void {
	guarded(storage).setItem(AUTO_ENTRY_SUPPRESSED_KEY, suppressed ? 'true' : 'false')
}

/**
 * 写入端载荷：调用方只需要给得出「从哪来、到哪去、哪一条、哪种页面」。
 * `key`（列表项的稳定标识）与 `page`（页面的类型声明）可省，
 * 各自的消费方都有兜底；`destination` **不可省**（见下）。
 */
export interface NavigationSourceInput {
	/** 来源页面的站内路径 */
	readonly path: string
	/**
	 * 这次跳转要去的站内路径（落地页）。
	 *
	 * 为什么必须记：规格把返回的前提写成**合取**——「目标与当前路径匹配**且**来源属于核心页面」。
	 * 只记来源的话，一条最长 30 分钟内的记录可以被任何一个页面捡走当自己的来源
	 * （书签直达、粘贴 URL、非 `<a>` 的脚本跳转都不会留下记录），B 于是把用户送到
	 * 一个他压根不记得去过的页面。记下目的地之后，「这条记录是不是给我的」就成了一条
	 * 可以当场判定的事实。
	 *
	 * 与 `path` 同规则：站内路径、不带 query 与 hash（落地页比较的也是 `location.pathname`）。
	 */
	readonly destination: string
	readonly key?: string
	readonly page?: string
}

/** 读取端载荷：`key` / `page` 缺省补空串，`timestamp` 由写入端补 */
export interface NavigationSource {
	readonly path: string
	readonly destination: string
	readonly key: string
	readonly page: string
	readonly timestamp: number
}

/**
 * 是否是站内路径。
 * `//host/x` 与 `/\host/x` 都是浏览器会解析成站外地址的写法，必须显式排除——
 * 只看「以 `/` 开头」会把协议相对 URL 当成站内路径放回去。
 */
function isSameOriginPath(path: string): boolean {
	if (!path.startsWith('/'))
		return false
	return !path.startsWith('//') && !path.startsWith('/\\')
}

/**
 * 去掉尾斜杠再比较。
 * 本站 `build.format: 'directory'`，`Astro.url.pathname` 带尾斜杠，
 * 而站内链接与手写路径未必一致；不归一就会把 `/posts/a/` 与 `/posts/a`
 * 当成两个页面（同 `CLAUDE.md` 坑位里 `path === item.url` 的那类陷阱）。
 */
function normalizeRoute(path: string): string {
	if (path === '/')
		return '/'
	return path.endsWith('/') ? path.slice(0, -1) : path
}

function parseNavigationSource(raw: string): NavigationSource | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	}
	catch {
		// 存坏了或被人改过的 JSON：一律按没有来源处理。
		// 绝不能让一个 JSON 异常从「点了站内链接」的处理器里冒出去。
		return null
	}

	if (typeof parsed !== 'object' || parsed === null)
		return null

	const { path, destination, key, page, timestamp } = parsed as Partial<Record<keyof NavigationSource, unknown>>
	// 站外来源绝不返回：它可能来自 referrer 或任何第三方写入的键
	if (typeof path !== 'string' || !isSameOriginPath(path))
		return null
	// 目的地同样必须是站内路径，且必须真的记下来过。
	// 缺失时判废而不是放行：这条记录无法证明「它就是冲着我这个页面写的」，
	// 放行等于让任何页面都能捡走一条 30 分钟内的旧记录当来源。
	if (typeof destination !== 'string' || !isSameOriginPath(destination))
		return null
	// 时间戳缺失就没法判过期，一律判废——宁可少一条返回，也不要拿陈旧来源导航。
	// `0` 与负数同样判废：它们是「没有时间」的写法（缺省填 0、时钟被拨回），
	// 放行会让一条永远算不出年龄的记录变成永久有效的返回来源。
	if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0)
		return null

	return {
		path,
		destination,
		key: typeof key === 'string' ? key : '',
		page: typeof page === 'string' ? page : '',
		timestamp,
	}
}

/**
 * 记下站内跳转的来源，落地页据此决定「返回去哪」。
 *
 * 站外路径**根本不写**：写入端筛一次、读取端再验一次，两头都不放行。
 * `now` 是可注入的时间源，测试据此断言过期规则，生产用墙钟。
 *
 * @param storage `null` 表示拿不到存储，走共享内存兜底
 * @param source 载荷不合型（`path` / `destination` 不是站内路径）一律早退而不抛：
 *   下游调用点是「点了站内链接」的内联处理器，抛错会打断整条点击链，
 *   而这里最多只是少记一条来源
 */
export function recordNavigationSource(
	storage: StorageLike | null,
	source: NavigationSourceInput,
	now: number = Date.now(),
): void {
	if (typeof source?.path !== 'string' || !isSameOriginPath(source.path))
		return
	// 目的地缺一不可：记不出「这条记录是冲着我来的」就等于没记，
	// 与其写一条落地页认不出来的记录，不如不写
	if (typeof source?.destination !== 'string' || !isSameOriginPath(source.destination))
		return

	const record: NavigationSource = {
		path: source.path,
		destination: source.destination,
		key: typeof source.key === 'string' ? source.key : '',
		page: typeof source.page === 'string' ? source.page : '',
		timestamp: now,
	}
	guarded(storage).setItem(SOURCE_KEY, JSON.stringify(record))
}

/**
 * 取出并清除来源记录。
 *
 * **一次性**：无论判定结果如何都先清掉。理由有二——坏记录不该被反复读；
 * 更重要的是「返回来源」这个动作会把用户送走，若记录留着，同一份来源会被第二次
 * 触发（例如返回后又点一次同一处）而把用户来回弹。
 *
 * @param storage 标签页会话存储；为 `null`、取不到或抛错时内部降级到内存
 * @param currentPath 当前落地页路径。两处比较都过归一化：
 *   来源与当前路径相同时没有「返回来源」的含义；**目的地与当前路径不同时这条记录
 *   根本不是冲这一页写的**（书签直达、粘贴 URL、脚本跳转都可能留下一条旧记录）
 * @param now 可注入的时间源，缺省墙钟
 */
export function consumeNavigationSource(
	storage: StorageLike | null,
	currentPath: string,
	now: number = Date.now(),
): NavigationSource | null {
	const store = guarded(storage)
	const raw = store.getItem(SOURCE_KEY)
	store.removeItem(SOURCE_KEY)

	if (raw === null)
		return null

	const record = parseNavigationSource(raw)
	if (record === null)
		return null

	if (now - record.timestamp > SOURCE_TTL_MS)
		return null

	const here = normalizeRoute(currentPath)
	if (normalizeRoute(record.path) === here)
		return null

	if (normalizeRoute(record.destination) !== here)
		return null

	return record
}
