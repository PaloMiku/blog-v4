# CLAUDE.md

个人博客「Mikuの极光星」（https://blog.sotkg.com）。**2026-10-03 起 Astro 7 直接接管仓库根**，
Nuxt 4 源码树（`app/` `content/` `server/` `shared/` `modules/` `patches/` `remark-plugins/`
`nuxt.config.ts` `blog.config.ts` …）已整体删除，`astro-site/` 这个过渡目录也不再存在。

这份文件只写**下次不看到就会犯错**的东西。历史过程、迁移期的实测记录、被推翻的中间结论
一律在 git 里（`git log -p -- CLAUDE.md`，或 tag `archive/astro-migration-2026`），
不要把它们复制回来——复制回来就是第二份真相，而第二份真相已经错过好几次。

## 常用命令

```sh
pnpm dev                     # 开发
pnpm build                   # SSG 构建，68 页
pnpm preview                 # 预览产物（启停由用户管理，代理不得擅自启停）
pnpm typecheck               # tsc -p tsconfig.check.json
pnpm lint                    # ESLint（含 CSS 规则；本机 pnpm 可能 EBUSY，可改用 npx eslint）
pnpm new                     # 新建文章（写 src/content/posts/<年>/<名>.mdx）
pnpm accept                  # 验收默认档（门禁清单在 scripts/accept.mjs 里，约 50s）
pnpm accept:full             # 加重档：加打线上站的门禁，20-25min，仅切换 / 发布前跑
pnpm interaction-check       # 交互门禁，**单独跑**，刻意不进验收流水线
node scripts/accept.mjs --skip-build          # 复用现有 dist/，只跑门禁
node scripts/accept.mjs --only check-dates    # 只跑某几道（调试用）
node scripts/probe-subtree.mjs --sel='<css>'  # 逐节点几何对比（诊断工具）
```

## 技术栈与结构

- Astro 7（站点根即仓库根，`src/pages` 文件路由）+ `@astrojs/mdx` v8 + `remark-mdc`；
  pnpm 12 + **catalogs 集中管版本**（版本只在 `pnpm-workspace.yaml` 出现一次）
- **零 Vue 岛**：`src/` 下 0 个 `.vue` 文件，`vue` / `@astrojs/vue` 已于 2026-10-03 摘除。
  交互一律走组件内原生 `<script>` + `data-*` 定位；确实要引入岛时先把 `vue()` 加回
  `astro.config.mjs`、`package.json`、`pnpm-workspace.yaml` 三处
- 样式纯 CSS（无 Tailwind、无预处理器）：令牌在 `src/styles/*.css`，组件内 `<style>` 用原生
  CSS 嵌套，CSS 检查走 ESLint（@zinkawaii/eslint-config-css）
- UI 组件全自研（`src/components/` 下 `blog/` `content/` `post/` `partial/` `popup/` `util/`
  `widget/`），第三方仅 `astro-icon` 与 `embla-carousel`
- **内容唯一真相源是 `src/content/**/*.mdx`**（63 个文件）
- 三层配置分工：内容/分类/友链 → `src/config/blog.ts`；导航/页脚/交互默认值 →
  `src/lib/app-config.ts`；内容 schema 与 loader → `src/content.config.ts`；构建 →
  `astro.config.mjs`
- 端点（`src/pages/`）：`/api/stats`、`/atom.xml`、`/subscriptions.opml`、`/llms.txt`、
  `/search-index.json`、`/raw/*.md`
- 文章可用 frontmatter `permalink` 自定义 URL；`hidePostPrefix` 开启时 /posts/xxx 显示为 /xxx
- `build.format: 'directory'` ⇒ **`Astro.url.pathname` 带尾斜杠**。凡是把 `path === item.url`
  写成精确比较的地方都要先归一化，否则首页会因为 `item.url` 恰好是 `/` 而**巧合正确**
- **组件示例页靠 `Component` 围栏**：`src/content/previews/example.mdx` 里每个组件写成一个
  ```` ```Component [Alert.astro] ```` 围栏，正文就是实际会写的 MDX，由
  `src/plugins/component-fence.ts` 展开成「现场效果 / 组件语法」两页签。门禁
  `check-component-fence.mjs` 验语法栏与围栏正文逐字一致
- **`<Tab>` 面板可以写 `#tab1` 代替 `slot="tab1"`**（`src/plugins/tab-panels.ts`）：
  编号从 1 连续递增、数量须与 `tabs={[…]}` 一致，插件在构建期展开成具名 slot。
  两种写法共存——没有 `#tabN` 的 `<Tab>` 原样放过。源侧判据 `check-tab-panels.mjs`
  （毫秒级，进默认档）；构建期红绿双向 `scripts/tab-panels-red.mjs`（跑 4 次
  `astro build`，~45 s，**单跑**，不进流水线）
- ⚠️ **`dist` 是指向 `.output/public` 的符号链接**（Nuxt 时代留下的路径，`.gitignore` 忽略
  两者）。任何 `find dist -type f` / `du -sh dist` **都会返回 0**——`find` 与 `du` 默认不跟随
  符号链接。统计产物一律用 `find -L dist` / `du -shL dist`，或直接写 `.output/public`

## 验收

`scripts/accept.mjs` 是**唯一入口**，也是门禁名单的**唯一事实源**：

- 默认档（`pnpm accept`）= 一次 `pnpm build` + 名单里的默认档门禁。零外网，只连 localhost。
- 加重档（`pnpm accept:full`）= 默认档 + 打线上站的门禁（`live:sitemap` / `live:ui-parity`）
  与 `preview-guard-selftest`。

三条原则，改动时别破坏：

1. **名单只有这一份。** 本地与 CI 跑的是同一个 `scripts/accept.mjs`，CI 侧只有一句
   `node scripts/accept.mjs --skip-build`。历史上 CI 曾手抄过 13 个 `- name: Gate: x` 步骤，
   那份手抄清单**漂过**：本地新增的门禁没同步过去，抓到真缺陷最多的 `check-affordances`
   就因此只在本地跑。`check-ci-triggers.mjs` 现在直接 import 名单校验，不许再手抄。
2. **加了门禁就要在同一次改动里接进 `accept.mjs` 的名单**，并跑一次红绿双向。接进去之前
   先想清楚它报红时该怎么办。一道永远红的门禁等价于没有门禁。
3. **「跳过」不等于「通过」。** 门禁在内存不足 / 基线缺失 / 网络不可达时会自己放弃并退 0
   （一次网络抖动不该拦住发布）。runner 把这类单独记成 `skipped`，**不计入 passed**，
   汇总行会写明。汇报「全绿」时必须带上这个数。

### 为什么门禁全是 Node

2026-10-04 之前，28 道门禁里有 13 道是 PowerShell。这不是风格问题，是三条实测：

- `.ps1` 在 `runs-on: ubuntu` 上结构上跑不起来 ⇒ 那 13 道**永远进不了 CI**，整套门禁只能
  在本机跑
- 旧 runner 逐个解析 `scripts/<名字>.ps1`，文件不在就打 `SKIP (script not present)` 并
  **记 exit 0**。把一个门禁从 `.ps1` 改成 `.mjs` 而忘了改名单，它就变成「还在列表里、
  但一次都不会跑」——「写了没接线」那一族的典型形态
- 名单同时存在于 runner、`CLAUDE.md`、CI 三处，三处都漂过

现在仓库里 **0 个 `.ps1`**，跨平台是结构保证而不是约定。依赖未入库的 Nuxt 冻结基线的门禁
（目前只剩 `compare-urls`）在 CI 上会自己跳过并计入 `skipped`——这是有意的信号，不是 bug。
`baseline/nuxt/` 无法再冻结（Nuxt 源码树已删），`freeze-baseline.mjs` 已随之退役：现在跑它
会把 **Astro 产物**冻成「Nuxt 基线」，比不跑更坏。

## 提交

- **conventional 主题 + 短要点**。主题一行说清这次改了什么，**不写流水账标题**
  （「顺手修了 A、B、C」这种一律砍掉或拆成独立提交）。正文用短要点，
  **不复述改动过程、不解释为什么现在做**——那些在 `git log -p` 里
- **小修复直接提交到 `main`**。不要习惯性先开分支，**只有用户明确要求走分支 / PR
  时才建**。`main` 就是部署分支，多一层分支只是把「已上线」降级成「在某个分支上」
- ⚠️ 运行环境若反过来要求「在默认分支上先开分支」，照它执行，但**必须在回复里给出
  快进回 `main` 的一条命令**。提交不在 `main` 上就等于没部署，而「本地全绿、线上没变」
  很容易被当成推送没生效
- 提交前跑一次 `pnpm accept`（默认档）。**门禁红着不提交**；跑不动就明说哪几道没跑，
  拿「构建过了」代替验收等于没验

## 部署

GitHub Actions（push main 触发）：`pnpm build` 后把 `dist/` 推送到 `PaloMiku/blog-public`
（GitHub Pages），站点经 EdgeOne CDN 对外服务。**CI 是否绿是部署是否成功的唯一事实源。**

三处验证部署的注意点：

- `gh` 在本仓库会**优先解析 `upstream` remote**（L33Z22L11/blog-v3），所有
  `gh run list` / `gh workflow list` 都必须显式 `-R PaloMiku/blog-v4`
- 站点在 EdgeOne 后面，**带 query 的 URL 是独立的 cache key**：`?cb=<时间戳>` 会命中
  尚未刷新的父层拿到**旧内容**。验证部署一律用普通 URL
- `edgeone.json`（`/api/*` → `application/json`、`*.opml` → `application/xml`）**不在仓库里
  被任何流水线消费**——流水线只推 `dist/`。它靠 EdgeOne 控制台配置生效，改它要去控制台

## 坑位

只写**可复用的判据**。一次性的事故叙事在 git 历史里。

1. **Astro 不做 attribute fallthrough。** `<Icon class="x" />` 的 `class` 会被**静默丢弃**，
   必须显式声明 prop 再合并。已导致封面图丢 `aspect-ratio`、渲染高 6 倍。**推论：合并 class
   之后还要确认它落在哪一层**——`Icon.astro` 明明合并了 `class`，astro-icon 却自己又包了一层
   `<span>`，于是 `error-icon` 落外层、`.iconify` 落内层。**凡是调用方给图标包装元素显式设了
   `font-size` 的地方都要重新量一遍盒子。**
2. **`:global()` 只作用于紧邻的选择器，不向嵌套传播。** 每个面向 slot 内容的层级都要单独写。
   且 `<style>` 默认隔离，写 `.x .y` 会要求 Astro 的 scope id 落在**子组件**根元素上，而它带的是
   子组件自己的 id ⇒ 规则永不匹配。`check-scope-anchors.mjs` 盯这一类。
3. **顶层 `:deep(X)` 搬到 Astro 必须把锚点补回去。** Vue 编译成 `[data-v-<hash>] X`，
   那个属性选择器**要求祖先里有本组件的元素**。写成裸 `:global(X)` 锚点就没了，规则会跑到
   组件外去。
4. **`data-astro-cid` 是构建期属性，脚本重建的节点一个都没有。** 谁在客户端用
   `createElement` / `createElementNS` 重建了带样式的元素，那条规则就只对首屏那一个命中，
   换个选项 / 翻一页之后样式**静默全掉**（页码按钮糊成 `1234`、combobox 对勾退化成 ~90px）。
   修法是**把锚点留住、只对被重建的那一个 class 豁免作用域**，不要写顶层裸 `:global()`；
   反过来在脚本里补 cid 是错的（hash 随组件内容变，脚本无从得知）。
   排查判据：`grep -rn "createElement" src`，逐个问「这个新建元素有没有 class 命中带 cid 的规则」。
5. **astro-icon 的 `<symbol>` 全局只有一份，挂在首次出现处。** 整块替换 DOM 会连它一起杀 ⇒
   **全站所有引用同时变空白**，不是某个图标坏。`src/lib/icon-sprite.ts` 的
   `hoistIconSprites(root)` 在替换子树**之前**把 symbol 搬到挂在 `document.body` 下的常驻宿主。
   宿主不能用 `display:none`（部分浏览器不给 `<use>` 展开影子树），用零尺寸 + `aria-hidden`。
   排查判据：`document.querySelectorAll('symbol[id^="ai:"]')` 的数量在交互前后对不上。
6. **门禁必须先自检。** 这个仓库里已经有二十余次「门禁自己错了」而不是「站点错了」。
   **没被看过变红的门禁等于没有门禁。** 每次新门禁都要注入一个真实缺陷验它会红。
7. **仪器自己也要能被证伪。** 两个仪器结论打架时先怀疑仪器。同源两例：断言用
   `if (/\n(?!\r)/.test(s))` 判「有没有裸 LF」——它匹配了**全部**换行（lookahead 看的是
   `\n` **之后**的字符），正确写法 `/(?<!\r)\n/`；以及后台任务读到的脚本可能不是你刚写的
   那份（起完任务先对一眼第一行输出）。
8. **「判断产物变没变」不要用整目录哈希。** 实测连续两次同样源码的构建给出两个不同哈希，
   追下去只有 4 个文件变，**全是构建时间戳**。
9. **「连量两遍一致」不等于「页面是确定的」。** 线上装 10 次页高跨度 44px，根因是洗牌写在
   `onMounted` 且那个逃生口在线上无效。判据已改成 `--samples`（默认 3）次判**极差**。
   **静态站不要为了两边「看起来一样」把静态站也改成随机。**
10. **断网测量会造出假阳性。** 离线路径拦截跨域 fetch，某页凭空多出 18px。**离线扫描报的
    差值，先用 online 模式复核再定性**；`ARTIF`（同一浏览器复量落在 ±40 内）要单独列出，
    既不能混进「一致」也不能混进「超差」。
11. **live 不是当前源码。** 每条线上差异只有「迁移缺陷 / **部署滞后漂移** / 内容漂移」三种
    可能，**正确动作是部署，不是改 Astro**；绝不加进 `known`/`ACCEPTED`——那会把「源码还没
    部署」这个信号永久静音。
12. **「构建通过 + 门禁全绿 + 产物一字未变」也可能是「代码根本没执行」。** 实测过：
    68 个条目的 `entry.rendered` 全是 undefined，因为 glob loader 走 `deferredRender` 分支。
    **⇒ 没有「改完之后产物变了吗」这一项检查，一切「接上了」都是猜的。**
13. **构建会改写正文字面，而所有几何门禁都看不见。** `remark-smartypants` 改的是字形不是盒子。
    判据必须是**逐字符计数不等式**（产物次数 ≤ 源次数）。**一个从不报错的门禁比没有门禁更糟。**
14. **「把字符串当 HTML 吐出去」= 静默空白；判据必须是「未求值即失败」。** rehype 侧存字符串
    而非 AST ⇒ 侧栏 widget 整个空白，**页高看不见**（空白也是合法盒子），**计算样式看不见**
    （压根没有元素）。`check-mdc-eval.mjs` 的判据是零歧义的：注册表里的组件名与 HTML 原生标签
    **无一重名**。
15. **Vue/MDX 的「属性」在两侧不在同一处；只读对、写错就静默无效。** `addClass` 对 MDX 节点
    是无声空操作；新增的 MDX 属性对象**必须带 `type: 'mdxJsxAttribute'`**，裸 `{name,value}`
    会被 hast→estree 静默丢弃。
16. **用文本当元素键不成立；判据顺序必须是「先全量、再逐元素」。** `textContent` 前 40 字符的
    签名会重复。定稿是**两道门槛**：`distDiff` 先算全量取值分布，分布相同的属性一律不报逐元素
    差异。改这类核心比较逻辑**必须**注入真实缺陷验红绿双向。
17. **读调用点不等于知道语义。** `useElementVisibility(anchorEl)` + `:class="{ expand }"`
    看不出极性，最后靠四态滚动实测才定出来。`getComputedStyle().marginRight` 对 flex item 的
    `margin: auto` 返回**解析后的实际像素**，两侧不同说明的是**容器剩余空间**不同。
18. **「量了外框」可以连续错三次；列测量清单的依据必须是遍历出来的普查表。** 补到 17 条
    选择器后仍全绿，因为两侧都在 `visibility:hidden` 那一层就出局了。**判据在更上游的环节出局时，
    往下游补清单是白费力气。**
19. **判断「某个资源到底用没用上」必须用与该问题定义相符的字段。** 实测
    `document.fonts.check()` 给「线上 true / 本地 false」，据此推出「本地字体没加载」**结论正好
    反了**——线上那条 `<link>` 的 `media` 停在 `print`，样式表下载了却**永不应用**，静默无错。
    同一探针里两个字段打架时，挑定义相符的那个。
20. **决定门禁能不能进 CI 的是 `baseline/`，不是语言。** 16 道 PowerShell 门禁里只有 6 道不依赖
    `baseline/`，另外 10 道换个语言在 CI 里照样自我跳过。**换语言能换来 CI 覆盖的只有那 6 道**
    ——所以 2026-10-04 那次全量移植的真正收益是「跨平台 + 名单单一事实源」，
    覆盖率是顺带的。现在 CI 跑的是完整默认档，因为名单里剩下的门禁都不依赖基线了。
21. **名单、计数、成员不要在第二个地方复述。** 本文件曾经把门禁分组表、步数、成员同时写在
    三处，于是每次增删都要改三个数字，而它们已经漂了至少五次（写「11 道 PowerShell」时实际
    是 12 道，写「两道没接线的门禁」时那两道早已接线，写「35 步」时实际是 38 步）。
    **事实放代码里，文档只描述原则。**
22. **「跨域被拦截」是客户端的推断，不是证据。** Twikoo 把 `xhr.status === 0` 一律映射成 CORS
    错误，而 0 的真实含义是「响应读不到」——404、连接被断、DNS 失败**全都是它**。当时真正的
    根因与跨域无关：`envId` 写的是站点根，而那个根在 Netlify 上只是一张
    `location.href='/.netlify/functions/twikoo'` 的静态跳转页，**只对浏览器导航有效**；客户端对
    envId 直接 POST JSON，POST `/` 落到静态文件返 404，而该 404 不带 CORS 头 ⇒ 浏览器不让读。
    **判据是 `curl -i -X POST <envId>` 看它返回什么，不是看组件的错误文案。**
    同族：手写探针时事件名写错（`getComments` 而非 2.0.x 的 `COMMENT_GET`），后端回
    `code 1001 请更新云函数至最新版本`——**看着像后端版本旧，实际后端就是最新的**。
23. **白名单的键必须选稳定的那一层。** `audit-dead-scope` 的死规则白名单一度把**带内容哈希的
    CSS 文件名**算进键里，而 `Blog.*.css` 是共享 bundle ⇒ 同组任意一个组件改样式都会让**全部**
    键失效，于是「这个组件被改过」被放大成「这个 bundle 里所有规则都变过」。代价是每跑一次
    构建就手工重钉一次名单，2026-10-03 与 10-04 各一次，而选择器与 cid 逐字未变。
    **键应该是语义身份**（cid 本身就是组件内容的哈希，改组件必改 cid）。
24. **Windows PowerShell 5.1 会先插值再交给 node，而且无 BOM 的 `.ps1` 按 ANSI 读。** 两条都
    咬过：命令串里的 `$1` / `$sampleEvery` 被当成变量吃掉；`.ps1` 里的中文注释会吞掉后面的
    整行语句，症状是「加了步骤但计数没变」，不报错也不红。仓库已无 `.ps1`，但
    `powershell -Command` 仍在用，**改文件用 edit/write 工具，或写进临时 .mjs 再跑**。
25. **`.ps1` 里的路径必须从 `$PSScriptRoot` 解析。** `Resolve-Path '..\x'` 跟的是**进程 CWD**
    而不是脚本位置——`check-dates` 与 `compare-urls` 因此指向过从未存在的路径。
    Node 侧对应物是从 `import.meta.url` 解析，不要用 `process.cwd()`。
26. **「在本机一直绿」不等于判据与环境无关；换台机器、换个时区就红。**
    `check-dates` 把 source 的裸墙上时钟（`date: 2025-05-26 17:00:00`，Asia/Shanghai）
    和产物的 UTC 表示（`datetime="2025-05-26T09:00:00Z"`）比成同一瞬间，用的是
    `new Date(裸墙钟)`——**按跑门禁那台机器的本地时区解析**。PowerShell 版一直在这台
    +08:00 的开发机上跑，所以恰好成立；2026-10-04 门禁迁到 Node、CI 第一次在
    `TZ=UTC` 的 ubuntu runner 上跑它，40 页**全部**差 8 小时。
    **这不是移植写错了，是原判据一直靠环境兜着**，而「本机绿了三个月」正是它
    看起来没问题的原因。折算必须钉在 `blogConfig.timeZone` 这个**显式配置**上
    （提交 `7e3029c` 已为站点做了这件事，门禁没跟上），偏移量用 `Intl` 按该时刻算，
    不要硬编码 `+08:00`。**验门禁要换时区重跑**：
    `TZ=UTC node scripts/accept.mjs --skip-build`。
27. **一道门禁红了却说不出为什么，等于逼人去本地重跑一遍。** runner 最初只把门禁输出
    里的 `RESULT:` 一行收进汇总表，其余 stdout 全部丢弃，于是 CI 上 `check-dates` 红了
    只剩孤零零一个 `FAIL`，排查只能把整个流水线日志拉下来再 grep 门禁名。
    **失败路径必须把门禁自己的输出原样打出来**——细节在门禁里，不在汇总里。

## 开放项

| 项 | 证据 | 状态 |
| --- | --- | --- |
| `games/galgames/clannad` 表格差异 | 源 `clannad/index.mdx` 1113 行、508 行表格、17 个 `<Folding>`；Astro 渲染 31 张表（310 处 `md-table`），**Nuxt 基线 0** | 未分类。机制待查（Nuxt Content 的 GFM 表格在 MDC 块里是否被解析） |
| `/2025/10/clarity-resource-list` 代码块计数 | 基线（用**当前源码**重建）nuxt=1 / astro=2；该页页高 d=0，两道几何门禁都看不见 | 未分类，根因同上（围栏代码块嵌在 MDC tab 槽位里，两侧解析不同） |
| 29 条顶层裸 `:global()` 未复核 | `check-scope-anchors` 的 `UNREVIEWED` | 钉住但未复核，见坑位 31 的原始记录。**条数是棘轮**，改动后自己数一遍（2026-10-04 删掉 FeedCard 两条 tippy 宿主规则后是 29；此前门禁头写「32」、本表写「33」，两个数都已漂过） |
| ~~`vue` / `@astrojs/vue` 是死重量~~ | `src/` 下 0 个 `.vue` 文件 | **已摘**（2026-10-03），三处同步删 |
| ~~分享按钮两侧不同步~~ | Nuxt 侧删了分享组件，Astro 侧从未跟进 | **已随部署消解**（2026-10-03）。两侧现已一致 |
| ~~`compare-dom` 15 处 marker 不一致~~ | 该门禁读 Nuxt 冻结基线 | **2026-10-04 退役**：迁移已完成、基线无法再冻结，守的是一个不会再变的目标 |
| 产物 CSS 里有 120 个类名在全站找不到落点 | 2026-10-04 实测：465 个类名里 120 个无落点，其中约 20 个是 Vue transition 残留（`*-enter-active` 等），另有 Twikoo 运行时渲染的 `tk-*`、katex/shiki 的内部类名 | **未处理**。做成门禁要 ~100 条 allowlist，不划算；但 Vue transition 那批是迁移残留，删掉能实打实减小产物。动 `src/styles/` 前先确认没有组件在运行时加这些 class |
| ~~Twikoo 评论区报「请求被跨域策略拦截 / status 0」~~ | `POST https://twikoo.sotkg.com/` → 404 且无 CORS 头；`POST .../.netlify/functions/twikoo` → 200 + 正确 ACAO | **已修并已上线**（2026-10-04，`af623f7`）。线上实测：评论区渲染「没有评论」而非跨域错误，坑位 22 |
| Twikoo 评论库查不到任何评论 | 对全部 38 篇文章调 `GET_COMMENTS_COUNT`，带/不带尾斜杠都返回 `count: 0` | **pending，与上面那条无关**（修之前请求根本到不了函数）。若预期有历史评论，要查 Netlify 上那个函数的数据库 |
| `probe-subtree` 的 profile 模式（垂直剖面 / 空隙 / 对账）该不该并进 `compare-ui-parity` | 它现在不在任何门禁名单里，作为「门禁」等于不存在 | 未处理。它的 tree 模式已被 `--sel=` 完全覆盖，profile 模式是唯一能说清「空隙」的仪器 |
| `compare-dom-live` 退役后丢掉的覆盖 | 它独有的是 head meta 19 条 + 侧栏 widget/footer 计数 3 条，且只硬编码 8 页 | 2026-10-04 退役时未回填。`compare-ui-parity` 的 `SEM_RULES` 已含 head meta，但只有加重档会跑 |

## 当前状态（2026-10-04）

- Astro 版 2026-10-03 上线，线上与本地同源。`live:*` 门禁因此从「Astro ↔ Nuxt」退化为
  「Astro ↔ Astro」，只能抓部署滞后漂移
- **2026-10-04：门禁全面从 PowerShell 迁到 Node**，`acceptance.ps1` → `scripts/accept.mjs`，
  仓库内 0 个 `.ps1`。CI 从 13 个手抄步骤变成一条 `node scripts/accept.mjs --skip-build`，
  覆盖范围从 12 道扩到默认档全量。退役 10 个脚本（5 个纯迁移期 Nuxt 对比门禁 + 5 个零引用孤儿）
- 同日上线三处修复：`audit-dead-scope` 的不稳定白名单键、Twikoo `envId` 指错路径
  （`af623f7`）、以及 `check-dates` 的时区依赖（`3f83aaf`）
- **CI 第一次跑就红，红了两次，两次都是我引入的**：① 构建步骤 `tee` 写不进
  gitignore 的 `.astro-compare/`（旧 `acceptance.ps1` 用 `New-Item` 建过，换 runner 后
  没人建）；② `check-dates` 在 `TZ=UTC` 的 runner 上 40 页全差 8 小时——**那道门禁从来
  没有真正与时区无关**，PowerShell 版一直在这台 +08:00 的开发机上跑，「按本地时区读
  裸墙钟」恰好成立。见坑位 26
