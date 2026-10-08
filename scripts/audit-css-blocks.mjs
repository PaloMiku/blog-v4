/**
 * 静态检查：源码里的 CSS 块有没有被工具改坏。
 *
 * ═══ 这道门禁为什么存在 ═══
 *
 * `src/components/content/Tab.astro` 的 `<style>` 开头是这样：
 *
 *     <style>
 *     	position: revert !important;
 *     }
 *
 * `.float-in-leave-active {` 这一行**整个不见了**——某次批量改写把它连同
 * 前一个规则的花括号一起吃掉了。后果不是编译报错：Astro 把这段原样塞进产物，
 * 浏览器的 CSS 解析器在顶层遇到裸声明会「跳过到下一个 `}`」，于是：
 *
 *   - `.float-in-leave-active` 规则**静默消失**（它的 `position: revert` 也没了）
 *   - 紧接着的 `.center { ... }` **侥幸活下来**（错误恢复刚好在它之前闭合）
 *
 * 于是构建全绿、页面大体正常，只有那一条规则悄悄失效。
 * 这正是「产物验证优先于源码推断」的典型样本，也是这份清单里反复出现的
 * 第 N 次「改文件改坏了但没人发现」。
 *
 * ═══ 判据 ═══
 *
 * 逐字符扫 CSS 花括号深度：
 *   1. 深度为 0 时出现 `;` → 顶层裸声明 → 选择器行丢失（本次的实际缺陷）
 *   2. 结束时深度不为 0 → 花括号不配对
 *
 * 只扫**真正的 `<style>` 块**：先剥掉 frontmatter，再只认行首的 `<style`。
 * 不这么收窄就会误报——`FeedCard.astro` 的 frontmatter 注释里为了说明
 * 「写 `.feed-card { … }` 会永不匹配」而**字面写了 `<style>`**，
 * 正则一抓就是一整段注释内容。
 *
 * ═══ 自检 ═══
 *
 * 判据本身带 6 个用例（含本仓库真实损坏的那一段）。判据自己判错的时候，
 * 门禁就是在教人忽略红灯——那是比没门禁更糟的状态。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'
import { walkFiles } from './lib/walk.mjs'

const ROOT = REPO_ROOT
const SRC = join(ROOT, 'src')

/**
 * 剥掉 frontmatter（首行 `---` 到下一个行首 `---`），避免把注释里的 `<style>` 当成真块。
 *
 * 一并返回**删掉的行数**：不返回的话，`<style>` 块里的行号全是块内相对行号，
 * 报错会指到 `Chat.astro:7` 这种地方（真实位置在 60 行之后）——
 * 指错行的门禁，用两次就没人看了。
 */
function stripFrontmatter(text) {
	const lines = text.split('\n')
	if (lines[0].replace(/^\uFEFF/, '').trim() !== '---')
		return { text, removed: 0 }
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '---')
			return { text: lines.slice(i + 1).join('\n'), removed: i + 1 }
	}
	return { text, removed: 0 }
}

function countLines(s) {
	let n = 0
	for (const ch of s) {
		if (ch === '\n')
			n++
	}
	return n
}

/**
 * 只认行首的 `<style`，这样行内的文字提及不会被当成样式块。
 *
 * ⚠️ 必须**全程只用 stripFrontmatter 的产物**。第一版先在剥离后的文本上
 * 取下标、再回到原文上切片，于是偏移量少了一截 frontmatter 的长度，
 * 抓出来的「CSS」实际是 frontmatter 尾部 + 组件模板 + 脚本，
 * 结果是 62 处「多余的右花括号」——把好文件全判成坏的。
 * 判据在真数据上第一次运行就误报，说明它当时还没被真正验证过。
 */
function styleBlocks(text) {
	const { text: body, removed } = stripFrontmatter(text)
	const opens = [...body.matchAll(/^<style[^>]*>/gm)]
	return opens.map((m) => {
		const from = m.index + m[0].length
		const close = body.indexOf('</style>', from)
		return {
			tag: m[0],
			body: close === -1 ? body.slice(from) : body.slice(from, close),
			// 块体**紧接在 `<style>` 同一行的尾部开始**，所以块内第 n 行
			// 对应文件第 lineBase + n 行。少算一行，报错就会指到上一行。
			lineBase: removed + countLines(body.slice(0, from)),
		}
	})
}

/**
 * 把注释与字符串**抹成等长空白**（保留换行，行号才不会错位）。
 *
 * 不抹就会两处误判：
 *   - `/* } { ; *\/` 注释里的花括号/分号被当成结构（自检用例 5 就抓到了）
 *   - `content: "};"` 字符串里的分号被当成顶层裸声明
 * 抹成等长而不是删掉，是为了报错时给的行号仍然指向真实位置。
 */
function maskNonCode(css) {
	const chars = [...css]
	let i = 0
	const blank = (from, to) => {
		for (let k = from; k < to && k < chars.length; k++) {
			if (chars[k] !== '\n')
				chars[k] = ' '
		}
	}
	while (i < chars.length) {
		const c = css[i]
		if (c === '/' && css[i + 1] === '*') {
			const end = css.indexOf('*/', i + 2)
			const stop = end === -1 ? css.length : end + 2
			blank(i, stop)
			i = stop
		}
		else if (c === '"' || c === '\'') {
			let j = i + 1
			while (j < css.length && css[j] !== c) {
				if (css[j] === '\\')
					j++
				j++
			}
			blank(i, Math.min(j + 1, css.length))
			i = j + 1
		}
		else {
			i++
		}
	}
	return chars.join('')
}

/**
 * 返回问题描述列表；空数组 = 干净。
 *
 * `lineBase` 是这个 `<style>` 块在文件里的起始行偏移（frontmatter 与
 * `<style>` 开标签都要算），不传就当 0——自检用例喂的是裸 CSS 片段。
 * 报出的行号必须是**文件真实行号**：指错行的门禁，用两次就没人看了。
 *
 * 注意 `null` 与 `[]` 的区别：调用方必须区分「扫过了且没问题」和
 * 「压根没扫到」。`compare-page-heights` 那次教训就是拿不到值就默认通过。
 */
function checkCss(rawCss, lineBase = 0) {
	const problems = []
	const css = maskNonCode(rawCss)
	let depth = 0
	let segStart = 0
	for (let i = 0; i < css.length; i++) {
		const c = css[i]
		if (c === '{') {
			if (depth === 0)
				segStart = i + 1
			depth++
		}
		else if (c === '}') {
			depth--
			if (depth < 0) {
				problems.push(`多余的右花括号（偏移 ${i}）`)
				depth = 0
				segStart = i + 1
			}
			else if (depth === 0) {
				// 规则闭合：从这里开始的顶层内容才算下一条声明
				segStart = i + 1
			}
		}
		else if (c === ';' && depth === 0) {
			const seg = css.slice(segStart, i).trim()
			// 自定义属性声明（`--x: 1;`）在顶层是**合法**的，不是裸声明
			if (seg !== '' && !seg.startsWith('--')) {
				const line = lineBase + css.slice(0, i).split('\n').length
				problems.push(`第 ${line} 行：顶层出现裸声明「${seg.replace(/\s+/g, ' ').slice(0, 60)}」——选择器行丢失`)
				return problems
			}
			segStart = i + 1
		}
	}
	if (depth !== 0)
		problems.push(`花括号不配对：结束时仍缺 ${depth} 个右花括号`)
	return problems
}

// ── 自检 ────────────────────────────────────────────────────────────────────
const SELF_TESTS = [
	{ name: '正常嵌套规则', css: '.a {\n\tcolor: red;\n}\n', expect: [] },
	{ name: '本仓库真实损坏的那一段', css: '\n\tposition: revert !important;\n}\n\n.center {\n\twidth: fit-content;\n}\n', expect: ['裸声明'] },
	{ name: '缺少右花括号', css: '.a {\n\tcolor: red;\n', expect: ['花括号不配对'] },
	{ name: '媒体查询内的声明不算顶层', css: '@media (width < 600px) {\n\t.a {\n\t\tcolor: red;\n\t}\n}\n', expect: [] },
	{ name: '注释里的花括号不参与配对', css: '/* } { ; */\n.a {\n\tcolor: red;\n}\n', expect: [] },
	{ name: '闭合规则后的顶层分号仍算裸声明', css: '.a {\n\tcolor: red;\n}\nposition: revert !important;\n', expect: ['裸声明'] },
	{ name: '字符串里的分号不算顶层声明', css: '.a::before {\n\tcontent: "};";\n}\n', expect: [] },
	{ name: '自定义属性声明是合法顶层', css: '--x: 1;\n.a {\n\tcolor: red;\n}\n', expect: [] },
	{
		// 自检用例里的 css 是**裸片段**，报出的行号没有意义；只有真正走
		// styleBlocks（带 frontmatter 与 `<style>` 开标签偏移）才谈得上真实行号。
		name: '报出的行号必须是**文件真实行号**（frontmatter + `<style>` 偏移都要算）',
		run: () => {
			// 造一个和 Chat.astro 同构的文件：3 行 frontmatter、模板 2 行、`<style>` 在第 7 行
			const text = [
				'---',
				'const a = 1',
				'---',
				'',
				'<div>x</div>',
				'',
				'<style>',
				'\tcolor: red;',
				'\t}',
				'</style>',
				'',
			].join('\n')
			const b = styleBlocks(text)[0]
			return checkCss(b.body, b.lineBase)
		},
		expect: ['第 8 行'],
	},
]

let selfOk = true
for (const t of SELF_TESTS) {
	const got = t.run ? t.run() : checkCss(t.css)
	// 期望干净的用例必须真的干净；期望报错的用例必须报出**全部**关键字
	const ok = t.expect.length === 0
		? got.length === 0
		: got.some(g => t.expect.every(k => g.includes(k)))
	if (!ok) {
		selfOk = false
		console.error(`  自检失败：${t.name}`)
		console.error(`    期望含 [${t.expect.join(', ') || '（无问题）'}]，实得 ${JSON.stringify(got)}`)
	}
}
if (!selfOk) {
	console.error('FAIL: CSS 判据自检不过，判据本身不可信，拒绝输出结论。')
	process.exit(1)
}
console.log(`self-test: ${SELF_TESTS.length} 例全过`)

// ── 扫描 ────────────────────────────────────────────────────────────────────
// 扩展名集合交给共享遍历器（`.astro` / `.css` 正是它 `ext` 参数的用途）。
const files = walkFiles(SRC, { ext: ['.astro', '.css'] })
const findings = []
let blocks = 0
for (const f of files) {
	const raw = readFileSync(f, 'utf8')
	for (const b of styleBlocks(raw)) {
		blocks++
		for (const p of checkCss(b.body, b.lineBase))
			findings.push({ file: relative(ROOT, f).replace(/\\/g, '/'), problem: p })
	}
}

console.log(`\n===== CSS 块完整性 =====`)
console.log(`  扫描 ${files.length} 个文件，${blocks} 个 <style> 块`)
if (!findings.length) {
	console.log('  OK: 没有顶层裸声明，也没有花括号不配对')
}
else {
	console.log(`  FAIL: ${findings.length} 处损坏`)
	for (const f of findings)
		console.log(`      ${f.file}  ${f.problem}`)
}

// BOM 单列：它不破坏 CSS，但会破坏 .ps1 / 其它按字节读的消费者，
// 而且本仓库已经因此踩过一次（中文注释 + 无 BOM = 静默吞行）。
//
// ⚠️ 收窄到 SRC，不要从仓库根扫。两者差别不是「多扫一点」：从根扫会
// 递归整个仓库再按扩展名过滤，也就是把 node_modules 的 5.8 万个文件全走一遍，
// 只为了确认里面有没有一个 .astro / .css 带 BOM。实测这道门禁因此要 21.3 s，
// 是全套离线门禁里最慢的一道（第二名 check-dropped-css 1.1 s）；改成 walk(SRC)
// 后降到约 0.2 s。
//
// 语义上没有损失：EXTS 只有 {.astro, .css}，原写法唯一多做的事是去检查
// node_modules 里第三方包的 BOM——那既不属于本仓库，也不构成任何风险。
const bomFiles = []
for (const f of walkFiles(SRC, { ext: ['.astro', '.css'] })) {
	const buf = readFileSync(f)
	if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)
		bomFiles.push(relative(ROOT, f).replace(/\\/g, '/'))
}
console.log(`\n===== UTF-8 BOM =====`)
if (!bomFiles.length) {
	console.log('  OK: 源码内无 BOM')
}
else {
	console.log(`  WARN: ${bomFiles.length} 个文件带 BOM`)
	for (const f of bomFiles)
		console.log(`      ${f}`)
}

// `.astro-compare/` 是不入库的产物目录（Astro 接管后由根 .gitignore 忽略）。
// 这个脚本以前假定它已经存在——在 astro-site/ 里成立，因为同目录的
// compare-ui-parity.mjs 先跑过并建了目录；接管后它搬到仓库根，第一次单独运行
// 就在 writeFileSync 上 ENOENT 崩掉。mkdir 幂等，顺便也不再依赖别的脚本先跑过。
mkdirSync(join(ROOT, '.astro-compare'), { recursive: true })
writeFileSync(join(ROOT, '.astro-compare', 'css-blocks.json'), JSON.stringify({ findings, bomFiles }, null, 2))
process.exitCode = findings.length ? 1 : 0
