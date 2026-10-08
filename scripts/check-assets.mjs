/**
 * 静态资源完整性门禁。
 *
 * ## 它盯的是什么
 *
 * 站点字体 `public/fonts/LXGWWenKai.woff2` 从来没被复制进 Astro 的资源树。
 * 两条 `@font-face` 一直指着 `/fonts/...`，**构建照样成功**——Astro 不会去校验
 * 引用到的 public/ 文件——而当时每一条已存在的门禁都是绿的：它们只比文本、URL、
 * 标题和日期。最后是手工扫产物才发现的。
 *
 * 同一形状的缺陷还有：资源路径打错、文件被改名、忘了复制进 public/。
 * 它们都产出「看起来对」的构建和一堆 404 的线上页面。
 *
 * ## 判据
 *
 * 构建产物（HTML + CSS）里每一条**本地**（根相对或文件相对）的静态资源引用——
 * `src=`、`href=` 和 CSS `url()`——都必须落到 dist 树里真实存在的文件上。
 *
 * 外部引用（https:、//cdn、data:、mailto:、#anchor）跳过：不归这条门禁管。
 *
 * **有意不覆盖**（写出来是为了不让任何人误以为覆盖了）：
 *   - `srcset=` 候选列表
 *   - `.js` chunk——不在下面的扩展名清单里，打包器管它们
 *
 * ## 路径
 *
 * dist 由**脚本自身位置**解析（`import.meta.url`），不依赖进程 CWD。
 * PS 版用 `Resolve-Path '..\dist'` 跟的是 CWD 而不是脚本位置，从别的目录调用会
 * 静默扫错树；Node 版不存在这个坑，但同一份默认路径必须留着。
 * 需要时可显式覆盖：`node scripts/check-assets.mjs --dist <dir>`。
 *
 * 退出码：0 = PASS，1 = FAIL，2 = 无法运行（dist 不存在）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

/** 仓库根。**不要**换成 process.cwd()。 */
const ROOT = REPO_ROOT

const DEFAULT_EXTENSIONS = [
	'woff2',
	'woff',
	'ttf',
	'otf',
	'png',
	'jpg',
	'jpeg',
	'svg',
	'webp',
	'ico',
	'xml',
	'txt',
	'json',
	'opml',
	'xsl',
	'css',
]

const extSet = new Set(DEFAULT_EXTENSIONS.map(e => e.replace(/^\.+/, '').toLowerCase()))

/** HTML 属性引用：src="..." / href='...' / src=x.png */
const RX_ATTR = /(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
/**
 * CSS url() 引用，引号或裸写都认。
 *
 * 这条正则是从 PS 版逐字搬过来的，`no-super-linear-backtracking` 的告警是误报：
 * 裸写分支 `[^)'"\s]*` 吃不到空白，跟不上那条 `\s*` 没有可交换的字符，
 * 两条 `\s*` 之间的输入空间是空集。想消警就得改结构，而改结构就是改判据——不干。
 */
// eslint-disable-next-line regexp/no-super-linear-backtracking
const RX_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi
const RX_STYLE_BLOCK = /<style[^>]*>(.*?)<\/style>/gis

const distDir = resolveDistDir(process.argv.slice(2))

function resolveDistDir(argv) {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--dist')
			return argv[i + 1] || join(ROOT, 'dist')
		if (argv[i].startsWith('--dist='))
			return argv[i].slice('--dist='.length)
	}
	return join(ROOT, 'dist')
}

// statSync 而非 [System.IO.File]::Exists()：后者对目录永远返回 False，
// 目录判定必须单独看 isDirectory()。
if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
	console.log(`ERROR: dist directory not found: ${distDir}`)
	console.log('RESULT: ERROR - nothing to scan (run the build first)')
	process.exit(2)
}
// 等价于 (Resolve-Path -LiteralPath $DistDir).Path：把参数定成绝对、已规范化的路径。
// 这一步不能省——省了的话传一个相对 --dist 就会退回「跟 CWD 走」，正是 PS 版踩过的坑。
const root = resolve(distDir)

/**
 * 判定一条引用是否属于本门禁，并给出它可能指向的候选路径。
 *
 * 候选顺序即尝试顺序：根相对只有一条；文件相对先试引用文件自己的目录，
 * 再试站点根（有些流水线用相对 href 表达根相对的意思）。
 * 返回 null = 不归本门禁管（外部引用、无扩展名、扩展名不在清单里）。
 */
function resolveReference(rawRef, fromDir) {
	const ref = rawRef.trim()
	if (!ref)
		return null
	// 锚点、内联 data、协议相对、绝对 URL、非 http 协议
	if (ref.startsWith('#'))
		return null
	if (/^(?:data|mailto|javascript|tel|blob|about):/i.test(ref))
		return null
	if (ref.startsWith('//'))
		return null
	if (/^[a-z][a-z0-9+.-]*:/i.test(ref))
		return null
	// fragment 与 query 不是文件路径的一部分
	const path = ref.split(/[?#]/)[0]
	if (!path)
		return null
	// 逐字等价于 [System.Uri]::UnescapeDataString。畸形百分号转义时
	// .NET 那侧不抛、原样继续，JS 这边会抛——catch 掉并保留原串，保持一致。
	let p = path
	try {
		p = decodeURIComponent(p)
	}
	catch {
		// 保留原串
	}
	// [System.IO.Path]::GetExtension() 在某些合法属性值上会抛
	// （比如根本不是路径的裸 token），所以这里按词法匹配扩展名。
	const m = /\.([A-Z0-9]+)$/i.exec(p)
	if (!m)
		return null
	if (!extSet.has(m[1].toLowerCase()))
		return null

	if (p.startsWith('/')) {
		const rel = p.replace(/^\/+/, '')
		return { kind: 'root', rel, candidates: [join(root, rel)] }
	}
	return { kind: 'relative', rel: p, candidates: [join(fromDir, p), join(root, p)] }
}

/** 递归列出 dist 下所有文件（不跟随符号链接目录，与 Get-ChildItem -Recurse -File 一致）。 */
function walkAll(dir) {
	return walkFiles(dir)
}

let scanned = 0
let checked = 0
/** 缺失路径（全路径小写） -> { rel, refs[] } */
const missing = new Map()

function addRef(rawRef, fromDir, rel) {
	const info = resolveReference(rawRef, fromDir)
	if (!info)
		return
	checked++
	if (info.candidates.some(c => existsSync(c) && statSync(c).isFile()))
		return
	// 归并键取第一个候选的小写全路径
	const key = info.candidates[0].toLowerCase()
	if (!missing.has(key))
		missing.set(key, { rel: info.rel, refs: [] })
	missing.get(key).refs.push(rel)
}

/** 三组捕获里取第一个成功的，等价于 PS 的 $m.Groups[1..3].Success 三元链。 */
function firstGroup(m) {
	return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])
}

for (const file of walkAll(root)) {
	const name = basename(file).toLowerCase()
	const isHtml = name.endsWith('.html') || name.endsWith('.htm')
	const isCss = name.endsWith('.css')
	if (!(isHtml || isCss))
		continue
	scanned++
	const fromDir = dirname(file)
	const relToRoot = file.slice(root.length + 1).replaceAll('\\', '/')

	// 等价于 [System.IO.File]::ReadAllText()：按 UTF-8 解码并吃掉 BOM。
	const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')

	for (const m of text.matchAll(RX_ATTR))
		addRef(firstGroup(m), fromDir, relToRoot)
	for (const m of text.matchAll(RX_URL))
		addRef(firstGroup(m), fromDir, relToRoot)
	// Astro 会把部分组件样式内联进页面，那些 url() 上面两遍扫不到。
	if (isHtml) {
		for (const sm of text.matchAll(RX_STYLE_BLOCK)) {
			for (const m of sm[1].matchAll(RX_URL))
				addRef(firstGroup(m), fromDir, `${relToRoot} (inline <style>)`)
		}
	}
}

const byCmp = (a, b) => a.localeCompare(b)

console.log('--- static asset references ---')
console.log(`  scanned ${scanned} html/css file(s) under ${root}`)
console.log(`  checked ${checked} local asset reference(s)`)

if (missing.size === 0) {
	console.log('  OK    every local asset reference resolves inside dist')
}
else {
	console.log('  --- MISSING ---')
	for (const key of [...missing.keys()].sort(byCmp)) {
		const e = missing.get(key)
		console.log(`  MISS  /${e.rel.replaceAll('\\', '/')}`)
		let shown = 0
		for (const r of [...new Set(e.refs)].sort(byCmp)) {
			if (shown >= 4) {
				console.log(`          ... +${e.refs.length - shown} more referrer(s)`)
				break
			}
			console.log(`          <- ${r}`)
			shown++
		}
	}
}

console.log('')
if (missing.size === 0) {
	console.log('RESULT: PASS - no dangling local asset reference')
	process.exit(0)
}
console.log(`RESULT: FAIL - ${missing.size} referenced local asset(s) missing from dist`)
process.exit(1)
