import antfu from '@antfu/eslint-config'
import css from '@zinkawaii/eslint-config-css'
import { defineConfig } from 'eslint/config'

// 2026-10-03 Astro 接管仓库根之后重写。改动理由：
//   - 删掉全部 `vue/*` 规则与 `app/pages/**/*.vue` 覆盖段：Nuxt 源码树（`app/`）已删除，
//     `src/` 下现在 **0 个 .vue 文件**（`vue()` 集成是最后残留，见下）。
//   - `content/**` → `src/content/**`：内容根搬了家。
//   - CSS 块从 `app/**/*.css` 改指 `src/styles/**/*.css`：那是现在唯一存活的 .css 来源；
//     组件内的 `<style>` 块由 audit-css-blocks.mjs 与 astro 自带的样式处理覆盖。
//
// `vue` / `@astrojs/vue` 这两个依赖现在只服务于 astro.config.mjs 里的 `vue()` 一行，
// 摘掉它是接管后的可选清理（先确认没有 .vue 文件，再删那两行），本次没做。

export default antfu({
	ignores: [
		'*.yaml',
		'.mimosa',
		'.qoder',
		'.zcode',
		'.playwright-mcp',
		// 工具/代理产生的一次性工作区，不入库也不受维护：
		// `.superpowers/sdd/` 里是 Task 6 的几何测量脚本（无头浏览器 dump 解析器），
		// `.astro-compare/` 是 accept 的构建日志与对比产物。两者都是 gitignored 的中间物，
		// lint 扫它们只会让 147 个 no-console 错误挡住真正的代码问题。
		'.superpowers/',
		'.astro-compare/',
	],
	stylistic: {
		indent: 'tab',
	},
	pnpm: true,
	jsonc: {
		overrides: {
			'jsonc/indent': ['error', 2],
		},
	},
	// @keep-sorted
	rules: {
		'yaml/indent': ['error', 2],
	},
}, {
	files: ['**/*.json'],
	ignores: ['src/content/**'],
	rules: {
		'style/eol-last': ['warn', 'never'],
	},
}, {
	files: ['src/content/**'],
	// @keep-sorted
	rules: {
		'antfu/consistent-list-newline': 'off',
		'e18e/prefer-includes': 'off',
		'eqeqeq': 'off',
		// MDX 里的一级标题由 frontmatter title 渲染，正文允许多个
		'markdown/heading-increment': 'off',
		// 保留文章中的占位链接、页内跳转和装饰性图标
		'markdown/no-empty-links': 'off',
		// JSX 组件的 props（如 <Badge img="…" link="…" />）会被 markdown 规则误判
		'markdown/no-missing-link-fragments': 'off',
		'markdown/no-multiple-h1': 'off',
		'markdown/require-alt-text': 'off',
		'no-irregular-whitespace': 'off',
		'no-sequences': 'off',
		'prefer-arrow-callback': 'off',
		'prefer-template': 'off',
		'style/indent': 'off',
		'style/no-mixed-spaces-and-tabs': 'off',
		'style/quotes': 'off',
		'style/semi': 'off',
		'unicorn/prefer-includes': 'off',
	},
}, {
	// 浏览器 bundle 的依赖边界（架构梳理 B2，client.ts 头注释 4.4KB 教训的规则化）：
	// 会进客户端 chunk 的模块不得 import 重依赖站点配置 / 域名解析库 / 构建期 barrel——
	// 违规曾静默地把 4.4KB 配置或整个 parse-domain 拖进客户端包，只能靠读注释防御。
	files: ['src/lib/client.ts', 'src/lib/client/**/*.ts'],
	rules: {
		'no-restricted-imports': ['error', {
			patterns: [
				{
					group: ['parse-domain', 'parse-domain/*'],
					message: 'parse-domain 会整包进客户端 chunk；用 client.ts 的内联实现。',
				},
				{
					group: ['**/config/blog', '**/config/blog.ts'],
					message: '站点整包配置会摇不进客户端（实测 4.4KB）；客户端模块用显式参数或模块内常量。',
				},
				{
					group: ['**/lib/shared', '**/lib/shared.ts', '**/lib/shared/time.ts'],
					message: 'shared barrel 顶层拖 config/blog 与 parse-domain；客户端只准用零依赖实现（client.ts）。',
				},
			],
		}],
	},
}).append({
	files: ['src/styles/**/*.css'],
	extends: defineConfig(css),
	rules: {
		'css/no-important': 'off',
		'css-stylistic/indentation': ['error', 'tab'],
	},
}).setDefaultIgnores(prevs => [
	...prevs,
	'**/*.css',
])
