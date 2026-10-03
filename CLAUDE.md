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
pnpm accept                  # 单一验收入口，等价于 scripts/acceptance.ps1
pnpm freeze-baseline         # 重新冻结 Nuxt 基线（见「冻结基线」一节）

powershell -File scripts/acceptance.ps1   # 完整验收（需先自行确保 dev server 已停）
                                         #   -Styles   再加 1600 浅色计算样式对比
                                         #   -Mobile   再加 390×844 的页高 + 计算样式对比
                                         #   -Dark     再加深色下的计算样式对比
node scripts/interaction-check.mjs        # 交互门禁，**单独跑**，不要塞进流水线
node scripts/probe-subtree.mjs --sel='<css>'        # 逐节点几何对比
node scripts/probe-subtree.mjs --sel='<css>' --mode=profile   # 垂直剖面：空隙、垂直带、对账
node scripts/freeze-baseline.mjs --help   # 重新冻结 Nuxt 基线的用法
```

## 技术栈与结构

- Astro 7（站点根即仓库根，`src/pages` 文件路由）+ Vue 3.5 运行时（当前 **0 个 Vue 岛**，
  `@astrojs/vue` 只服务于 `astro.config.mjs` 里那一行 `vue()`，是可摘的死重量）
  + `@astrojs/mdx` v8 + `remark-mdc`（frontmatter 解析）；pnpm 12 + **catalogs 集中管版本**
  （`package.json` 全是 `catalog:` 引用，版本只在 `pnpm-workspace.yaml` 出现一次，5 组 45 条）
- 样式纯 CSS（无 Tailwind、无预处理器）：令牌在 `src/styles/*.css`，组件内 `<style>` 用原生 CSS 嵌套，
  CSS 检查走 ESLint（@zinkawaii/eslint-config-css）
- UI 组件全自研（`src/components/` 下 `blog/` `content/` `post/` `partial/` `popup/` `util/` `widget/`），
  第三方仅 `astro-icon`、vue-tippy、embla-carousel、@bikariya/*
- **内容唯一真相源是 `src/content/**/*.mdx`**（63 个文件）。接管前的 `content/**/*.md` 原文树
  与 `mdc-to-mdx` codemod 已退役（转换报告存档在 `docs/mdc-to-mdx-report.md`）。
- 三层配置分工：内容/分类/友链 → `src/config/blog.ts`；导航/页脚/交互默认值 → `src/lib/app-config.ts`；
  内容 schema 与 loader → `src/content.config.ts`；构建/module → `astro.config.mjs`
- 端点（`src/pages/`）：`/api/stats`、`/atom.xml`、`/subscriptions.opml`、`/llms.txt`、
  `/search-index.json`、`/raw/*.md`（63 篇原文）
- 文章可用 frontmatter `permalink` 自定义 URL；`hidePostPrefix` 开启时 /posts/xxx 显示为 /xxx
- `build.format: 'directory'` ⇒ **`Astro.url.pathname` 带尾斜杠**。`BlogSidebar` 的
  `currentMark` 写成 `path === item.url` 时必须用 `pathname === '/'` 之类的归一化，
  否则首页因为 `item.url` 恰好是 `/` 而**巧合正确**（见坑位 27）
- dev / preview 服务器的启停由用户自行管理，代理不得擅自启动或杀掉

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

`scripts/acceptance.ps1` 是单一验收入口：**2 步构建 + 34 步**。

| 组 | 数量 | 成员 |
| --- | --- | --- |
| 构建 | 2 | `pnpm install`、`pnpm build`（只构建一次，所有门禁共用同一个 `dist`） |
| PowerShell 静态门禁 | 11 | `check-integration` `check-layout` `check-anchor-classes` `check-dead-css` `check-assets` `compare-urls` `compare-titles` `check-content-preservation` `check-dates` `audit-deferred` `audit-image-pipeline` |
| 边界/源码门禁 | 3 | `audit-dead-scope`（`$knownDeadScope = 3`）`audit-css-blocks` `check-ci-triggers` |
| 依赖边界 | 1 | `check-self-contained` |
| 产品门禁 | 11 | `check-icon-swap` `check-flip-gates` `check-list-controls` `check-dropped-css` `check-affordances` `check-scope-anchors` `check-heading-ids` `check-text-literal` `check-mdc-eval` `check-aria-current` `check-icon-box` |
| 仪器自检 | 1 | `preview-guard-selftest` |
| 线上门禁 | 7 | `live:sitemap` `live:head` `live:ui-parity` `live:style-parity` `live:ui-parity-mobile` `live:style-parity-mobile` `live:style-parity-dark` |
| 构建告警 | 1 | `check-build-warnings` |

**两道存在但没接线的门禁**（§85.4 的老问题，接管后更需要处理）：

| 脚本 | 状态 |
| --- | --- |
| `collect-evidence.ps1` | 跑得通、exit 0，但不在 `$gates` 里 |
| `compare-dom.ps1` | 跑得通，但报 **15 处 marker 不一致**且自身 exit 0。见「开放项」 |

CI 侧只有一条流水线 `.github/workflows/build.yml`（push main 即发布），跑
**9 道无浏览器门禁**：`check-self-contained` `check-mdc-eval` `check-heading-ids`
`check-text-literal` `check-scope-anchors` `check-aria-current` `check-icon-box`
`audit-css-blocks` `check-ci-triggers`。它**不**跑 `acceptance.ps1`（需要未入库的基线、
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

## 迁移期最容易重蹈的坑（实测记录在 `docs/astro-phase1-findings.md`，85 节）

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
    （`compare-urls.ps1` 一直读 `..\baseline-urls.txt`，那个文件全仓库不存在，
    `docs/baseline-nuxt.md:105` 却还引用着它）。接管时全部改成 `$PSScriptRoot` 锚定。
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
31. **「钉住未复核」不等于「批准」。** 接管时 `check-scope-anchors` 有 32 条顶层裸
    `:global()` 全部需要 `:global()`（主体由子组件 / slot / 第三方库渲染、`::view-transition-*`
    天然全局）。逐条补可达性不变式是独立的复核工作，接管不做。做法是按**完整选择器**
    钉进 `UNREVIEWED` 并显式标注未复核——比计数棘轮强（改名/删除会被抓到），
    又不等于替它们背书。

## 开放项（接管后新增，勿当成已解决）

| 项 | 证据 | 状态 |
| --- | --- | --- |
| `dist` 是指向 `.output/public` 的**悬空 junction** | 硬安全策略禁止任何 CLI 永久删除，`mavis-trash` 拒收 reparse point ⇒ **需要你手动 `rmdir dist`**（只删链接，不动数据） | 未解决；本次靠重建 `.output/public` 让链接恢复有效才跑通构建 |
| `astro-site/` 尚未删除 | 目录内容已全部上移到仓库根，但每次删除都被**正在运行的 `compare-ui-parity`** 占用（它从 `astro-site/dist` 起 preview）而失败 | 扫描结束后 `rm -- "astro-site"` 即可。本次提交**刻意没有把它带进去**（254 个文件），它仍是 untracked |
| `games/galgames/clannad` 表格差异 | 源 `clannad/index.mdx` 1113 行、508 行表格、17 个 `<Folding>`；Astro 渲染 31 张表（310 处 `md-table`），**Nuxt 基线 0** | 未分类。`compare-dom` 报出的 15 处 marker 不一致里最大的一条，机制待查（Nuxt Content 的 GFM 表格在 MDC 块里是否被解析） |
| `/2025/10/clarity-resource-list` 代码块计数 | 基线（用**当前源码**重建）nuxt=1 / astro=2；该页页高 d=0，两道几何门禁都看不见 | 未分类，根因同上（围栏代码块嵌在 MDC tab 槽位里，两侧解析不同） |
| `compare-dom` 15 处 marker 不一致 | 脚本自身 exit 0（§85.5 那族「打了分不算红」） | 未接线、未分类，因此没进 `acceptance.ps1` |
| `compare-titles` 缺 `exit` | 打印 RESULT 但退出码恒 0 | 属 §85.5 那族（8 道里只修了 `check-integration`），未逐道补 |
| 32 条顶层裸 `:global()` 未复核 | `check-scope-anchors` 的 `UNREVIEWED` | 钉住但未复核，见坑位 31 |
| `vue` / `@astrojs/vue` 是死重量 | `src/` 下 **0 个 `.vue` 文件**，这两个依赖只服务 `astro.config.mjs` 的 `vue()` | 未摘。摘之前先确认不再引入 Vue 岛 |
| 基线缺 Nuxt 的 `atom.xml` / `subscriptions.opml` | 首次冻结只收 html+css（`freeze-baseline.mjs` 的理由漏了 xml），已把 `*.xml` 补进白名单 | **不可本地修复**（Nuxt 源码树已删）。要取回只能抓 https://blog.sotkg.com/atom.xml |
| 分享按钮两侧不同步 | §85 选的是「两侧同步改、先不部署」，但 Nuxt 侧（`app/components/popover/Share.vue` + `PostHeader.vue`）**从未改**，随树删除一并消失 ⇒ 线上仍有按钮，Astro 已删 ⇒ 每篇文章页 −10~−11px 且少一个 button | 随接管自然消解（Nuxt 侧已不存在），但**第一次 push main 部署后线上会真的少掉这个按钮** |
| `live:*` 三道门禁未在新布局下重跑 | 本次只跑了离线门禁 | 未验证 |

## 当前状态（2026-10-03，接管当日）

- Astro 7 接管仓库根完成：`pnpm build` 出 **68 页**（11.7s），`dist` 264 文件 / 12.77 MB
- 依赖合并完成：5 组 catalogs / 45 条，**逐条对齐 `astro-site/node_modules` 的实装版本**
- 冻结基线 67 路由 / 120 文件 / 6.65 MB，来源提交 `fa9f2b3`
- 离线门禁实测：**11 道 PowerShell 门禁中 10 绿 1 红**（`check-dead-css` 的
  `clarity-resource-list` 代码块计数，见开放项）、**15 道 node 门禁全绿**、CI 形状门禁绿
- 接管期顺手修掉的真缺陷：`build.yml` 的 4 处 YAML 缺引号（照抄旧文件带过来的）、
  `Tip.astro` 的 `.tip-icon` 永不匹配、`compare-urls.ps1` 指向不存在的文件、
  `check-dates.ps1` 判据不兼容导致 40/40 全红、`audit-dead-scope` 因 3 条已查明死规则永久红、
  `audit-css-blocks` 假定产物目录已存在、`.ps1` 的 CWD 相对路径一族
- **全部改动尚未提交**（`git status` 里 `src/` `scripts/` 等仍为 untracked）
