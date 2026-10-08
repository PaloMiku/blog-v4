import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * UI 一致性门禁：线上 Nuxt 站点 vs 本地 Astro 产物，**断网**逐页比页高。
 *
 * ═══ 为什么需要第二个对比器 ═══
 *
 * `compare-page-heights.mjs`（真实网络）量的差值里混着两类东西：
 *   1. 站点真实差异（要修的 bug）
 *   2. 远程 CDN 资源加载时序差异（噪声）
 * 全站 63 页里只有 12 页判得出「可信」，剩下 19 页直接标 UNST——
 * 因为这个工具**分不清**这两类东西，于是 1 淹没在 2 里。
 *
 * 噪声的来源是可枚举的：
 *   - 图片：站点图片托管在 `blog-files.101045700.xyz` / `imgheybox.*`，
 *     CSS 只有 `max-width:100%; height:auto`，**没有占位高度**，
 *     未加载完时图片高度是 0，加载完跳到自然高度；
 *   - 字体：`s4.zstatic.net`（LXGW 霞鹜）、`fonts.googleapis.cn`（Noto/JetBrains/Ephesis）、
 *     `fonts.bytedance.com`（DOUYINSANSBOLD），全部按需远程加载；
 *   - 评论：Twikoo 走 `twikoo.sotkg.com`，渲染完高度完全不同。
 * 两侧主机不同（EdgeOne CDN vs localhost）→ 延迟不同 → 时序不同。
 *
 * ═══ 本门禁的做法 ═══
 *
 * 给 Chrome 加 `--host-resolver-rules`，把**除 localhost 以外的所有域名**
 * 解析到 `~NOTFOUND`。两侧于是都拿不到远程字体/图片/Twikoo：
 * 页面只剩本站自己的 DOM + CSS，高度只反映布局本身。
 *
 * 这不是把问题藏起来，是把**测量前提固定住**：
 * 剩下的差值必然来自标记或样式，而不是网络运气。
 *
 * ⚠️ 因此本门禁**不覆盖**：远程字体/图片/评论在真实网络下的行为。
 * 那部分由 `compare-page-heights.mjs`（live 模式）与 `live:*` 门禁负责。
 * 两个门禁职责不重叠，合起来才叫「与原 Nuxt 一致」。
 *
 * ═══ 前置自检（不许省） ═══
 *
 * `--host-resolver-rules` 一旦写错（比如 EXCLUDE 顺序反了把 localhost 也干掉），
 * 页面会加载失败或退化成 200px 的空白，而高度对比**照样能跑完**——
 * 于是"两边都是 500px"被判成"一致"。这正是 `compare-page-heights.mjs`
 * 交过学费的教训（`/about` 假报 -2259）。
 *
 * 所以开跑前先断言两件事，任一不成立直接非零退出：
 *   A. 隔离真的生效：跨域 fetch 必须失败
 *   B. 本地页面真的渲染出来了：`#blog-root` 必须存在且有子节点
 */
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { CDP, findBrowser, killTree, waitHttp } from './lib/cdp-session.mjs'
import { allPaths } from './lib/page-list.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import { requirePreviewSlot } from './lib/preview-guard.mjs'
import { argOf } from './lib/ui-parity-args.mjs'

const ROOT = REPO_ROOT
const REMOTE = 'https://blog.sotkg.com'

/** 断网模式下容差应该极小：没有远程字体/图片，两个站点量出同一个整数高度才对 */
const MODE = argOf('mode', 'offline')
const TOLERANCE = Number(argOf('tolerance', MODE === 'offline' ? 4 : 40))
const PORT = Number(argOf('port', '4391'))
const DEEP = Number(argOf('deep', '6'))

/**
 * 语义签名采集（可见的链接/按钮/输入/媒体/标题）。
 * 默认开，`--sem=off` 关。它和页高共用同一次浏览器访问，几乎不额外花钱。
 */
const SEM_ON = argOf('sem', 'on') !== 'off'

/**
 * 隔离假阳性的判定门槛：断网差值超差时自动用 **online** 复量一遍，
 * online 下落在 ±这个值以内就算「隔离造出来的」，不算站点差异。
 *
 * 40 不是随手取的整数：它就是本工具 `--mode=online` 一直以来的默认容差。
 * online 下两侧主机不同（EdgeOne CDN vs localhost），远程字体/图片/评论区
 * 的加载时序天然不同——这正是 `compare-page-heights.mjs` 分不开噪声、
 * 于是本工具才要断网的原因。断网量出的差值在 online 下就该落回这个量级。
 */
const ONLINE_RECHECK_TOLERANCE = Number(argOf('online-tolerance', 40))
/** `--recheck=off` 可以关掉自动复核（会明显变快，但差值得自己复核） */
const RECHECK = argOf('recheck', 'on') !== 'off'

/**
 * 隔离规则本身。抽成常量是因为**要按值把它从参数里剔掉**：
 * online 复核用的浏览器必须**没有**这条规则，参数却共用同一份数组。
 */
const OFFLINE_RULE = '--host-resolver-rules=EXCLUDE localhost,EXCLUDE 127.0.0.1,EXCLUDE blog.sotkg.com,MAP * ~NOTFOUND'

/** online 复核用的第二个浏览器，按需启动；见 `getOnlineSession()` */
let onlineSession = null
/**
 * 视口宽度。**默认 1600 不变**，所以既有基线不作废。
 *
 * 为什么加这个：这个工具此前把 1600×1000 硬编码在两处（L254 的 `--window-size`
 * 与 CDP 的 `Emulation.setDeviceMetricsOverride`），于是「桌面一致」被当成了
 * 「UI 一致」。站点里有大量 `@media (max-width: 768px)` 规则，桌面逐像素相等
 * **完全不能推出**移动端相等——断点写错、`hidden`/`display` 在窄屏下打架、
 * 栅格 `repeat(auto-fill, minmax(...))` 收缩塌陷，都只在窄屏显形。
 *
 * 窄屏运行必须写进**另一个文件**（见 outName），否则它会悄悄覆盖掉 1600px 的
 * 基线，下一个人读到的就是一份「60 页全绿」但量的是手机宽度的东西。
 */
const VIEW_W = Number(argOf('width', '1600'))
const VIEW_H = Number(argOf('height', '1000'))
// Desktop keeps the bare filename; a phone run gets its own. Referenced by BOTH
// output writers (page heights and styles), so it is defined up here.
const widthTag = VIEW_W === 1600 && VIEW_H === 1000 ? '' : `-w${VIEW_W}x${VIEW_H}`

/**
 * 主题。默认不覆盖（无头 Chrome 默认浅色），既有基线不作废。
 *
 * 两边默认都是「跟随系统」：Astro 的 `ThemeToggle.astro` 用
 * `window.matchMedia('(prefers-color-scheme: dark)')` 解析，Nuxt 侧是
 * `@nuxtjs/color-mode`。所以 `Emulation.setEmulatedMedia` 把这条媒体查询打开，
 * **两侧会对称地切到深色**——不需要往页面里注入 class，那会造成非对称。
 *
 * 这一维此前只做过源码级核对（`color.css` 逐字相同、`.dark` 规则集合相同、
 * 两边都把 `.dark` 挂在 `<html>` 上），**但从没量过深色下的渲染结果**。
 * 页高门禁对颜色完全瞎，而深色模式是「令牌换了整套值」的典型场景。
 *
 * ⚠️ 光靠源码相同不足以断言渲染相同，所以 preflight 会**验证 `.dark`
 * 真的挂上了**；没挂上就报错退出，而不是拿一份浅色结果当深色结论。
 */
const THEME = argOf('theme', '')
const themeTag = THEME ? `-${THEME}` : ''
const LOCAL = `http://localhost:${PORT}`
/**
 * 默认给两侧都加 `?shuffle=false`。
 *
 * `app.config.ts` 里 `link.randomInGroup: true`，而 FeedGroup 两侧都是
 * **挂载后**打乱组内顺序（Nuxt `onMounted` / Astro 原生脚本）。
 * 于是 `/link` 每次打开的卡片顺序都不同——实测同一页两次量到的第一张
 * `.feed-card` 分别是「南栀 / Space」和「陈郑逸 / 领域」。
 *
 * 这不是缺陷，是设计；但它意味着 `/link` 的**内容顺序**天然不可比。
 * 好在两侧都实现了同一个逃生口（Nuxt `route.query.shuffle !== 'false'`，
 * Astro `new URLSearchParams(location.search).get('shuffle') !== 'false'`），
 * 加上 `shuffle=false` 就能把顺序钉回配置顺序，两侧同时恢复可比。
 */
const QUERY = argOf('query', 'shuffle=false')

/**
 * 已知的、被用户明确接受的差异。**只列有据可查、且用户拍过板的。**
 *
 * 为什么要显式列出来，而不是默默放过：
 * 「这一页差 465px 但门禁是绿的」和「这一页差 0」在 CI 输出里长得一模一样，
 * 下一个人接手时无法分辨哪个是修好的、哪个是豁免的。
 * 列出来 = 差异有名字、有原因、有上限。
 *
 * `maxDelta` 是**上限而不是期望值**：超过它仍然判失败。
 * 没有上限的豁免项，迟早会盖住一个真 bug。
 */
const ACCEPTED = [
	// 这里曾经有过一条 `/2025/10/clarity-resource-list`、上限 600px 的豁免：
	// 「Nuxt 的 MDC 解析器没把 `# tab2`（注意那个前导空格）当插槽，渲出多余的
	// <h1>tab2</h1> + 默认展开的代码块（+465px）」。Nuxt 提交 1e78213 把空格去掉了，
	// 该差异**不再复现**：2026-10-03 实测该页 d=-10px，而 -10px 是每篇文章都有的
	// 分享按钮差值。
	//
	// 于是那条豁免变成了「一个 600px 的口子，只盖住一个 10px 的差」——正是本文件
	// 头部警告的那种「豁免盖住不相干的问题」。已删除。剩下的真实差异（tab2 面板里
	// 一个 hidden 的代码块）由 check-dead-css.ps1 的 $knownDelta 具名记录，那条
	// 记录同时给出了 0px 的页高证据。
	{
		path: '/2025/11/piece-hy1',
		maxDelta: 200,
		reason: '3 个 ::info-card（3 × 59px = 177px）。线上因 2026-09-30 移除 Bangumi 后拿不到数据，'
			+ '每张渲染成「暂时无法加载条目信息 + 重新加载」的错误卡；Astro 侧是空外壳。'
			+ '用户 2026-10-02 决定不复刻这个坏掉的错误卡。上限 200px 恰好覆盖 177px。',
	},
	{
		// 上限刻意只覆盖 info-card 本身（5 × 59 = 295px）。
		// 这一页**同时**还有未提交的内容改动（生产仍保留「## 相关条目」），
		// 那部分差值合计会超过 350px —— 也就是说，内容没提交部署之前，
		// 门禁会照红不误。那是应该的：差异是真的，不该被豁免盖住。
		path: '/2025/10/nukitashi-gv-end',
		maxDelta: 350,
		reason: '5 个 ::info-card（5 × 59px = 295px），同 piece-hy1，用户 2026-10-02 决定不复刻错误卡。'
			+ '上限 350px 只覆盖这部分；页面另有内容漂移（未提交的本地改动），不在豁免范围内。',
	},
]

/** 两侧必须用**完全相同**的查询串，否则本身就是一组不对称的实验条件 */
const withQuery = url => (QUERY ? `${url}${url.includes('?') ? '&' : '?'}${QUERY}` : url)

/*
 * 浏览器可执行文件、会话层（`CDP` / `killTree` / `waitHttp`）都在
 * `lib/cdp-session.mjs`——两个探针共用一份，见那里的边界说明。
 * 「找不到浏览器」的报错文案仍留在本文件，因为它属于本脚本的启动前置。
 */
const CHROME = findBrowser()
if (!CHROME) {
	console.error('FAIL: no chrome')
	process.exit(1)
}

/*
 * 开跑前先 `astro preview stop`。
 *
 * Astro 7.x 的 `astro preview` 自带一份「正在运行的 preview 服务器」登记表。
 * 端口空着、进程死了，**登记还在**；而这个检查是**跨端口**的——
 * 之前手工跑留下的 `localhost:4392` 会让这次请求 4391 的启动直接被拒：
 *
 *     Preview server already running at http://localhost:4392
 *     Run `astro preview stop` to stop it, or use `astro preview --force`
 *
 * `--force` 在这里不解决问题（实测仍然被拒），所以要先把陈年登记清掉。
 * 这也是 `acceptance.ps1` 里两道 live 门禁 2026-10-02 双双
 * `FAIL: preview never came up`（恰好 60.8s = waitHttp 超时）的真实原因。
 *
 * 两次弯路都记下来了：
 *   1. 我第一反应是去改门禁**执行顺序**，方向完全错，改完照样同样失败；
 *   2. 真正暴露问题的是给 preview 接上 stdout/stderr——原来 `stdio: 'ignore'`
 *      把这段提示整个丢掉了，只剩一句没有线索的报错。
 *
 * ⚠️ 但**不能无条件 stop**：那不看端口，会把用户为本项目手动起的 preview 一起杀掉，
 * 也会把并行跑的 probe-subtree（4393）正在用的那个杀掉。改成先问登记：
 * 只清自己端口的残留，遇到别人的直接 exit 2 拒绝。见 lib/preview-guard.mjs。
 */
requirePreviewSlot({ cwd: ROOT, port: PORT })

const previewLog = []
const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
	cwd: ROOT,
	shell: true,
	stdio: ['ignore', 'pipe', 'pipe'],
})
preview.stdout.on('data', d => previewLog.push(String(d)))
preview.stderr.on('data', d => previewLog.push(String(d)))
if (!await waitHttp(`${LOCAL}/`)) {
	console.error('FAIL: preview never came up')
	console.error(`      ${previewLog.join('').trim().split('\n').slice(-12).join('\n      ') || '(preview 没有输出任何内容)'}`)
	console.error(`      尝试地址 ${LOCAL}/  端口 ${PORT}`)
	killTree(preview)
	process.exit(1)
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-parity-'))
const dbg = 9640 + Math.floor(Math.random() * 60)
const chromeArgs = [
	'--headless=new',
	`--remote-debugging-port=${dbg}`,
	`--user-data-dir=${profile}`,
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-gpu',
	'--hide-scrollbars',
	/*
	 * 强制「减少动效」。两侧都会因此**跳过入场动画、直接呈现终态**。
	 *
	 * 起因：智能摘要在 Nuxt 侧是打字机动画（50ms/字符）。67 个字要打 3.35 秒，
	 * 而量测只等 2.5 秒——于是量到的是「才打了 59 个字」的中间态，
	 * 和 Astro 侧一次性输出的 67 字一比，凭空多出一条「文本不一致」。
	 * 这不是站点差异，是**量测时刻的差异**。
	 */
	'--force-prefers-reduced-motion',
	`--window-size=${VIEW_W},${VIEW_H}`,
	'about:blank',
]
if (MODE === 'offline') {
	/*
	 * EXCLUDE 必须排在 MAP * 前面：Chrome 的规则是**自上而下首次命中即生效**，
	 * `MAP * ~NOTFOUND` 放前面会把 localhost 一起打死，页面直接加载失败。
	 * 反过来（EXCLUDE 在后）本地服务正常、远程全挂，这才是我们要的。
	 *
	 * ⚠️ `blog.sotkg.com` 也必须 EXCLUDE：它就是**基线站点**本身。
	 * 第一版忘了排除，基线页同样解析失败、返回 Nuxt 自己的错误页
	 * （`div#main-message`，高 1000px = 视口高），于是每一页都报「差 1615px」。
	 * 差值全是假的，而工具本身跑得好好的——这正是必须做前置自检的理由。
	 * 注意只放行 apex：`twikoo.sotkg.com` 等仍要挡住。
	 */
	chromeArgs.unshift(OFFLINE_RULE)
}
const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' })

/*
 * 兜底清理。
 *
 * 之前只在正常路径末尾调 killTree，一旦中途抛未捕获异常
 * （实测过一次：`document.body` 为 null 抛原始 TypeError），
 * preview 服务与 headless Chrome 就**留在后台**：占用端口、留下临时 profile，
 * 下一次运行还会因为端口被占而连到上一次的残留实例，
 * 报出「本地页面没渲染出来」这种与本次改动毫无关系的错。
 *
 * 只杀**自己 spawn 出来的** PID 树。绝不能按进程名批量杀 chrome——
 * 那会连用户自己的浏览器一起杀掉（本轮已经犯过一次这个错）。
 */
let cleaned = false
function cleanup() {
	if (cleaned)
		return
	cleaned = true
	killTree(chrome)
	killTree(preview)
	// online 复核的浏览器是**第二个**进程树，同样只杀自己 spawn 出来的那个
	if (onlineSession) {
		killTree(onlineSession.proc)
		try {
			rmSync(onlineSession.prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
		}
		catch { /* 尽力而为 */ }
	}
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
	}
	catch { /* 尽力而为 */ }
}
process.on('uncaughtException', (err) => {
	console.error(`FAIL: ${err?.message || err}`)
	cleanup()
	process.exit(1)
})
process.on('unhandledRejection', (err) => {
	console.error(`FAIL: ${err?.message || err}`)
	cleanup()
	process.exit(1)
})
for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		cleanup()
		process.exit(130)
	})
}

async function waitDevtools() {
	const dl = Date.now() + 30000
	while (Date.now() < dl) {
		try {
			const j = await (await fetch(`http://127.0.0.1:${dbg}/json/version`)).json()
			if (j.webSocketDebuggerUrl)
				return j.webSocketDebuggerUrl
		}
		catch { /* 还没起来 */ }
		await sleep(250)
	}
	return null
}

const wsUrl = await waitDevtools()
if (!wsUrl) {
	console.error('FAIL: devtools never came up')
	killTree(chrome)
	killTree(preview)
	process.exit(1)
}

const cdp = await CDP.connect(wsUrl)
const sid = await cdp.openPage()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false }, sid)
// 主题走 prefers-color-scheme，两边默认都是「跟随系统」，所以这是对称开关
if (THEME)
	await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] }, sid)

async function evaluate(expression, awaitPromise = false) {
	const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise,
	}, sid)
	if (exceptionDetails)
		throw new Error(exceptionDetails.exception?.description || exceptionDetails.text)
	return result.value
}

/* ── online 复核用的第二个浏览器 ──────────────────────────────────────────────
 *
 * 断网模式是**故意**的：两侧主机不同，远程字体/图片/评论区的加载时序天然不同，
 * 不隔离就分不清「站点差异」和「时序噪声」。但隔离本身也会造假：
 *
 *   实测 /2025/10/lemmy-fediverse-deploy
 *     offline：线上 9645 / 本地 9626 → -19px
 *     online ：线上 9971 / 本地 9971 →   0px（`.article` 两侧都是 8444）
 *
 * 机制：线上那篇文章的正文里有靠远程资源才达到的最终排版，隔离后**线上自己**
 * 反而高了 19.03px；Astro 侧不受影响。差值方向是「Astro 更矮」，很容易被读成
 * 「Astro 少渲染了什么」，而实际上什么都没少。
 *
 * 所以：**断网量出的差值必须用 online 复核再定性**（§76.4 的规矩）。
 * 以前这一步靠人记得做，于是 -19px 在基线里躺了好几轮。现在工具自己复核。
 *
 * 为什么要**另起一个浏览器**：`--host-resolver-rules` 是启动参数，
 * 没法在运行中的实例上去掉或加上。
 */
async function getOnlineSession() {
	if (onlineSession)
		return onlineSession
	const port = 9700 + Math.floor(Math.random() * 60)
	const prof = mkdtempSync(join(tmpdir(), 'cdp-online-'))
	const args = chromeArgs
		.filter(a => a !== OFFLINE_RULE)
		.map(a => a === `--remote-debugging-port=${dbg}`
			? `--remote-debugging-port=${port}`
			: a === `--user-data-dir=${profile}` ? `--user-data-dir=${prof}` : a)
	const proc = spawn(CHROME, args, { stdio: 'ignore' })

	const dl = Date.now() + 30000
	let ws = null
	while (Date.now() < dl) {
		try {
			const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
			if (j.webSocketDebuggerUrl) {
				ws = j.webSocketDebuggerUrl
				break
			}
		}
		catch { /* 还没起来 */ }
		await sleep(250)
	}
	if (!ws) {
		killTree(proc)
		try {
			rmSync(prof, { recursive: true, force: true })
		}
		catch { /* 尽力而为 */ }
		throw new Error('online 复核用的 chrome 没起来（30s）')
	}

	const conn = await CDP.connect(ws)
	const s = await conn.openPage()
	await conn.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false }, s)
	if (THEME)
		await conn.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] }, s)
	const ev = async (expression, awaitPromise = false) => {
		const { result, exceptionDetails } = await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, s)
		if (exceptionDetails)
			throw new Error(exceptionDetails.exception?.description || exceptionDetails.text)
		return result.value
	}
	onlineSession = { proc, prof, conn, s, ev }
	return onlineSession
}

/** online 下的页高，连量两遍取一致值（与 `measureStable` 同一口径）。 */
async function measureStableOnline(url) {
	const o = await getOnlineSession()
	const once = async () => {
		await o.conn.send('Page.navigate', { url }, o.s)
		for (let i = 0; i < 150; i++) {
			if (await o.ev('document.readyState') === 'complete')
				break
			await sleep(200)
		}
		await sleep(2500)
		// online 下必须等远程图片，否则量到的是没加载完的半成品
		await o.ev(`(async () => {
			const imgs = [...document.images].filter(i => !i.complete || i.naturalWidth === 0)
			await Promise.race([
				Promise.all(imgs.map(i => i.decode().catch(() => {}))),
				new Promise(r => setTimeout(r, 15000)),
			])
		})()`, true)
		await sleep(500)
		return o.ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')
	}
	const a = await once()
	const b = await once()
	return { h: a, b, stable: Math.abs(a - b) <= 2 }
}

// ── 前置自检 ────────────────────────────────────────────────────────────────
async function preflight() {
	if (MODE === 'offline') {
		const reached = await evaluate(`(async () => {
			const probe = (u) => Promise.race([
				fetch(u, { mode: 'no-cors' }).then(() => 'REACHED', () => 'BLOCKED'),
				new Promise(r => setTimeout(() => r('TIMEOUT'), 6000)),
			])
			return await probe('https://twikoo.sotkg.com/')
		})()`, true)
		if (reached === 'REACHED') {
			console.error('FAIL: 跨域请求没有被拦截（fetch 成功），断网隔离未生效。')
			console.error('      host-resolver-rules 没起作用，继续跑出来的差值全部不可信。')
			killTree(chrome)
			killTree(preview)
			process.exit(1)
		}
		if (reached === 'TIMEOUT') {
			console.error('FAIL: 跨域 fetch 超时，无法判断隔离是否生效。宁可报错也不猜。')
			killTree(chrome)
			killTree(preview)
			process.exit(1)
		}
		console.log(`preflight: 隔离生效（跨域 fetch -> ${reached}）`)
	}

	// 本地页面必须真的渲染出来，而不是一个空壳
	//
	// `document.body` 可能为 null：导航刚发出、文档还没建好。
	// 第一版直接读 `document.body.scrollHeight`，于是抛一个
	// `Cannot read properties of null` 的原始 TypeError —— 报错信息里
	// 完全看不出是「页面没加载出来」，读的人会以为工具坏了。
	// 这里改成：等 body 出现（最多再等 5s），仍没有就明确报错退出。
	//
	// ⚠️ 导航本身不能省。改这段时我一度把 `Page.navigate` 连同 readyState
	// 循环一起删掉了，于是页面停在 about:blank，报错却说「本地页面没渲染出来」——
	// 指向完全错误的方向。诊断输出里的 `url: about:blank` 才是真正的线索。
	await cdp.send('Page.navigate', { url: `${LOCAL}/` }, sid)
	for (let i = 0; i < 150; i++) {
		if (await evaluate('document.readyState') === 'complete')
			break
		await sleep(200)
	}
	let rendered = null
	for (let attempt = 0; attempt < 25; attempt++) {
		rendered = await evaluate(`(() => {
			if (!document.body)
				return null
			const root = document.getElementById('blog-root')
			return {
				ok: !!root,
				kids: root ? root.children.length : 0,
				h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
				// 失败时把「这到底是什么页面」一并带出来。只报「没渲染出来」
				// 等于让人猜：404？SPA 回退？空壳？还是根本没导航过去？
				title: document.title,
				url: location.href,
				head: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
			}
		})()`)
		if (rendered)
			break
		await sleep(200)
	}
	if (!rendered) {
		console.error('FAIL: 本地页面没有 document.body —— 导航没生效（preview 服务可能没起来）。')
		cleanup()
		process.exit(1)
	}
	if (!rendered.ok || rendered.kids < 3) {
		console.error(`FAIL: 本地页面没渲染出来（#blog-root 存在=${rendered.ok} 子节点=${rendered.kids}）。`)
		console.error('      对比无法进行——两边都空的话「高度一致」是假的。')
		console.error(`      title: ${rendered.title}`)
		console.error(`      url  : ${rendered.url}`)
		console.error(`      正文 : ${rendered.head}`)
		cleanup()
		process.exit(1)
	}
	console.log(`preflight: 本地渲染正常（#blog-root ${rendered.kids} 个子节点，高 ${rendered.h}px）`)

	// 主题自检：请求了 --theme 就必须真的切过去
	//
	// 这一条不能省。「源码里 dark 规则一样」不等于「渲染出来一样」，而如果
	// `setEmulatedMedia` 静默失效（参数名写错、站点改了默认主题），两侧都会
	// 停在浅色——于是你会拿到一份 63 页全绿、实际量了两次浅色的「深色结论」。
	// 这正是本项目栽过最多次的那类坑：仪器没在测目标，却报得很漂亮。
	if (THEME) {
		const want = THEME === 'dark'
		const isDark = await evaluate('document.documentElement.classList.contains(\'dark\')')
		if (isDark !== want) {
			console.error(`FAIL: --theme=${THEME} 没有生效（<html> 上 ${want ? '没有' : '有'} .dark）。`)
			console.error('      继续跑出来的差值全部是浅色 vs 浅色，不作结论。')
			console.error('      查两件事：Emulation.setEmulatedMedia 的值，站点默认主题是否还是「跟随系统」。')
			cleanup()
			process.exit(1)
		}
		console.log(`preflight: 主题已生效（<html class="${THEME}">）`)
	}
}

await preflight()

/**
 * `--styles`：比**计算样式**，不比页高。
 *
 * 为什么必须另做一道：页高对「盒子有多大」极灵敏，却对「盒子长什么样」
 * 完全无感。一条只写 `color` / `border-radius` / `box-shadow` 的 scoped 死规则，
 * 高度一毫米都不会动——而这类死规则恰恰是本项目反复踩的坑（§47、§50.10）。
 * 现有的 `dom-probe.mjs` 只比 head meta、几何与元素计数，也不含任何计算样式。
 * 于是「样式层不一致」在现有门禁里是**完全不可见**的。
 *
 * 做法：对一组语义选择器取前 N 个匹配元素，比它们的计算样式。
 * 断网条件同样成立——否则远程字体的实际字形会左右 font 相关的计算值。
 *
 * ⚠️ 只取「前 N 个」而不是全部：两侧 DOM 节点数本来就不一样
 * （Astro 会多插 `<script>`，Nuxt 会插 `<!--[-->` 片段标记），
 * 按序号全量对齐必然错位。逐选择器比对 + 数量对齐是可用的口径。
 */
const STYLES = process.argv.includes('--styles')
/*
 * 2026-10-03 试过给 `styleOf` 加「轮询到结构稳定」的等待（`--settle` / `--stable-rounds`），
 * 动机是怀疑「引用整段到评论区」按钮在 hydration 未完成时被测到。
 * **已回退**：把首次等待压到 0ms（`--settle=0 --stable-rounds=1`，连侧栏那 500ms 之外什么都不等）
 * 仍然复现不出那 4 条差异，而线上 5 次独立导航 + 探针在 1600×1000 断网隔离下逐项相同。
 * 也就是说「等待不足」这个假设**不成立**，加那套逻辑只是凭空多花 ~1.2s/页，
 * 没有被证明能防住任何东西。**未被证明有用的防御性代码不要留在门禁里。**
 * 详见 findings §82.8。
 */
const STYLE_PROPS = [
	'color',
	'background-color',
	'border-top-width',
	'border-top-style',
	'border-top-color',
	'border-bottom-width',
	'border-bottom-style',
	'border-bottom-color',
	'border-left-width',
	'border-right-width',
	'border-radius',
	'box-shadow',
	'opacity',
	'font-size',
	'font-weight',
	'font-style',
	// 换行相关的这一组是实测补上的：同样宽、同样字体、同样的文字，
	// Nuxt 折 3 行 Astro 折 2 行（86px vs 58px）——高度对比只能定位到段落，
	// 真正的原因只可能在这些属性上。原列表里一个都没有。
	'line-height',
	'word-break',
	'overflow-wrap',
	'word-wrap',
	'white-space',
	'text-indent',
	'text-align',
	'text-decoration-line',
	'text-transform',
	'letter-spacing',
	'list-style-type',
	'outline-color',
	// 盒模型这一组是补上的「观测缺口」，理由很具体：
	// `/link` 少的那 8px 来自 `FeedGroup` 顶层 `:deep(.feed-card.feed-card){margin:0}`
	// 在 Astro 侧丢了 scope 锚点、变成全站生效，于是 `/link` 上那张不在组内的独立
	// 卡片丢了 `margin:1em auto`。**`.feed-card` 本来就在下面的 STYLE_SELECTORS 里**，
	// 可它比的是颜色/边框/字体/换行，一个 margin 属性都没有——于是这条缺陷在样式层
	// 完全隐形，只能以「整页少 8px」的形式冒出来，而页高对比又不告诉你是哪个盒子。
	// 那 8px 前后查了好几轮（§52.6 只推到「间距 16 vs 8」，仍说不出多出来的 8 来自哪），
	// 最后靠 `probe-subtree --mode=profile` 的垂直剖面才定位。
	//
	// 换句话说：不是差异小，是**量它的仪器没有这一维**。补上。
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
]
const STYLE_ACCEPTED = [
	{
		sel: '.article p',
		reason: '数量差，来自 §55 的 info-card 决定：线上每张加载失败的 info-card 里'
			+ '有一个 `<p class="info-card-error-text">`，Astro 侧是空壳没有这个 `p`。'
			+ '仅影响 nukitashi-gv-end(×5) 与 piece-hy1(×3) 两页。',
	},
	{
		sel: '.hide-above-mobile',
		prop: 'line-height',
		reason: '左下角侧栏开关按钮。Nuxt 31.36px / Astro 22.4px，但**渲染几何完全相同**：'
			+ '两侧盒子都是 42.88×42.88（1600 下按钮被 `hide-above-tablet` 隐藏、量不到，'
			+ '只有 390×844 这一趟会报）。差别只在 line-height 这个**计算值**上——'
			+ 'Nuxt 那边的 strut 没参与行盒高度，Astro 侧 `BlogPanel.astro` 显式写了 '
			+ '`line-height: 1`。用户看得见的是盒子，不是这个值。'
			+ '本轮重新量过分布坐实：toggle-sidebar 按钮 42.88×42.88 两侧一致，'
			+ '同一选择器下的 skip-link（390×50.39）也一致。'
			+ '**别为了让它变绿而把 BlogPanel 的 `line-height: 1` 改回去**——'
			+ '那是当初 §73 定位 +8.9px 时定下的值，改回去会让移动端面板高度变化。',
	},
	{
		sel: '.gradient-card',
		prop: 'text-align',
		reason: '侧栏搜索按钮。Nuxt 源码里 `.search-btn{text-align:start}` 是存在的，'
			+ '编译后落在 `/_nuxt/default.z4v_I5lo.css`，而**页面根本没有引用这个 chunk**'
			+ '（实测：12 个被引用的 CSS 里没有任何一个含 `.search-btn`）。'
			+ '于是线上这条规则从未生效，按钮落回 UA 默认的 `text-align:center`。'
			+ 'Astro 按源码如实应用，差异来自线上构建漏链样式表，不是迁移缺陷——'
			+ '刻意复刻等于故意让一条规则失效。故记录在案，不改。',
	},
]

const STYLE_SELECTORS = [
	'body',
	'a.skip-link',
	'#main-content',
	'.blog-header',
	'.blog-aside',
	'#blog-sidebar',
	'.blog-footer',
	'.post-list',
	'.post-card',
	'.post-title',
	'.post-header',
	'.post-meta',
	'.post-footer',
	'.md-excerpt',
	'article.article',
	'.post-cover',
	'.surround-post',
	'.article h1',
	'.article h2',
	'.article h3',
	'.article h4',
	'.article p',
	'.article a',
	'.article ul',
	'.article ol',
	'.article li',
	'.article blockquote',
	'.article img',
	'.article pre',
	'.article code',
	'.article table',
	'.article hr',
	'.feed-group',
	'.feed-title',
	'.feed-card',
	'.copy',
	'.copy .prompt',
	'.copy .code',
	'.tabs',
	'.tabs button',
	'.tab-content',
	'.z-comment',
	'.z-comment h3',
	'#twikoo',
	'.card',
	'.button',
	'.tip',
	'.alert',
	'.badge',
	'.banner',
	'.gradient-card',
	'.prose',
	'.prose p',
	'.prose a',
	'.prose h2',
	'.prose h3',
	'.prose code',
	'.prose pre',
	'.text-creative',
	'.text-center',
	'.hide-above-mobile',
	'.skip-link',

	/*
	 * ── 侧栏内部（2026-10-03 补）────────────────────────────────
	 *
	 * 之前这张表里有 `#blog-sidebar` 和 `.blog-footer` 两个**外框**，
	 * 侧栏里的 16 个组件一个都没有。于是「侧栏每个导航项高 8.6px」
	 * 这一处肉眼明显的差异，样式对比报了 63/66 全绿——
	 * **量了外框，没量框里的东西。**
	 *
	 * 物证：`probe-subtree.mjs --sel='.sidebar-nav'` 在 1600×1000 下量到
	 * 每个 `a.sidebar-nav-item` 线上 38px / Astro 46.6px，
	 * 6 个导航项累积 51.6px，`.menu` 整体 +43.1px。
	 * 根因指向图标盒：线上 `span.iconify` 高 21.6（= `.sidebar-nav` 的
	 * 0.9em × 16px × 1.5），Astro 是 `span.nav-icon` 包着 `svg.iconify` 高 30.2。
	 *
	 * 教训与坑位 6/7 同源：**仪器没有这一维，不等于这一维没问题。**
	 * 「外框一致」很容易被读成「这个组件一致」。
	 */
	'.sidebar-nav',
	'.sidebar-nav li',
	'.sidebar-nav h3',
	'.sidebar-nav-item',
	'.sidebar-nav-item-parent',
	'.sidebar-nav-leaf',
	'.sidebar-subnav',
	'.sidebar-subnav li',
	'.sidebar-nav .nav-text',
	'.sidebar-nav .nav-text-wrap',
	'.sidebar-nav .external-tip',
	'.search-btn',
	'.sidebar-nav .kbd',
	'.footer-nav',
	'.footer-nav menu',
	'.footer-nav hgroup',
	'.sidebar-footer',

	/*
	 * ── 第二次补（2026-10-03，普查驱动）──────────────────────────
	 *
	 * 上一批 17 条是**照着 `BlogSidebar.astro` 的结构想的**，结果又漏了一层：
	 * 页脚真正的样式承载者是 `<menu>` 里的 `<a>`，而我只补到了
	 * `.footer-nav` / `.footer-nav menu` 两个**外框**。
	 * 反向测试注入的 `padding: 0.7em` 正好写在那个 `<a>` 上，
	 * 门禁于是从头到尾没看见它——**补了 17 条、补的全是框。**
	 *
	 * 教训：不能靠「读一遍组件结构」来决定测量清单。
	 * 改用 `_probe-side-dom` 遍历 `#blog-sidebar` 整棵子树、
	 * 按 `tag.class` 汇总两侧签名，拿一张 53 行的普查表当依据。
	 * 清单里每一行都要能指着普查表说「这条两侧同名」。
	 *
	 * ⚠️ `.footer-nav` 是**页面底部**（`footer.blog-footer > nav.footer-nav`），
	 *    不在 `#blog-sidebar` 里；侧栏那个页脚是 `footer.sidebar-footer`。
	 *    两者是两个地方，别补串了。
	 */
	'.sidebar-footer menu',
	'.sidebar-footer menu a',
	'.blog-text',
	'.header-title',
	'.header-subtitle',
	'.blog-logo',
	'.theme-toggle',
	'.split-char',

	/*
	 * **故意不收** `.nav-icon` 与 `.nav-toggle-icon`。
	 * 它们是 Astro 侧为了补 attribute fallthrough 而加的包装层类名，
	 * 线上对应的是 `.iconify`（由 `@nuxt/icon` 渲染）——**两侧类名不同**，
	 * 选择器跨侧匹配不上，只会被报成「本地有、线上没有」的元素数量差。
	 * 那是**假差异**，把它塞进表里等于给门禁装一个永远红的红灯。
	 *
	 * 这两个盒子的几何改用 `probe-subtree.mjs --sel='#blog-sidebar'` 核对：
	 * 2026-10-03 逐节点量下来，侧栏内**再无任何高度差**
	 * （导航项 38=38、图标盒 21.5938=21.5938、页脚 105.5=105.5）。
	 *
	 * **判据只能落在跨侧同名的东西上。** 这是「同一个 DOM 概念在两侧名字不同」
	 * 这类差异的通用处理：要么让两边同名，要么换个仪器，别放进按名索骥的表。
	 */
]
// 每个选择器取**头 3 个 + 尾 3 个**可见元素作为样本。
// 样本只用于回「报的是哪一条」；检测靠 dist（全部可见元素的取值分布），
// 所以尾部元素是否被采样不影响检出，只影响定位精度。
const STYLE_CAP = 3

/**
 * 把一组取值压成「值×次数」的短摘要，最多列 3 项。
 *
 * 分布差异要能一眼看出「哪一侧多了哪个值」才有诊断价值：
 * 线上 82 个 0px + 1 个 16px、Astro 83 个 0px，直接说「数组不相等」等于没说。
 */
function freqText(values) {
	const m = new Map()
	for (const v of values) m.set(v, (m.get(v) || 0) + 1)
	const parts = [...m.entries()]
		.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
		.map(([v, c]) => `${v}×${c}`)
	return parts.length > 3 ? `${parts.slice(0, 3).join(' ')} …(共 ${parts.length} 种)` : parts.join(' ')
}

if (STYLES) {
	const styleProbe = `(() => {
		const sels = ${JSON.stringify(STYLE_SELECTORS)}
		const props = ${JSON.stringify(STYLE_PROPS)}
		const cap = ${STYLE_CAP}
		const visible = (e) => {
			if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true')
				return false
			const cs = getComputedStyle(e)
			if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
				return false
			return e.getClientRects().length > 0
		}
		const out = {}
		for (const sel of sels) {
			const all = [...document.querySelectorAll(sel)]
			// 先过滤可见、再取样本。原先是 all.slice(0, cap) 之后才 visible()，
			// 于是在「隐藏外壳排在前面」时 cap 全被隐藏元素吃光。
			const vis = all.filter(visible)
			// dist = 全部可见元素的取值分布，用来做**检测**；
			// items 只是头尾各若干条的样本，用来回「报的是哪一条」。
			//
			// 为什么要 dist：原先只有头部采样，于是「第 4 个及之后」的缺陷结构性不可见。
			// 实测 /link：FeedGroup 渲染在 Tab 之外（link.astro:58-65），
			// 前若干个 .feed-card 全是组内卡片（两侧 margin 都是 0），
			// 而真正有问题的那张独立卡片排在**尾部**——它被 FeedGroup 顶层那条
			// :deep(.feed-card.feed-card){margin:0} 丢了 scope 锚点而丢了 margin:1em auto。
			// cap=3 永远采不到它，于是样式层报 0 差异，整页却少 8px。
			// 分布比对不需要配对，也不会漏尾部。
			const dist = {}
			for (const p of props) dist[p] = []
			for (const e of vis) {
				const cs = getComputedStyle(e)
				for (const p of props) dist[p].push(cs[p])
			}
			for (const p of props) dist[p].sort()
			const sample = [...vis.slice(0, cap), ...vis.slice(-cap)]
			const items = []
			const taken = new Set()
			for (const e of sample) {
				if (taken.has(e))
					continue
				taken.add(e)
				const cs = getComputedStyle(e)
				const o = {}
				for (const p of props) o[p] = cs[p]
				// 文本签名：用于把两侧的元素**按内容**配对，而不是按下标。
				// 实测 /2025/11/piece-hy1 线上有 13 个可见的 article p、Astro 只有 10 个，
				// 按下标比会把完全不同的两段文字当成同一个元素，
				// 报出「font-size 12.96 vs 16px、text-indent 0 vs 32px」这种
				// **完全由错位产生的假差异**。与 §56.4 是同一个教训。
				// 注意本段在模板字符串里，不能出现反引号。
				o.sig = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
				items.push(o)
			}
			out[sel] = { count: all.length, visible: vis.length, items, dist }
		}
		return out
	})()`

	const styleOf = async (url) => {
		await cdp.send('Page.navigate', { url }, sid)
		for (let i = 0; i < 150; i++) {
			if (await evaluate('document.readyState') === 'complete')
				break
			await sleep(200)
		}
		await sleep(2000)
		/*
		 * 侧栏必须先强制进入「已显示」状态，否则它整块会被跳过。
		 *
		 * `#blog-sidebar` 默认 `visibility: hidden`（Nuxt 与 Astro **两边都一样**，
		 * 各自靠 `layoutStore.state === 'sidebar'` 决定要不要挂 `show` 类）。
		 * 无头浏览器里没人移动鼠标、没人滚动，那个状态切换不会发生，
		 * 于是 `#blog-sidebar` 及其所有后代都过不了 `visible()`，
		 * `nv.visible === 0` 直接 `continue`。
		 *
		 * **⇒ 侧栏从来没有被样式对比比较过，在任何视口下都没有。**
		 * 2026-10-03 用户肉眼看出「侧栏间距和下部组件不一致」，
		 * 正是落在这个洞里：每个导航项比线上高 8.64px、页脚高 20.5px，
		 * 而门禁报 63/66 全绿。
		 *
		 * `show` 是**两侧同名**的真实状态（`BlogSidebar.vue:123` /
		 * `BlogSidebar.astro:363` 都是 `classList.toggle('show', …)`），
		 * 所以这里加的是「把页面摆到用户看到的样子」，不是改判定标准。
		 * sleep 要盖过 `transition: visibility .2s`。
		 */
		await evaluate('(() => { const s = document.getElementById(\'blog-sidebar\'); if (s) s.classList.add(\'show\'); return !!s })()')
		await sleep(500)
		const rootOk = await evaluate('!!document.getElementById("blog-root")')
		if (!rootOk)
			return null

		return evaluate(styleProbe)
	}

	const stylePaths = (await allPaths(REMOTE)).filter(p => !argOf('urls') || argOf('urls').split(',').includes(p))
	console.log(`\nUI style parity: ${stylePaths.length} urls, ${STYLE_PROPS.length} props x ${STYLE_SELECTORS.length} selectors (cap ${STYLE_CAP})\n`)

	const diffs = []
	// 跨页汇总已接受的差异，所以声明必须在循环外
	const acceptedSeen = new Map()
	for (const [i, path] of stylePaths.entries()) {
		if (!existsSync(join(ROOT, 'dist', path.replace(/^\//, ''), 'index.html')) && !existsSync(join(ROOT, 'dist', `${path.replace(/^\//, '')}.html`)))
			continue
		const n = await styleOf(withQuery(REMOTE + path))
		const a = await styleOf(withQuery(LOCAL + path))
		if (!n || !a) {
			console.error(`FAIL: ${path} 有一侧不是正常页面，停止（不产出结论）`)
			killTree(chrome)
			killTree(preview)
			process.exit(1)
		}
		const pageDiffs = []
		// 本页已经按 (sel, prop) 报过的组合，分布比对要跳过，避免同一处差异报两遍
		const reported = new Set()

		/*
		 * `--debug-sel=<css>`：把该选择器在两侧的**原始**数据整份打出来。
		 *
		 * 为什么要有它：报告里的 `nuxt=0px×1 astro=28.8px×1` 是**频率摘要**，
		 * 而且 `[0]` 只是多重集路径的占位下标、不是「第 0 个元素」。
		 * 摘要回答不了「到底是哪几个元素、各自是什么值」，
		 * 于是只能靠猜——2026-10-03 为 `clarity-resource-list` 的 4 条
		 * `padding-right` 差异，先后排除了「字体」「hydration 时机」
		 * 「offline 隔离」「视口」四个假设，最后独立探针量到两侧逐项相同，
		 * 才发现是假阳性。**判据不一致时，先把原始数据摆出来。**
		 */
		const dbgSel = argOf('debug-sel', '')
		if (dbgSel) {
			for (const side of [['nuxt', n], ['astro', a]]) {
				const d = side[1][dbgSel]
				if (!d) {
					console.log(`  [debug] ${path} ${side[0]} ${dbgSel}: 该选择器在页面里不存在`)
					continue
				}
				console.log(`  [debug] ${path} ${side[0]} ${dbgSel}: count=${d.count} visible=${d.visible} 样本=${d.items.length}`)
				for (const it of d.items) console.log(`         sig="${it.sig}"  padding-right=${it['padding-right']}`)
				const dd = d.dist && d.dist['padding-right']
				if (dd)
					console.log(`         dist[padding-right] = ${JSON.stringify(dd)}`)
			}
		}
		let hiddenOnly = 0
		for (const sel of STYLE_SELECTORS) {
			const nv = n[sel]
			const av = a[sel]
			if (nv.visible !== av.visible) {
				const allowCount = STYLE_ACCEPTED.find(a => a.sel === sel && !a.prop)
				if (allowCount)
					acceptedSeen.set(`${sel}.count`, { sel, prop: 'count', reason: allowCount.reason })
				else
					pageDiffs.push({ sel, kind: 'count', nuxt: nv.visible, astro: av.visible })
			}
			else if (nv.count !== av.count) {
				// 总数不同但**可见数相同** → 差的是隐藏外壳。
				// SSG 必然把弹层（搜索框提示条、评论区确认框…）静态输出，
				// Nuxt 是用到才渲染。这是架构差异，不是缺陷，
				// 原版按 `count` 统计，于是全站 63 页各报 4 条、合计 252 条噪声，
				// 把真正的样式差异淹在里面。改成按**可见元素**比。
				hiddenOnly++
			}
			if (nv.visible === 0)
				continue
			if (nv.visible !== av.visible) {
				// 可见元素数量不同 → 两边不是同一批元素，逐项比样式只会产出
				// 「把 A 段和 B 段当成同一段」的假差异。数量差异上面已经报过了，这里直接跳过。
				continue
			}
			// 权威判定先行：先算出哪些属性的**全量取值分布**两侧不同。
			//
			// 这条门槛是必需的，因为「文本签名」不是可靠的元素键：同一选择器下
			// 文本完全相同的元素可以有多个（本轮实测三类）——
			//   · /link 的 37 张 .feed-card 里有两张签名相同（390 那一趟）
			//   · /link 的两个 .gradient-card（侧栏搜索按钮 + 搜索框里的那个）
			//   · /games/galgames/riddle-joker 的若干 .article p
			// 对这类元素，逐元素配对（无论按下标还是按签名）都可能把 A 配成 B。
			//
			// 若某个属性的**全量分布相同**，那么它与「逐元素不同」之间的唯一区别
			// 就是：同样的取值在**文本互不区分**的元素之间发生了置换。
			// 文本都一样 => 用户看不出哪张是哪张 => 置换不可见 => 不该报。
			// 这不是放水：分布不同的情况（真的多了一张 / 少了一张 / 某个值变了）
			// 一律照报，§76 的 FeedGroup 缺陷正是靠这一条被抓住的。
			const distDiff = new Set()
			for (const p of STYLE_PROPS) {
				const nd = nv.dist?.[p]
				const ad = av.dist?.[p]
				if (!nd || !ad || nd.length !== ad.length)
					continue
				if (nd.every((v, i) => v === ad[i]))
					continue
				distDiff.add(p)
			}

			// 按文本签名分桶，然后**逐桶比取值的多重集**，而不是按桶内下标配对。
			//
			// 为什么必须这么改：签名取 `textContent` 前 40 字符，**可以重复**。
			// 实测 /link（390×844）：37 张 `.feed-card` 里有两张签名相同，而两侧桶内
			// 顺序不同（线上 `[14.4px, 16px]`、Astro `[16px, 14.4px]`）。原来的
			// `bucket.find(it => !usedA.has(it))` 按插入顺序取，把这两张配反，
			// 报出 13 条**完全由配对产生的假差异**——font-size / line-height /
			// text-align / list-style-type / margin ×4 / padding ×4，
			// 全部落在 `nth = 2`。
			//
			// 三条独立证据说明它是假阳性：
			//   1) 同一个 sel.prop 的**全量取值分布**两侧逐项相同
			//      （14.4px ×36 + 16px、20.16px ×36 + 22.4px、center ×36 + start、
			//        0px ×36 + 16px + 67px、宽 84.1 ×36 + 224）；
			//   2) 37 张卡的几何逐张相同（84.1×100，x = 16 / 107.3 / 198.6 …）；
			//   3) online 与 offline 两种隔离模式下分布都相同 —— 不是断网假阳性。
			//
			// 改成多重集比较后的语义是明确的：
			//   多重集相同 ⇒ 该签名下不存在任何取值差异，不产出 diff；
			//   多重集不同 ⇒ 报一次，并给出两侧的取值。
			// 某一侧整桶缺失（真·少元素）时退回按下标配对；
			// 少掉的数量本身已经由上面的 `visible` 计数检查单独报出，不会漏。
			const bucketOf = (items) => {
				const m = new Map()
				for (const it of items) {
					if (!m.has(it.sig))
						m.set(it.sig, [])
					m.get(it.sig).push(it)
				}
				return m
			}
			/**
				* 报一条差异：命中接受表就记为 accepted，否则进 pageDiffs。
				* 抽成函数是因为「多重集不等」与「按下标配对不等」两条路径要共用。
			 */
			const reportOne = (sel2, prop, nv2, av2, nth, fallback) => {
				const allow = STYLE_ACCEPTED.find(x => x.sel === sel2 && x.prop === prop)
				if (allow) {
					acceptedSeen.set(`${sel2}.${prop}`, { sel: sel2, prop, reason: allow.reason })
				}
				else {
					reported.add(`${sel2}.${prop}`)
					pageDiffs.push({ sel: sel2, kind: 'style', nth, prop, nuxt: nv2, astro: av2, fallback })
				}
			}
			const byN = bucketOf(nv.items)
			const byA = bucketOf(av.items)
			for (const [sig, xs] of byN) {
				const ys = byA.get(sig)
				if (!ys || ys.length !== xs.length) {
					// 桶缺失或长度不等 → 这个签名下确实是不同的元素集合，退回按下标配对
					for (let k = 0; k < xs.length; k++) {
						const y = (ys && ys[k]) || av.items[nv.items.indexOf(xs[k])]
						if (!y)
							continue
						for (const p of STYLE_PROPS) {
							if (!distDiff.has(p))
								continue
							if (xs[k][p] === y[p])
								continue
							reportOne(sel, p, xs[k][p], y[p], k, !ys)
						}
					}
					continue
				}
				// 桶内长度相同 → 逐属性比多重集。
				// 注意这里的 `nth` 恒为 0：多重集比较**不建立元素级配对**，
				// 两侧取值直接以 freqText（`值×次数` 形式）给出。
				// 下游打印成 `[0].prop` 只是占位，真正要看的是 nuxt/astro 两串取值。
				for (const p of STYLE_PROPS) {
					if (!distDiff.has(p))
						continue
					const xv = xs.map(it => it[p]).sort()
					const yv = ys.map(it => it[p]).sort()
					if (xv.every((v, i) => v === yv[i]))
						continue
					reportOne(sel, p, freqText(xv), freqText(yv), 0, false)
				}
			}
			// 全量取值分布比对：抓「样本没采到」的那一类差异
			for (const p of STYLE_PROPS) {
				if (reported.has(`${sel}.${p}`))
					continue
				const allow = STYLE_ACCEPTED.find(a => a.sel === sel && a.prop === p)
				if (allow) {
					acceptedSeen.set(`${sel}.${p}`, { sel, prop: p, reason: allow.reason })
					continue
				}
				const nd = nv.dist?.[p]
				const ad = av.dist?.[p]
				if (!nd || !ad || nd.length !== ad.length)
					continue
				if (nd.every((v, i) => v === ad[i]))
					continue
				pageDiffs.push({ sel, kind: 'dist', prop: p, nuxt: freqText(nd), astro: freqText(ad) })
			}
		}
		if (pageDiffs.length) {
			diffs.push({ path, pageDiffs })
			console.log(`  DIFF ${String(pageDiffs.length).padStart(4)}  ${path}${hiddenOnly ? `   (另有 ${hiddenOnly} 处仅隐藏元素数量不同，不计)` : ''}`)
			for (const d of pageDiffs.slice(0, 12)) {
				const where = d.kind === 'style' ? ` [${d.nth}].${d.prop}` : d.kind === 'dist' ? ` (全量分布).${d.prop}` : ''
				console.log(`        ${d.sel}${where}  nuxt=${d.nuxt}  astro=${d.astro}`)
			}
			if (pageDiffs.length > 12)
				console.log(`        ... 另有 ${pageDiffs.length - 12} 处`)
		}
		else {
			console.log(`   ok       ${path}`)
		}
		process.stdout.write('')
		void i
	}
	console.log(`\n===== UI style parity =====`)
	console.log(`  有差异的页面: ${diffs.length} / ${stylePaths.length}`)
	if (acceptedSeen.size) {
		console.log(`  已接受的差异（线上构建缺陷，用户/源码判定）: ${acceptedSeen.size} 类`)
		for (const a of acceptedSeen.values())
			console.log(`      ${a.sel}.${a.prop}\n        ${a.reason}`)
	}
	// Same hazard as the page-height output: a phone-width run must not quietly
	// replace the desktop styles baseline. Desktop keeps the bare name.
	const styleName = `style-parity${widthTag}${themeTag}.json`
	writeFileSync(join(ROOT, '.astro-compare', styleName), JSON.stringify({ viewport: { width: VIEW_W, height: VIEW_H }, theme: THEME || 'default', pages: diffs }, null, 2))
	console.log(`\n  已写入 .astro-compare/${styleName}  (viewport ${VIEW_W}x${VIEW_H}, theme ${THEME || 'default'})`)
	killTree(chrome)
	killTree(preview)
	for (let i = 0; i < 5; i++) {
		try {
			rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
			break
		}
		catch { await sleep(400) }
	}
	/*
	 * 样式对比走完就退出，不与页高对比串在同一进程里：
	 * 两者都要独占 dist 的 preview 服务与浏览器实例，串起来只会让
	 * 单页耗时翻倍，而且一旦红了很难判断是哪一种对比出的问题。
	 */
	process.exit(diffs.length ? 1 : 0)
}

/**
 * 逐区块量高。
 *
 * 单独一个「页高差 465px」没法定位，必须能指出差在哪个盒子上。
 * 遍历 body / #blog-root / #main-content 三层的直接子级——
 * 页面的块级结构就在这三层，再往里就是内容自身了。
 */
const BLOCK_PROBE = `(() => {
	const name = (e) => {
		const id = e.id ? '#' + e.id : ''
		const cls = (e.className && typeof e.className === 'string')
			? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.')
			: ''
		return (e.tagName.toLowerCase() + id + cls).slice(0, 64)
	}
	const blocks = []
	for (const root of [document.body, document.getElementById('blog-root'), document.getElementById('main-content')]) {
		if (!root) continue
		for (const e of root.children) {
			const r = e.getBoundingClientRect()
			if (r.height < 4) continue
			blocks.push({
				owner: root.id || root.tagName.toLowerCase(),
				name: name(e),
				h: Math.round(r.height),
				nodes: e.querySelectorAll('*').length,
			})
		}
	}
	const root = document.getElementById('blog-root')
	/* ── 语义签名：可交互 / 标题 / 媒体元素的多重集 ──
	 *
	 * 为什么要它：页高只看**总高度**，样式对比只看 STYLE_SELECTORS 里那几十个
	 * 选择器。于是「少了一个链接 / 少了一个按钮 / 少了一张图的 alt」这一类差异
	 * **两道门禁都看不见**——除非那个选择器恰好在表里。
	 *
	 * 只收**可见**元素：弹层、搜索框、评论引用按钮这些在 Astro 侧是静态输出、
	 * 在 Nuxt 侧是 client-only，两边都不可见，比它们只会得到纯噪声。
	 * （先在静态 HTML 上试过这个想法，结论是不可行，理由见 lib/page-list.mjs
	 * 与 findings §78：Nuxt Content 的 anchorLinks 是**构建期**产物、
	 * 进 SSR HTML，而 Astro 侧是**运行时**增强——渲染结果一致，HTML 却不同。）
	 */
	const SEM_RULES = {
		a: ['href', 'aria-current', 'aria-label'],
		button: ['aria-label', 'aria-expanded'],
		input: ['name', 'placeholder', 'aria-label'],
		select: ['name', 'aria-label'],
		textarea: ['name', 'aria-label'],
		img: ['src', 'alt'],
		iframe: ['src'],
		audio: ['src'],
		video: ['src'],
		h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
		summary: [], label: [],
	}
	const SEM_TEXT = { h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, summary: 1, label: 1 }
	const semVisible = (e) => {
		if (e.closest('[hidden]'))
			return false
		if (e.getAttribute('aria-hidden') === 'true')
			return false
		const cs = getComputedStyle(e)
		if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
			return false
		return e.getClientRects().length > 0
	}
	const semUrl = (v) => {
		if (!v) return ''
		let s = v.trim()
		if (/^(https?:)?\\/\\//i.test(s) || s.startsWith('http')) {
			try { const u = new URL(s, location.href); s = u.pathname + u.search } catch (e) { /* 原样 */ }
		}
		return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s
	}
	const semText = (e) => (e.textContent || '').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 40)
	const sem = []
	if (${SEM_ON ? 'true' : 'false'}) {
		for (const e of document.querySelectorAll('a,button,input,select,textarea,img,iframe,audio,video,h1,h2,h3,h4,h5,h6,summary,label')) {
			const t = e.tagName.toLowerCase()
			if (e.closest('template,svg')) continue
			if (!semVisible(e)) continue
			const parts = SEM_RULES[t].map((k) => (k === 'href' || k === 'src') ? semUrl(e.getAttribute(k)) : (e.getAttribute(k) || '').trim())
			if (SEM_TEXT[t]) parts.push(semText(e))
			sem.push(t + '|' + parts.join('|'))
		}
	}
	return {
		h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
		rootOk: !!root,
		rootKids: root ? root.children.length : 0,
		blocks,
		sem,
	}
})()`

async function measure(url) {
	await cdp.send('Page.navigate', { url }, sid)
	for (let i = 0; i < 150; i++) {
		if (await evaluate('document.readyState') === 'complete')
			break
		await sleep(200)
	}
	// 两侧等待必须一致：Astro 侧同样有 Mermaid、灯箱、代码折叠等异步渲染
	await sleep(2500)
	if (MODE !== 'offline') {
		await evaluate(`(async () => {
			const imgs = [...document.images].filter(i => !i.complete || i.naturalWidth === 0)
			await Promise.race([
				Promise.all(imgs.map(i => i.decode().catch(() => {}))),
				new Promise(r => setTimeout(r, 15000)),
			])
		})()`, true)
		await sleep(500)
	}
	// 滚到底再回顶，逼出懒加载与 IntersectionObserver 渲染的内容
	await evaluate(`(async () => {
		const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
		for (let y = 0; y < H; y += window.innerHeight * 0.85) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) }
		window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 250))
	})()`, true)
	await sleep(300)
	return evaluate(BLOCK_PROBE)
}

/**
 * 连量 N 遍取一致值。
 *
 * 断网模式下没有远程资源抢带宽，多次结果本该逐像素相同；实测不到就说明
 * 页面里还有别的异步渲染没稳定（mermaid / 灯箱 / 图表），**不下结论**。
 *
 * ⚠️ N 必须是 **3**，而且判据必须是**最大值 − 最小值**，不是「相邻两次之差」。
 * 原来只量 2 次、判 |a−b| ≤ 2，结果被 `/link` 撕开一个 44px 的口子：
 *
 *   线上 /link @390（offline）连装 10 次：
 *     2677 2677 2677 2674 2633 2654 2650 2670 2674 2674     ← 跨度 44px
 *   而每一次装载**内部**连采 5 次（间隔 1s）都完全相同。
 *
 * 也就是说这不是「动画还没停」，而是**每次装载的结果本身就不一样**。
 * 63 页那一趟恰好抽到 2674/2674 两次相邻一致的读数，于是报出一条
 * 「astro 矮 20px」的漂亮差异——**全是噪声**。本地 Astro 侧 5 次装载恒为
 * 同一个值，抖的一直只有线上。
 *
 * 「两次读数一致」不等于「页面是确定的」：只要抖动是间歇的，相邻两次落在
 * 同一档的概率相当高。判据必须落在**多次读数的分布**上，
 * 和样式门禁的 `distDiff` 是同一个道理——先看全量分布，再谈逐元素。
 */
const STABILITY = Number(argOf('stability', 2))
const SAMPLES = Math.max(2, Number(argOf('samples', 3)))

async function measureStable(url) {
	const hs = []
	let last = null
	for (let i = 0; i < SAMPLES; i++) {
		last = await measure(url)
		hs.push(last.h)
	}
	const min = Math.min(...hs)
	const max = Math.max(...hs)
	return {
		h: last.h,
		blocks: last.blocks,
		sem: last.sem,
		stable: max - min <= STABILITY,
		min,
		max,
		samples: hs,
		rootOk: last.rootOk,
		rootKids: last.rootKids,
	}
}

/**
 * 语义签名多重集之差。
 *
 * 比多重集而不是按下标配对：同一个选择器下完全相同的链接/按钮可以有很多个
 * （侧栏导航、卡片列表、代码块里的重复「复制」），按下标会把 A 配成 B，
 * 报出一堆**由错位产生的假差异**（与 §76.4 同一个教训）。
 * 分布相同而逐元素不同只可能是「同样内容的元素之间发生了置换」，不可见。
 */
function semDiff(remoteList = [], localList = []) {
	const r = new Map()
	const l = new Map()
	for (const s of remoteList) r.set(s, (r.get(s) || 0) + 1)
	for (const s of localList) l.set(s, (l.get(s) || 0) + 1)
	const out = []
	for (const k of [...new Set([...r.keys(), ...l.keys()])].sort()) {
		const rc = r.get(k) || 0
		const lc = l.get(k) || 0
		if (rc !== lc)
			out.push({ sig: k, nuxt: rc, astro: lc })
	}
	return out
}

/**
 * 两侧都必须是**真的站点页面**，不是错误页 / 空壳。
 *
 * 这一条不是保险，是上一版 bug 的直接产物：基线被自己的隔离规则打死时，
 * 工具把 Nuxt 的错误页（`#main-message`，1000px）当成了正常基线，
 * 于是每一页都报出漂亮的「差异」，全部是假的。
 * 页面结构不对时唯一正确的做法是停下来报错，不是继续算差值。
 */
function assertRealPage(measure_, url, side) {
	if (measure_.rootOk && measure_.rootKids >= 3)
		return
	console.error(`\nFAIL: ${side} 侧不是正常页面：${url}`)
	console.error(`      #blog-root 存在=${measure_.rootOk} 子节点=${measure_.rootKids} 页高=${measure_.h}px`)
	console.error('      基线或候选端出错了（错误页 / CDN 拦截 / 构建产物缺失）。继续比差值只会得到假结论。')
	killTree(chrome)
	killTree(preview)
	process.exit(1)
}

/*
 * 受测页面清单在 `scripts/lib/page-list.mjs`（sitemap + 三个被 robots
 * `Disallow` 挡住的 preview 页）。原来这里只取 sitemap，于是 previews
 * 从来没被量过——`/preview` 的 h1 少了一整个「返回首页」链接就是这样漏掉的。
 */
const all = await allPaths(REMOTE)
const filter = argOf('urls')
const paths = filter ? all.filter(p => filter.split(',').includes(p)) : all
console.log(`\nUI parity [mode=${MODE}]  ${paths.length} urls, tolerance ${TOLERANCE}px\n`)

const rows = []
const skipped = []
for (const [i, path] of paths.entries()) {
	const rel = path.replace(/^\//, '')
	if (!existsSync(join(ROOT, 'dist', rel, 'index.html')) && !existsSync(join(ROOT, 'dist', `${rel}.html`))) {
		skipped.push(path)
		continue
	}
	const n = await measureStable(withQuery(REMOTE + path))
	const a = await measureStable(withQuery(LOCAL + path))
	assertRealPage(n, withQuery(REMOTE + path), '线上（Nuxt 基线）')
	assertRealPage(a, withQuery(LOCAL + path), '本地（Astro 候选）')
	const d = a.h - n.h
	const usable = n.stable && a.stable
	const within = usable && Math.abs(d) <= TOLERANCE
	// 豁免项只在**差值没有超过各自上限**时才算数；超限仍然判失败
	const acc = within ? null : ACCEPTED.find(a => a.path === path)
	const known = !!acc && usable && Math.abs(d) <= acc.maxDelta

	/*
	 * 隔离假阳性复核：断网超差时用 online 再量一遍。
	 * online 落在容差内 → 这是隔离造出来的，记为 `artifact`，**不算站点差异**；
	 * online 仍然超差 → 保留原判定，并把两个数一起打出来供对照。
	 */
	let artifact = null
	if (MODE === 'offline' && RECHECK && usable && !within && !known) {
		const on = await measureStableOnline(withQuery(REMOTE + path))
		const oa = await measureStableOnline(withQuery(LOCAL + path))
		const od = oa.h - on.h
		const onOk = on.stable && oa.stable && Math.abs(od) <= ONLINE_RECHECK_TOLERANCE
		artifact = { nuxt: on.h, astro: oa.h, d: od, stable: on.stable && oa.stable, ok: onOk }
		if (onOk) {
			console.log(`         ↳ online 复核：nuxt ${on.h} astro ${oa.h} d=${od}px（±${ONLINE_RECHECK_TOLERANCE} 内）→ 判为隔离假阳性`)
		}
		else {
			console.log(`         ↳ online 复核：nuxt ${on.h} astro ${oa.h} d=${od}px —— 仍然超差，按站点差异处理`)
		}
	}

	const semD = SEM_ON ? semDiff(n.sem, a.sem) : []
	const row = {
		path,
		nuxt: n.h,
		astro: a.h,
		d,
		usable,
		ok: within || !!artifact?.ok,
		known,
		artifact,
		sem: semD,
		nuxtSamples: n.samples,
		astroSamples: a.samples,
		reason: acc?.reason,
	}
	rows.push(row)
	const semFlag = semD.length ? ` SEM+${semD.length}` : ''
	const flag = !usable ? 'UNST' : within ? ' ok ' : artifact?.ok ? 'ARTIF' : known ? 'KNOWN' : 'DIFF'
	// UNST 时把多次读数直接摊在这一行，省掉一次「回头翻日志」
	const rangeFlag = usable ? '' : `  [${n.samples.join('/')} | ${a.samples.join('/')}]`
	process.stdout.write(`  [${String(i + 1).padStart(2)}/${paths.length}] ${flag} ${String(Math.round(d)).padStart(7)}  nuxt ${String(n.h).padStart(6)} astro ${String(a.h).padStart(6)}  ${path}${semFlag}${rangeFlag}\n`)
}

const unstable = rows.filter(r => !r.usable)
const known = rows.filter(r => r.known)
const artifacts = rows.filter(r => r.artifact?.ok)
const semBad = SEM_ON ? rows.filter(r => r.sem.length) : []
const bad = rows.filter(r => !r.ok && !r.known && r.usable).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
const good = rows.filter(r => r.ok)

console.log(`\n===== UI parity [${MODE}] =====`)
console.log(`  对比 : ${rows.length}`)
console.log(`  一致 (|d| <= ${TOLERANCE}) : ${good.length}`)
console.log(`  超差 : ${bad.length}`)
if (artifacts.length) {
	/*
	 * 隔离假阳性必须**单独列出来**，不能悄悄并进「一致」。
	 * 理由：这些页在断网下确实有差值，而这个差值不是站点差异。
	 * 混进「一致」里，读者就看不出这一页曾经红过；混进「超差」里，
	 * 又会让人以为站点有 bug 而去改本来正确的代码。
	 */
	console.log(`  隔离假阳性（断网超差、online 复核落在 ±${ONLINE_RECHECK_TOLERANCE} 内）: ${artifacts.length}`)
	for (const r of artifacts)
		console.log(`      ${r.path}  断网 ${Math.round(r.d)}px → online ${r.artifact.d}px（nuxt ${r.artifact.nuxt} / astro ${r.artifact.astro}）`)
}
if (SEM_ON) {
	console.log(`  语义签名不一致 : ${semBad.length}`)
	for (const r of semBad) {
		console.log(`      ${r.path}  (${r.sem.length})`)
		for (const s of r.sem.slice(0, 12))
			console.log(`         ${s.sig}\n            线上 ${s.nuxt} / 本地 ${s.astro}`)
		if (r.sem.length > 12)
			console.log(`         … 另 ${r.sem.length - 12} 条`)
	}
}
if (skipped.length) {
	/*
	 * 跳过的页面必须**显眼**，并且最好让门禁变红。
	 *
	 * 2026-10-02 踩过：上一次 acceptance 在 `pnpm build` 中途被杀，`dist/` 只写了
	 * 一半，于是这次跳过 24 页、只比了 39 页——而它照样打印出
	 * 「对比 : 39 / 一致 : 30 / 超差 : 7」这样**格式完全正常**的结论，
	 * 被当成结果读了两轮。
	 *
	 * 少比 24 个页面却报「超差 7」，看起来反而像好消息——
	 * 分母藏起来的时候，人只会看分子的绝对值。
	 */
	console.log(`  ⚠⚠ 跳过 ${skipped.length} 页（本地无对应产物）—— 本次结论只覆盖 ${rows.length} 页，不是全站`)
	for (const p of skipped)
		console.log(`      ${p}`)
}
if (known.length) {
	console.log(`  已接受（用户拍板，有上限）: ${known.length}`)
	for (const r of known) {
		console.log(`      ${r.path}  ${Math.round(r.d)}px（上限 ±${ACCEPTED.find(a => a.path === r.path).maxDelta}）`)
		console.log(`        ${r.reason}`)
	}
}
if (unstable.length) {
	/*
	 * 「读不出来」和「读出来是 0」是两回事，必须分开说。
	 * 原话术是「两侧各自连测不一致（页面仍有未稳定的异步渲染）」，
	 * 而 `/link` 的实测是**每次装载结果就不一样**、装载内部反而稳定——
	 * 话术指向错方向，会让人去查动画/懒加载。
	 * 所以这里直接把 N 次读数摊开，让「抖动」和「没停」一眼能分开。
	 */
	console.log(`  ⚠ 多次装载结果不一致（极差 > ${STABILITY}px），不作结论 : ${unstable.length}`)
	for (const r of unstable) {
		const spread = v => Math.max(...v) - Math.min(...v)
		console.log(`      ${r.path}`)
		console.log(`         线上 ${r.nuxtSamples.join(' / ')}  极差 ${spread(r.nuxtSamples)}`)
		console.log(`         本地 ${r.astroSamples.join(' / ')}  极差 ${spread(r.astroSamples)}`)
	}
}

// 超差的页面直接给出逐区块对照，省掉一个「跑 diag 再回头」的往返
if (bad.length && DEEP > 0) {
	console.log(`\n  --- 逐区块定位（前 ${DEEP} 页）---`)
	for (const row of bad.slice(0, DEEP)) {
		const n = await measure(withQuery(REMOTE + row.path))
		const a = await measure(withQuery(LOCAL + row.path))
		console.log(`\n  ${row.path}   总差 ${Math.round(row.d)}px`)
		const names = new Set([...n.blocks.map(b => b.name), ...a.blocks.map(b => b.name)])
		for (const nm of names) {
			const nb = n.blocks.find(b => b.name === nm)
			const ab = a.blocks.find(b => b.name === nm)
			if (!nb || !ab) {
				// 标签方向别写反：`nb` 缺失 = **线上没有**这个块，也就是**只有 Astro 有**。
				// 第一版写反了，把「Astro 多渲染了一个 249px 的 section」报成「仅线上有」，
				// 差点把方向读反——工具把话说错，比不说更贵。
				const onlyAstro = !nb
				console.log(`      ${onlyAstro ? ' - ' : '   '} ${nb ? `nuxt ${String(nb.h).padStart(6)}` : 'nuxt      -'}  ${ab ? `astro ${String(ab.h).padStart(6)}` : 'astro     -'}   ${nm}  ${onlyAstro ? '<- 仅 Astro 有' : '<- 仅线上有'}`)
				continue
			}
			const dd = ab.h - nb.h
			const mark = Math.abs(dd) > 8 ? '***' : '   '
			const note = nb.nodes !== ab.nodes ? `  (节点数 ${nb.nodes} -> ${ab.nodes})` : ''
			console.log(`    ${mark} nuxt ${String(nb.h).padStart(6)}  astro ${String(ab.h).padStart(6)}  d ${String(dd).padStart(6)}   ${nm}${note}`)
		}
	}
}

if (skipped.length) {
	console.log(`\n  --- 跳过（本地无对应产物，未被验证）: ${skipped.length} ---`)
	for (const p of skipped)
		console.log(`    ${p}`)
}

/**
 * `--sel=` 节点级下钻：把某个容器两侧的**直接子节点**逐个并排。
 *
 * 区块级差异（-10px）看不出是什么：可能是某个子块多了一行、某个
 * margin 没生效、某个元素多出一个边框。按序号并排 + 带上首段文本，
 * 一眼能对上是谁多谁少。
 */
const SEL = argOf('sel')

/**
 * `--census=<selector>`：对两侧该选择器的**所有后代**做 `tag.class` 普查并对比。
 *
 * 为什么不用字符串切片去数：§62.3 试过，同一页先后量出
 * 「文章区内 113 vs 0」与「全文件 316 vs 204」两个互相矛盾的结果——
 * 因为 `<article>` 在 Astro 产物里的闭合位置和 Nuxt 不同，
 * `IndexOf('post-footer')` 当边界靠不住。切片不可信就别拿它下结论。
 * 浏览器的 DOM 是唯一可信的观测源。
 */
const CENSUS = argOf('census')
if (CENSUS) {
	const censusProbe = `(() => {
		const root = document.querySelector(${JSON.stringify(CENSUS)})
		if (!root) return null
		const counts = {}
		for (const e of root.querySelectorAll('*')) {
			const cls = (typeof e.className === 'string' && e.className.trim())
				? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.')
				: ''
			const key = e.tagName.toLowerCase() + cls
			counts[key] = (counts[key] || 0) + 1
		}
		return counts
	})()`
	const censusOf = async (url) => {
		await cdp.send('Page.navigate', { url }, sid)
		for (let i = 0; i < 150; i++) {
			if (await evaluate('document.readyState') === 'complete')
				break
			await sleep(200)
		}
		await sleep(2000)
		return evaluate(censusProbe)
	}

	for (const path of paths) {
		const n = await censusOf(withQuery(REMOTE + path))
		const a = await censusOf(withQuery(LOCAL + path))
		console.log(`\n  ===== census ${CENSUS} @ ${path} =====`)
		if (!n || !a) {
			console.log(`      选择器命中: nuxt ${n ? 'yes' : 'NO'}  astro ${a ? 'yes' : 'NO'}`)
			continue
		}
		const keys = [...new Set([...Object.keys(n), ...Object.keys(a)])].sort()
		const rows = keys.map(k => ({ k, n: n[k] || 0, a: a[k] || 0 })).filter(r => r.n !== r.a)
		if (!rows.length) {
			console.log(`      两侧后代普查完全一致（共 ${keys.length} 类）`)
			continue
		}
		rows.sort((x, y) => Math.abs(y.a - y.n) - Math.abs(x.a - x.n))
		for (const r of rows.slice(0, 20))
			console.log(`      ${String(r.n).padStart(5)} -> ${String(r.a).padStart(5)}   ${r.k}`)
		const totalN = Object.values(n).reduce((s, v) => s + v, 0)
		const totalA = Object.values(a).reduce((s, v) => s + v, 0)
		console.log(`      合计 ${totalN} -> ${totalA}  (Δ${totalA - totalN})，差异 ${rows.length} 类`)
	}
	cleanup()
	process.exit(0)
}

if (SEL) {
	const childProbe = `(() => {
		const root = document.querySelector(${JSON.stringify(SEL)})
		if (!root) return null
		const cs = getComputedStyle(root)
		const rr = root.getBoundingClientRect()
		const last = root.lastElementChild
		const lcs = last ? getComputedStyle(last) : null
		const self = {
			h: Math.round(rr.height),
			w: Math.round(rr.width),
			mt: cs.marginTop,
			mb: cs.marginBottom,
			pt: cs.paddingTop,
			pb: cs.paddingBottom,
			display: cs.display,
			// 容器比所有子节点矮、却又在页面总高上少一截时，答案通常在这里：
			// 末子节点的外边距**有没有塌出容器**。盒高不含塌出的外边距，
			// 所以「子节点逐个一致、容器却矮一截」正是塌陷差异的典型形状。
			scrollH: root.scrollHeight,
			clientH: root.clientHeight,
			// 注意：这段在模板字符串里，不能用反引号或模板插值 —— 会被外层吃掉。
			lastName: last ? last.tagName.toLowerCase() + '.' + String(last.className || '').trim().split(/\\s+/)[0] : '(none)',
			lastMb: lcs ? lcs.marginBottom : '',
			lastH: last ? Math.round(last.getBoundingClientRect().height) : 0,
			overflow: cs.overflow,
		}
		const kids = [...root.children].map((e, i) => {
			const r = e.getBoundingClientRect()
			const cls = (e.className && typeof e.className === 'string')
				? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.')
				: ''
			const prev = root.children[i - 1]
			const ecs = getComputedStyle(e)
			const full = (e.textContent || '').replace(/\s+/g, ' ').trim()
			return {
				i,
				name: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + cls,
				h: Math.round(r.height),
				top: Math.round(r.top + window.scrollY),
				bottom: Math.round(r.bottom + window.scrollY),
				// 与前一个兄弟的间距：高度对不上时，差值往往全在这里
				gap: i === 0 ? null : Math.round(r.top - prev.getBoundingClientRect().bottom),
				// 间距归因用：自身外边距 + 盒子类型，决定这段空白是谁贡献的
				mt: ecs.marginTop,
				mb: ecs.marginBottom,
				disp: ecs.display,
				// 全文长度：正文只差一行高度时，八成是**文字本身**不一样而不是 CSS。
				// 探针只截 46 字，看不出差的是一个标点还是一整句。
				len: full.length,
				text: full.slice(0, 46),
			}
		})
		return { self, kids }
	})()`
	const childOf = async (url) => {
		await cdp.send('Page.navigate', { url }, sid)
		for (let i = 0; i < 150; i++) {
			if (await evaluate('document.readyState') === 'complete')
				break
			await sleep(200)
		}
		await sleep(2500)
		await evaluate(`(async () => {
			const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
			for (let y = 0; y < H; y += window.innerHeight * 0.85) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) }
			window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 250))
		})()`, true)
		await sleep(300)
		return evaluate(childProbe)
	}

	for (const path of paths) {
		const n = await childOf(withQuery(REMOTE + path))
		const a = await childOf(withQuery(LOCAL + path))
		console.log(`\n  ===== ${SEL} @ ${path} =====`)
		if (!n || !a) {
			console.log(`      选择器命中: nuxt ${n ? 'yes' : 'NO'}  astro ${a ? 'yes' : 'NO'}`)
			continue
		}
		console.log(`      自身盒模型: nuxt h=${n.self.h} w=${n.self.w} margin=${n.self.mt}/${n.self.mb} padding=${n.self.pt}/${n.self.pb} display=${n.self.display} scrollH=${n.self.scrollH} overflow=${n.self.overflow}`)
		console.log(`                 末子节点 nuxt ${n.self.lastName} h=${n.self.lastH} mb=${n.self.lastMb}`)
		console.log(`      自身盒模型: astro h=${a.self.h} w=${a.self.w} margin=${a.self.mt}/${a.self.mb} padding=${a.self.pt}/${a.self.pb} display=${a.self.display} scrollH=${a.self.scrollH} overflow=${a.self.overflow}`)
		console.log(`                 末子节点 astro ${a.self.lastName} h=${a.self.lastH} mb=${a.self.lastMb}`)
		console.log(`      子节点数: nuxt ${n.kids.length}  astro ${a.kids.length}`)
		/*
		 * 按**文本**配对，不按下标、也不只按类名。
		 *
		/*
		 * 两轮配对，并且**明确区分「配不上」与「只有一边有」**。
		 *
		 * 演进过程（三次都栽在同一个地方——把工具的失败当成项目的差异）：
		 *   1. 按下标：一侧多一个元素，后面全部错位；
		 *   2. 只按类名：Nuxt 水合后给段落加 `has-quote-button`，同名段落落进
		 *      两个分组，炸出几十条并不存在的差异；
		 *   3. 按文本：实测 `/2024/08/docker-deploy-outline` 出现
		 *      **9 个「仅线上有」对 9 个「仅 Astro 有」——完全对称**，
		 *      说明元素两边都在、只是没配上，而工具却报成「Astro 缺 9 个」。
		 *
		 * 现在：文本配不上就退回「按类名 + 顺序」再配一次；
		 * 仍然配不上的明确标为 UNPAIRED，写清含义是「无法配对」，
		 * **不下「缺失」的结论**。
		 */
		const usedN = new Set()
		const usedA = new Set()
		const pairs = []
		const textKey = k => k.text || k.name
		const byText = (kids) => {
			const m = new Map()
			for (const k of kids) {
				const kk = textKey(k)
				if (!m.has(kk))
					m.set(kk, [])
				m.get(kk).push(k)
			}
			return m
		}
		const gn = byText(n.kids)
		const ga = byText(a.kids)
		for (const kk of [...new Set([...n.kids.map(textKey), ...a.kids.map(textKey)])]) {
			const xs = gn.get(kk) || []
			const ys = ga.get(kk) || []
			for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
				// ⚠️ 只有**真的配上了**才标记 used。
				// 写成「先 usedN.add 再判断有没有对面」，会把没配上的 nuxt 元素
				// 悄悄标成已用，于是最后只报出 astro 那一边——
				// 输出看起来像「Astro 多出 9 个元素」，实际上两边都有，只是文本不同。
				if (!xs[i] || !ys[i])
					continue
				usedN.add(xs[i].i)
				usedA.add(ys[i].i)
				pairs.push([xs[i], ys[i]])
			}
		}
		// 第二轮：剩下的按类名顺序配
		const leftN = n.kids.filter(k => !usedN.has(k.i))
		const leftA = a.kids.filter(k => !usedA.has(k.i))
		for (const x of leftN) {
			const j = leftA.findIndex(y => !usedA.has(y.i) && y.name === x.name)
			if (j === -1)
				continue
			const y = leftA[j]
			usedN.add(x.i)
			usedA.add(y.i)
			pairs.push([x, y])
		}
		for (const [x, y] of pairs) {
			const dd = y.h - x.h
			const dt = y.top - x.top
			const mark = Math.abs(dd) > 2 ? '***' : '   '
			const gs = (x.gap === null || y.gap === null)
				? '  -  '
				: `${String(x.gap).padStart(3)}/${String(y.gap).padStart(3)}`.padStart(9)
			const cls = x.name === y.name ? x.name : `${x.name} || ${y.name}`
			const how = x.text === y.text ? '' : '  (按类名配对)'
			console.log(`    ${mark} nuxt ${String(x.h).padStart(5)}  astro ${String(y.h).padStart(5)}  d ${String(dd).padStart(5)}  topΔ ${String(dt).padStart(5)}  字数 ${x.len}/${y.len}  gap n/a ${gs}  ${cls}${how}`)
			if (Math.abs(dd) > 2)
				console.log(`              nuxt  : ${x.text || '(无文本)'}\n              astro : ${y.text || '(无文本)'}`)
		}
		const unN = n.kids.filter(k => !usedN.has(k.i))
		const unA = a.kids.filter(k => !usedA.has(k.i))
		if (unN.length || unA.length) {
			console.log(`    ⚠ 未能配对 nuxt ${unN.length} 个 / astro ${unA.length} 个 —— 含义是「对不上」，**不是「某一边缺失」**：`)
			for (const k of unN)
				console.log(`         nuxt  ?  ${k.name}  ${k.h}px  ${k.text || '(无文本)'}`)
			for (const k of unA)
				console.log(`         astro ?  ${k.name}  ${k.h}px  ${k.text || '(无文本)'}`)
		}
	}
}

mkdirSync(join(ROOT, '.astro-compare'), { recursive: true })
/*
 * 输出文件名带上本次跑的页数，避免**定点下钻覆盖全站结果**。
 * 这个坑踩过：跑完 63 页拿到权威清单后，为了查一个区块又跑了 1 页，
 * 全站 JSON 被覆盖成单页，下次只能回头去翻日志。
 * 页数不同 = 两份不同的实验结果，不该共用一个文件名。
 */
const outName = `ui-parity-${paths.length}p${MODE === 'offline' ? '-offline' : '-live'}${widthTag}${themeTag}.json`
writeFileSync(join(ROOT, '.astro-compare', outName), JSON.stringify({ mode: MODE, tolerance: TOLERANCE, viewport: { width: VIEW_W, height: VIEW_H }, theme: THEME || 'default', rows, skipped }, null, 2))
console.log(`\n结果已写入 .astro-compare/${outName}  (viewport ${VIEW_W}x${VIEW_H}, theme ${THEME || 'default'})`)

killTree(chrome)
killTree(preview)
// online 复核用的第二个浏览器也要收掉，否则它会一直挂在后台等下一次连接
if (onlineSession) {
	killTree(onlineSession.proc)
	try {
		rmSync(onlineSession.prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
	}
	catch { /* 尽力而为 */ }
}
for (let i = 0; i < 5; i++) {
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
		break
	}
	catch { await sleep(400) }
}
/*
 * 退出码：页高超差 **或** 语义签名不一致，都算失败。
 * 隔离假阳性（artifact）不算——它不是站点差异，理由见上面 `artifacts` 那段。
 */
process.exitCode = (bad.length || semBad.length) ? 1 : 0
