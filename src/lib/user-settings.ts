/**
 * 访客本地设置（正文字体 / 字号 / 行高 / 内容区宽度 / 强调色）。
 *
 * ## 作用域
 *
 * 这些是**每个访客各自**的偏好，存在 localStorage 里，不进仓库、不影响构建。
 * 与之相对，站点级的构建期配置在 `src/lib/app-config.ts`，两者互不干涉。
 *
 * 只应由 `.astro` 组件的 `<script>`（客户端）import——frontmatter 是构建期代码，
 * import 本模块会把 `document` 访问带进 SSR 阶段（同 `layout-state.ts` 的约束）。
 *
 * ## 为什么落成 CSS 变量而不是逐个改 DOM
 *
 * 五项设置里有四项是数值，作用于「全站某个 CSS 变量」。逐个 DOM 操作（改
 * `.article` 的 fontSize、改 `#main-content` 的 maxWidth……）既散又脆：任何一个
 * 选择器重构都会静默失效。写成变量后，**CSS 那边只管消费，JS 只管写变量**，
 * 两侧通过 `font.css` / `article.css` / `Blog.astro` 里的变量名解耦。
 *
 * ## 数值走 inline style，枚举走 data 属性
 *
 * - 数值 → `documentElement.style.setProperty(...)`。inline style 一定赢，
 *   不必和 `color.css:3` 的 `:root, .light { --hue-theme: 220deg }` 算特异性。
 * - 枚举（字体）→ `documentElement.dataset.font`。它是三个具名 token 而不是数值，
 *   由 `font.css` 的规则决定换哪个字体栈；`html[data-font='serif']` 的特异性
 *   `(0,1,1)` 高于 `:root` 的 `(0,1,0)`，算得清也稳。
 *
 * ## ⚠️ 与首屏防闪烁脚本的重复是刻意的
 *
 * `src/layouts/Base.astro` 里那段 `<script is:inline>` 必须在样式应用**之前**
 * 同步跑完，因此它不能 import 本模块（Astro 会把普通 `<script>` 改写成
 * module，改了就来不及）。两份代码里的**存储键、变量名、默认值**必须逐字一致，
 * 改动时两侧一起改。
 *
 * ## 与 ThemeToggle 的关系
 *
 * 互不冲突：`ThemeToggle` 只切 `<html>` 上的 `class="dark"` 与 `data-theme`，
 * 从不碰 `--hue-theme`。色相覆盖对深浅两套都生效，因为 `.dark`（`color.css:40`）
 * 只重新声明了 `--c-primary` 等派生变量，它们的 `hsl(var(--hue-theme) …)`
 * 会自动吃到新的色相。
 */

/**
 * 存储键。**刻意不用 `nuxt-color-mode`**——那是 `@nuxtjs/color-mode` 的默认键，
 * 由 `Base.astro` 的防闪烁脚本与 `ThemeToggle.astro` 共同占用。
 */
export const STORAGE_KEY = 'blog-v4:user-settings'

export type ArticleFont = 'basic' | 'serif' | 'creative'
export type CardStyle = 'card' | 'flat'

export interface UserSettings {
	/** 正文字体。`'basic'` 即「不覆盖」，等于 `font.css` 里的 `--font-basic` */
	font: ArticleFont
	/**
	 * 正文字号（px）。`null` = 不覆盖。
	 * 默认走 CSS 里的 `var(--font-size-article, 1em)`——`1em` 数值上恒等于继承值，
	 * 是严格的 no-op，不会引入偏移。
	 */
	fontSize: number | null
	/** 行高。`null` = 不覆盖，走 `article.css` 里的 `1.8` */
	lineHeight: number | null
	/** 内容区阅读宽度（px）。`null` = 不覆盖。窄屏（≤768px）不参与 */
	articleWidth: number | null
	/** 强调色色相（deg）。`null` = 不覆盖，走 `color.css:3` 的 `220deg` */
	hue: number | null

	/* ── 全站级开关（不是正文排版）───────────────────────────── */

	/** 卡片风格。`'card'` 即「不覆盖」，等于 `reusable.css` 的 `.card` */
	cardStyle: CardStyle
	/** 界面动效。`true` 即「不覆盖」，等于跟随系统的 reduced-motion */
	motion: boolean
	/** 毛玻璃。`true` 即「不覆盖」 */
	blur: boolean
}

/**
 * 数值项：**走 `<html>` 的 inline style 写 CSS 变量**。
 *
 * ⚠️ 这份列表与 `src/layouts/Base.astro` 的防闪烁内联脚本必须逐字对应。
 * 那边不能 import 本模块（Astro 会把它改成 module，来不及在样式应用前跑完），
 * 所以「加一项要改两处」这件事无法从类型上强制，只能靠这两处互指的注释。
 */
export const NUMERIC_KEYS = ['fontSize', 'lineHeight', 'articleWidth', 'hue'] as const

/** 属性项：**走 `<html>` 上的 data 属性**（枚举或开关，写成 CSS 规则消费） */
export const ATTRIBUTE_KEYS = ['cardStyle', 'motion', 'blur'] as const

export type NumericKey = typeof NUMERIC_KEYS[number]
export type AttributeKey = typeof ATTRIBUTE_KEYS[number]

/**
 * 全部「未覆盖」。
 *
 * ⚠️ 这里存的**不是**「当前应该显示成什么」——控件的缺省显示值由下面
 * `RANGES` 的 `fallback` 给出。两者刻意分开：`null` 的语义是「我没改过」，
 * 于是「恢复默认」退化成「把这几个键删掉」，而不是「写回一份拷贝」。
 */
export const DEFAULT_SETTINGS: UserSettings = {
	font: 'basic',
	fontSize: null,
	lineHeight: null,
	articleWidth: null,
	hue: null,
	cardStyle: 'card',
	motion: true,
	blur: true,
}

/**
 * 数值项 → CSS 变量名与序列化格式。
 *
 * 用一张表把「变量名」和「怎么转成字符串」放在一起，而不是散在 `applySettings`
 * 的一串 if/else 里——后者每加一项都要改两处，且很容易把 `deg` / `px` 挂错。
 *
 * ⚠️ 变量名与 `Base.astro` 防闪烁脚本里的字符串必须逐字一致。
 */
const CSS_VARS: Record<NumericKey, { name: string, format: (value: number) => string }> = {
	fontSize: { name: '--font-size-article', format: v => `${v}px` },
	lineHeight: { name: '--line-height-article', format: v => String(v) },
	articleWidth: { name: '--article-width', format: v => `${v}px` },
	hue: { name: '--hue-theme', format: v => `${v}deg` },
}

/**
 * 属性项 → 写进 `<html>` 的 data 属性。
 *
 * **必须显式写出属性名**，不能靠 `root.dataset[key]` 反推：`dataset` 是
 * camelCase ↔ kebab-case 的自动映射，`cardStyle` 会变成 `data-card-style`，
 * 而 `user-prefs.css` 里写的是 `html[data-card='flat']`——两边对不上，
 * 结果是「开关存下了、界面没反应」，而且**不报任何错**。
 * 这正是当初把 `hue` / `fontSize` 的变量名收进 `CSS_VARS` 表的原因，
 * 属性名同理。
 *
 * 「等于默认值」一律映射成 `undefined`，也就是**删掉那个属性**，
 * 让 CSS 的 `:root` / 无属性状态自然接管——与数值项「null 就 removeProperty」
 * 是同一个道理。
 */
const DATA_ATTRS: Record<AttributeKey, {
	attr: string
	of: (value: UserSettings[AttributeKey]) => string | undefined
}> = {
	cardStyle: { attr: 'card', of: v => (v === 'card' ? undefined : String(v)) },
	motion: { attr: 'motion', of: v => (v === true ? undefined : 'off') },
	blur: { attr: 'blur', of: v => (v === true ? undefined : 'off') },
}

/** 枚举项 → data 属性，规则同上（「basic」即缺省） */
const FONT_DATA_ATTR = (v: ArticleFont) => (v === 'basic' ? undefined : v)

/** 各数值项的取值范围与「未覆盖时控件显示什么」 */
export const RANGES = {
	/**
	 * `fallback: 16` —— `:root` 与 `body` 都**没有**设 font-size（`main.css:1-26`
	 * 逐条核过），`.article` 继承的就是浏览器默认的 16px。
	 * ⚠️ 别把这个当成「站点正文是 18px」写进控件缺省值：控件显示的值必须等于
	 * CSS 缺省下**实际渲染出来的**值，否则用户一打开面板看到的就不是现状。
	 */
	fontSize: { min: 14, max: 22, step: 1, fallback: 16, unit: 'px' },
	lineHeight: { min: 1.2, max: 2.2, step: 0.05, fallback: 1.8, unit: '' },
	/**
	 * `fallback: 784` 是**实测值**，不是推算的。
	 *
	 * `#blog-root` 的 `max-width` 原本是 `calc(var(--aside-width) + 1rem + 1080px)`
	 * = 280 + 16 + 1080 = **1376px**，而三列是
	 * `280px · 1fr · 280px` + 两个 `1rem` 列隙，于是正文列恒为
	 * `1376 − 280 − 280 − 32 = 784px`（1440px 视口下 CDP 实测确认）。
	 * 注释里那个 "1080px" 说的是**外壳总预算**，不是正文列宽。
	 *
	 * ⚠️ **step 必须是 16 而不是随手写的 20**：缺省 784 要**正好落在步长网格上**，
	 * 否则 `syncFromStorage` 把 784 写进 `<input type=range>` 时浏览器会把它吸到
	 * 最近的合法步（780），于是「打开面板看到的缺省位置」与「真正的缺省值」差 4px，
	 * 而且一旦碰过滑块就再也回不去。`(784 - 640) / 16 = 9`，整除。
	 * 同理 `(1200 - 640) / 16 = 35`，上界也整除。
	 *
	 * 早先这里写的是 `step: 20` + `fallback: 784`，实测存进去的是 780。
	 */
	articleWidth: { min: 640, max: 1200, step: 16, fallback: 784, unit: 'px' },
	hue: { min: 0, max: 360, step: 5, fallback: 220, unit: '°' },
} as const

export const FONT_OPTIONS: { value: ArticleFont, label: string }[] = [
	{ value: 'basic', label: '默认无衬线' },
	{ value: 'serif', label: '衬线' },
	{ value: 'creative', label: '标题体' },
]

/**
 * `--c-primary` 在**浅色**模式下对白底低于 3:1 的色相闭区间（deg）。
 *
 * ## 这组数字是量出来的，不是估的
 *
 * `color.css:23` 的浅色 `--c-primary` 是 `hsl(H 100% 55%)`，底色 `--c-bg` 是
 * `hsl(0 0% 100%)`。按 WCAG 相对亮度公式逐度扫描（步长 5°）的结果：
 * `15° = 3.23`、`20° = 2.93`、`205° = 2.81`、`210° = 3.36`——即 20°–205° 共
 * 190°（占色轮 53%）不达标。默认的 220° 是 4.79:1。
 *
 * **深色模式下没有任何色相低于 3:1**：`color.css:55` 的 `--c-primary` 是
 * `100% 70%`，压在 7% 灰底上全轮 ≥3:1（默认 220° 是 6.76:1）。故面板只在
 * 浅色模式下画警示色。
 *
 * ## 为什么用 3:1 而不是 4.5:1
 *
 * 也扫过 4.5:1（正文文本口径）：**浅色模式下 360° 全部不达标**，连最亮的黄绿
 * 都够不到。4.5:1 口径下没有可行解，只能用 3:1——WCAG 2.2 的 1.4.11
 * 「非文本对比度」，适用于控件边界与图形。本功能里 `--c-primary` 的角色正是
 * 强调色与控件色，不是正文文字。
 */
export const LOW_CONTRAST_HUE = { min: 20, max: 205 } as const

export function isLowContrastHue(hue: number): boolean {
	return hue >= LOW_CONTRAST_HUE.min && hue <= LOW_CONTRAST_HUE.max
}

/* ────────────────────────── 存储 ────────────────────────── */

function isArticleFont(value: unknown): value is ArticleFont {
	return value === 'basic' || value === 'serif' || value === 'creative'
}

function isCardStyle(value: unknown): value is CardStyle {
	return value === 'card' || value === 'flat'
}

/**
 * 拿 `parsed` 里**校验通过**的值填进 settings，逐项独立。
 *
 * 逐项校验而不是整体采纳：存储里的坏键不该让其余各项一起失效。
 * 两条通道分别校验——数值项只收有限数，属性项按各自的取值域。
 */
function hydrate(parsed: Record<string, unknown>): UserSettings {
	const settings: UserSettings = { ...DEFAULT_SETTINGS }

	if (isArticleFont(parsed.font))
		settings.font = parsed.font
	if (isCardStyle(parsed.cardStyle))
		settings.cardStyle = parsed.cardStyle

	for (const key of NUMERIC_KEYS) {
		const value = parsed[key]
		if (typeof value === 'number' && Number.isFinite(value))
			settings[key] = value
	}

	for (const key of ['motion', 'blur'] as const) {
		const value = parsed[key]
		if (typeof value === 'boolean')
			settings[key] = value
	}

	return settings
}

/**
 * 从 localStorage 读出设置。
 *
 * 隐私模式下 `localStorage.getItem` 会抛（`ThemeToggle.astro:62-68` 已记录），
 * 存储里的值也可能被手改成任意 JSON——两边都按「读不到就用默认」处理。
 * 注意这里**不**把 `null` 补成具体数值：那由 CSS 的 fallback 负责。
 */
export function readSettings(): UserSettings {
	let raw: string | null = null
	try {
		raw = localStorage.getItem(STORAGE_KEY)
	}
	catch {
		return { ...DEFAULT_SETTINGS }
	}
	if (!raw)
		return { ...DEFAULT_SETTINGS }

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	}
	catch {
		return { ...DEFAULT_SETTINGS }
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		return { ...DEFAULT_SETTINGS }

	return hydrate(parsed as Record<string, unknown>)
}

/**
 * 只把**与默认不同**的键写进去。少写少读，也让日后新增设置项时旧记录不会带上
 * 过期的键值。
 *
 * 存不下时静默返回 false——设置已经在本次会话生效了，为它打断界面不值得。
 */
function persist(settings: UserSettings): boolean {
	const payload: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(settings)) {
		if (value !== DEFAULT_SETTINGS[key as keyof UserSettings])
			payload[key] = value
	}
	try {
		if (Object.keys(payload).length)
			localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
		else
			localStorage.removeItem(STORAGE_KEY)
		return true
	}
	catch {
		return false
	}
}

/* ────────────────────────── 应用 ────────────────────────── */

/**
 * 把设置写到 `<html>` 上。**只写，不读、不存**——`Base.astro` 的防闪烁脚本在
 * 首屏已经写过一遍，这里是运行时改动的增量应用。
 *
 * 两条通道各走各的：数值写 inline style（一定赢，省掉和 `color.css:3`
 * 的 `:root, .light` 算特异性），枚举/开关写 data 属性（值是具名 token，
 * 由 `user-prefs.css` 的规则决定换哪套外观）。
 */
export function applySettings(settings: UserSettings): void {
	const root = document.documentElement

	for (const key of NUMERIC_KEYS) {
		const value = settings[key]
		if (value === null)
			root.style.removeProperty(CSS_VARS[key].name)
		else
			root.style.setProperty(CSS_VARS[key].name, CSS_VARS[key].format(value))
	}

	for (const key of ATTRIBUTE_KEYS) {
		const { attr, of } = DATA_ATTRS[key]
		const value = of(settings[key]) as string | undefined
		if (value === undefined)
			delete root.dataset[attr]
		else
			root.dataset[attr] = value
	}

	const font = FONT_DATA_ATTR(settings.font)
	if (font === undefined)
		delete root.dataset.font
	else
		root.dataset.font = font
}

/**
 * 当前有几项被改过。
 *
 * 「恢复默认」按钮据此决定自己是禁用态还是可用态——否则用户看着一个永远亮着的
 * 「恢复默认」，点下去发现什么都没发生，只能猜自己到底改没改过。
 */
export function modifiedCount(settings: UserSettings = readSettings()): number {
	let count = 0
	for (const [key, value] of Object.entries(settings)) {
		if (value !== DEFAULT_SETTINGS[key as keyof UserSettings])
			count++
	}
	return count
}

function announce(): void {
	document.dispatchEvent(new CustomEvent('settings-change', { detail: { ...readSettings() } }))
}

/** 改一项并立即生效。传 `null` 表示「这一项不覆盖」 */
export function setSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
	const settings = readSettings()
	settings[key] = value
	persist(settings)
	applySettings(settings)
	announce()
}

/** 恢复全部默认：删存储、清 `<html>` 上的所有覆盖 */
export function resetSettings(): void {
	try {
		localStorage.removeItem(STORAGE_KEY)
	}
	catch {
		// 存不下就谈不上清，`<html>` 上的清理照做，本次会话内等效已重置
	}
	applySettings({ ...DEFAULT_SETTINGS })
	announce()
}

/* ────────────────────────── 导出 / 导入 ────────────────────────── */

/** 导出格式版本。将来 `UserSettings` 的形状变了就 +1，导入端据此拒绝过新的文件 */
export const EXPORT_VERSION = 1

/** 全部合法的键，用来判断一份导入文件「认不认识」 */
const ALL_KEYS: readonly string[] = ['font', ...NUMERIC_KEYS, ...ATTRIBUTE_KEYS]

/**
 * 导出一份 JSON 文本。
 *
 * 带 `version` 是为了将来改形状时能识别旧文件——**不写版本号的话，
 * 新版读到旧格式会「安静地导入一半」**，用户以为搬过去了，其实丢了三设置。
 */
export function exportSettings(): string {
	return JSON.stringify({ version: EXPORT_VERSION, settings: readSettings() }, null, '\t')
}

export type ImportResult
	= | { ok: true, modified: number }
		| { ok: false, error: string }

/**
 * 导入一份 JSON 文本。
 *
 * **失败一律走返回值，不抛异常**：导入是用户主动点的操作，出错时需要的是
 * 一句能看懂的话（"这不是设置文件"），不是一个红色堆栈。
 *
 * 宽容的地方：既接受 `{version, settings}` 的正式导出，也接受一个裸的设置对象
 * （手写或从别处粘过来的）。严格的地方：版本比当前新就拒绝，宁可让用户手动
 * 处理也不要让新版代码去猜旧字段的含义。
 */
export function importSettings(json: string): ImportResult {
	let parsed: unknown
	try {
		parsed = JSON.parse(json)
	}
	catch {
		return { ok: false, error: '这不是有效的 JSON 文件' }
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		return { ok: false, error: '文件内容不是一个对象' }

	const wrapper = parsed as { version?: unknown, settings?: unknown }
	if (wrapper.version !== undefined) {
		if (typeof wrapper.version !== 'number')
			return { ok: false, error: '文件缺少可识别的版本号' }
		if (wrapper.version > EXPORT_VERSION) {
			return {
				ok: false,
				error: `这份导出来自更新的版本（v${wrapper.version}，本站认到 v${EXPORT_VERSION}），请先更新站点`,
			}
		}
		if (!wrapper.settings || typeof wrapper.settings !== 'object')
			return { ok: false, error: '文件里没有设置内容' }
		parsed = wrapper.settings
	}

	const source = parsed as Record<string, unknown>
	const recognized = ALL_KEYS.filter(key => source[key] !== undefined)
	if (!recognized.length)
		return { ok: false, error: '没认出任何设置项，可能不是本站导出的文件' }

	const settings = hydrate(source)
	persist(settings)
	applySettings(settings)
	announce()
	return { ok: true, modified: modifiedCount(settings) }
}
