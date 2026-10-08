/**
 * 仓库根、产物目录与路由映射的**唯一**解析处。
 *
 * ## 为什么必须是这一个文件
 *
 * 收敛前，40 个门禁脚本里「从 `import.meta.url` 求仓库根」有 **9 种不同写法**，
 * 其中两种走 `new URL('..', import.meta.url).pathname`：
 *
 *     new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')   // 12 个脚本
 *     fileURLToPath(new URL('..', import.meta.url))                            // 7 个脚本
 *
 * 它们在当前仓库路径 `D:\Projects\blog-v4` 下结果相同，所以**看不出区别**——
 * 但这不是等价，是巧合。实测：
 *
 *     new URL('..', 'file:///D:/x/probe%20root/…').pathname
 *       => /x/probe%20root/          ← 百分号编码、且不是 Windows 绝对路径
 *     fileURLToPath(new URL('..', 'file:///D:/x/probe%20root/…'))
 *       => D:\x\probe root\          ← 正确的原生绝对路径
 *
 * 也就是说**仓库一旦被 clone 到含空格或非 ASCII 字符的路径，12 个门禁会指向
 * 一个不存在的目录**，症状是 ENOENT 而不是任何像样的报错。
 * `fileURLToPath` 才是正解：它解码 percent-encoding 并按平台产出原生分隔符。
 *
 * 这条「本机一直绿 ≠ 判据与环境无关」（坑位 26 的同族）的教训值得记住：
 * 两种写法在开发机上完全等价，只有换路径才分道扬镳。
 *
 * ## 为什么路径必须从 `import.meta.url` 解析
 *
 * 不能用 `process.cwd()`。门禁既可能被 `accept.mjs` 以 `cwd: ROOT` 起，也可能被
 * 人从任意目录手工 `node scripts/xxx.mjs`；`check-runtime-dom.mjs:35` 与
 * `preview-guard.selftest.mjs:7` 现在就写着 `process.cwd()`，它们只是**恰好**
 * 总是被以仓库根为 CWD 调起。`Resolve-Path '..\x'` 跟的是进程 CWD 而不是脚本
 * 位置（坑位 25 已经为此付过一次学费）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 仓库根。`scripts/lib/paths.mjs` 在 `scripts/lib/` 下，所以要上溯两级。
 *
 * `fileURLToPath` 而不是 `.pathname` 的理由见文件头——这不是风格选择。
 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

/**
 * 构建产物目录。
 *
 * ⚠️ `dist` 在本机是一个**指向 `.output/public` 的符号链接**（Nuxt 时代留下的
 * 路径，`.gitignore` 忽略两者），而 `git ls-files -s dist` 无输出——那个
 * junction 没进仓库。所以**干净 checkout 里只有 `dist/`，`.output/public/`
 * 根本不存在**，本机两者却是同一份（坑位 34）。
 *
 * 于是读产物的门禁有两种正确写法：固定读 `dist`（CI 一定成立），或像
 * `check-critical-assets` 那样两个都认。**不要**因为本机 `dist` 是个链接就把
 * 读法改成 `.output/public`——那正是 `check-critical-assets` 初版栽的跟头，
 * 本机一路绿、推上去自我跳过、`skip: never` 判违规跳过、流水线红、deploy 被跳过。
 */
export const DIST = path.join(REPO_ROOT, 'dist')

/**
 * 产物目录的实际位置，**读产物前必须过一遍这个**。
 *
 * 返回第一个真实存在的候选；两个都不存在时返回 `undefined`，由调用方决定
 * 「我没跑」怎么编码（门禁里统一用 `SKIP:` 前缀 + exit 0，见 `accept.mjs`
 * 的 `SKIP_MARKERS`）。
 *
 * @returns {string | undefined} 存在的产物目录，或 undefined
 */
export function resolveDistDir() {
	return [DIST, path.join(REPO_ROOT, '.output/public')].find(d => fs.existsSync(d))
}

/**
 * 产物里的 `index.html` 相对路径 → 站点路由。
 *
 * ## 尾斜杠为什么必须在这里归一化
 *
 * `build.format: 'directory'` ⇒ 产物 URL **带尾斜杠**（`/foo/`），而
 * `Astro.url.pathname` 也带。凡是把 `path === item.url` 写成精确比较的地方，
 * 都要先过这个函数——否则首页会因为 `item.url` 恰好是 `/` 而**巧合正确**，
 * 其余页全错。
 *
 * 收敛前有 4 套实现，其中 `compare-remote-sitemap.mjs` 的反向构造还产出
 * **带**尾斜杠的 URL，另两处不产，两边对不上。现在只有这一份。
 *
 * 站点根必须留在 `/`：塌成空串会被下游的「非空串」过滤吃掉，于是首页从
 * 清单里消失。
 *
 * ⚠️ 这里**有意比收敛前的实现更严一档**：`'///'` 这类「全是斜杠」的输入，
 * 旧的 `compare-urls.mjs: normalizeUrl` 与 `check-aria-current.mjs: norm` 都返回
 * `''`（它们的守卫只挡 `''` 与 `'/'`，`'///'` 落到 `replace` 之后就是空串）。
 * 真实输入里不会出现这种路径，但既然已经收敛成一份，就把不变式补完整——
 * 剥完为空串时一律回 `/`。对拍 7 个真实输入与旧实现逐字相同。
 *
 * @param {string} p 路由或产物相对路径
 * @returns {string} 去掉尾斜杠的路由；站点根恒为 `/`
 */
export function toRoute(p) {
	const t = String(p).trim()
	if (t === '' || t === '/')
		return '/'
	const stripped = t.replace(/\/+$/, '')
	return stripped === '' ? '/' : stripped
}

/**
 * `dist/` 里的一个页面文件 → 它的路由。
 *
 * 传入绝对路径或相对 `DIST` 的路径都认。`index.html` 在根目录时映射到 `/`
 * 而不是 `''`（理由同 `toRoute`）。
 *
 * @param {string} file 页面文件路径
 * @returns {string} 站点路由
 */
export function fileToRoute(file) {
	const rel = path.relative(DIST, path.resolve(REPO_ROOT, file)).split(path.sep).join('/')
	if (rel === 'index.html')
		return '/'
	return `/${toRoute(rel.replace(/(^|\/)index\.html$/, '$1'))}`
}
