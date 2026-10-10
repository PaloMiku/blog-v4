// 一个聚焦的 DOM double，只实现 `src/lib/gamepad-focus.ts` 真正用到的那部分 API。
//
// ## 为什么需要它
// 焦点层是本次新增里唯一必须读真实 DOM 的模块（选择器命中、属性过滤、祖先可见性、
// `focus()` / `scrollIntoView()` 调用顺序、`MutationObserver` 刷新节流）。仓库里没有 jsdom，
// 而且 CLAUDE.md 的 EC-005 把「零新依赖」钉成了规则。所以这里自己写一个**范围明确**的 double。
//
// ## 「范围明确」是什么意思（这是本文件最重要的约束）
// 它**不是**通用 DOM 实现，只支持 `gamepad-focus.ts` 用到的 API 形状：
//   - 选择器：类型 / `*` / `#id` / `.class` / `[attr]` / `[attr="v"]` / `:not(…)` /
//     逗号并列 / 后代与 `>` 两种组合符。别的语法（`:has`、伪元素、`+`、`~`）**直接抛错**
//     而不是静默返回空集——静默返回空集会让「选择器写错了」这条真缺陷在测试里伪装成
//     「这个页面没有目标」。
//   - 几何：没有排版引擎。盒子按文档序**纵向堆叠**生成，可用 `setRect()` 覆盖。
//     因此几何规则的判据留在 `gamepad-navigation.ts` 的纯函数测试里；DOM 层的盒子只用来表达
//     「谁在上谁在下」与「谁被裁掉了」这两个粗粒度事实。
//   - 计算样式：只解析行内 `style` 属性（`display` / `visibility` / `overflow-*`），
//     `visibility` 按 CSS 规则向祖先继承，`display: none` 让整棵子树的盒子变成 0。
//
// ## 为什么必须自检（CLAUDE.md 坑位 6 / 7）
// double 本身就是仪器。仪器错了会同时给出假通过和假失败——假通过比不测更坏。
// 因此 `tests/gamepad-focus.test.mjs` 里有一段「mini-dom 自检」：先证明选择器匹配、
// 祖先可见性规则、属性变更通知这三件事**本 double 自己是对的**，再拿它去判生产代码。
// 那一段红了是 double 坏了，不是焦点层坏了。
//
// ## 明确不覆盖（逐条列在 task-4 报告里）
// 真实 `focus({ preventScroll })` 是否真的不滚动、真实 `scrollIntoView({ block: 'nearest' })`
// 是否真的滚到安全位置、`<details>` / `<dialog>` 的 UA 行为、CSS 级联、Shadow DOM、
// `stopPropagation`、真实布局引擎的盒子。
const VIEWPORT_WIDTH = 1280
const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 44
const STACK_GAP = 16

// ── 选择器解析 ──────────────────────────────────────────────────────────────

/** 标识符字符：CSS ident 的够用子集（ASCII 标识符字符 + 非 ASCII 段），能覆盖本仓库的属性名与类名 */
const IDENT_CHAR = /[-\w]|[^\x20-\x7E]/

/** 读一段标识符，返回 `[值, 下一个下标]` */
function readIdent(text, start) {
	let i = start
	while (i < text.length && IDENT_CHAR.test(text[i]))
		i++
	return [text.slice(start, i), i]
}

/**
 * 找到与 `close` 配对的 `close`（跳过嵌套）；找不到就抛错而不是猜。
 * `start` 是**开括号之后**的位置：先数嵌套深度，见到 depth 为 0 的 `close` 即返回。
 */
function findClosing(text, start, open, close) {
	let depth = 0
	for (let i = start; i < text.length; i++) {
		if (text[i] === open) {
			depth++
		}
		else if (text[i] === close) {
			if (depth === 0)
				return i
			depth--
		}
	}
	throw new Error(`mini-dom：选择器里 ${open} 没有配对的 ${close} → ${text}`)
}

/** 按顶层逗号切分选择器组（括号/方括号内部的逗号不算） */
function splitSelectorList(selector) {
	const groups = []
	let buffer = ''
	let depth = 0
	for (const ch of selector) {
		if (ch === '[' || ch === '(') {
			depth++
		}
		else if (ch === ']' || ch === ')') {
			depth--
		}
		else if (ch === ',' && depth === 0) {
			groups.push(buffer)
			buffer = ''
			continue
		}
		buffer += ch
	}
	groups.push(buffer)
	return groups.map(group => group.trim()).filter(Boolean)
}

/** 一个复合选择器：类型 / id / 类 / 属性 / :not */
function parseCompound(text) {
	const compound = { tag: null, id: null, classes: [], attrs: [], nots: [] }
	let i = 0
	while (i < text.length) {
		const ch = text[i]
		if (ch === '*') {
			i++
			continue
		}
		if (ch === '#') {
			const [value, next] = readIdent(text, i + 1)
			compound.id = value
			i = next
			continue
		}
		if (ch === '.') {
			const [value, next] = readIdent(text, i + 1)
			compound.classes.push(value)
			i = next
			continue
		}
		if (ch === '[') {
			const end = findClosing(text, i + 1, '[', ']')
			const body = text.slice(i + 1, end)
			const eq = body.indexOf('=')
			if (eq < 0) {
				compound.attrs.push({ name: body.trim().toLowerCase(), value: null })
			}
			else {
				// 第一个 `=` 一定是运算符（值里的 `=` 在它后面，如 `[href="a=b"]`）。
				// 运算符非裸 `=` 时**抛错**：把它们当成属性名的一部分会让
				// `[aria-current^="page"]` 静默返回 false，于是「选择器写错了」这条真缺陷
				// 会伪装成「这个页面没有目标」，而且测试全绿——本仓库已经在用
				// `[href^="http"]` / `[id^="ai:"]`（见 src/lib/icon-sprite.ts），拼错的概率不低
				const operator = body[eq - 1]
				if (operator === '~' || operator === '|' || operator === '^' || operator === '$' || operator === '*')
					throw new Error(`mini-dom：不支持的属性运算符「${operator}=」→ ${text}`)
				const name = body.slice(0, eq).trim().toLowerCase()
				let value = body.slice(eq + 1).trim()
				const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))
				if (quoted)
					value = value.slice(1, -1)
				compound.attrs.push({ name, value })
			}
			i = end + 1
			continue
		}
		if (ch === ':') {
			if (text.startsWith(':not(', i)) {
				// 从 `(` **之后**开始找配对的 `)`：从 `(` 本身开始会多算一层深度，
				// 于是切出来的是 `([tabindex]` 而不是 `[tabindex]`
				const end = findClosing(text, i + 5, '(', ')')
				compound.nots.push(parseCompound(text.slice(i + 5, end).trim()))
				i = end + 1
				continue
			}
			// 抛错而不是当成不匹配：让「本 double 不支持这个选择器」立刻暴露
			throw new Error(`mini-dom：不支持的伪类 → ${text.slice(i)}`)
		}
		const [value, next] = readIdent(text, i)
		if (!value)
			throw new Error(`mini-dom：解析不了的选择器片段 → ${text}`)
		compound.tag = value.toLowerCase()
		i = next
	}
	return compound
}

/** 一个组选择器拆成 `[{ combinator, compound }]`，combinator ∈ `null | ' ' | '>'` */
function parseSequence(text) {
	const steps = []
	let buffered = ''
	// 组合符必须**跟着它后面那个复合选择器一起存**，不能单独放一个 pending 变量：
	// `a > b` 在 `>` 之后还有一个空格，独立的 pending 会被那个空格改回 `' '`，
	// 于是子代选择器被误判成后代选择器——`span > a` 会错误地命中 `div > span > a` 里的 a。
	let pendingCombinator = null
	const flush = () => {
		const trimmed = buffered.trim()
		const combinator = pendingCombinator
		buffered = ''
		pendingCombinator = null
		if (trimmed)
			steps.push({ combinator, compound: parseCompound(trimmed) })
		// 把刚被消费掉的组合符还回去：`a > b` 的第二个空格必须**保留** `>`
		return combinator
	}
	let i = 0
	while (i < text.length) {
		const ch = text[i]
		if (ch === '[' || ch === '(') {
			const close = ch === '[' ? ']' : ')'
			const end = findClosing(text, i + 1, ch, close)
			buffered += text.slice(i, end + 1)
			i = end + 1
			continue
		}
		if (/\s/.test(ch)) {
			pendingCombinator = flush() ?? ' '
			while (i < text.length && /\s/.test(text[i]))
				i++
			continue
		}
		if (ch === '>') {
			flush()
			pendingCombinator = '>'
			i++
			continue
		}
		if (ch === '+' || ch === '~')
			throw new Error(`mini-dom：不支持的组合符 → ${ch}`)
		buffered += ch
		i++
	}
	flush()
	if (steps.length === 0)
		throw new Error(`mini-dom：空选择器 → ${text}`)
	return steps
}

const selectorCache = new Map()

function compileSelector(selector) {
	let compiled = selectorCache.get(selector)
	if (!compiled) {
		compiled = splitSelectorList(selector).map(parseSequence)
		selectorCache.set(selector, compiled)
	}
	return compiled
}

function matchCompound(element, compound) {
	if (compound.tag !== null && element.localName !== compound.tag)
		return false
	if (compound.id !== null && element.getAttribute('id') !== compound.id)
		return false
	for (const name of compound.classes) {
		if (!element.classList.contains(name))
			return false
	}
	for (const attr of compound.attrs) {
		const value = element.getAttribute(attr.name)
		if (value === null)
			return false
		if (attr.value !== null && value !== attr.value)
			return false
	}
	for (const not of compound.nots) {
		if (matchCompound(element, not))
			return false
	}
	return true
}

function matchSequence(element, steps) {
	const last = steps[steps.length - 1]
	if (!matchCompound(element, last.compound))
		return false
	let node = element
	for (let i = steps.length - 2; i >= 0; i--) {
		const step = steps[i]
		if (steps[i + 1].combinator === '>') {
			node = node.parentElement
			if (!node || !matchCompound(node, step.compound))
				return false
		}
		else {
			let parent = node.parentElement
			while (parent && !matchCompound(parent, step.compound))
				parent = parent.parentElement
			if (!parent)
				return false
			node = parent
		}
	}
	return true
}

// ── 计算样式 ────────────────────────────────────────────────────────────────

/** 解析行内 `style` 声明。只认 `display` / `visibility` / `overflow*`，其余忽略 */
function parseStyle(text) {
	const declarations = {}
	for (const part of String(text ?? '').split(';')) {
		const colon = part.indexOf(':')
		if (colon < 0)
			continue
		const name = part.slice(0, colon).trim().toLowerCase()
		const value = part.slice(colon + 1).trim()
		if (name)
			declarations[name] = value
	}
	return declarations
}

/**
 * 计算样式：`visibility` 按 CSS 继承（元素自身写 `visible` 可以覆盖祖先的 `hidden`），
 * 其余属性不继承。
 */
function computedStyle(element) {
	const own = parseStyle(element.getAttribute('style'))
	let visibility = own.visibility ?? ''
	if (!visibility) {
		visibility = 'visible'
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			const inherited = parseStyle(parent.getAttribute('style')).visibility
			if (inherited) {
				visibility = inherited
				break
			}
		}
	}
	const overflow = own.overflow ?? 'visible'
	const declarations = {
		'display': own.display ?? 'block',
		'visibility': visibility,
		'overflow': overflow,
		'overflow-x': own['overflow-x'] ?? overflow,
		'overflow-y': own['overflow-y'] ?? overflow,
	}
	// 真 CSSStyleDeclaration 没设某属性时返回**空串**，不是 undefined。生产代码若用
	// `??` 兜底，裁剪判定会在真实浏览器里整条静默失效；这里如实复刻这个形状
	return {
		'getPropertyValue': name => declarations[String(name).toLowerCase()] ?? '',
		'display': declarations.display,
		'visibility': declarations.visibility,
		'overflow': declarations.overflow,
		'overflow-x': declarations['overflow-x'],
		'overflow-y': declarations['overflow-y'],
	}
}

// ── 节点 ────────────────────────────────────────────────────────────────────

class MiniText {
	constructor(data) {
		this.nodeType = 3
		this.data = String(data)
		this.parentElement = null
		this.ownerDocument = null
	}

	get textContent() {
		return this.data
	}

	/** `appendChild` 会先调 `remove()` 把节点从旧父级摘下来；文本节点没有旧父级 */
	remove() {}
}

function createRect(rect) {
	const x = rect.x ?? 0
	const y = rect.y ?? 0
	const width = rect.width ?? 0
	const height = rect.height ?? 0
	return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }
}

/**
 * 挂载时把 ownerDocument 铺到整棵子树。
 * `el('div', {}, [child])` 造出来的是**未挂载**的树，那时子树里的节点都还没有
 * ownerDocument——只给直接子节点赋值的话，`getBoundingClientRect()` 会拿到 null。
 */
function attachDocument(node, owner) {
	node.ownerDocument = owner
	if (node.nodeType === 1) {
		for (const child of node.childNodes)
			attachDocument(child, owner)
	}
}

const ZERO_RECT = createRect({ x: 0, y: 0, width: 0, height: 0 })

/**
 * 让断言失败时打印得可读。
 *
 * 每个节点都指着 `parentElement` 与 `ownerDocument`，整张图是互相连通的：`util.inspect`
 * 会把它展开成一篇几秒的巨幅 dump（实测单条断言 11 秒），真正的失败信息被埋在最后一行。
 * 这不是美观问题——断言在十几秒后才报错，会被误判成「测试卡死」。
 */
const INSPECT = Symbol.for('nodejs.util.inspect.custom')

function describeNode(node) {
	if (node.nodeType === 9)
		return 'MiniDocument'
	const attrs = [...node.attrs].map(([name, value]) => ` ${name}="${value}"`).join('')
	const keys = ['href', 'data-list-key', 'data-gamepad-key', 'data-gamepad-region', 'data-gamepad-initial-focus', 'data-list-key']
		.filter(name => node.attrs.has(name))
		.map(name => `${name}=${JSON.stringify(node.getAttribute(name))}`)
		.join(' ')
	return `<${node.localName}${attrs}>${keys ? ` ${keys}` : ''} children=${node.children.length}`
}

class MiniElement {
	constructor(tagName, attributes = {}) {
		this.nodeType = 1
		this.localName = String(tagName).toLowerCase()
		this.ownerDocument = null
		this.parentElement = null
		this.childNodes = []
		this.attrs = new Map()
		this.listeners = new Map()
		for (const [name, value] of Object.entries(attributes)) {
			if (value === undefined || value === null)
				continue
			this.attrs.set(String(name).toLowerCase(), String(value))
		}
	}

	// 真 DOM 里 tagName 是大写。生产代码若忘了 toLowerCase，这里会立刻暴露
	get tagName() {
		return this.localName.toUpperCase()
	}

	[INSPECT]() {
		return describeNode(this)
	}

	get children() {
		return this.childNodes.filter(node => node.nodeType === 1)
	}

	get id() {
		return this.getAttribute('id') ?? ''
	}

	get className() {
		return this.getAttribute('class') ?? ''
	}

	get textContent() {
		return this.childNodes.map(node => node.textContent).join('')
	}

	get isConnected() {
		let node = this
		while (node.parentElement)
			node = node.parentElement
		return this.ownerDocument !== null && node === this.ownerDocument.documentElement
	}

	get classList() {
		const read = () => (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
		const write = (list) => {
			if (list.length === 0)
				this.removeAttribute('class')
			else
				this.setAttribute('class', list.join(' '))
		}
		const api = {
			contains: name => read().includes(name),
			add: (...names) => {
				const list = read()
				for (const name of names) {
					if (!list.includes(name))
						list.push(name)
				}
				write(list)
			},
			remove: (...names) => write(read().filter(name => !names.includes(name))),
			toggle: (name, force) => {
				const list = read()
				const has = list.includes(name)
				const next = force === undefined ? !has : force
				write(next ? [...new Set([...list, name])] : list.filter(item => item !== name))
				return next
			},
		}
		Object.defineProperty(api, 'length', { get: () => read().length })
		return api
	}

	getAttribute(name) {
		const value = this.attrs.get(String(name).toLowerCase())
		return value === undefined ? null : value
	}

	hasAttribute(name) {
		return this.attrs.has(String(name).toLowerCase())
	}

	setAttribute(name, value) {
		const key = String(name).toLowerCase()
		const previous = this.attrs.get(key) ?? null
		this.attrs.set(key, String(value))
		this.ownerDocument?.recordAttribute(this, key, previous)
		// 行内 style 参与 display 计算，改它可能让整棵子树的盒子作废
		this.ownerDocument?.invalidate()
	}

	removeAttribute(name) {
		const key = String(name).toLowerCase()
		if (!this.attrs.has(key))
			return
		const previous = this.attrs.get(key) ?? null
		this.attrs.delete(key)
		this.ownerDocument?.recordAttribute(this, key, previous)
		this.ownerDocument?.invalidate()
	}

	appendChild(node) {
		node.remove()
		node.parentElement = this
		attachDocument(node, this.ownerDocument)
		this.childNodes.push(node)
		this.ownerDocument?.recordChildList(this, [node], [])
		this.ownerDocument?.invalidate()
		return node
	}

	append(...nodes) {
		for (const node of nodes)
			this.appendChild(typeof node === 'string' ? new MiniText(node) : node)
	}

	remove() {
		const parent = this.parentElement
		if (!parent)
			return
		const index = parent.childNodes.indexOf(this)
		if (index < 0)
			return
		parent.childNodes.splice(index, 1)
		this.parentElement = null
		parent.ownerDocument?.recordChildList(parent, [], [this])
		parent.ownerDocument?.invalidate()
	}

	contains(node) {
		// 沿 parentElement 往上走就够了：documentElement 的 parentElement 是 null，链自然终止
		for (let current = node; current; current = current.parentElement) {
			if (current === this)
				return true
		}
		return false
	}

	matches(selector) {
		return compileSelector(selector).some(steps => matchSequence(this, steps))
	}

	closest(selector) {
		let node = this
		while (node) {
			if (node.matches(selector))
				return node
			node = node.parentElement
		}
		return null
	}

	querySelectorAll(selector) {
		const groups = compileSelector(selector)
		const found = []
		const walk = (node) => {
			for (const child of node.children) {
				if (groups.some(steps => matchSequence(child, steps)))
					found.push(child)
				walk(child)
			}
		}
		walk(this)
		return found
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null
	}

	getBoundingClientRect() {
		return this.ownerDocument.rectOf(this)
	}

	getClientRects() {
		const rect = this.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0 ? [rect] : []
	}

	focus(options) {
		this.ownerDocument?.recordFocus(this, options)
	}

	blur() {
		if (this.ownerDocument?.activeElement === this) {
			this.ownerDocument.activeElement = this.ownerDocument.body
			this.ownerDocument.dispatch('focusout', this)
		}
	}

	click() {
		this.ownerDocument?.recordClick(this)
	}

	scrollIntoView(options) {
		this.ownerDocument?.recordScrollIntoView(this, options)
	}

	addEventListener(type, handler) {
		if (!this.listeners.has(type))
			this.listeners.set(type, new Set())
		this.listeners.get(type).add(handler)
	}

	removeEventListener(type, handler) {
		this.listeners.get(type)?.delete(handler)
	}
}

// ── MutationObserver ────────────────────────────────────────────────────────

function isDescendantOf(node, ancestor, subtree) {
	if (node === ancestor)
		return true
	if (!subtree)
		return false
	let current = node.parentElement
	while (current) {
		if (current === ancestor)
			return true
		current = current.parentElement
	}
	return false
}

class MiniMutationObserver {
	constructor(callback) {
		this.callback = callback
		this.registrations = []
		this.pending = []
		// 真 MutationObserver **不追溯**：observe() 之前发生的变更永远不会被回调。
		// 少了这个序号，建树期间攒下的记录会在第一次 flush 时被当成「刚发生的变化」投递给
		// 刚创建的管理器，于是「管理器自己的 class 变更不触发刷新」那条断言会莫名其妙地红
		this.startSeq = -1
	}

	observe(target, options = {}) {
		this.registrations.push({ target, options })
		if (this.startSeq < 0)
			this.startSeq = target.ownerDocument ? target.ownerDocument.seq : 0
		target.ownerDocument?.registerObserver(this)
	}

	disconnect() {
		this.registrations = []
		this.pending = []
	}

	takeRecords() {
		const records = this.pending
		this.pending = []
		return records
	}

	/**
	 * 这条记录是否被本次 observe 覆盖。真浏览器也是逐条过滤后再回调的。
	 *
	 * **作用域检查对两类记录都要做**。只给 `attributes` 做的话，`childList` 会变得比浏览器
	 * 宽松得多：观察 `inside`（不带 subtree）却收到 `outside` 里的插入记录。这类偏差会把
	 * 生产代码的 bug 变成绿的测试——生产代码「本来就不该收到」的那条记录，在这里照收不误，
	 * 于是断言永远看不到它。
	 */
	accepts(record) {
		if (record.seq < this.startSeq)
			return false
		return this.registrations.some((registration) => {
			const { target, options } = registration
			// 目标自身总是命中；subtree 才管子孙
			if (!isDescendantOf(record.target, target, options.subtree))
				return false
			if (record.type === 'attributes') {
				if (!options.attributes)
					return false
				const filter = options.attributeFilter
				return !filter || filter.includes(record.attributeName)
			}
			return Boolean(options.childList)
		})
	}
}

// ── Document ────────────────────────────────────────────────────────────────

class MiniDocument {
	constructor() {
		this.nodeType = 9
		this.baseURI = 'https://example.test/'
		// 先把变更通知与几何的容器备好，再挂 body：appendChild 会立刻发一条 childList 记录
		this.listeners = new Map()
		this.observers = new Set()
		this.records = []
		this.seq = 0
		this.layouts = new Map()
		this.overrides = new Map()
		this.log = []
		this.flushScheduled = false
		this.documentElement = new MiniElement('html')
		this.documentElement.ownerDocument = this
		this.body = new MiniElement('body')
		this.documentElement.appendChild(this.body)
		this.activeElement = this.body
		this.hidden = false
		this.defaultView = {
			getComputedStyle: element => computedStyle(element),
			MutationObserver: MiniMutationObserver,
		}
	}

	invalidate() {
		this.layouts.clear()
	}

	[INSPECT]() {
		return 'MiniDocument'
	}

	registerObserver(observer) {
		this.observers.add(observer)
	}

	// ── 变更通知 ──
	recordAttribute(target, attributeName, attributeOldValue) {
		this.records.push({ seq: this.seq++, type: 'attributes', target, attributeName, attributeOldValue })
		this.scheduleFlush()
	}

	recordChildList(target, addedNodes, removedNodes) {
		this.records.push({ seq: this.seq++, type: 'childList', target, addedNodes, removedNodes })
		this.scheduleFlush()
	}

	scheduleFlush() {
		if (this.flushScheduled)
			return
		this.flushScheduled = true
		// 真 MutationObserver 在微任务检查点交付一批；这里用 queueMicrotask 对齐
		queueMicrotask(() => {
			this.flushScheduled = false
			this.flush()
		})
	}

	flush() {
		const records = this.records
		this.records = []
		for (const observer of this.observers) {
			const accepted = records.filter(record => observer.accepts(record))
			if (accepted.length === 0)
				continue
			observer.pending.push(...accepted)
			observer.callback(observer.takeRecords(), observer)
		}
	}

	// ── 事件（简化冒泡：从 target 一路走到 documentElement；不支持 stopPropagation）──
	addEventListener(type, handler) {
		if (!this.listeners.has(type))
			this.listeners.set(type, new Set())
		this.listeners.get(type).add(handler)
	}

	removeEventListener(type, handler) {
		this.listeners.get(type)?.delete(handler)
	}

	dispatch(type, target) {
		const event = {
			type,
			target,
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true
			},
		}
		let node = target
		while (node) {
			for (const handler of [...(node.listeners?.get(type) ?? [])])
				handler(event)
			if (node === this.documentElement) {
				for (const handler of [...(this.listeners.get(type) ?? [])])
					handler(event)
			}
			node = node.parentElement
		}
		return event
	}

	recordFocus(element, options) {
		this.log.push({ type: 'focus', element, options })
		this.activeElement = element
		this.dispatch('focus', element)
		this.dispatch('focusin', element)
	}

	recordClick(element) {
		this.log.push({ type: 'click', element })
		this.dispatch('click', element)
	}

	recordScrollIntoView(element, options) {
		this.log.push({ type: 'scroll', element, options })
	}

	// ── 几何 ──
	setRect(element, rect) {
		this.overrides.set(element, createRect(rect))
		this.layouts.clear()
	}

	/** `display: none` 的元素与整棵子树在真实浏览器里都没有盒子 */
	rectOf(element) {
		if (this.overrides.has(element))
			return this.overrides.get(element)
		for (let node = element; node; node = node.parentElement) {
			if (computedStyle(node).display === 'none')
				return ZERO_RECT
		}
		if (this.layouts.size === 0)
			this.layout(rootOf(element) ?? element)
		return this.layouts.get(element) ?? ZERO_RECT
	}

	/** 文档序纵向堆叠：盒子只表达「谁在上谁在下」与宽度，不做真实排版 */
	layout(root) {
		this.layouts.clear()
		// 递归边排边量：容器的高度先由子内容撑出来，再把下一段排到它**下面**。
		// 若只按「每个元素一个固定高度」排，`<ul>` 里的卡片会与 `<ul>` 后面的分页按钮
		// 叠在同一段 y 上——那是排版器的错，会让「向下移动」的 DOM 层断言全乱
		const walk = (node, x, y, width) => {
			let cursor = y
			for (const child of node.children) {
				const used = walk(child, x, cursor, width)
				cursor += used + STACK_GAP
			}
			const height = Math.max(DEFAULT_HEIGHT, cursor - y)
			this.layouts.set(node, createRect({ x, y, width, height }))
			return height
		}
		walk(root, 0, 0, root === this.documentElement ? VIEWPORT_WIDTH : DEFAULT_WIDTH)
	}

	getComputedStyle(element) {
		return computedStyle(element)
	}
}

function rootOf(node) {
	let current = node
	while (current.parentElement)
		current = current.parentElement
	return current.ownerDocument ? current.ownerDocument.documentElement : null
}

// ── 公开入口 ────────────────────────────────────────────────────────────────

/** 造一个元素。属性值为 `false` / `null` / `undefined` 时不写这个属性 */
export function el(tagName, attributes = {}, children = []) {
	const element = new MiniElement(tagName, attributes)
	for (const child of children)
		element.append(child)
	return element
}

/**
 * 造一份「文档」。`children` 挂到 `document.body` 下。
 * 返回文档本身；节点由用例自己拿引用（`el()` 的返回值）。
 */
export function createDocument(children = [], { baseURI } = {}) {
	const document = new MiniDocument()
	if (baseURI !== undefined)
		document.baseURI = baseURI
	document.body.append(...children)
	document.invalidate()
	return document
}

export { MiniDocument, MiniElement, MiniMutationObserver, ZERO_RECT }
