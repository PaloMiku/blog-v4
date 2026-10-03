/// <reference types="astro/client" />

/**
 * astro 7.3.5 不再提供 `declare module '*.astro'` 的 ambient 声明
 * （对整个 node_modules/astro 做 Select-String，`*.astro` 零命中），而 `.astro/`
 * 目录被 .gitignore 忽略、CI 也只在 build 时才重新生成它，所以这份 shim 必须入库：
 * 少了它 `tsc -p tsconfig.check.json` 会多报 29 个错（42 → 13），
 * 多出来的全是「找不到模块 '*.astro'」。
 */
declare module '*.astro' {
	const Component: import('astro/runtime/server/index.js').AstroComponentFactory
	export default Component
}
