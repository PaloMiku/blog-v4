# CLAUDE.md

个人博客「Mikuの极光星」（https://blog.sotkg.com）。**2026-10-03 起 Astro 7 直接接管仓库根**，
Nuxt 4 源码树（`app/` `content/` `server/` `shared/` `modules/` `patches/` `remark-plugins/`
`nuxt.config.ts` `blog.config.ts` …）已整体删除，`astro-site/` 这个过渡目录也不再存在。
上游 L33Z22L11/blog-v3（Clarity 主题）的选择性批次同步随 Nuxt 侧一起冻结。

## 常用命令

```sh
pnpm dev                     # 开发
pnpm build                   # SSG 构建，68 页，产物在 dist
pnpm preview                 # 预览产物
pnpm typecheck               # tsc -p tsconfig.check.json
pnpm lint                    # ESLint（含 CSS 规则；本机 pnpm 可能 EBUSY，可改用 npx eslint）
pnpm new                     # 新建文章（写 src/content/posts/<年>/<名>.mdx）
pnpm accept                  # 基础验收（默认档，~35s，零网络零浏览器）
pnpm accept:full             # 加重档：线上对比，~20-25min，仅切换/发布前跑
pnpm freeze-baseline         # 重新冻结 Nuxt 基线（见「冻结基线」一节）

powershell -File scripts/acceptance.ps1   # 同 pnpm accept（需先自行确保 dev server 已停）
                                         #   -Profile full   加重档（同 pnpm accept:full）
                                         #   -Styles   再加 1600 浅色计算样式对比（仅 full）
                                         #   -Mobile   再加 390×844 的页高 + 计算样式对比（仅 full）
                                         #   -Dark     再加深色下的计算样式对比（仅 full）
node scripts/interaction-check.mjs        # 交互门禁，**单独跑**，不要塞进流水线
node scripts/probe-subtree.mjs --sel='<css>'        # 逐节点几何对比
node scripts/probe-subtree.mjs --sel='<css>' --mode=profile   # 垂直剖面：空隙、垂直带、对账
node scripts/freeze-baseline.mjs --help   # 重新冻结 Nuxt 基线的用法
```

## 技术栈与结构

- Astro 7（站点根即仓库根，`src/pages` 文件路由）+ `@astrojs/mdx` v8 + `remark-mdc`
  （frontmatter 解析）；pnpm 12 + **catalogs 集中管版本**
  （`package.json` 全是 `catalog:` 引用，版本只在 `pnpm-workspace.yaml` 出现一次，5 组 46 条）
- **零 Vue 岛**：`src/` 下 0 个 `.vue` 文件，`vue` / `@astrojs/vue` 已于 2026-10-03 摘除
  （`package.json` / `pnpm-workspace.yaml` 的 `ui` catalog / `astro.config.mjs` 的 `vue()`），
  产物里搜不到任何 Vue runtime。交互一律走组件内原生 `<script>` + `data-*` 定位；
  确实要引入岛时先把 `vue()` 加回这三处
- 样式纯 CSS（无 Tailwind、无预处理器）：令牌在 `src/styles/*.css`，组件内 `<style>` 用原生 CSS 嵌套，
  CSS 检查走 ESLint（@zinkawaii/eslint-config-css）
- **组件示例页靠 `Component` 围栏**：`src/content/previews/example.mdx` 里每个组件写成一个
  ```` ```Component [Alert.astro] ```` 围栏，正文就是实际会写的 MDX，由
  `src/plugins/component-fence.ts` 展开成「组件/用法/源码」三页签（源码从 `src/components/`
  读盘）。文件不在 `components/content/` 下时补 `source=<相对 src 的路径>`。门禁
  `check-component-fence.mjs` 验它与磁盘文件逐字一致
- UI 组件全自研（`src/components/` 下 `blog/` `content/` `post/` `partial/` `popup/` `util/` `widget/`），
  第三方仅 `astro-icon` 与 `embla-carousel`
- **内容唯一真相源是 `src/content/**/*.mdx`**（63 个文件）。接管前的 `content/**/*.md` 原文树
  与 `mdc-to-mdx` codemod 已退役（转换报告归档在 git 历史：`git show a4603b0^:docs/mdc-to-mdx-report.md`）。
- 三层配置分工：内容/分类/友链 → `src/config/blog.ts`；导航/页脚/交互默认值 → `src/lib/app-config.ts`；
  内容 schema 与 loader → `src/content.config.ts`；构建/module → `astro.config.mjs`
- 端点（`src/pages/`）：`/api/stats`、`/atom.xml`、`/subscriptions.opml`、`/llms.txt`、
  `/search-index.json`、`/raw/*.md`（63 篇原文）
- 文章可用 frontmatter `permalink` 自定义 URL；`hidePostPrefix` 开启时 /posts/xxx 显示为 /xxx
- `build.format: 'directory'` ⇒ **`Astro.url.pathname` 带尾斜杠**。`BlogSidebar` 的
  `currentMark` 写成 `path === item.url` 时必须用 `pathname === '/'` 之类的归一化，
  否则首页因为 `item.url` 恰好是 `/` 而**巧合正确**（见坑位 27）
- dev / preview 服务器的启停由用户自行管理，代理不得擅自启动或杀掉
- ⚠️ **`dist` 是指向 `.output/public` 的符号链接**（Nuxt 时代留下的路径，本仓库的
  `.gitignore` 忽略 `dist` 与 `.output`）。任何 `find dist -type f` / `du -sh dist`
  **都会返回 0**——`find` 与 `du` 默认不跟随符号链接。统计产物一律用
  `find -L dist` / `du -shL dist`，或直接写 `.output/public`。
  2026-10-03 收尾审计时在这里踩过一次，误以为产物是空的。

## 冻结基线（`baseline/nuxt/`）

接管后 Nuxt 源码树没了，`pnpm generate` 不再存在，而 7 道离线门禁仍需要一个
「Nuxt 侧长什么样」的锚点。锚点是一次**冻结的本地快照**，由 `scripts/freeze-baseline.mjs` 生成：

- 2026-10-03 冻结自提交 `fa9f2b3`（当时工作区干净），67 路由 / 120 文件 / 6.65 MB
- 只收 `*.html` `*.css` `*.xml`——完整产物 38 MB 里 28.9 MB 是 589 个 JS chunk，没有门禁读它
- **本目录不入库**（根 `.gitignore` 有 `baseline/`）。换机器或 CI 上这 7 道门禁会报
  「基线缺失」，那是**有意的信号**，不是 bug
- 重新冻结需要 Nuxt 源码树（已删），所以实际上**不能再冻结**。`freeze-baseline.mjs` 保留是为了
  让这个约束有个显式的执行入口和文档

## 验收

`scripts/acceptance.ps1` 是单一验收入口：**2 步构建 + 35 步**。

| 组 | 数量 | 成员 |
| --- | --- | --- |
| 构建 | 2 | `pnpm install`、`pnpm build`（只构建一次，所有门禁共用同一个 `dist`；日志落在 `.astro-compare/acceptance-build.log`） |
| PowerShell 静态门禁 | 11 | `check-integration` `check-layout` `check-anchor-classes` `check-dead-css` `check-assets` `compare-urls` `compare-titles` `check-content-preservation` `check-dates` `audit-deferred` `audit-image-pipeline` |
| 边界/源码门禁 | 3 | `audit-dead-scope`（`$knownDeadScope = 3`）`audit-css-blocks` `check-ci-triggers` |
| 依赖边界 | 1 | `check-self-contained` |
| 产品门禁 | 12 | `check-icon-swap` `check-flip-gates` `check-list-controls` `check-dropped-css` `check-affordances` `check-scope-anchors` `check-heading-ids` `check-text-literal` `check-mdc-eval` `check-aria-current` `check-icon-box` `check-component-fence` |
| 仪器自检 | 1 | `preview-guard-selftest`（**只属于 `full` 档**，见下） |
| 线上门禁 | 7 | `live:sitemap` `live:head` `live:ui-parity` `live:style-parity` `live:ui-parity-mobile` `live:style-parity-mobile` `live:style-parity-dark` |
| 运行时 DOM | 1 | `check-runtime-dom`（起本地 preview + 无头 Chrome，交互后读活的 DOM；**唯一不看静态产物**的门禁，~23s） |
| 构建告警 | 1 | `check-build-warnings`（读步骤 2 那次构建的日志，**不再自己构建**） |

### 分档：本地只跑基础档，切换/发布前才跑 full

`acceptance.ps1` 带 `-Profile`（`offline` / `full`，**默认 `offline`**）。错档由
`ValidateSet` 直接拒（`-Profile ofline` 是参数绑定错误，不是静默回落）。

| 档 | 入口 | 内容 | 实测墙钟 |
| --- | --- | --- | --- |
| `offline`（默认） | `pnpm accept` | 29 道只读 `dist/` 与 `src/` 的门禁 + `check-build-warnings`，**零网络、零浏览器、不占端口** | **33.9 s，36/36 绿** |
| `full` | `pnpm accept:full` | 上面 + `preview-guard-selftest` + `live:sitemap` / `live:head` / `live:ui-parity` | **~20–25 min**，大头是 `live:ui-parity` |

`-Styles` / `-Mobile` / `-Dark` 只影响 `full`。

**默认档在 2026-10-03 从 `full` 改成 `offline`**，这是用户的明确决定。原先把 `full`
设为默认的理由（收窄默认值与悄悄丢门禁是同一种错）**在实践上是错的**：默认档要 20 分钟，
于是谁都不会跑，重档等于永远不存在——那比它要防的失败更糟。现在的约定是
**本地只做基础扫描，重档必须显式点名**。

`live:ui-parity` 的成本实测：**63 页 × 两侧，约 20 s/页**（`live:sitemap` 与 `live:head`
很快，大头全在这一道）。它贵在每页都要真实 headless Chrome 导航、跨域请求全拦以固定
前提、测不稳还要重测。**这三道是唯一能看见「Astro 生成的 URL 集合内部自洽但与线上不同」、
从而把切换变成全站 404 而所有离线门禁全绿的仪器**——所以别删，只是别默认跑。

`preview-guard-selftest` 归在 `full` 有三条理由，其中第三条是硬冲突：

1. 它**不验站点**，只验 `preview-guard` 的端口协商——只有马上要跑需要它的
   `live:*` 浏览器门禁时它才有意义。
2. 它是全流水线最贵的一步，而且比旧注释自称的 ~30 s 贵得多：实测 **120.8 s**。
   `waitUp` 每次都 shell 出去跑一次 PowerShell `Get-NetTCPConnection` 轮询，
   每次 preview 启动都是真的 `astro preview`。
3. 它**硬编码 4391 / 4393** 并在其上 spawn/kill 进程。2026-10-03 第一次跑
   `offline` 档时它就是红的：用户自己起了一个 preview 占着 4391，而自检的
   「别人的 preview」场景正好落在那个端口上。`CLAUDE.md` 明写 preview 服务器
   由用户管理，一个会去碰用户可能正占用的端口的自检，**无论多快都不该在日常档里**。

`interaction-check.mjs` **两档都不进**（§4a 已记：流水线里不可靠、单跑可靠）。
它原先被怀疑的元凶是「对着共享工作树再跑一次全量构建」，而第 5 步已经不这么做了——
但这只是假设不是实测，要验就得把它接回 `offline` 档跑一次。

### 门禁耗时（2026-10-03 实测单步墙钟）

**改前 → 改后：`offline` 档 150.8 s（且 1 道红）→ 33.9 s（36/36 绿）。** 三处：

- `audit-css-blocks.mjs` 的 BOM 段写的是 `walk(ROOT)`（仓库根）而不是 `walk(SRC)`，
  于是把 `node_modules` 的 5.8 万个文件递归了一遍，只为筛出其中的 `.astro` / `.css`
  —— **21.3 s → 0.18 s**。修前它是全套离线门禁里最慢的一道，第二名 `check-dropped-css`
  只有 1.1 s。
- `check-build-warnings` 原本为了拿日志自己再跑一次隔离构建（`--outDir <tmp>`），
  现在读步骤 2 已经写下的日志 —— **省掉一次 ~15 s 的全量构建**（该步 0.3 s），
  顺带取消了当年「它必须跑在最后、因为它会打开一个让浏览器门禁变 flaky 的窗口」
  这个排序约束。`check-build-warnings.ps1` 的 `-LogPath` 早就有，只是没接上。
  代价是它拿不到构建退出码了——不需要，步骤 2 的 `$LASTEXITCODE` 就在管这件事，
  而且是同一次构建。
- `preview-guard-selftest` 移出日常档 —— 见上，省掉 120.8 s 并消除一处端口冲突。

**一道门禁一个进程**是这个结构的固定成本：29 道 ≈ 11 s 纯解释器启动开销
（PowerShell 每道 ~0.4 s，node 每道 ~0.2 s）。也就是说 33.9 s 里有约三分之一是
`powershell.exe` / `node.exe` 的冷启动，真要再压就得把门禁合并成单个进程内
runner，那是一次结构性改动，不在当前范围内。剩下的 33.9 s ≈ 3 s install +
15 s build + 14 s 门禁，门禁本身已经很平（最慢的 `check-dead-css` 1.4 s）。

**两道存在但没接线的门禁**（§85.4 的老问题，接管后更需要处理）：

| 脚本 | 状态 |
| --- | --- |
| `collect-evidence.ps1` | 跑得通、exit 0，但不在 `$gates` 里 |
| `compare-dom.ps1` | 跑得通，但报 **15 处 marker 不一致**且自身 exit 0。见「开放项」 |

CI 侧只有一条流水线 `.github/workflows/build.yml`（push main 即发布），跑
**12 道无浏览器门禁**：`check-self-contained` `check-mdc-eval` `check-heading-ids`
`check-text-literal` `check-scope-anchors` `check-aria-current` `check-icon-box`
`check-component-fence` `check-runtime-dom` `compare-urls` `audit-css-blocks`
`check-ci-triggers`。它**不**跑 `acceptance.ps1`（需要未入库的基线、
PowerShell 入口、打线上站的 headless Chrome，干净 CI 里都不成立），也**不**跑
`interaction-check.mjs`（流水线里不可靠而单跑可靠）。

## 部署

GitHub Actions（push main 触发）：`pnpm build` 后把 `dist/` 推送到 PaloMiku/blog-public
（GitHub Pages），站点经 EdgeOne CDN 对外服务。CI 是否绿是部署是否成功的唯一事实源。

三处验证部署的注意点：

- `gh` 在本仓库会**优先解析 `upstream` remote**（L33Z22L11/blog-v3），所有
  `gh run list` / `gh workflow list` 都必须显式 `-R PaloMiku/blog-v4`。
- 站点在 EdgeOne 后面，**带 query 的 URL 是独立的 cache key**：`?cb=<时间戳>` 会命中
  尚未刷新的父层拿到**旧内容**。**验证部署一律用普通 URL**；要绕过 CDN 就查
  `blog-public` 的部署产物本身。
- `edgeone.json`（`/api/*` → `application/json`、`*.opml` → `application/xml`）**不在仓库里
  被任何流水线消费**——两条流水线都只推 `dist/`。它靠 EdgeOne 控制台配置生效，改它要去控制台。

## 迁移期最容易重蹈的坑（实测记录 85 节已随 docs/ 清理移出工作树，取回：`git show a4603b0^:docs/astro-phase1-findings.md`）

> ✅ **`a4603b0` 已由 tag `archive/astro-migration-2026` 锚定**（2026-10-03 收尾时打）。
> 原本它只存在于本地分支 `feat/migrate-astro`、远端没有该分支，本文与 `MIGRATION-BRIEF.md`
> 共 4 处 `git show a4603b0^:docs/…` 引用全靠它。tag 会随 `git push --tags` 上传，
> 之后任何新 clone 都取得到；分支已删，引用不再悬空。
> **推 tag 是这批改动的必要步骤之一，漏推等于把 4 处引用留给运气。**

1. **Astro 不做 attribute fallthrough。** `<Icon class="x" />` 的 `class` 会被**静默丢弃**，
   必须显式声明 prop 再合并。已导致封面图丢失 `aspect-ratio`、渲染高 6 倍。
   **推论：合并 class 之后还要确认它落在哪一层。** §77 的 404 错误图标就是
   `Icon.astro` 明明合并了 `class`，但 astro-icon 的 `<Icon>` 组件**自己又包了一层
   `<span>`**，于是 `error-icon` 落外层、`.iconify` 落内层 svg。
   `main.css` 的 `:where(.iconify){font-size:1.2em}` 特异性是 0，线上因为两个类在
   **同一个元素**上而输给组件的 `5rem`（80×80），Astro 因为拆成两层而赢（96×112），
   整块内容被顶偏一个 `gap: 2rem`。**凡是调用方给图标包装元素显式设了 `font-size`
   的地方都要重新量一遍盒子。** 2026-10-03 又在 `Tip.astro` 的 `.tip-icon` 上复发一次。
2. **`:global()` 只作用于紧邻的选择器，不向嵌套传播。** 每个面向 slot 内容的层级
   都要单独写 `:global()`。且 `<style>` 默认隔离，写 `.x .y` 会要求 Astro 的 scope id
   落在**子组件**的根元素上，而它带的是子组件自己的 id —— 规则永不匹配。
3. **门禁必须先自检。** 这个迁移里已经有二十余次「门禁自己错了」而不是「站点错了」，
   包括：规则写在正则引号的错误一侧而**完全不匹配**、新加的正则打断注释剥离、
   只读 `dist/_astro/*.{css,js}` 而漏掉 Astro 7 内联进 HTML 的 1431 段产物。
   **没被看过变红的门禁等于没有门禁。** 详见 findings §62.4、§64.10–64.12。
4. **新写的门禁不接进 `acceptance.ps1` 就等于不存在。** §64 一轮写了五道门禁，
   一道都没进流水线。`check-self-contained` 同样如此（§66.1）。**加门禁的同一件事里
   就要把它接进去**；接进去之前先想清楚它报红时该怎么办。
5. **别把「在一个视口下量过」当成「UI 一致」。** 页高与样式对比此前只量 1600×1000 浅色，
   而站点里有大量 `@media (max-width: 768px)` 规则、深色更是整套换令牌。
   加测量维度时**默认值必须保持原样**，且非默认值要写进自己的产物文件。
6. **「差异不影响页高」不等于「不用查」。** §72.3 挖出的 9px 在 `position:fixed` 里，
   对页高、滚动、tab 序全无影响；写了 `scripts/probe-subtree.mjs` 之后 40 秒就把 9px
   拆成「两个按钮各 4.48px = line-height − 1em」，一行 `line-height: 1` 修好。
   能抓住「只改横向」「只改没被采样的盒模型属性」两类的，只有按属性的全量取值分布比对。
7. **新加的仪器必须能自己喊停。** §74：如果 `setEmulatedMedia` 静默失效，两侧都停在
   浅色，你会拿到一份「63 页全绿、实际量了两次浅色」的深色结论。所以 preflight 里要有
   「`--theme=dark` 时 `<html>` 必须真的带 `.dark`，否则报错退出」这种守卫，**并且注入
   缺陷验过它会红**。
8. **顶层 `:deep(X)` 搬到 Astro 必须把锚点补回去。** Vue 把顶层 `:deep(X)` 编译成
   `[data-v-<hash>] X`——那个属性选择器**要求祖先里有本组件的元素**。写成裸
   `:global(X)` 锚点就没了，规则会跑到组件外去（§76 的 `/link` 少 8px）。
   `check-scope-anchors.mjs` 盯这一类；接管后它改成按**完整选择器**钉住现状
   （`UNREVIEWED` 32 条）并在 `KNOWN` 里对 3 条复算 DOM 可达性。
9. **断网测量会造出假阳性，必须用 online 模式复核。** §76：离线路径拦截跨域 fetch，
   `lemmy-fediverse-deploy` 凭空多出 18px。**离线扫描报的差值，先复核再定性。**
10. **「这个页面/路由对应哪个源文件」是猜的，而猜测没人复核。** §77：静态托管下任何缺失
    路径都命中 `404.html` 这个 SPA 壳，壳水合后路由到 catch-all，`error.vue` **永不执行**。
    **每个页面都要确认「线上这份 HTML 到底由哪个源文件产出」。** 清单是
    `scripts/lib/page-list.mjs` 一个来源，66 页。**加路由时先问它在不在清单里。**
11. **Vue 的「组件根元素」不能翻译成「枚举父元素」。** §77：线上 `ProseCode.vue` 的
    `code { … }` 对**任意嵌套深度**都生效；Astro 侧写成 `article p > code, li > code, …`
    就漏了 `<p><strong><code>`，26 个行内代码漏了 1 个。判据要用**集合**
    （`code:not(pre code):not(.copy):not(.domain)`，每个排除项都要有普查依据）。
12. **读调用点不等于知道语义；`auto` 外边距的 computed value 是 used value。** §77 两处
    都栽在这。① `useElementVisibility(anchorEl)` + `:class="{ expand }"` 看不出极性，
    最后靠四态滚动实测才定出来。② `getComputedStyle().marginRight` 对 flex item 的
    `margin: auto` 返回**解析后的实际像素**，两侧这个值不同说明的是**容器剩余空间**不同。
13. **用文本当元素键不成立；判据顺序必须是「先全量、再逐元素」。** §77.5b/§77.5d：
    `textContent` 前 40 字符的签名会重复（同签名卡片、同签名段落）。定稿是**两道门槛**：
    `distDiff` 先算全量取值分布，分布相同的属性一律不报逐元素差异。
    | 全量分布 | 逐元素 | 判定 |
    |---|---|---|
    | 同 | 同 | 一致 |
    | 同 | 异 | 同文本元素间置换 → 不可见 → 不报 |
    | 异 | 任意 | 必报 |
    改这类核心比较逻辑**必须**注入真实缺陷验红绿双向。
14. **「不在清单里的东西等于没测」的第二形态是整条路由。** §78.1：受测 URL 来自
    `sitemap.xml`，而 robots 的 `Disallow` 把三页挡在外面，代价是 19 个 MDC 组件里
    **12 个零测量背书**。手工核对立刻抓到真缺陷：移动端没有任何回首页的入口。
15. **同一个渲染结果，两边的 HTML 结构上就不可比。** §78.2：Nuxt 的 `anchorLinks` 是
    **构建期**产物，Astro 的 `prose-enhance.ts` 是**运行时**增强；Astro 还多静态输出
    搜索框/分享按钮/二维码。连 `button` 的 `type` 都不同。**判据必须落在渲染后的 DOM。**
    写静态探针时另有两个必踩：`innerText` 必须剔 `<script>` 子树；遍历递归**不能**写在
    `if (n.tagName)` 里面（parse5 的 `#document` 节点没有 `tagName`，整棵树不会被遍历）。
16. **「连量两遍一致」不等于「页面是确定的」。** §78.4：线上 `/link` 装 10 次页高跨度 44px，
    根因是洗牌写在 `onMounted`（`randomInGroup: true`），而那个逃生口在线上无效。
    判据已改成 `--samples`（默认 3）次判**极差**。**Astro 侧是静态站，不要为了两边
    「看起来一样」把静态站也改成随机。**
17. **断网模式自己会造假，差值必须用 online 复核。** §78.3：工具**自己**用第二个浏览器
    复量，落在 ±40 内判 `ARTIF` 单独列出。**别把 `ARTIF` 混进「一致」，也别混进「超差」。**
18. **live 不是当前源码——差异分三类，门禁自己分不出来。** §78.8：每条差异只有
    「迁移缺陷 / **部署滞后漂移** / 内容漂移」三种可能，**正确动作是部署，不是改 Astro；
    绝不加进 `known`/`ACCEPTED`**——那会把「源码还没部署」这个信号永久静音。
19. **「构建通过 + 门禁全绿 + 产物一字未变」也可能是「代码根本没执行」。** §79.2：
    物证是构建期一句 `console.error`——68 个条目的 `entry.rendered` **全是 undefined**，
    因为 `@astrojs/mdx` 的 entry type 不提供 `getRenderFunction`，glob loader 走
    `deferredRender` 分支。**⇒ 没有「改完之后产物变了吗」这一项检查，一切「接上了」都是猜的。**
20. **构建会改写正文字面，而所有几何门禁都看不见。** §79.5：`remark-smartypants` 在 Astro 侧
    **默认开着**（判的是 `smartypants !== false`），20/64 页的 `"…"` 被写成 `“…”`。
    换的是字形不是盒子。判据是**逐字符计数不等式** `产物次数 ≤ 源次数`。
    **一个从不报错的门禁比没有门禁更糟**——它让人以为这条已被覆盖。
21. **断言自己会错，两个仪器结论打架时先怀疑仪器。** §79 追加 findings 时用
    `if (/\n(?!\r)/.test(s))` 判「有没有裸 LF」，它**匹配了全部 5728 个换行**（lookahead 看的是
    `\n` **之后**的字符）。正确写法 `/(?<!\r)\n/`。同源两条：后台任务读到的脚本可能不是你刚写的
    那份（起完任务先对一眼第一行输出）；**判断「产物变没变」不要用整目录哈希**——实测连续两次
    同样源码的构建给出两个不同哈希，追下去只有 4 个文件变，**全是构建时间戳**。
22. **「把字符串当 HTML 吐出去」= 静默空白；判据必须是「未求值即失败」。** §79.10：
    `rehype-meta-slots` 在 Nuxt 侧存 MDC AST 并求值，Astro 侧存字符串 ⇒ 侧栏 widget 整个空白。
    **页高看不见**（空白也是合法盒子），**计算样式看不见**（压根没有元素）。门禁
    `check-mdc-eval.mjs` 的判据是零歧义的：注册表里 26 个组件名与 HTML 原生标签**无一重名**。
23. **Vue/MDX 的「属性」在两侧不在同一处；只读对、写错就静默无效。** §79.11：
    `addClass` 只写 `properties`，对 MDX 节点是**无声空操作**；新增的 MDX 属性对象**必须带
    `type: 'mdxJsxAttribute'`**，裸 `{name,value}` 会被 hast→estree 静默丢弃。
24. **巧合正确的路径会掩盖整类缺陷；探针的失败模式不止一个。** §80：`currentMark` 写
    `path === item.url`，而 `build.format: 'directory'` 让 pathname 带尾斜杠，于是精确命中恒不成立、
    该给 `page` 的退化成 `true`。**首页「看起来是对的」只因 `item.url` 恰好也是 `/`。**
    一个断言在某个输入上通过，必须问「它是因为正确而通过，还是因为巧合」。
25. **「量了外框」可以连续错三次；列测量清单的依据必须是遍历出来的普查表。** §82：按组件
    结构补到 17 条选择器后仍全绿，因为 `#blog-sidebar` 两侧都是 `visibility:hidden`，
    所有后代在「可见吗」这一层就出局。**判据在更上游的环节出局时，往下游补清单是白费力气。**
26. **`X.check()` 这类便利谓词往往不是你以为的那个问题，而且答案可能是反的。** §82：
    `document.fonts.check('600 24px "LXGW WenKai Screen"', …)` 得**线上 `true` / 本地 `false`**，
    据此写「本地字体没加载」**结论正好反了**——线上那条 `<link>` 的 `media` 停在 `print`，
    样式表下载了却**永不应用**，静默无错。**判断「某个资源到底用没用上」必须用与该问题
    定义相符的字段；同一探针里两个字段打架时，挑定义相符的那个。**
27. **Windows PowerShell 5.1 会先插值再交给 node。** 2026-10-03 接管期实测两次：
    `node -e "...s.replace(/- name: Gate: (.+)/, '- name: \"Gate: $1\"')"` 里
    `$1` 被 PS 当变量吃掉，产出 `- name: " Gate: \`；`\$sampleEvery` 里的 `$` 同理。
    **改文件用 `edit`/`write` 工具，或写进临时 .mjs 再跑**，不要把带 `$` 的替换塞进
    `powershell -Command` 风格的双引号串。同理 §85.7：PS 5.1 把 UTF-8 当 ANSI 读，
    **`.ps1` 必须是 ASCII-only**（无 BOM 的 `.ps1` 里的非 ASCII 字节会吞掉换行）。
28. **`.ps1` 里的路径必须从 `$PSScriptRoot` 解析。** `Resolve-Path '..\x'` 跟的是**进程 CWD**，
    不是脚本位置——`check-dates` 与 `compare-urls` 因此指向过从未存在的路径
    （`compare-urls.ps1` 一直读 `..\baseline-urls.txt`，那个文件全仓库不存在）。接管时全部改成 `$PSScriptRoot` 锚定。
29. **「查了少了一个值」之前，先确认查询覆盖了全部路径。** §67.3：glob 只覆盖 `dist/*.html`、
    而归档页在 `dist/archive/index.html`，差点把一条根本没丢的字体规则报成缺陷。
    §76.4.1 是加强版：新门禁里「这个选择器命中 N 页」的口径连错四次，每次都往相反方向错。
    定稿是不看正则——`class="([^"]*)"` 整个取出来按空白切分再判成员。
    **一个门禁自己的计数器不可信，它的结论就一条都不可信。** 2026-10-03 又踩了一次：
    `audit-css-blocks.mjs` 在新布局下 ENOENT 崩掉，因为它**假定 `.astro-compare/`
    已由别的脚本建好**；`check-content-preservation.ps1` 在采样数为 0 时除零崩掉，
    报出来的是「崩溃」而不是「一道什么都没测的门禁不能算通过」。
30. **仪器自己也要能被证伪，接管期逮到的四个例子。** ① `check-ci-triggers` 在我写出新
    `build.yml` 的**第一版**就报红——我把旧文件里「`- name: Gate: …` 缺引号」这个
    YAML 语法错误原样搬了过去。② `check-scope-anchors` 的新棘轮把 32 条既有裸 `:global()`
    全报了出来，说明按 `subjectOf()` 的「主体」判定会同时误报（`:global(.toc ol)`）与漏报
    （`:global(:hover) > .icon-line` 主体是 `:hover`）。③ `check-content-preservation`
    报 `/drive/` 少一段，实为**源里的 markdown 链接**与**产物里 `<svg>` 替换留下的空格**
    拼接方式不同，判据改成去空白比对才对。④ 每一次负控都要打在**会被采样的行**上——
    第一次负控注入的行号没被采样，脚本报绿，我差点把它当成「门禁不灵」。
31. **「钉住未复核」不等于「批准」。** 接管时 `check-scope-anchors` 有 33 条顶层裸
    `:global()` 全部需要 `:global()`（主体由子组件 / slot / 第三方库渲染、`::view-transition-*`
    天然全局）。逐条补可达性不变式是独立的复核工作，接管不做。做法是按**完整选择器**
    钉进 `UNREVIEWED` 并显式标注未复核——比计数棘轮强（改名/删除会被抓到），
    又不等于替它们背书。
32. **围栏的 info string 是唯一的事实源，而它只存在于源文件里。** 新增
    `Component` 围栏（`src/plugins/component-fence.ts`）把组件示例收进一个围栏：
    正文按 MDX 解析后真实渲染、正文原文当用法、磁盘文件当源码，三栏同出一处。
    但两个派生代码块**只存在于合成文本里**，而 `prose.ts` 的 `scanFences()` 是去
    **读 .mdx 原文**扫 info 的（meta 从 mdast 传不到 hast）⇒ 图注靠「同语言、同顺序」
    配对。**配错位时每个源码栏仍然有名字，只是拿了别人的文件，构建与所有几何门禁全绿。**
    三条必须同时成立：① `componentFenceInfos()` 的返回顺序 = 插件产出 code 节点的顺序；
    ② 树里的顺序是 tab1（正文，含正文里的围栏）→ tab2 → tab3，所以 `scanFences()`
    必须**先**推正文里那些围栏的 meta；③ 围栏长度必须严格大于正文里最长的反引号串
    （`position.end.offset` 是**闭合围栏之后**的偏移，且闭合围栏可能带缩进）。
    `scripts/check-component-fence.mjs` 把每个源码栏的正文读回来与磁盘文件逐字比对，
    已验红绿双向。

33. **Astro 的 `data-astro-cid` 是构建期属性，脚本重建的节点一个都没有。**
    `src/**/*.astro` 里凡是选择器带 cid 的规则，只对**构建期渲染出来**的那些节点生效。
    谁在客户端用 `document.createElement` / `createElementNS` 重建了带样式的元素，
    那条规则就只对首屏那一个命中，换个选项 / 翻一页之后样式**静默全掉**。
    2026-10-03 逮到两处，同一个根因：
    - `Pagination.astro` 的 `> .pagination-num` → `src/pages/index.astro` 的
      `syncPager()` 每次排序 / 分类 / 翻页都重建页码按钮 ⇒ `width:3em`、
      `&.active` 高亮、`&:hover` 三条同时失效，四个页码糊成 `1234`。
    - `Tab.astro` 的 `.combobox-check` → combobox 换选项时用 `createElementNS`
      重建对勾 ⇒ `width/height:1em` 失效，SVG 退化成默认尺寸（实测约 90px 高，
      把下拉项从 20px 撑到 140px）。
    **为什么所有门禁都看不见**：① 静态产物里规则确实匹配得到（首屏节点带 cid），
    所以 `audit-dead-scope` 不报；② 门禁量的是**首屏那份 DOM**，重建发生在交互之后；
    ③ 分页那条是**横向**差异，页高根本看不见。
    修法是**把锚点留住、只对被重建的那一个 class 豁免作用域**，不要写顶层裸
    `:global()`：`.pagination[data-astro-cid] > .pagination-num`、
    `.combobox-wrapper[data-astro-cid] .combobox-check`。顶层裸 `:global()` 能让门禁变绿
    但会判红（`check-scope-anchors` 拦的就是这个），而且确实会让规则泄漏到组件外。
    **反过来在脚本里补 cid 属性是错的**：那个 hash 随组件内容变，脚本无从得知。
    排查这类问题的判据很简单：`grep -rn "createElement" src` 之后，
    逐个问「这个新建元素有没有 class 命中某条带 cid 的规则」。

34. **astro-icon 的 `<symbol>` 全局只有一份，挂在首次出现处；整块替换 DOM 会连它一起杀。**
    `astro-icon` 1.2.0 每个图标实例渲染成
    `<svg class="iconify" data-icon="X"><symbol id="ai:X">…</symbol><use href="#ai:X"></use></svg>`，
    但 **symbol 定义只在文档顺序里第一个用到该图标的 `<svg>` 上**，其余全是纯 `<use>`。
    `<use>` 按文档级 id 解析 ⇒ 那一份没了，**全站所有引用同时变空白**，不是某个图标坏。
    2026-10-03 实测：首页 `?page=2` 时 `menu.replaceChildren(...)` 把首屏第一张卡连同
    `ai:tabler:pencil-minus` / `ai:tabler:pilcrow` 的唯一定义一起丢掉，于是卡片上
    **日期图标和字数图标消失、分类图标还在**——因为 `tabler:bulb` 的定义排在
    OrderToggle 的分类下拉里，落在 `<menu>` 之外。这个「只坏一部分」的症状最有迷惑性。
    排查判据：`document.querySelectorAll('symbol[id^="ai:"]')` 的数量在交互前后对不上，
    或 `use.getBBox()` 是 `[0,0]`。
    修法是 `src/lib/icon-sprite.ts` 的 `hoistIconSprites(root)`：**在替换子树之前**把
    `root` 内的 symbol 搬到挂在 `document.body` 下的常驻宿主（`<use>` 解析与它在哪个
    `<svg>` 里无关）。`index.astro` / `archive.astro` 各调一次。
    - 宿主**不能**用 `display:none`（部分浏览器不给 `<use>` 展开影子树），用零尺寸 +
      `aria-hidden`。
    - `archive.astro` 那一次目前是 **no-op**（实测它的 35 个 symbol 都不在被替换的
      `[data-archive-list]` 子树内），属同类预防，不是已修的缺陷。
    - `IntegrationOptions` 只有 `include` / `iconDir` / `svgoOptions`，**没有**共享
      sprite 容器开关，所以只能在应用侧兜。
    - 这个变化是**解析期**发生的：MutationObserver 记录不到任何移除事件（HTML 两份
      逐字节相同，`curl` 对比过），别指望用 observer 抓。

35. **SEO 上有两处是「主动偏离线上」，不是缺陷——`live:head` 会报差异，别去修。**
    2026-10-03 收尾审计时全站扫了 68 页的 head，顺手改了三处。改之前逐字核对过
    Nuxt 基线，**两处都是线上也有的老问题**，所以它们是改进而非回归：

    | 项 | 改前 | 改后 | 位置 |
    | --- | --- | --- | --- |
    | meta description 长度 | 26/38 篇超 160 字符，最长 406（frontmatter 写的就是首段原文） | 全部 ≤155，超长为 0 | `Base.astro` 的 `SEO_DESCRIPTION_MAX` |
    | 重复 description | 1 组覆盖 25 页（`content/games/` 下 20 个 mdx 没有 `description`，全落到站点简介） | 0 组 | `[...slug].astro` 合成 `「标题」——站点名` |
    | `/archive/` 的 h1 | 0 个（页面按设计没有可见标题） | 1 个 `.sr-only` | `archive.astro` + `reusable.css` |

    **因此 `live:head` 会报出 26 页 head 差异**（都落在 description 上），那是预期内的。
    要回退就把 `SEO_DESCRIPTION_MAX` 调大或整段注释掉，别当成回归去"对齐"。
    - 游戏区那 20 条合成 description 是**占位**，质量上限有限；真正该写进 frontmatter
      的 `description:`（schema 已是 `z.string().optional()`，写了优先）。
    - `/archive/` 用 `.sr-only` 而不是可见 h1，是因为 Nuxt 基线那页同样 0 个 h1，
      补可见标题会让页高偏离基线（容差 40 px）。`.sr-only` 用
      `position:absolute + clip-path:inset(50%)`，**不能用 `display:none`**，
      那会把元素从无障碍树里摘掉，等于没加。

36. **PowerShell 5.1 会让中文注释**吞掉**后面的整行语句——静默失效。**
    无 BOM 的 `.ps1` 按系统 ANSI 码页读，注释里的非 ASCII 字节可能把换行吃掉，
    于是紧跟其后的**第一条可执行语句根本没执行**，脚本不报错、退出码也正常。
    2026-10-04 实踩：给 `acceptance.ps1` 插了一段中文注释来登记新门禁，
    跑完 `total: 36`——**新门禁压根没进表**，因为它的
    `$results.Add(...)` 被那段注释吞了。改成 ASCII 注释后立刻变成 37。
    **症状是「加了步骤但计数没变」，不报错、不红**，只看退出码完全发现不了。
    → 在 `.ps1` 里，**紧挨可执行语句的注释一律用 ASCII**；要说的话放
    `CLAUDE.md`，或放在离语句远一些的位置。别指望这条规则是形式主义。

37. **决定门禁能不能进 CI 的是 `baseline/`，不是 PowerShell。**
    曾以为「17 道 PS 门禁进不了 CI，换成 node 就把它们救回来了」——实测不成立：
    16 道 PS 门禁里**只有 6 道不依赖 `baseline/`**，另外 10 道依赖冻结基线，
    而 `baseline/` 按既定决定是不入库的（见「冻结基线」一节）。把那 10 道换成
    node 之后，它们在 CI 里和现在一样自我跳过：`compare-urls.mjs` 在无基线环境
    直接 exit 0 并打印「基线缺失」。
    **换语言能换来 CI 覆盖的只有那 6 道**：
    `check-content-preservation` `check-assets` `check-integration`
    `audit-deferred` `check-build-warnings` `check-head-vs-live`。
    排移植优先级时先按「是否依赖基线」分，别按「是不是 PowerShell」分。
    真正把 CI 从 11 道提到 12 道、且那道**不依赖基线**的，是 `check-runtime-dom`。

## 开放项（接管后新增，勿当成已解决）

| 项 | 证据 | 状态 |
| --- | --- | --- |
| `games/galgames/clannad` 表格差异 | 源 `clannad/index.mdx` 1113 行、508 行表格、17 个 `<Folding>`；Astro 渲染 31 张表（310 处 `md-table`），**Nuxt 基线 0** | 未分类。`compare-dom` 报出的 15 处 marker 不一致里最大的一条，机制待查（Nuxt Content 的 GFM 表格在 MDC 块里是否被解析） |
| `/2025/10/clarity-resource-list` 代码块计数 | 基线（用**当前源码**重建）nuxt=1 / astro=2；该页页高 d=0，两道几何门禁都看不见 | 未分类，根因同上（围栏代码块嵌在 MDC tab 槽位里，两侧解析不同） |
| `compare-dom` 15 处 marker 不一致 | 脚本自身 exit 0（§85.5 那族「打了分不算红」） | 未接线、未分类，因此没进 `acceptance.ps1` |
| `check-content-preservation` 围栏跟踪有漏 | 逐行采样（1458 行）会浮出 10 条假阳性，集中在 3 页，都是**围栏代码块里**的样本：缩进围栏、或 info string 里带反引号的围栏没被跟随。因此生产步长取 1/8（88 行、0 假阳性）。要提高密度得先修围栏跟踪 | 已知取舍，未修 |
| `compare-titles` 缺 `exit` | 打印 RESULT 但退出码恒 0 | 属 §85.5 那族（8 道里只修了 `check-integration`），未逐道补 |
| 33 条顶层裸 `:global()` 未复核 | `check-scope-anchors` 的 `UNREVIEWED` | 钉住但未复核，见坑位 31。**条数是棘轮**，门禁会全量打印清单，改动后自己数一遍（2026-10-03 发现文档写 32、实际 33） |
| ~~`vue` / `@astrojs/vue` 是死重量~~ | `src/` 下 **0 个 `.vue` 文件**，这两个依赖只服务 `astro.config.mjs` 的 `vue()` | **已摘**（2026-10-03）。三处同步删：`package.json` 两条依赖、`pnpm-workspace.yaml` 的 `ui` catalog 两条、`astro.config.mjs` 的 import + `vue()`。`pnpm install` 少装 150 个包，`pnpm build` 68 页绿、`typecheck` / `lint` / `check-self-contained` 干净，产物里搜不到 Vue runtime。**验收已补跑：`pnpm accept`（基础档）36/36 绿；`pnpm accept:full` 未跑完（中途停止），重档待补** |
| 基线缺 Nuxt 的 `atom.xml` / `subscriptions.opml` | 首次冻结只收 html+css（`freeze-baseline.mjs` 的理由漏了 xml），已把 `*.xml` 补进白名单 | **不可本地修复**（Nuxt 源码树已删）。要取回只能抓 https://blog.sotkg.com/atom.xml |
| ~~分享按钮两侧不同步~~ | §85 选的是「两侧同步改、先不部署」。**Nuxt 侧其实改了**——`chore/nuxt-fork-maintenance:382a2fb` 删掉了 `app/components/popover/Share.vue`（226 行）与 `PostHeader.vue` 的分享相关段；该提交信息明说「只删 Nuxt 侧，Astro 侧那份在 astro-site/ 里，两边都清掉才能避免反向漂移」，而 **Astro 侧从未跟进**。那条分支未并入 main，改动随工作树删除而丢失 ⇒ 线上仍有按钮、Astro 已无 ⇒ 每篇文章页 −10~−11px 且少一个 button | **已随部署消解**（2026-10-03）。Astro 版上线后线上与本地同源：线上文章页实测无 `class="*share*"` / `aria-label="*分享*"`（唯一命中「分享」的是相关文章标题），`style-parity` 曾报的 `.button: nuxt=1 astro=0`（62/62 页）随之消失。两侧现已一致，无需再「补回按钮」或「补旧部署」 |
| `live:*` 三道门禁未在新布局下重跑 | 本次只跑了离线门禁 | 未验证。**且前提已变**：Astro 版上线后线上与本地同源，`live:*` 只能抓部署滞后漂移，不再能对 Nuxt 基线（详见「当前状态 → 提交与部署」） |

## 当前状态（2026-10-03，Astro 版已上线）

> `00c4401`（Astro 接管仓库根、Nuxt 树删除、68 页构建绿）落地后，本节记录的两批改动
> 也已提交并上线，见文末「提交与部署」。当日「顺手修掉的缺陷」清单记在该提交信息里，不再双写。
>
- **组件示例页改为 `Component` 围栏**：`src/plugins/component-source.ts`（空围栏 +
  `source=`，只解决源码不腐烂，**没解决重复书写**）退役，换成
  `src/plugins/component-fence.ts`。`example.mdx` 的 26 个组件示例从
  「`<Tab>` + 三个 `<div slot>`，组件手写两遍」变成一个围栏，正文即实际写法；
  文件从 1010 行降到 682 行，构建产物不变（68 页 / 264 文件）
- 顺带修掉：围栏正文里内嵌围栏的 meta 曾会静默失效（`scanFences()` 现在先推正文里
  那些 meta）；`example.mdx` 里指向本页的 GitHub 链接仍是接管前的
  `astro-site/src/content-mdx/` 路径（404）；乐谱/图表两节仍在讲一个**本仓库并不存在**
  的 `remark-code-component` 插件
- 新增门禁 `check-component-fence.mjs`（已接进 `acceptance.ps1` 与 CI，CI 侧 9→10 道），
  验红绿双向做过：语言写死 ⇒ 源码栏配错位；只注入前 5 行 ⇒ 内容对不上
- 门禁实测：**11 道 PowerShell 静态门禁全绿**（`check-dead-css` 现为 PASS，接管当日
  记的那条红已不复现，原因未查）、**10 道 node 门禁全绿**
- `live:*` 七道线上门禁**未跑**（需要 headless Chrome 打线上站 + 用户自管的 preview
  server），因此本页的**页高与计算样式尚未与 Nuxt 基线对过账**

### 提交与部署

- 本节改动**已提交并推送**：`5232c7b`（三个交互期缺陷 + 门禁耗时收敛 + SEO 与归档页 h1）、
  `7e3029c`（日期 `locale` / `timeZone` 锁定，消除构建机环境依赖）；归档 tag
  `archive/astro-migration-2026` 已随 `git push --tags` 上传（含 `^{}` 解引用）
- **Astro 版于 2026-10-03 上线**（线上实测，非推测）：零 `_nuxt/`、14 处 `_astro/`；
  `atom.xml` 的 `<updated>` = `2026-10-03T13:48:31Z`，对应 `7e3029c` 那次 CI
  （13:47:56 起 / 44s），即含日期修复的构建已生效；首页日期渲染为 `2025年05月19日`（中文）；
  本地 `dist` 与线上同页 `data-astro-cid-*` 一致
- ⚠️ **连带后果**：「本地 ↔ 线上」不再跨两套框架，`live:*` 从「Astro ↔ Nuxt」退化为
  「Astro ↔ Astro」，只能抓部署滞后漂移；对 Nuxt 基线的验证只剩离线 `baseline/nuxt/`
