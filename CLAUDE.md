# CLAUDE.md

个人博客「Mikuの极光星」（https://blog.sotkg.com）。**2026-10-03 起 Astro 7 直接接管仓库根**，
Nuxt 4 源码树（`app/` `content/` `server/` `shared/` `modules/` `patches/` `remark-plugins/`
`nuxt.config.ts` `blog.config.ts` …）已整体删除，`astro-site/` 这个过渡目录也不再存在。

这份文件只写**下次不看到就会犯错**的东西。历史过程、迁移期的实测记录、被推翻的中间结论、
带日期的事故叙事，一律在 `docs/history/incidents.md`（本地档案，docs/ 不入库）和 git 里
（`git log -p -- CLAUDE.md`，或 tag `archive/astro-migration-2026`），不要把它们复制回来——
复制回来就是第二份真相，而第二份真相已经错过好几次。

## 常用命令

```sh
pnpm dev                     # 开发
pnpm build                   # SSG 构建（页数看构建日志，别在这里数）
pnpm preview                 # 预览产物（启停由用户管理，代理不得擅自启停）
pnpm typecheck               # tsc -p tsconfig.check.json
pnpm lint                    # ESLint（含 CSS 规则；本机 pnpm 可能 EBUSY，可改用 npx eslint）
pnpm new                     # 新建文章（写 src/content/posts/<年>/<名>.mdx）
pnpm accept                  # 发布档（release）：构建 + 发布必需门禁；清单只在 scripts/accept.mjs
pnpm accept:maintenance      # 深度维护审计：发布档全量 + CSS/DOM/台账/CDN 等深度门禁
pnpm accept:parity           # 迁移对拍档：基线/线上比较，耗时 20+ 分钟，仅切换 / 发布前跑
pnpm interaction-check       # 交互门禁，**单独跑**，刻意不进验收流水线
node scripts/accept.mjs --skip-build          # 复用现有 dist/，只跑门禁
node scripts/accept.mjs --only check-dates    # 只跑某几道（调试用）
node scripts/accept.mjs --print-policies      # 只打印门禁的跳过策略矩阵，不跑门禁
ACCEPT_FORCE_CI=1 node scripts/accept.mjs     # 本机按 CI 判定跑（验 CI 上的判据）
node scripts/check-expirations.mjs --selftest # 豁免台账门禁的自检（不读真实台账）
node scripts/probe-subtree.mjs --sel='<css>'  # 逐节点几何对比（诊断工具）
```

## 技术栈与结构

- Astro 7（站点根即仓库根，`src/pages` 文件路由）+ `@astrojs/mdx` v8 + `remark-mdc`；
  pnpm 12 + **catalogs 集中管版本**（版本只在 `pnpm-workspace.yaml` 出现一次）
- **零 Vue 岛**：`src/` 下 0 个 `.vue` 文件，`vue` / `@astrojs/vue` 已不在依赖里。
  交互一律走组件内原生 `<script>` + `data-*` 定位；确实要引入岛时先把 `vue()` 加回
  `astro.config.mjs`、`package.json`、`pnpm-workspace.yaml` 三处
- 样式纯 CSS（无 Tailwind、无预处理器）：令牌在 `src/styles/*.css`，组件内 `<style>` 用原生
  CSS 嵌套，CSS 检查走 ESLint（@zinkawaii/eslint-config-css）
- UI 组件全自研（`src/components/` 下 `blog/` `content/` `post/` `partial/` `popup/` `util/`
  `widget/`），第三方仅 `astro-icon` 与 `embla-carousel`
- **内容唯一真相源是 `src/content/**/*.mdx`**（篇数看 `pnpm build` 日志或数文件，别在这里数）
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
  （毫秒级，进发布档）；构建期红绿双向 `scripts/tab-panels-red.mjs`（跑多次
  `astro build`，~45 s，**单跑**，不进流水线）
- ⚠️ **`dist` 是指向 `.output/public` 的符号链接**（历史遗留路径，`.gitignore` 忽略
  两者，junction 本身不入库）。任何 `find dist -type f` / `du -sh dist` **都会返回 0**——
  `find` 与 `du` 默认不跟随符号链接。统计产物一律用 `find -L dist` / `du -shL dist`，
  或读门禁统一用的 `dist` 口径（坑位 34）

## 验收

`scripts/accept.mjs` 是**唯一入口**，也是门禁名单的**唯一事实源**：哪些门禁、几道、各挂
什么跳过策略，都只在那一个文件里定义。本文件**不复述名单，也不复述任何计数**——
`node scripts/accept.mjs --print-policies` 打印的就是权威版本。

三个档位（`--profile`，默认 `release`）：

- `release`（`pnpm accept`）= 一次 `pnpm build` + 发布必需门禁。零外网，只连 localhost。
  CI 跑的就是这一档。
- `maintenance`（`pnpm accept:maintenance`）= 发布档全量 + 深度审计（CSS 域 / 台账治理 /
  CDN 合同 / Windows 专属自测等）。
- `parity`（`pnpm accept:parity`）= 迁移对拍档，打基线与线上站；需要外网、慢。基线缺失时
  显示 NOT-RUN（不可运行），不计通过也不算违规。线上与本地早已同源，`live:*` 只能抓
  **部署滞后漂移**（坑位 11）。

三条原则，改动时别破坏：

1. **名单只有这一份。** 本地与 CI 跑的是同一个 `scripts/accept.mjs`，CI 侧只有一句
   `node scripts/accept.mjs --skip-build`。不许再手抄清单——`check-ci-triggers.mjs` 现在
   直接 import 名单校验（手抄漂过的历史见 `docs/history/incidents.md`）。
2. **加了门禁就要在同一次改动里接进 `accept.mjs` 的名单**，并跑一次红绿双向。接进去之前
   先想清楚它报红时该怎么办。一道永远红的门禁等价于没有门禁。
3. **「跳过」不等于「通过」——现在这句话已经写进退出码了。** 门禁在内存不足 / 基线缺失 /
   网络不可达时会自己放弃并退 0（一次网络抖动不该拦住发布）。**每道门禁在名单里都带一个
   `skip` 策略**，默认 `never`（跳过即缺陷），豁免条目各写了 `why`：

   | skip | 本机跳过 | CI 跳过 |
   | --- | --- | --- |
   | `never`（默认） | 红 | 红 |
   | `env-dependent` | 绿 | **红** |
   | `expected-in-ci` | 红 | 绿（仍计入 `skipped` 并逐条点名） |

   违规跳过会让 `accept.mjs` 自己 `exit 1`，汇总里多一行 `违规跳过 N`。
   豁免的条数、门禁的豁免清单都别在这里复述——`--print-policies` 是权威。
   ⚠️ **CI 相关的判据如果只能到 CI 上才能验，就等于没有 CI 相关的判据**，所以有
   `ACCEPT_FORCE_CI=1` 让本机能按 CI 判定跑一遍。改这套判据后必须用它验过再提交。

   改名单元素形态（字符串 ↔ 对象）时记得两处消费方：`--only` 的过滤和
   `check-ci-triggers.mjs` 的取名都要走 `gateName()`，否则会静默失配——见坑位 28。

门禁全部是 Node、仓库内 0 个 `.ps1`：跨平台与「本机能跑 = CI 能跑」是**结构保证而不是
约定**。依赖基线 / 外网的比较门禁都收在 parity 档，不进 CI 名单；CI 跑发布档全量。
（PowerShell 时代的历史见 `docs/history/incidents.md`。）

## 提交

- **conventional 主题 + 短要点**。主题一行说清这次改了什么，**不写流水账标题**
  （「顺手修了 A、B、C」这种一律砍掉或拆成独立提交）。正文用短要点，
  **不复述改动过程、不解释为什么现在做**——那些在 `git log -p` 里
- **小修复直接提交到 `main`**。不要习惯性先开分支，**只有用户明确要求走分支 / PR
  时才建**。`main` 就是部署分支，多一层分支只是把「已上线」降级成「在某个分支上」
- ⚠️ 运行环境若反过来要求「在默认分支上先开分支」，照它执行，但**必须在回复里给出
  快进回 `main` 的一条命令**。提交不在 `main` 上就等于没部署，而「本地全绿、线上没变」
  很容易被当成推送没生效
- 提交前跑一次 `pnpm accept`（发布档）。**门禁红着不提交**；跑不动就明说哪几道没跑，
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

只写**可复用的判据**。一次性的事故叙事在 `docs/history/incidents.md` 与 git 历史里。

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
    一批条目的 `entry.rendered` 全是 undefined，因为 glob loader 走 `deferredRender` 分支。
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
20. **决定门禁能不能进 CI 的是「依不依赖基线 / 外网」，不是语言。** 换一种脚本语言换不来
    覆盖率——依赖缺失时照样自我跳过。全量迁 Node 的真正收益是跨平台 + 名单单一事实源，
    CI 覆盖是顺带的。现在发布档名单里的门禁都不依赖基线，所以 CI 能跑全量。
21. **名单、计数、成员不要在第二个地方复述。** 门禁名单在 `scripts/accept.mjs`，跳过策略
    矩阵在 `--print-policies`，页数/篇数在构建日志。**事实放代码里，文档只描述原则**——
    写进本文件的每个数字都漂过（至少五次的漂移记录见 `docs/history/incidents.md`）。
22. **「跨域被拦截」是客户端的推断，不是证据。** Twikoo 把 `xhr.status === 0` 一律映射成
    CORS 错误，而 0 的真实含义是「响应读不到」——404、连接被断、DNS 失败**全都是它**。
    **判据是 `curl -i -X POST <envId>` 看它返回什么，不是看组件的错误文案。**
    同族：手写探针的事件名要对着所用库版本核实（`code 1001 请更新云函数` 看着像后端旧，
    实际是探针写错了事件名）。当时完整根因见 `docs/history/incidents.md`。
23. **白名单的键必须选稳定的那一层。** `audit-dead-scope` 的死规则白名单一度把**带内容哈希的
    CSS 文件名**算进键里，而 `Blog.*.css` 是共享 bundle ⇒ 同组任意一个组件改样式都会让**全部**
    键失效，「这个组件被改过」被放大成「这个 bundle 里所有规则都变过」，代价是每跑一次构建
    就手工重钉一次名单。**键应该是语义身份**（cid 本身就是组件内容的哈希，改组件必改 cid）。
24. **Windows PowerShell 5.1 会先插值再交给 node，而且无 BOM 的 `.ps1` 按 ANSI 读。**
    仓库已无 `.ps1`，但 `powershell -Command` 仍在用：命令串里的 `$1` / `$变量名` 会被
    当成变量吃掉，中文会被按 ANSI 吞。**改文件用 edit/write 工具，或写进临时 .mjs 再跑**。
25. **脚本里的路径必须从脚本自身位置解析。** Node 侧从 `import.meta.url` 解析，不要用
    `process.cwd()`——跟着进程 CWD 的相对路径（旧 PowerShell 的 `Resolve-Path '..\x'`）
    曾让 `check-dates` 与 `compare-urls` 指向过从未存在的路径。
26. **「在本机一直绿」不等于判据与环境无关；换台机器、换个时区就红。** `check-dates` 这类
    比较源与产物时刻的门禁，**折算必须钉在 `blogConfig.timeZone` 这个显式配置上**，
    偏移量用 `Intl` 按该时刻算，不要硬编码 `+08:00`，也不要 `new Date(裸墙钟)` 按本机时区
    解析（原判据一直靠 +08:00 开发机兜着，CI 一换 `TZ=UTC` 就全线红，见
    `docs/history/incidents.md`）。**验门禁要换时区重跑**：
    `TZ=UTC node scripts/accept.mjs --skip-build`。
27. **一道门禁红了却说不出为什么，等于逼人去本地重跑一遍。** runner 若只把门禁输出里的
    `RESULT:` 一行收进汇总表、其余 stdout 全部丢弃，CI 上就只剩孤零零一个 `FAIL`。
    **失败路径必须把门禁自己的输出原样打出来**——细节在门禁里，不在汇总里。
28. **「一道门禁都没跑，却报全绿」比「门禁自己错了」更危险——两者都是绿灯失效。**
    门禁名单的元素从字符串改成 `{ name, skip, why }` 的同一次改动里，`--only` 的过滤
    拿字符串跟对象比、**永远不匹配**，过滤结果为空集，runner 一路走到汇总照样打出
    `ACCEPTED: all steps green`。**「过滤后为空」必须直接 `exit 2`**，
    且所有按名字匹配名单的地方都要过同一个 `gateName()`。
    同一改动里 `check-ci-triggers.mjs` 也中招：它把元素直接当字符串拼路径，
    得到 `[object Object]`，`existsSync` 一律 false，于是**把名单里每一道都报成
    「不存在」**——它自己会暴露，但那一堆假问题会把真正的缺失埋掉。
29. **「绿灯」这个词要有定义，否则它会退化成「没报红」。** 如果 runner 对 `skipped > 0`
    一律 `exit 0`，而流水线恰好在内存最紧的时刻调用浏览器门禁、它自我放弃，那个绿灯与
    「跑过并通过」在汇报里完全一样。判据是**「绿灯 = 该跑的跑了且跑过了」**，由名单里的
    `skip` 策略逐道对账。同族教训：**CI 上的判据必须能在本机验**（`ACCEPT_FORCE_CI=1`），
    只能到 CI 上才能验的判据，等于没有 CI 相关的判据。
30. **组件 `<style>` / 模板里的注释会被原样输出，所以探针会先信字面量。**
    实测：在 `Base.astro` 的说明注释里贴一句形如 `class="katex"` 的示例，
    那段注释 Astro 原样写进**每一页**的 head，于是按 class 属性统计的探针在
    **六十多个没有公式的页面**上各报出一个假命中。工具先看「文本里出现了」，
    才发现它出现在注释里。
    **判据必须剥掉 `<!-- -->` 与 `<script>`/`<style>` 正文再数落点**，
    且**认标签不认裸字符串**（数 `<span …class="…katex…">`，不是数「出现过 katex」）。
    同族：写说明用词，别贴原始属性串。`check-critical-assets.mjs` 的
    `--selftest` 里有两条专门钉这个（注释里的节点不算、注释里提到不算）。
31. **「改完靠记忆守着」不算接上线——判据要能被注入验证。**
    实测过：把 `hasMath` 强制成 `false`，其余门禁全绿，是产物核对才发现公式页丢了样式
    （纪事见 `docs/history/incidents.md`）。判据正确不等于有保护；
    新门禁/新行为必须走一次红绿双向，注入的坏版本要能被抓住才算数。
    同一条纪律的另一个出口：**失败路径不能是日志墙**。逐页报错会刷屏把真正的落点埋掉，
    按「资源组合」聚合成一条才可用。
32. **看到「新实现与旧基线不一致」，默认怀疑「新框架引入了缺陷」是错的——反过来很常见。**
    缺陷可能在基线那一侧，迁移顺手把它修好了（clannad 纪事见 `docs/history/incidents.md`）。
    判据要**双向**：只查「产物有没有少」，查不到「基线本来就少」。
    同族的第二个教训：**产物比基线多的差异也需要有人审**。
    它是改进还是回归，判据只有一条——看差异方向与根因，不能靠「与线上不一致」搁置。
    覆盖：`check-content-preservation` 盯内容层丢段——一旦富内容渲染被摘掉（比如 `remark-mdc`
    被移除），它会红。对这类判据**先复刻再下结论**（怀疑采样稀就先逐条复刻采样验证）。
33. **「产物里某个数字大得离谱」先查清它是什么，再判是不是缺陷。**
    首页 HTML 大头是客户端排序数据集：`<template data-post-dataset>` 每篇 × 每种排序各一份，
    供 `OrderToggle` 在客户端换排序时重渲染（`<menu data-post-menu>` 只有可见的第一页）。
    **教训落在 HTML 体积上而不是正确性上**：要压体积就得改成交互时再取，
    而不是「删掉多余的卡片」。
    同族：定位元素别用字面量字符串。Astro 会往标签上加 `data-astro-cid-*`，
    `<main id="main-content">` 在产物里根本不是这么写的——按字面量切段会静默
    拿到 `indexOf === -1`，于是「main 之前多少张 / main 之内 0 张」这种
    完全颠倒的结论看起来还很笃定。**用标签正则，不用字符串。**
34. **「产物目录」是仓库约定，不是实现细节——自己推导会在 CI 上静默失效。**
    本机 `dist` 是一个**不入库的 junction → `.output/public`**，CI 的干净 checkout 里没有
    它，Astro 直接把产物写进 `dist/`——两边目录形状不一样，本机却看不出来。
    **产物路径必须跟着其余门禁走**（它们统一读 `dist`，deploy 也是 `folder: dist`），
    不要在门禁里自己推导成 `.output/public`（踩坑纪事见 `docs/history/incidents.md`）。
    **好消息**：这类失效由 skip 策略机制抓住，说明判据做对了。

## 开放项

| 项 | 证据 | 状态 |
| --- | --- | --- |
| 产物 CSS 里有 120 个类名在全站找不到落点 | 实测：约四分之一的类名无落点，其中一部分是 Vue transition 残留（`*-enter-active` 等），另有 Twikoo 运行时渲染的 `tk-*`、katex/shiki 的内部类名 | **未处理**。做成门禁要 ~100 条 allowlist，不划算；但 Vue transition 那批是迁移残留，删掉能实打实减小产物。动 `src/styles/` 前先确认没有组件在运行时加这些 class |
| Twikoo 评论库查不到任何评论 | 对全站文章调 `GET_COMMENTS_COUNT`，带/不带尾斜杠都返回 `count: 0` | **pending**（envId 那处已修，见 incidents 档案；若预期有历史评论，要查 Netlify 上那个函数的数据库） |
| `probe-subtree` 的 profile 模式（垂直剖面 / 空隙 / 对账）该不该并进 `compare-ui-parity` | 它现在不在任何门禁名单里，作为「门禁」等于不存在 | 未处理。它的 tree 模式已被 `--sel=` 完全覆盖，profile 模式是唯一能说清「空隙」的仪器 |
| `compare-dom-live` 退役后丢掉的覆盖 | 它独有的是 head meta 19 条 + 侧栏 widget/footer 计数 3 条，且只硬编码 8 页 | 2026-10-04 退役时未回填。`compare-ui-parity` 的 `SEM_RULES` 已含 head meta，但只有加重档会跑 |
