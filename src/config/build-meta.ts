/**
 * 构建期元信息：构建时间、git commit、框架版本。
 * 供设置面板的「关于」分类消费（见 `src/components/blog/SettingsPanel.astro`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ **只能被 frontmatter（构建期）import。绝不能被任何 `<script>` import。** ⚠️⚠️
 *
 * 本文件用 `node:child_process` / `node:fs`。一旦被组件的 `<script>` bundle 进去，
 * 浏览器端会报 `Module "node:child_process" has been externalized for browser
 * compatibility`，进而让**那个页面的脚本整块挂掉**（66/67 个页面抛
 * `ReferenceError` 的那次事故就是 `app-config.ts` 里的 `process.cwd()` 干的，
 * 详见该文件文件头）。
 *
 * 同一条约束对「页面顶层的 frontmatter」也成立：frontmatter 是构建期代码，
 * 它 import 本模块没问题，但**模块顶层不许碰 `document`**（没有）。
 *
 * ⚠️ **构建时间会让 `dist/` 不可复现**：同一份源码两次构建产物不同。
 * 这是有意接受的代价——「这个站是什么时候部署的」对读者是有意义的信息。
 * 但它意味着**不能拿 `git diff dist/` 当回归手段**。
 * 所以下面刻意把时间渲染成**纯文本**，绝不用 `<time datetime="…">`：
 * `check-dates.mjs` 会用 `html.match(/datetime="([^"]*)"/)` 取页面里**第一个**
 * 匹配并断言它是 frontmatter 的 `date` 派生的值，撞上就红。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// eslint 规则 `node/prefer-global/process` 要求显式 import 而不是用全局 `process`
// （与 `scripts/check-dates.mjs` 同一写法）。这也顺带把「本文件只能在 Node 里求值」
// 这件事写成了显式依赖，而不是靠约定。
import process from 'node:process'

/**
 * 仓库根目录。
 *
 * ⚠️ **不能用 `fileURLToPath(import.meta.url)` 往上数两级。**
 * Astro 的 frontmatter 是经 Vite SSR 打包执行的，`build-meta.ts` 会被并进一个
 * 临时 chunk，于是 `import.meta.url` 指向的是那个 chunk 的位置
 * （`node_modules/.vite/...`），往上两级根本不是仓库根。
 * 实测症状很有迷惑性：`new Date()` 之类的纯计算照常工作，只有依赖 `ROOT`
 * 的 `readCommit()` / `readAstroVersion()` 静默返回 `null`——
 * 因为它们都 `catch` 了，看起来像是「环境里没有 git / 没装 astro」。
 *
 * `process.cwd()` 在 `astro build` / `astro dev` 下就是项目根，可靠。
 * 加一层向上查找兜底：从子目录（比如 monorepo 里从包目录启动）也能用。
 *
 * ⚠️ `process` 只在构建期存在。这正是本文件**不能被 `<script>` import** 的
 * 另一个理由（另一个是 `node:child_process` / `node:fs`）。
 */
function resolveRoot(): string {
	let dir = process.cwd()
	// 最多向上找 5 层，再深就放弃
	for (let i = 0; i < 5; i++) {
		if (existsSync(join(dir, 'package.json')))
			return dir
		const parent = dirname(dir)
		if (parent === dir)
			break
		dir = parent
	}
	// 找不到就退回 cwd：下面的 read 函数各自 try/catch，不会因此炸掉
	return process.cwd()
}

const ROOT = resolveRoot()

/**
 * 本次构建的时间。
 *
 * 取的是**模块首次求值**的时刻：`astro build` 每次都是新进程，所以约等于构建开始时间；
 * `astro dev` 下则是 dev server 的启动时间（长跑的开发会话里会越来越"旧"）。
 * 想让 dev 下的时间刷新，重启 dev server 即可。
 */
export const builtAt = new Date().toISOString()

/**
 * git commit 短 SHA。
 *
 * 拿不到就返回 `null` 而不是抛错——CI 用浅克隆或 Docker 构建时未必有完整 git 环境，
 * 「关于」面板少一行不该让整站构建失败。同理，仓库本身也可能不在 git 里。
 */
function readCommit(): string | null {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8',
			// 关掉 stderr，否则 git 的报错会污染构建日志
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 5000,
		}).trim() || null
	}
	catch {
		return null
	}
}

/**
 * 框架实际解析到的版本。
 *
 * ⚠️ **不能直接读根 `package.json` 的 dependencies**：那里写的是
 * `astro: catalog:framework`（pnpm catalog 引用），读出来是字面量 "catalog:framework"
 * 而不是版本号。真正落地在 `node_modules/astro/package.json` 里，
 * pnpm 的符号链接 `readFileSync` 会跟过去。
 *
 * 拿不到时退回 `package.json` 里的原始声明（哪怕它只是个 catalog 别名），
 * 宁可显示得不够精确，也不要让这一格空着。
 */
function readAstroVersion(): string | null {
	try {
		const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'astro', 'package.json'), 'utf8'))
		return typeof pkg.version === 'string' ? pkg.version : null
	}
	catch {
		try {
			const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
			const spec = pkg.dependencies?.astro ?? pkg.devDependencies?.astro
			return typeof spec === 'string' ? spec.replace(/^[\^~]/, '') : null
		}
		catch {
			return null
		}
	}
}

export const buildMeta = {
	builtAt,
	commit: readCommit(),
	astroVersion: readAstroVersion(),
} as const
