// Node ESM resolve hook：让 `node --test` 能直接 import 仓库里的 `.ts` 源文件。
//
// 仓库源码沿用 Vite 风格的**无扩展名**相对 import（`'../../config/blog'`），
// 而 Node 原生 type stripping 要求扩展名可解析，两条规则补齐即可共存：
//   1. 默认解析失败（ERR_MODULE_NOT_FOUND）时，依次尝试补 `.ts` / `.js` / `.mjs`
//      以及 `<dir>/index.ts`——与 Vite 对这类裸目录/无扩展名的解析结果一致。
//   2. `astro:content` 虚拟模块映射到 `tests/stubs/astro-content.mjs`，
//      使 `src/lib/stats.ts`（经 `./content`）可被 plain Node 求值。
// 仅在默认解析失败后兜底，不改变任何正常解析路径。
const ASTRO_CONTENT_STUB = new URL('./stubs/astro-content.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
	if (specifier === 'astro:content')
		return { url: ASTRO_CONTENT_STUB, shortCircuit: true }

	try {
		return await nextResolve(specifier, context)
	}
	catch (err) {
		const recoverable = err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT'
		if (!(specifier.startsWith('.') || specifier.startsWith('/')) || !recoverable)
			throw err
		for (const candidate of [`${specifier}.ts`, `${specifier}.mjs`, `${specifier}.js`, `${specifier}/index.ts`]) {
			try {
				return await nextResolve(candidate, context)
			}
			catch {
				// 继续尝试下一个候选
			}
		}
		throw err
	}
}
