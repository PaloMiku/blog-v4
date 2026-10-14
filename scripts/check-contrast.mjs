#!/usr/bin/env node
/**
 * 门禁：主题令牌的核心对比度不达标。
 *
 * ## 这条门禁在防什么
 *
 * 对比度是**改动令牌时最容易顺带弄坏、且没有任何几何门禁看得见**的东西。
 * 把 `--c-text-3` 从 46% 调到 70% 看着只是「淡一点」，构建全绿、页面也正常，
 * 但 23 处元信息文字就跌到 2.11:1——低于 WCAG AA 的 4.5:1，而**没有任何
 * 现有门禁会报红**。`check-layout` 断言令牌「存在」，`check-prose-layer`
 * 断言正文完整，两者都量不出对比度。
 *
 * ## 为什么读源文件而不是读产物
 *
 * 令牌是 `hsl(var(--hue-theme) H S% L%)`，`--hue-theme` 又在别处定义，
 * 产物 CSS 里是编译后的字面量。但**产物才是浏览器看到的东西**——如果某个
 * 组件在自己的 `<style>` 里覆盖了同名令牌，源码里的值就不作数了。
 *
 * 折中：判据读 `src/styles/color.css`（令牌的唯一定义处），因为
 * `check-self-contained` 与既有约定都保证组件不得重定义全局令牌
 * （实测 0 处）。真出现覆盖时，这条门禁会与产物不一致，届时应改读产物。
 *
 * ## 判据
 *
 * 每个前景令牌与该主题的**实际底色**（`--c-bg`）之间：
 *   - 文字类令牌（text / primary 作为文字色）≥ 4.5:1（WCAG AA 正文）
 *   - 边界类令牌（border-strong）≥ 3:1（WCAG 1.4.11 非文本对比度）
 *
 * 只覆盖**已在本仓库实测过、且被大量消费**的核心令牌，不做全站扫描：
 * 全量扫描要解析所有继承与叠色，判据会复杂到没法证伪。
 *
 * ## 阈值为什么按「用途」而不是统一 4.5
 *
 * WCAG 1.4.11 管的是「识别控件所必需的视觉信息」，对边界这类非文字元素
 * 要求 3:1；1.4.3 对正文文字要求 4.5:1。把边框也按 4.5 卡，会逼出一堆
 * 没人需要的重边框——那正是本站「无边框 + 背景分层」视觉语言要避免的。
 *
 * ## 如何自证（改本脚本后必须做）
 *
 * 把 `color.css` 里的 `--c-text-3` 调回 70%，本脚本应变红并报出实测比值；
 * 还原后应变绿。**没被看过变红的门禁等于没有门禁。**
 *
 * 用法：node scripts/check-contrast.mjs
 * 退出码：0 = 通过；1 = 有令牌不达标；2 = 脚本自身出错
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { REPO_ROOT } from './lib/paths.mjs'

const COLOR_CSS = path.join(REPO_ROOT, 'src/styles/color.css')

if (!fs.existsSync(COLOR_CSS)) {
	console.error(`找不到 ${COLOR_CSS}，脚本自身出错`)
	process.exit(2)
}

const src = fs.readFileSync(COLOR_CSS, 'utf8')

/**
 * 色相取自 `--hue-theme` 的字面值。不硬编码 220 —— 万一有人改了主色相，
 * 这道门禁必须跟着变，否则会在错误的色相上算出一堆假的对拍数。
 */
const hueMatch = src.match(/--hue-theme:\s*(\d+(?:\.\d+)?)deg/)
if (!hueMatch) {
	console.error('--hue-theme 解析失败，脚本自身出错')
	process.exit(2)
}
const HUE = Number(hueMatch[1])

/**
 * 取出一个规则块的内容（不含花括号）。
 *
 * 用花括号深度计数而不是找第一个 `\n}`：`color.css` 里内嵌过带花括号的
 * 注释（--c-border-strong 上方那段），按行尾匹配会截在中途。
 * 同时剥掉注释，避免注释里的字面量被当成声明。
 */
function block(selectorRe) {
	const m = src.match(selectorRe)
	if (!m)
		return null
	const open = m.index + m[0].length - 1
	let depth = 0
	for (let i = open; i < src.length; i++) {
		const ch = src[i]
		if (ch === '{') {
			depth++
		}
		else if (ch === '}') {
			depth--
			if (depth === 0) {
				const body = src.slice(open + 1, i)
				return body.replace(/\/\*[\s\S]*?\*\//g, '')
			}
		}
	}
	return null
}

const light = block(/^\s*:root,[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*\.light\s*\{/m)
const dark = block(/^\s*\.dark\s*\{/m)
if (!light || !dark) {
	console.error('color.css 结构与预期不符，脚本自身出错')
	process.exit(2)
}

/**
 * 取令牌声明。
 *
 * 形如 `hsl(var(--hue-theme) 0% 46%)`：**色相是变量，字面上只有两个数字**
 * ——饱和度 0% 与明度 46%。按三个分量去捕获会永远匹配不上。
 * 色相统一按 `--hue-theme` 的字面值取（本文件是 220deg，两套主题一致）。
 */
function token(blockSrc, name) {
	// 前面必须落在行首或分隔符上：不能用 `\b`，`--c-bg` 的 `-` 两侧都是非单词
	// 字符，而 `\b` 只在单词/非单词之间成立。也不能直接锚定名字，否则
	// `--c-bg` 会先命中 `--c-bg-1`。
	const m = blockSrc.match(new RegExp(`(?:^|[\\s;])${name}:\\s*hsl\\(\\s*var\\(--hue-theme\\)\\s+([\\d.]+)%\\s+([\\d.]+)%`))
	if (!m)
		return null
	return [HUE, Number(m[1]), Number(m[2])]
}

function hslToRgb([h, s, l]) {
	s /= 100
	l /= 100
	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs((h / 60) % 2 - 1))
	const m = l - c / 2
	const hh = ((h % 360) + 360) % 360
	let r
	let g
	let b
	if (hh < 60)
		[r, g, b] = [c, x, 0]
	else if (hh < 120)
		[r, g, b] = [x, c, 0]
	else if (hh < 180)
		[r, g, b] = [0, c, x]
	else if (hh < 240)
		[r, g, b] = [0, x, c]
	else if (hh < 300)
		[r, g, b] = [x, 0, c]
	else [r, g, b] = [c, 0, x]
	return [r + m, g + m, b + m]
}

function relativeLuminance(rgb) {
	const [r, g, b] = rgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg, bg) {
	const a = relativeLuminance(hslToRgb(fg))
	const b = relativeLuminance(hslToRgb(bg))
	const hi = Math.max(a, b)
	const lo = Math.min(a, b)
	return (hi + 0.05) / (lo + 0.05)
}

/**
 * 要查的组合。`need` 按用途取：正文 4.5:1（WCAG 1.4.3），边界 3:1（1.4.11）。
 * 只列被大量消费、且实测过会出问题的令牌。
 */
const CHECKS = [
	{ fg: '--c-text-1', need: 4.5, why: '正文主色' },
	{ fg: '--c-text-2', need: 4.5, why: '次级文字' },
	{ fg: '--c-text-3', need: 4.5, why: '元信息（23 处消费）' },
	{ fg: '--c-primary', need: 4.5, why: '主色，作为文字/链接使用' },
	{ fg: '--c-border-strong', need: 3.0, why: '控件边界（26 处消费）' },
]

const THEMES = [
	{ name: 'light', src: light },
	{ name: 'dark', src: dark },
]

const failures = []

for (const theme of THEMES) {
	const bg = token(theme.src, '--c-bg')
	if (!bg) {
		console.error(`${theme.name} 的 --c-bg 解析失败，脚本自身出错`)
		process.exit(2)
	}

	console.log(`--- ${theme.name}（底色 --c-bg）---`)
	for (const { fg, need, why } of CHECKS) {
		const v = token(theme.src, fg)
		if (!v) {
			console.log(`  SKIP  ${fg} 不是 hsl(var(--hue-theme) …) 形态，本脚本算不了`)
			continue
		}
		const r = contrast(v, bg)
		const pass = r >= need
		if (!pass)
			failures.push(`${theme.name} 的 ${fg}：实测 ${r.toFixed(2)}:1 < 门槛 ${need}:1（${why}）`)
		console.log(`  ${pass ? 'OK  ' : 'FAIL'}  ${fg.padEnd(18)} ${r.toFixed(2).padStart(6)}:1  (需 ≥${need})  ${why}`)
	}
	console.log('')
}

if (failures.length) {
	console.log(`RESULT: FAIL - ${failures.length} 个组合不达标`)
	for (const f of failures)
		console.log(`  - ${f}`)
	process.exit(1)
}

console.log('RESULT: PASS - 核心令牌在两个主题下均达标')
