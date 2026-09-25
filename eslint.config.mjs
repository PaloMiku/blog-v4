import antfu from '@antfu/eslint-config'

export default antfu({
	ignores: ['*.yaml', '.mimosa', '.qoder', '.zcode', '.playwright-mcp'],
	stylistic: {
		indent: 'tab',
	},
	pnpm: true,
	// @keep-sorted
	rules: {
		'yaml/indent': ['error', 2],
	},
}, {
	// vue/* 规则假设 Vue SFC AST，只能作用于 .vue，放进全局配置会令 markdown 等文件崩溃
	files: ['**/*.vue'],
	// @keep-sorted
	rules: {
		'vue/block-lang': ['warn', {
			script: { lang: ['ts', 'tsx'] },
			style: { lang: ['scss'] },
		}],
		'vue/enforce-style-attribute': ['warn', {
			allow: ['scoped'],
		}],
		'vue/html-indent': ['error', 'tab', { baseIndent: 0 }],
	},
}, {
	files: ['app/pages/**/*.vue'],
	rules: {
		'vue/valid-v-slot': 'off',
	},
}, {
	files: ['**/*.json'],
	ignores: ['content/**'],
	rules: {
		'jsonc/indent': ['error', 2],
		'style/eol-last': ['warn', 'never'],
	},
}, {
	files: ['content/**'],
	// @keep-sorted
	rules: {
		'antfu/consistent-list-newline': 'off',
		'eqeqeq': 'off',
		// 围栏代码块是文章内容而非项目源码，--fix 不得改写读者看到的示例
		'jsonc/indent': 'off',
		// MDC 以无空格的 #slot 行定义命名 slot（如 #default/#tab1），与本规则冲突
		'markdown/no-missing-atx-heading-space': 'off',
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
})
