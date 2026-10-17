# CLAUDE.md

个人博客「Mikuの极光星」（https://blog.sotkg.com）。**2026-10-03 起 Astro 7 直接接管仓库根**，
Nuxt 4 源码树已整体删除。

这份文件只写**下次不看到就会犯错**的东西。写作纪律：

- 只写**可复用的判据**，不写一次性事故叙事——那些在 git 里
  （tag `archive/astro-migration-2026` 与 `git log -p -- CLAUDE.md`），`docs/` 不入库，
  所以判据必须自足：不能靠指向另一份本地文件来解释。
- **不在这里复述可计算的计数**（门禁道数、页数、篇数）——本文件里的每个数字都漂过，
  至少五次。要数字就运行打印它的命令。
- 同族教训合并成一条，不一个坑写两遍；失效的前提条件随条件消失一起删。
- 计划类文档同理：**完成后只留结论、验收证据与回滚条件**，施工单留在 git。

## 常用命令

```sh
pnpm dev                     # 开发
pnpm build                   # SSG 构建（页数看构建日志，别在这里数）
pnpm preview                 # 预览产物（启停由用户管理，代理不得擅自启停）
pnpm typecheck               # tsc -p tsconfig.check.json
pnpm lint                    # ESLint（含 CSS 规则）；本机 pnpm 可能 EBUSY，可改用 npx eslint
pnpm test                    # node --test，纯逻辑直测，不构建
pnpm new                     # 新建文章（写 src/content/posts/<年>/<名>.mdx）
pnpm summary                 # 摘要增量预览（只列待生成，不写盘）；--write 才调模型并写盘
pnpm accept                  # 发布档（release）：构建 + 发布必需门禁；清单只在 scripts/accept.mjs
pnpm accept:maintenance      # 深度维护审计：发布档全量 + CSS/DOM/台账/CDN 等深度门禁
pnpm interaction-check       # 交互门禁，**单独跑**，刻意不进验收流水线
node scripts/accept.mjs --skip-build          # 复用现有 dist/，只跑门禁
node scripts/accept.mjs --only check-dates    # 只跑某几道（调试用）
node scripts/accept.mjs --print-policies      # 只打印门禁的跳过策略矩阵，不跑门禁
ACCEPT_FORCE_CI=1 node scripts/accept.mjs     # 本机按 CI 判定跑（验 CI 上的判据）
node scripts/check-expirations.mjs --selftest # 豁免台账门禁的自检（不读真实台账）
```

## 技术栈与结构

- Astro 7（站点根即仓库根，`src/pages` 文件路由）+ `@astrojs/mdx` v8；
  pnpm 12 + **catalogs 集中管版本**（版本只在 `pnpm-workspace.yaml` 出现一次）
- **零 Vue 岛**：`src/` 下 0 个 `.vue` 文件，`vue` / `@astrojs/vue` 已不在依赖里。
  交互一律走组件内原生 `<script>` + `data-*` 定位；确实要引入岛时先把 `vue()` 加回
  `astro.config.mjs`、`package.json`、`pnpm-workspace.yaml` 三处
- 样式纯 CSS（无 Tailwind、无预处理器）：令牌在 `src/styles/*.css`，组件内 `<style>` 用原生
  CSS 嵌套，CSS 检查走 ESLint（@zinkawaii/eslint-config-css）
- UI 组件全自研（`src/components/` 根下有 `Icon.astro` 与 `ModalHost.astro`，
  其下按 `blog/` `content/` `post/` `partial/` `popover/` `util/` `widget/` 分组），
  第三方仅 `astro-icon` 与 `embla-carousel`
- **内容唯一真相源是 `src/content/**/*.mdx`**（篇数看 `pnpm build` 日志或数文件）；
  **摘要的真相源是 `src/data/summaries.json`**（不在 frontmatter，坑位 34）
- **零 LLM 依赖**：`pnpm summary` 的模型调用是裸 fetch（`scripts/lib/llm.mjs`），
  打 OpenAI 兼容端点，配置在 `.env`（坑位 36）
- **配置分层（动手前先认准该写哪一层）**：内容/分类/友链 → `src/config/blog.ts`；
  第三方脚本、评论（Twikoo）与摘要徽章文案 → `src/config/integrations.ts`（从 `blog.ts`
  迁出，改统计或评论服务只碰这一个文件）；**为对齐旧栈行为而留的布尔开关** →
  `src/config/compat.ts`（每个开关必须写全「保留原因 / 验证证据 / 退出条件 / 复核日期」，
  页面主流程只引用它，不再就地藏 `const PARITY_x = true`）；冻结的主题标识字面量 →
  `src/config/site-meta.ts`（**不要改成读 `package.json`**——会把 `<meta name="generator">`
  从 `Clarity 3.8.0` 变成别的，atom 与页脚跟着变）；导航/页脚/交互默认值 →
  `src/lib/app-config.ts`（**必须能在浏览器求值**，`BlogStats` / `Excerpt` 的内联脚本会
  import 它，历史上一版用 `node:fs` 让 66/67 页抛 `ReferenceError`）；内容 schema 与
  loader → `src/content.config.ts`；构建管线 → `astro.config.mjs`
- **`src/lib/` 分三档，别混**：`src/lib/shared/*.ts` 是**零配置纯模块层**（不许 import
  站点配置、不许碰 `node:`、不许有副作用），配置走**显式绑定口**灌入——
  `configureContentId({ hidePostPrefix })`、`configureTime({ timeZone, language })`；
  `src/lib/client.ts` 是**浏览器 bundle 的唯一入口**，另持一份零依赖复刻
  （`escapeHtml` / `escapeRegExp` / `safelyDecodeUriComponent` / `highlightHtml`），
  因为 `shared/time.ts` 顶层拖整个 blog 配置、`shared/link.ts` 拖 `parse-domain`
  （实测为一个 5 行函数多进 4.4KB）。**barrel `src/lib/shared.ts` 刻意不转出
  `summaries` / `pagination` / `seo`**——它们带 `node:fs` / `node:crypto`，而全站共用的
  根布局会经 barrel 把 node 模块拖进客户端。两条纪律由工具守着：`eslint.config.mjs` 的
  `no-restricted-imports` 禁客户端模块 import `parse-domain` / `config/blog` / shared
  barrel；`tests/client-shared-parity.test.mjs` 用样例对账两份复刻，防「只靠注释约定」的漂移
- **内容管线**：`src/loaders/with-article-meta.ts` 包住 glob loader，补
  `readingTime` / `isPost` / `summary`+`seo`（后者来自 `src/data/summaries.json`）；
  `src/plugins/` 四个 unified 插件**顺序即合同**——`component-fence`（展开 Component
  围栏）与 `heading-ids`（Nuxt slugger 逐字一致的标题 id，**是线上 URL 合同，勿改**）
  都必须排最前，因为 Astro 内建的 heading id 排在**所有**用户插件之后、却尊重已存在的
  id。**MDX 条目走 `deferredRender` 分支、`entry.rendered` 全是 undefined**，所以标题 id
  归一只能在 rehype 层做（坑位 12 的成因即此）
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
- ⚠️ **`dist` 是指向 `.output/public` 的符号链接**（历史遗留，`.gitignore` 忽略两者，
  链接本身不入库）。任何 `find dist -type f` / `du -sh dist` **都会返回 0**——
  `find` 与 `du` 默认不跟随符号链接。统计产物一律用 `find -L dist` / `du -shL dist`，
  或读门禁统一用的 `dist` 口径（坑位 32）

## 验收

### 何时跑门禁（默认不跑）

**默认：改完不主动跑门禁。** 交互式的一两次小改就整跑一遍 `pnpm accept`（含一次完整
构建）太贵，收益却只在极少数改动上兑现。**只在这两种情况下跑**：

1. **用户本次明确要求**（「跑一下门禁」「验收一下」）；
2. **一次性的目标/计划型工作**——一次会话里要连着改许多文件、且需要一个终态验收。

其余情况**改完直接汇报改了什么，把跑不跑交给用户**。别用「构建过了」代替验收，
也**别默认去跑**——那是这条纪律要省掉的开销。

⚠️ **不跑 ≠ 无法验证，但不许假装验过。** 要分清哪些文件动了也不影响任何判据：

- **不被任何门禁读取**：`CLAUDE.md`、`README.md`、`docs/**`（后者还不入库）。
- **被门禁读取**：`src/` 与 `scripts/` 下的源码、以及 ⚠️ **`.github/workflows/*.yml`**
  ——`check-ci-triggers.mjs` 真读它（校验 YAML 可解析、门禁步骤引用的脚本存在、
  部署目录是 `dist`、push main 会触发发布）。**改这个文件至少要保证它是合法 YAML、
  且不引用不存在的脚本**，否则就是把一道门禁弄红。

会进产物的源码改动，其风险由**既有两道兜底**接住——CI 在**部署之前**跑
`pnpm typecheck` 与 `node scripts/accept.mjs --skip-build`
（`.github/workflows/build.yml`，验收步先于 Deploy 步），所以「本地没验」不会变成
「带着红门禁上线」。**据此可以说「按纪律未跑门禁」，但不能说「已验证通过」。**

### 门禁本身

`scripts/accept.mjs` 是**唯一入口**，也是门禁名单的**唯一事实源**：哪些门禁、几道、各挂
什么跳过策略，都只在那一个文件里定义。本文件**不复述名单，也不复述任何计数**——
`node scripts/accept.mjs --print-policies` 打印的就是权威版本。

两个档位（`--profile`，默认 `release`）：

- `release`（`pnpm accept`）= 一次 `pnpm build` + 发布必需门禁。零外网，只连 localhost。
  CI 跑的就是这一档。
- `maintenance`（`pnpm accept:maintenance`）= 发布档全量 + 深度审计（CSS 域 / 台账治理 /
  CDN 合同 / Windows 专属自测等）。

改动时别破坏下面三条原则。先说一个前提：**「不在名单里」有三种，别混为一谈。**
名单是唯一事实源，但以下脚本**刻意不入档**，不是漏接线——`check-summaries-red.mjs` 与
`tab-panels-red.mjs`（红控自检，每例要跑一次真门禁或整次 `pnpm build`，太贵，**单跑**）；
`interaction-check.mjs`（真浏览器交互门禁，`pnpm interaction-check` 单独跑）。另有两个特例：
`check-build-warnings` 由 `accept.mjs` 的 `BUILD_WARNING_GATE` 常量单独接线（读第一步写的
日志，CI 正是自己 build 后 `--skip-build` 复用）；`preview-guard.selftest.mjs` **其实在
maintenance 档**，只是以 `script:` 字段改名挂成 `preview-guard-selftest`。**⇒ 判断「某道门禁
有没有接上」要看 `--print-policies` 的输出，不是拿文件名 grep 名单。**

三条原则：

1. **名单只有这一份。** 本地与 CI 跑的是同一个 `scripts/accept.mjs`，CI 侧只有一句
   `node scripts/accept.mjs --skip-build`。不许再手抄清单——`check-ci-triggers.mjs` 现在
   直接 import 名单校验（手抄漂过的历史见本文件坑位 21）。
2. **加了门禁就要在同一次改动里接进 `accept.mjs` 的名单**，并跑一次红绿双向。接进去之前
   先想清楚它报红时该怎么办。**一道永远红的门禁等价于没有门禁。**
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
   `check-ci-triggers.mjs` 的取名都要走 `gateName()`，否则会静默失配（坑位 27）。

门禁全部是 Node、仓库内 0 个 `.ps1`：跨平台与「本机能跑 = CI 能跑」是**结构保证而不是
约定**。CI 跑发布档全量。

## 提交

- **conventional 主题 + 短要点**。主题一行说清这次改了什么，**不写流水账标题**
  （「顺手修了 A、B、C」这种一律砍掉或拆成独立提交）。正文用短要点，
  **不复述改动过程、不解释为什么现在做**——那些在 `git log -p` 里。
- **小修复直接提交到 `main`**。不要习惯性先开分支，**只有用户明确要求走分支 / PR
  时才建**。`main` 就是部署分支，多一层分支只是把「已上线」降级成「在某个分支上」
- ⚠️ 运行环境若反过来要求「在默认分支上先开分支」，照它执行，但**必须在回复里给出
  快进回 `main` 的一条命令**。提交不在 `main` 上就等于没部署，而「本地全绿、线上没变」
  很容易被当成推送没生效
- 提交前跑一次 `pnpm accept`（发布档）。**门禁红着不提交**；跑不动就明说哪几道没跑，
  拿「构建过了」代替验收等于没验
- ⚠️ **上一句的例外见 `## 验收` 开头「何时跑门禁」**：交互式小改**默认不跑**，
  只在用户本次要求、或一次性的目标/计划型工作时才跑。**Agent 自己不能把「不跑」
  升级成「已验证」**——没跑就说没跑

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

只写**可复用的判据**。一次性事故叙事在 git 历史里（`git log -p -- CLAUDE.md`）。
本节每条判据都要求自足：不引用本仓库任何不入库的文档。

1. **Astro 不做 attribute fallthrough。** `<Icon class="x" />` 的 `class` 会被**静默丢弃**，
   必须显式声明 prop 再合并。已导致封面图丢 `aspect-ratio`、渲染高 6 倍。**推论：合并 class
   之后还要确认它落在哪一层**——`src/components/Icon.astro` 明明合并了 `class`，
   astro-icon 却自己又包了一层 `<span>`，于是 `error-icon` 落外层、`.iconify` 落内层。
   **凡是调用方给图标包装元素显式设了 `font-size` 的地方都要重新量一遍盒子。**
2. **`:global()` 只作用于紧邻的选择器，不向嵌套传播。** 每个面向 slot 内容的层级都要单独写。
   且 `<style>` 默认隔离，写 `.x .y` 会要求 Astro 的 scope id 落在**子组件**根元素上，而它带的是
   子组件自己的 id ⇒ 规则永不匹配。`check-scope-anchors.mjs` 盯这一类。
3. **顶层 `:global(X)` 是丢掉了锚点的规则——它会跑到组件外去。** 在 scoped 框架里，
   顶层的 `:deep(X)` 编译成 `[data-v-<hash>] X`，那个属性选择器**要求祖先里有本组件的
   元素**，它才是锚点；`:global(X)` 却是全站的 X。漏掉的后果不是「样式没生效」，
   而是**样式在不该生效的地方生效了**——比死规则更难发现，因为它看起来是对的。
   修法是把锚点自己写回去（`.feed-group :global(.feed-card)`）。
   ⚠️ **样式迁移早已完工、Nuxt 源码树已删**：`src/` 里剩下的 `:deep(` 与真实 scope id 形态
   `data-v-<hex>` **全部躺在解释这些规则的注释里**，没有一处是活代码。光看字面 `grep` 命中数
   会得出「还有几十处待迁移」的错误结论——**判「还剩几处」要剥掉注释再数**（本文件不复述
   这个计数，它会随注释增删而漂）。别把 `FeedCard.astro` 里的 `data-v-tippy` 算进去：
   那是自定标签，不是 Vue scope id。判据一侧是 `check-scope-anchors.mjs`：棘轮 +
   `scripts/exemptions.json` 台账，台账里的每条也必须在源码里对得上（双向）
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
6. **门禁必须先自检。** 这个仓库里已多次出现「门禁自己错了」而不是「站点错了」。
   **没被看过变红的门禁等于没有门禁。** 每次新门禁都要注入一个真实缺陷验它会红。
7. **仪器自己也要能被证伪。** 两个仪器结论打架时先怀疑仪器。同源两例：断言用
   `if (/\n(?!\r)/.test(s))` 判「有没有裸 LF」——它匹配了**全部**换行（lookahead 看的是
   `\n` **之后**的字符），正确写法 `/(?<!\r)\n/`；以及后台任务读到的脚本可能不是你刚写的
   那份（起完任务先对一眼第一行输出）。
8. **「判断产物变没变」不要用整目录哈希。** 实测连续两次同样源码的构建给出两个不同哈希，
   追下去只有 4 个文件变，**全是构建时间戳**。（当初做这件事的比较工具已随 Nuxt 基线退役；
   判据留着——任何重新引入的产物对比都会再踩一遍。）
9. **「连量两遍一致」不等于「页面是确定的」。** 线上连量 10 次页高跨度 44px，根因是洗牌写在
   `onMounted` 且那个逃生口在线上无效。定稿判据是多次采样判**极差**，而不是单次相等——
   判据本身与工具无关，所以采样工具退役了它仍然成立。
   **静态站不要为了两边「看起来一样」也跟着改成随机。**
10. **断网测量会造出假阳性。** 离线路径拦截跨域 fetch，某页凭空多出 18px。**离线扫描报的
    差值，先用 online 模式复核再定性**。再有：同一浏览器复量只落在容差内的结果要**单列**出来，
    既不能混进「一致」也不能混进「超差」。
11. **live 不是当前源码。** 每条线上差异只有「迁移缺陷 / **部署滞后漂移** / 内容漂移」三种
    可能，**正确动作是部署，不是改源码**；绝不把已知差异加进任何「预期一致」白名单——
    那会把「源码还没部署」这个信号永久静音。
12. **「构建通过 + 门禁全绿 + 产物一字未变」也可能是「代码根本没执行」。** 实测过：
    一批条目的 `entry.rendered` 全是 undefined，因为 glob loader 走 `deferredRender` 分支。
    **⇒ 没有「改完之后产物变了吗」这一项检查，一切「接上了」都是猜的。**
13. **构建会改写正文字面，而所有几何门禁都看不见。** `remark-smartypants` 换的是标点**字形**
    不是盒子——它把 `"…"` 写成 `“…”`、`...` 写成 `…`，页高与计算样式一律量不出来。
    ⚠️ 它在 Astro 侧**默认开着**（`@astrojs/markdown-remark` 判的是 `smartypants !== false`），
    本仓库靠 `astro.config.mjs` 显式写 `smartypants: false` 关掉——**别把它打开**，
    正文的字面形态是内容合同。判据必须是**逐字符计数不等式**（产物次数 ≤ 源次数），
    即 `check-text-literal.mjs`。**一个从不报错的门禁比没有门禁更糟**：它的第一版判「每个
    `…` 在源里都出现过」，结果源里本来就有，注入 `smartypants: true` 照样 exit 0。
14. **「把字符串当 HTML 吐出去」= 静默空白；判据必须是「未求值即失败」。** 存字符串而非节点树
    ⇒ 侧栏 widget 整个空白，**页高看不见**（空白也是合法盒子），**计算样式看不见**
    （压根没有元素）。失效点现在是 `src/lib/meta-slot.ts`：它解析
    `metaSlots[*].content`，**只认** `content-components.ts` 里注册过的 PascalCase 组件，
    其余形态一律**抛错让构建失败**（静默渲染成空白是最坏的失败方式）。`check-mdc-eval.mjs`
    是兜底判据且零歧义：注册表里的组件名与 HTML 原生标签**无一重名**，所以「产物里出现即未求值」
    严格成立。**注册新组件时若名字撞上原生标签，这条判据就废了。**
15. **MDX 节点的「属性」有两套形状；只读对、写错就静默无效。** `addClass` 对 MDX 节点
    是无声空操作；新增的属性对象**必须带 `type: 'mdxJsxAttribute'`**，裸 `{name,value}`
    会被 hast→estree 静默丢弃。就在 `src/plugins/prose.ts`，判据与成因写在文件里。
16. **用文本当元素键不成立；判据顺序必须是「先全量、再逐元素」。** 用 `textContent` 前几十字符
    当签名会重复。正确顺序是**两道门槛**：先算全量取值分布，分布相同的属性一律**不报**逐元素差异。
    改这类核心比较逻辑**必须**注入真实缺陷验红绿双向。
17. **读调用点不等于知道语义。** 典型是极性判断：`useElementVisibility(anchorEl)` 加
    `:class="{ expand }"` 看不出是「可见时加」还是「不可见时加」，只能靠四种滚动状态实测定出来
    （现役实例见 `src/components/partial/Pagination.astro`，`IntersectionObserver` 复现版
    曾在极性上写反、四种状态全与线上相反）。同族：`getComputedStyle().marginRight` 对 flex item
    的 `margin: auto` 返回**解析后的实际像素**，两侧不同说明的是**容器剩余空间**不同。
18. **「量了外框」可以连续错三次；列测量清单的依据必须是遍历出来的普查表。** 补到十几条
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
    写进本文件的每个数字都漂过（至少五次）。
22. **「跨域被拦截」是客户端的推断，不是证据。** Twikoo 把 `xhr.status === 0` 一律映射成
    CORS 错误，而 0 的真实含义是「响应读不到」——404、连接被断、DNS 失败**全都是它**。
    **判据是 `curl -i -X POST <envId>` 看它返回什么，不是看组件的错误文案。**
    同族：手写探针的事件名要对着所用库版本核实。实测发 `GET_COMMENTS` 得到
    `{"code":1001,"message":"请更新 Twikoo 云函数至最新版本"}`，看着像后端版本落后，
    实际是**该事件名在这个版本里根本不存在**（已改名 `COMMENT_GET`，参数形状也不同）。
    **判据是「拿不到东西先怀疑探针」，不是相信报错文案。**
    （现役记录见 `src/components/widget/RecentComments.astro` 的文件头。）
23. **白名单的键必须选稳定的那一层。** `audit-dead-scope` 的死规则白名单一度把**带内容哈希的
    CSS 文件名**算进键里，而 `Blog.*.css` 是共享 bundle ⇒ 同组任意一个组件改样式都会让**全部**
    键失效，「这个组件被改过」被放大成「这个 bundle 里所有规则都变过」，代价是每跑一次构建
    就手工重钉一次名单。**键应该是语义身份**（cid 本身就是组件内容的哈希，改组件必改 cid）。
24. ⚠️ **脚本里的路径必须从脚本自身位置解析，不要用 `process.cwd()`。** Node 侧从
    `import.meta.url` 解析——跟着进程 CWD 的相对路径（旧 PowerShell 的 `Resolve-Path '..\x'`）
    曾让 `check-dates` 与两个比较门禁（一个比冻结基线、一个比线上）指向过从未存在的路径。
    同族陷阱：**Windows PowerShell 5.1 会先插值再交给 node，且无 BOM 的文件按 ANSI 读**——
    命令串里的 `$1` / `$变量名` 被当成变量吃掉，中文被按 ANSI 吞。仓库已无 `.ps1`，
    但 `powershell -Command` 仍在用。**改文件用 edit/write 工具，或写进临时 .mjs 再跑。**
25. **「在本机一直绿」不等于判据与环境无关；换台机器、换个时区就红。** `check-dates` 这类
    比较源与产物时刻的门禁，**折算必须钉在 `blogConfig.timeZone` 这个显式配置上**，
    偏移量用 `Intl` 按该时刻算，不要硬编码 `+08:00`，也不要 `new Date(裸墙钟)` 按本机时区
    解析（原判据一直靠 +08:00 开发机兜着，CI 一换 `TZ=UTC` 就全线红，见本条前半的时区事故）。
    **验门禁要换时区重跑**：
    `TZ=UTC node scripts/accept.mjs --skip-build`。
26. **门禁的失败路径必须把门禁自己的输出原样打出来，且「绿灯」要有定义。**
    两层含义：
    - **细节在门禁里，不在汇总里。** runner 若只把 `RESULT:` 一行收进汇总表、其余 stdout
      全部丢弃，CI 上就只剩孤零零一个 `FAIL`，等于逼人去本地重跑一遍。
    - **「绿灯 = 该跑的跑了且跑过了」，不是「没报红」。** runner 对 `skipped > 0` 一律
      `exit 0` 时，流水线恰好在内存最紧的时刻调用浏览器门禁、它自我放弃，那个绿灯与
      「跑过并通过」在汇报里完全一样。**判据是由名单里的 `skip` 策略逐道对账。**
      同族：**CI 上的判据必须能在本机验**（`ACCEPT_FORCE_CI=1`）——
      只能到 CI 上才能验的判据，等于没有 CI 相关的判据。
27. **「一道门禁都没跑，却报全绿」比「门禁自己错了」更危险——两者都是绿灯失效。**
    门禁名单的元素从字符串改成 `{ name, skip, why }` 的同一次改动里，`--only` 的过滤
    拿字符串跟对象比、**永远不匹配**，过滤结果为空集，runner 一路走到汇总照样打出
    `ACCEPTED: all steps green`。**「过滤后为空」必须直接 `exit 2`**，
    且所有按名字匹配名单的地方都要过同一个 `gateName()`。
    同一改动里 `check-ci-triggers.mjs` 也中招：它把元素直接当字符串拼路径，
    得到 `[object Object]`，`existsSync` 一律 false，于是**把名单里每一道都报成
    「不存在」**——它自己会暴露，但那一堆假问题会把真正的缺失埋掉。
28. **组件 `<style>` / 模板里的注释会被原样输出，所以探针会先信字面量。**
    实测：在组件的说明注释里贴一句形如 `class="…"` 的示例，那段注释 Astro 原样写进
    **每一页**的产物，于是按 class 属性统计的探针在**几十个根本没有该元素的页面**上
    各报出一个假命中。工具先看「文本里出现了」，才发现它出现在注释里。
    **判据必须剥掉 `<!-- -->` 与 `<script>`/`<style>` 正文再数落点**，
    且**认标签不认裸字符串**（数整个标签，不是数「出现过某个词」）。
    同族：写说明用词，别贴原始属性串。`check-critical-assets.mjs --selftest` 有两条专门
    钉这个：「注释里的样式表不算节点（假阳性回归）」「script 正文里的字符串不算节点」。
    ⚠️ **判据的举例会漂，判据本身不会**：这条当初是照着 KaTeX 的假命中写的，而数学管线
    已于 2026-10-15 整体摘除、katex 在 `src/` 里已不存在。**「剥注释、认标签」与那个例子
    无关**，别因为例子死了就把判据一起删。
29. **「改完靠记忆守着」不算接上线——判据要能被注入验证。**
    两个出口，缺一不可：
    - **新门禁/新行为必须走一次红绿双向**，注入的坏版本要能被抓住才算数。
      ⚠️ **靶子要挑当下活着的**：本条原先举的例子是把 `hasMath` 强制成 `false`，
      而 `hasMath` 已随数学管线（2026-10-15）零实现——照抄那个例子等于在验一段不存在的
      代码，注入什么都不会变红。**判据正确不等于有保护。**
    - **失败路径不能是日志墙。** 逐页报错会刷屏把真正的落点埋掉，
      按「资源组合」聚合成一条才可用。
    同族前提：**「构建通过 + 门禁全绿 + 产物一字未变」也可能是「代码根本没执行」**——
    实测过一批条目的 `entry.rendered` 全是 undefined，因为 glob loader 走 `deferredRender`
    分支。**⇒ 没有「改完之后产物变了吗」这一项检查，一切「接上了」都是猜的。**
30. **看到「新实现与旧基线不一致」，默认怀疑「新框架引入了缺陷」是错的——反过来很常见。**
    缺陷可能在基线那一侧，迁移顺手把它修好了（clannad：Nuxt Content 在 MDC 容器与
    tab 槽位内不渲染 GFM，整段攻略都丢了，基线可见正文仅 2,037 字符 vs Astro 16,231）。
    判据要**双向**：只查「产物有没有少」，查不到「基线本来就少」。
    同族的第二个教训：**产物比基线多的差异也需要有人审**。
    它是改进还是回归，判据只有一条——看差异方向与根因，不能靠「与线上不一致」搁置。
    覆盖：`check-content-preservation` 盯内容层丢段——它从源 `.mdx` 抽样散文行、在**渲染后的
    页面**里找它们是否活着（映射必须逐字镜像 `generateId`，干草堆必须来自产物，两条都别动）。
    ⚠️ 别再拿「摘掉 `remark-mdc` 会红」当它的例子：2026-10-15 摘掉时它**没有红**，因为摘除后
    正文照样穿过管线——这条门禁证明的是「内容有没有穿过管线」，不是「某个插件还在不在」。
    对这类判据**先复刻再下结论**（怀疑采样稀就先逐条复刻采样验证）。
31. **「产物里某个数字大得离谱」先查清它是什么，再判是不是缺陷。**
    首页 HTML 大头是客户端排序数据集：`<template data-post-dataset>` 每篇 × 每种排序各一份，
    供 `OrderToggle` 在客户端换排序时重渲染（`<menu data-post-menu>` 只有可见的第一页）。
    **教训落在 HTML 体积上而不是正确性上**：要压体积就得改成交互时再取，
    而不是「删掉多余的卡片」。
    同族：定位元素别用字面量字符串。Astro 会往标签上加 `data-astro-cid-*`，
    `<main id="main-content">` 在产物里根本不是这么写的——按字面量切段会静默
    拿到 `indexOf === -1`，于是「main 之前多少张 / main 之内 0 张」这种
    完全颠倒的结论看起来还很笃定。**用标签正则，不用字符串。**
32. **「产物目录」是仓库约定，不是实现细节——自己推导会在 CI 上静默失效。**
    本机 `dist` 是一个**不入库的 symlink → `.output/public`**，CI 的干净 checkout 里没有
    它，Astro 直接把产物写进 `dist/`——两边目录形状不一样，本机却看不出来。
    **产物路径必须跟着其余门禁走**（它们统一读 `dist`，deploy 也是 `folder: dist`），
    要在门禁里自己推导成 `.output/public`（`check-critical-assets` 初版就这么写，
    本机一路绿、推上去自我放弃）。
    **好消息**：这类失效由 skip 策略机制抓住，说明判据做对了。
33. **⚠️ 删 YAML 键时，块标量（`key: |` / `key: >`）不是「一行」。**
    正则 `/^description:[ \t]*(?:.*\n(?:[ \t]+.*\n?)*)?/m` 只吃掉 `description: |` 那一行，
    把**缩进的多行正文留在 frontmatter 里**。YAML 会把那段缩进当成前一个键的续行或
    后续内容——实测 `date: 2025-12-10 05:00:00` 被污染成 `2025-12-11T20:00:00Z`，
    而**几何 / DOM 门禁全部看不出来**（date 变了但盒子没变）。只有 `check-dates`
    与 `check-summaries` 这类**内容层**门禁抓到。
    **判据**：批量改 frontmatter 后必须跑 `check-dates`（它比 source↔产物时刻），
    且改动前后 `pnpm summary` 的 `unchanged` 计数应当保持不变（`sourceHash` 整段排除
    frontmatter，所以**只修 frontmatter 不该让任何条目变成待生成**——若变了说明正文被动过）。
    同族：`description:` 若出现在**正文代码块**里（如 1Panel 应用声明模板），
    按全文 grep 的门禁会误报——判据必须限定在 frontmatter 边界内，见 `check-summaries`。
34. **摘要真相源是 `src/data/summaries.json`，不在 frontmatter。** `summary`（完整长摘要，供
    Excerpt / JSON-LD / Atom / llms.txt / 列表卡片）与 `seo`（≤150 字，供 meta / og）是两个
    字段，刻意分开：SEO 结果摘要在 `SEO_DESCRIPTION_MAX`（=150 字）处截断，长摘要进 meta 是白占权重。
    键 = 条目 id（`content-id.ts` 的 URL 合同）。生成来源是**全局单值** `$meta.model`，
    **为空则徽章不渲染**——没有可信来源就不标，别显示一个猜的模型名。
    徽章显示的是它推导出的短名（坑位 37），不是完整 ID。
    `sourceHash`（正文 sha256 前 16 位）是增量判据：**正文没变就不重生成**，
    人工润色也不会被覆盖（要重写用 `pnpm summary --force` / `--only <id>`）。
    一条不变量由 `check-summaries` 守着：键集合 == `posts/` 下的条目 id 集合，多一个少一个都红。
    **`seo` 另有三条判据**（≤150 / 非空 / frontmatter 无残留），因为空 `seo` 的后果是
    meta description 空白：`??` 对空串不生效，loader 的 `if (rec?.seo)` 又会挡掉它。
    红绿双向自检是 `scripts/check-summaries-red.mjs`（注入幽灵键 / 缺键 / seo 超长 /
    seo 空串 / frontmatter 残留，逐条断言真门禁会变红，再断言还原后回绿；
    同时用 `write-1panel-app.mdx` 验证正文代码块里的 `description:` 不误报）。
    约 1 秒，**单跑**，不进发布档——与坑位 22 的 `tab-panels-red.mjs` 同一约定。
35. **⚠️ 生成失败时必须让那个键「完全没被碰过」，尤其不能盖新的 `sourceHash`。**
    `applyEntry` 在解析失败 / 调用失败时直接 return 是一条硬要求，不是优化：
    盖上哈希 ⇒ 下次 `hashSource(src) === rec.sourceHash` 成立 ⇒ 判成 `unchanged`
    ⇒ 那篇文章的摘要**永远不会再生成**，而 `pnpm summary` 报「已同步」、
    `check-summaries` 报绿、门禁全红绿。**一次网络抖动变成永久静默丢失，且零信号**
    ——坑位 29 的假绿，触发条件只是「写回时顺手把 hash 一起存了」。
    同族：`--only` 必须压过 `--force`（`ONLY ? id === ONLY : FORCE || …`），
    写成 `FORCE || ONLY === id` 会让 `--force --only x` 静默变成全量重算（条目数见 `summaries.json`）。
    副作用也要显式：写回后逐条打印新旧字数，让人看见「人工润色被覆盖了几条」。
36. **模型配置在 `.env`，读法是 node 原生的 `--env-file-if-exists`**（见
    `package.json` 的 `summary` 脚本），**不装 dotenv**——全仓库维持零 LLM 依赖，
    `scripts/lib/llm.mjs` 是裸 fetch。`LLM_MODEL` 有两个身份：请求用的模型，
    与写进 `$meta.model` 的徽章署名，**两者必须是同一个值**，否则全站文章会署一个
    不是它们来源的名字。`$meta.model` 只在**真的生成过东西**时更新：
    跑个 no-op 就把全站署名改掉是另一种撒谎。
    密钥唯一的读取点是 `authHeaders`，错误路径只抛状态码与 provider 的 message，
    **不打 request body / headers**（日志会进 issue 与 CI artifact）。
    `seo` 在生成侧恒过一遍 `clampDescription`（缺失 / 空串 / 超长一并覆盖），
    门禁侧另有非空判据——两侧都堵，比只在渲染期截断便宜。
37. **⚠️ 别在代码里硬编码「厂商 slug → 展示名」映射表。** 徽章要显示短名
    （`deepseek/deepseek-flash` 是 21 字符，而徽章是 `0.75rem` 胶囊），
    最省事的做法是抄一张 `VENDOR_NAMES` 表——**那是把开放集合写进代码**：
    加个厂商就得改一行代码，而漏改的后果很隐蔽（`Moonshotai Kimi K2` 那种冗余）。
    实测**不需要任何厂商知识**也能全部推对：`moonshotai/kimi-k2` → `Kimi K2`、
    `anthropic/claude-sonnet-4.5` → `Claude Sonnet 4.5`、`x-ai/grok-4` → `Grok 4`。
    规则只有两条：标签**只由型号段构成**（厂商 slug 是路由命名空间，读者不认识），
    外加**厂商首词 == 型号首词时剥掉首词**（`deepseek/deepseek-flash`）。
    ⚠️ 去重判据必须限定在**首词**：早先按「厂商各词 × 型号任意词求交集」，
    `meta-llama` 的 `llama` 命中了 `llama-4-70b` 的首词，整个型号被剥成 `4 70b`
    ——只剩版本号碎片，比显示长名字糟得多。
    唯一无法推导的大小写例外是 `gpt`/`llm` 这类型号自带的品牌词，
    那两张小集合是**拼写**不是厂商知识，可以留。
    完整 ID 始终留在 `$meta.model`（复现调用需要那个字符串），
    `$meta.modelLabel` 是可选的显式短名（`--model-label`），缺省即自动推导。
    实测产物：`$meta.model = "deepseek/deepseek-flash"` ⇒ 每页徽章渲染为 `Flash`（不是完整 ID）。
38. **⚠️ 判据要能被证伪，而「中文没有词边界」是最常见的永红来源。**
    精简门禁时实测到两类绿灯失效，形态不同但同一根因——**没人注入过真实缺陷**：
    - **永红**：`audit-deferred` 的 `/留空/` 命中了 `placeholder: '留空表示未更新'`。
      中文没有 `\b`，照搬英文那两条 `TODO`/`stub` 的「单词」写法必然误伤正常文案。
      修法不是改文案迁就门禁，是给中文标记加**上下文**约束（这里用
      `(?:=|return)\s*["']…["']` 并排除 `placeholder`/`label` 这类「本就是提示用户」的字段）。
    - **永绿**：已删除的 `check-anchor-classes` 曾用 `.article` 与 `max-width:100%` 两条
      **子串**判据，实测命中分别来自 `.article-card` 与 `fit-content`/`min-width` 里的无关规则，
      而目标文件早已被打进共享 bundle、不再是独立文件。**它因此从不报红，最后被删掉**——
      这就是「永绿」比「永红」更隐蔽的地方：没有红灯提醒你它已经失效。
    **同族教训**：判据「看起来在测某件事」不等于它在测那件事。
    **每个子串/正则类判据都要问一句「这段文本还能从哪儿来」**——
    带前缀同族的 class（`.article` vs `.article-card`）、同属性的其它写法
    （`max-width` vs `min-width`）、前缀相同的标识符（`sort` vs `sortOrder`）。
    要判唯一性就用**集合成员判定**（`cls.split(/\s+/).includes('article')`）或带否定前瞻的整词正则。
    这也是 CLAUDE.md 坑位 16「键必须选稳定的那一层」在选择器一侧的同型。
39. **合并门禁前先证明重复是「逐字」或「真子集」，否则是在搬代码不是去重。**
    实测（这一例**已完成**：`check-flip-gates` 已并入 `check-list-controls` 并删除，
    本条留的是判据不是待办）：两道门禁的 Toggle/Slider 选择器判据
    **md5 相同**、连报错文案都一样，`maskNonCode` 在三道门禁里也是逐字副本。
    判据是真子集时才可删：list-controls 的 wrapper 判据覆盖 3 页且多两个更严的
    `data-list-transition-*` 钩子，flip-gates 只覆盖 2 页的 class 形态 ⇒ 后者是前者子集。
    **⚠️ 但判据「不相交」时不要硬合**：`check-icon-swap`（`<use>`/symbol 闭包）与
    `check-icon-box`（CSS display 几何）看着都是「图标」，实则一个要 CSS 规则解析器、
    一个没有，合进来等于把两套解析器和两套自检体系缝在一起——那是**变复杂**不是变简单。
    那种情况该做的是补齐弱的那道（icon-box 当时零自检，补完 7 例当场抓出
    「父级 flex 上下文只计数、不满足判据」的真缺陷），而不是删掉或合并。

## 开放项

| 项 | 证据 | 状态 |
| --- | --- | --- |
| 产物 CSS 里有约四分之一类名在全站找不到落点 | 其中一部分是**运行时才有**的类：Twikoo 渲染的 `tk-*`、Shiki 的内部类名、以及原生 `<script>` 挂上的 `*-enter-active` 等 | **未处理**，且**不要照「迁移残留」去删**。⚠️ 那些 `*-enter-*` **名字像 Vue transition，实现是手写 transition**：`src/styles/animation.css` 定义 `.collapse-enter-*` / `.float-in-*`，由 `src/components/blog/BlogSidebar.astro` 用 `COLLAPSE_ENTER`/`COLLAPSE_LEAVE` 数组在运行时切换（`src/components/content/Tab.astro` 另有 `.dropdown-enter-*`）。**删掉它们会直接删坏折叠动画。** 真正无人接手的是死 CSS：`audit-dead-scope.mjs` 明确把这一族排除在外，`check-dead-css` 已于 2026-10-04 退役。要现状就自己 grep **产物**重新统计，别引用任何文档里的数字 |
| Twikoo 评论库查不到任何评论 | 对全站文章调 `GET_COMMENTS_COUNT`，带/不带尾斜杠都返回 `count: 0` | **pending**（envId 那处已修，见 incidents 档案；若预期有历史评论，要查 Netlify 上那个函数的数据库） |
| `AI excerpt` / `excerpt-content` 两条断言的自动覆盖 | 原 `check-integration` 有这两条，精简时移交给了 `interaction-check.mjs`——但那道门禁**不进流水线** | **未处理**。若要它们自动生效，应加进 `check-affordances`（release 档、只读 dist）而不是加回 `check-integration` |

## Agent skills

### Issue tracker

GitHub Issues in `PaloMiku/blog-v4`; every `gh` command carries `-R PaloMiku/blog-v4`（本 clone 里 `gh` 会优先解析 `upstream`）. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to the role names (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`); `wayfinder:*` 不是 triage 角色. See `docs/agents/triage-labels.md`.

### Domain docs

single-context（一个仓库共用根目录 `CONTEXT.md`，架构决定放 `docs/adr/`）. See `docs/agents/domain.md`.
