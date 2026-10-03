# CLAUDE.md

个人博客「Mikuの极光星」（https://blog.sotkg.com），基于上游 L33Z22L11/blog-v3（Clarity 主题）深度定制的 Nuxt 4 纯静态站。upstream 仅做选择性批次同步，不直接 merge。

## 常用命令

```sh
pnpm dev        # 开发
pnpm generate   # SSG 构建，产物在 .output/public（新版工具链不再生成根目录 dist）
pnpm preview    # 预览构建产物
pnpm lint       # ESLint（含 CSS 规则，本机 pnpm 可能 EBUSY，可改用 npx eslint）
pnpm new        # 新建文章
```

## 技术栈与结构

- Nuxt 4（app/ 目录）+ Vue 3.5 + @nuxt/content v3（sqlite native）；pnpm 11 + catalogs 集中管版本（package.json 全是 `catalog:` 引用，加依赖改 pnpm-workspace.yaml）
- 样式纯 CSS（无 Tailwind、无预处理器）：令牌在 `app/assets/css/` 全局文件，组件内 `<style scoped>` 用原生 CSS 嵌套，CSS 检查走 ESLint（@zinkawaii/eslint-config-css）
- UI 组件全自研（app/components 下 blog/content/post/partial/popup/util/widget），第三方仅 vue-tippy、embla-carousel、@bikariya/*
- 三层配置分工：内容/分类/友链 → `blog.config.ts`；导航/页脚/交互默认值 → `app/app.config.ts`；构建/module → `nuxt.config.ts`
- 内容在 content/（posts 正式文章、previews 草稿、games 游戏库）；server/ 仅 3 个预渲染端点（/api/stats、/atom.xml、/subscriptions.opml）

## 约定

- ESLint 统一 tab 缩进、无 Prettier；带 `// @keep-sorted` 标记的配置数组必须保持排序
- 文章可用 frontmatter `permalink` 自定义 URL；`hidePostPrefix` 开启时 /posts/xxx 显示为 /xxx
- dev 服务器（pnpm dev 等）的启停由用户自行管理，代理不得擅自启动或杀掉；`pnpm generate` 若因 .data 被 dev 占用而失败，先请用户暂停 dev 再继续
- **Windows PowerShell 5.1 下不要用 `Set-Content -Encoding UTF8` 回写源码**：它会写 BOM，`audit-css-blocks.mjs` 会报 `WARN: N 个文件带 BOM`。用文件工具直接写，或 `[System.IO.File]::WriteAllBytes` 剥掉前三字节。`.ps1` 同理必须是 ASCII-only（无 BOM 的 .ps1 会被当成 ANSI 读，非 ASCII 字节会吞掉换行）

## Astro 迁移（`astro-site/`，进行中）

Nuxt 4 → Astro 7 的重写，**目标与线上 Nuxt 站逐项对齐**。进度与踩坑记录见
`docs/astro-migration-plan.md`（计划）与 `docs/astro-phase1-findings.md`（实测，71 节，最新在 §71）。

```sh
cd astro-site
pnpm build                              # 68 页，产物在 astro-site/dist
powershell -File scripts/acceptance.ps1   # 单一验收入口
                                         #   -Styles 再加 1600 浅色计算样式对比
                                         #   -Mobile 再加 390×844 的页高 + 计算样式对比
                                         #   -Dark   再加深色下的计算样式对比
node scripts/interaction-check.mjs        # 交互门禁，**单独跑**，不要塞进流水线
node scripts/probe-subtree.mjs --sel='<css>'        # 逐节点几何对比，定位「这个块差 N px」
node scripts/probe-subtree.mjs --sel='<css>' --mode=profile   # 垂直剖面：空隙、垂直带、**对账**
node scripts/check-scope-anchors.mjs      # 顶层 :global() 丢了 scope 锚点就红
```

> **桌面一致 ≠ UI 一致。** 页高/样式对比此前只量过 1600×1000 的**浅色**，
> 而站点里有大量 `@media (max-width: 768px)` 规则、且深色会整套换令牌。
> 现已加 `--width=`／`--height=`／`--theme=`，默认值全部保持原样，
> 非默认值写进**自己的** `.astro-compare/*-w390x844.json` / `*-dark.json`，
> 不会覆盖既有基线。实测三个条件下**精确 0 差的都是同样那 54 页**。

**`astro-site/` 已完全自包含**：不 import、不读文件到 Nuxt 树之外。
`blog.config.ts` / `shared/utils/*` / `app/feeds.ts` / `app/utils/img.ts`
已内联为 `src/config/blog.ts`、`src/lib/shared/*`、`src/lib/feeds.ts`、`src/lib/img.ts`；
`parse-domain` 是它自己的依赖。门禁 `scripts/check-self-contained.mjs` 盯着这件事，
**且必须用「注入真实缺陷后变红」验过它**——见下方教训。

### 迁移期最容易重蹈的十三个坑

1. **Astro 不做 attribute fallthrough。** `<Icon class="x" />` 的 `class` 会被**静默丢弃**，
   必须显式声明 prop 再合并。已导致封面图丢失 `aspect-ratio`、渲染高 6 倍。
   **推论：合并 class 之后还要确认它落在哪一层。** §77 的 404 错误图标就是
   `Icon.astro` 明明合并了 `class`，但 astro-icon 的 `<Icon>` 组件**自己又包了一层
   `<span>`**，于是 `error-icon` 落外层、`.iconify` 落内层 svg。
   `main.css` 的 `:where(.iconify){font-size:1.2em}` 特异性是 0，线上因为两个类在
   **同一个元素**上而输给组件的 `5rem`（80×80），Astro 因为拆成两层而赢（96×112），
   整块内容被顶偏一个 `gap: 2rem`。**凡是调用方给图标包装元素显式设了 `font-size`
   的地方都要重新量一遍盒子。**
2. **`:global()` 只作用于紧邻的选择器，不向嵌套传播。** 每个面向 slot 内容的层级
   都要单独写 `:global()`。且 `<style>` 默认隔离，写 `.x .y` 会要求 Astro 的 scope id
   落在**子组件**的根元素上，而它带的是子组件自己的 id —— 规则永不匹配。
3. **门禁必须先自检。** 这个迁移里已经有二十余次「门禁自己错了」而不是「站点错了」，
   包括：规则写在正则引号的错误一侧而**完全不匹配**、新加的正则打断注释剥离、
   只读 `dist/_astro/*.{css,js}` 而漏掉 Astro 7 内联进 HTML 的 1431 段产物。
   **没被看过变红的门禁等于没有门禁。** 详见 findings §62.4、§64.10–64.12。
4. **新写的门禁不接进 `acceptance.ps1` 就等于不存在。** §64 一轮写了五道门禁，
   一道都没进流水线——它们当时只在有人记得手动敲时才存在。`check-self-contained`
   同样如此（§66.1）。**加门禁的同一件事里就要把它接进去**，
   详见 findings §67.1。
5. **别把「在一个视口下量过」当成「UI 一致」。** §72：页高与样式对比都只量
   1600×1000 就算收官，而断点错误、`hidden` 被作者级 `display` 压过、栅格塌陷
   全都只在窄屏显形；深色更是整套换令牌，而**页高对颜色完全无感**。
   加测量维度时**默认值必须保持原样**，且非默认值要写进自己的产物文件，
   否则会悄悄覆盖既有基线。
6. **「差异不影响页高」不等于「不用查」。** §72.3 挖出的 9px 在
   `position:fixed` 里，对页高、滚动、tab 序全无影响，于是当时想「不值得写
   探针」。结果**工具缺口本身就是缺陷**：写了 `scripts/probe-subtree.mjs`
   之后，40 秒就把 9px 拆成「两个按钮各 4.48px = line-height − 1em」，
   一行 `line-height: 1` 修好，根节点从 +8.9 变 0。§77 又添两个变体：
   一是「一个 class 改了几何，但改的是**横向**」（分页 224→752px，页高不变）；
   二是「差异落在 `STYLE_PROPS` 没列的盒模型属性上，且采样只取头部」（`.feed-card`
   的 margin）。**能抓住这两类的只有按属性的全量取值分布比对**，页高门禁看不见。
7. **新加的仪器必须能自己喊停。** §74：如果 `setEmulatedMedia` 静默失效，
   两侧都停在浅色，你会拿到一份「63 页全绿、实际量了两次浅色」的深色结论。
   所以 preflight 里要有「`--theme=dark` 时 `<html>` 必须真的带 `.dark`，
   否则报错退出」这种守卫，**并且注入缺陷验过它会红**——否则它只是一句注释。
8. **顶层 `:deep(X)` 搬到 Astro 必须把锚点补回去。** Vue 的 `<style scoped>` 把
   顶层 `:deep(X)` 编译成 `[data-v-<hash>] X`——那个属性选择器**要求祖先里有本组件
   的元素**。写成裸 `:global(X)` 锚点就没了，规则会跑到组件外去。
   实测（§76）：`/link` 上那张不在 FeedGroup 内的独立卡片，本该保留
   `margin: 1em auto`，被 `FeedGroup` 的 `:deep(.feed-card.feed-card){margin:0}`
   顶成 `0`，整页少 8px；而 `.feed-card` **本来就在** `STYLE_SELECTORS` 里，
   样式对比却报 0 差异——因为 `STYLE_PROPS` 没有 margin 属性，且只采样列表**头部**，
   有缺陷的那张排在尾部。`scripts/check-scope-anchors.mjs` 盯这一类。
9. **断网测量会造出假阳性，必须用 online 模式复核。** §76：离线路径拦截页面跨域
   fetch，于是线上那份靠客户端 JS 才达到最终渲染的内容（`ProsePre` 的 shiki 高亮）
   停在 SSR 纯文本上，`lemmy-fediverse-deploy` 因此凭空多出 18px。切 `--mode=online`
   是 +1px 亚像素。**离线扫描报的差值，先复核再定性。**
10. **「这个页面/路由对应哪个源文件」是猜的，而猜测没人复核。** §77：`404.astro`
   的文件头写着「对应 `app/error.vue`」并据此写了图标、文案、按钮和 `.app-error` 外壳。
   线上 404 实际由 **`app/pages/[...slug].vue` 的 no-post 分支**渲染——静态托管下
   任何缺失路径都命中 `404.html` 这个 SPA 壳，壳水合后路由到 catch-all，
   `error.vue`（Nuxt 抛错页）**永不执行**。物证：线上 404 的 Nuxt payload 是
   `serverRendered: false`。**每个页面都要确认「线上这份 HTML 到底由哪个源文件产出」**，
   静态壳会让「哪个文件看起来该负责」彻底失效。而当时的门禁只扫 sitemap 里的 URL，
   **结构上就看不见 404**——不在清单里的页面等于没测。
   同一形状的第二形态是整条路由：robots `Disallow` 挡住的三页（见坑位 14），
   现在清单是 `scripts/lib/page-list.mjs` 一个来源，**66 页**。
11. **Vue 的「组件根元素」不能翻译成「枚举父元素」。** §77：线上
   `ProseCode.vue` 的 `<style scoped> code { … }` 编译成 `code[data-v-N]`，
   对**任意嵌套深度**都生效。Astro 侧写成了 `article p > code, li > code, …`，
   于是 `<p><strong><code>` 那一处漏了，26 个行内代码里 1 个没样式。
   这与坑位 8 是同一个错误的两种形态：**都在把 Vue 的组件边界换成 CSS 里的近似表达**。
   判据要用**集合**（`code:not(pre code):not(.copy):not(.domain)`，每个排除项都要有普查依据），
   不要往枚举表里加 `strong > code` 打地鼠。
12. **读调用点不等于知道语义；`auto` 外边距的 computed value 是 used value。**
   §77 两处都栽在这。① `useElementVisibility(anchorEl)` + `:class="{ expand }"`
   看不出 `expand` 到底是「可见时加」还是「不可见时加」——源码当时根本装不到，
   最后靠四态滚动实测才定出极性反了。② `getComputedStyle().marginRight` 对 flex item 的
   `margin: auto` 返回**解析后的实际像素**（240.625px），不是 `auto`；
   两侧这个值不同，说明的是**容器剩余空间**不同，而不是「规则没生效」。
   顺着这条线量 `.pagination` 本身，才看到 224px vs 752px 的真因。
   另：这也是坑位 6 的第三个变体——**纯横向差异**既不改页高、也不改被采样元素的纵向盒模型。
13. **用文本当元素键不成立；判据顺序必须是「先全量、再逐元素」。** §77.5b/§77.5d：
   `compare-ui-parity.mjs` 按 `textContent` 前 40 字符分签名配对两侧元素，
   用来解决「按下标比会把 A 段和 B 段当成同一段」。但**签名可以重复**——
   实测撞上三类：`/link` 37 张 `.feed-card` 里两张同签名、`/link` 两个 `.gradient-card`、
   `riddle-joker` 若干 `.article p`。于是：
   - 按**插入顺序**配对 → 把同签名的两张配反 → 13 条假差异（`/link` @390）；
   - 改成逐桶比**多重集** → 假差异消失，但同签名元素之间发生**取值置换**时又报出来
     （此时分布其实相同；文本都一样 ⇒ 用户看不出哪张是哪张 ⇒ 不可见）。

   定稿是**两道门槛**：`distDiff` 先算全量取值分布，分布相同的属性一律不报逐元素差异。

   | 全量分布 | 逐元素 | 判定 |
   |---|---|---|
   | 同 | 同 | 一致 |
   | 同 | 异 | 同文本元素间置换 → **不可见 → 不报** |
   | 异 | 任意 | **必报** |

   改这类核心比较逻辑**必须**注入真实缺陷验红绿双向（§76 的 FeedGroup 缺陷：
   注入后 `/link` 报 `DIFF 8` exit 1，恢复后 `ok` exit 0）。
   **「同一属性上全量分布相同而逐元素不同」这个矛盾出现时，错的永远是逐元素那一侧。**
14. **「不在清单里的东西等于没测」的第二形态是**整条路由**。** §78.1：受测 URL 来自
   `sitemap.xml`，而 `robots.txt` 的 `Disallow: /preview` 与 `Disallow: /previews/`
   把三页挡在外面。代价不是「少量未覆盖」——`content/previews/**` 用到的 19 个 MDC 组件里
   **12 个在 `content/posts/**` 里一次都没出现过**（`blur` `card-list` `link-banner` `link-card`
   `meta-aside-bar` `meta-aside-foo` `meta-copyright` `poetry` `project-group` `series-group`
   `timeline` `video-embed`），零测量背书。手工核对 `/preview` 的 HTML 立刻抓到真缺陷：
   h1 里的「返回首页」链接整个漏了，**移动端没有任何回首页的入口**。
   **页高看不见**（390 下两侧都是 1176）、**样式对比也看不见**（`STYLE_SELECTORS` 里没有
   `.preview-header a`）——「某个元素在不在」这两道门禁都不管。
   清单现收敛到 `scripts/lib/page-list.mjs` 一个来源，66 页。**加路由时先问它在不在清单里。**
15. **同一个渲染结果，两边的 HTML 结构上就不可比。** §78.2：想省掉浏览器做静态 HTML
   语义对比，第一条差异就是「线上每个标题文字是自链接、Astro 没有」——**假的**。
   Nuxt Content 的 `anchorLinks` 是**构建期**产物（进 SSR HTML），Astro 的
   `prose-enhance.ts` 是**运行时**增强，渲染一致而 HTML 不同；反向还成立：Astro 静态输出
   搜索框/分享按钮/65 个「引用整段到评论区」/二维码 img，这些在 Nuxt 侧是 client-only。
   连 `button` 的 `type` 都不同（线上 46 个全没有，Astro 全加）。**判据必须落在渲染后的 DOM。**
   写这类静态探针时另有两个必踩：`innerText` 必须剔 `<script>` 子树（Astro 把组件
   `<script>` 渲染成组件根元素的**子节点**，会把整段 JS 吸进按钮文本）；
   遍历递归**不能写在 `if (n.tagName)` 里面**（parse5 的 `#document` 节点没有 `tagName`，
   整棵树不会被遍历，你会得到「线上 0 个 button」）。
16. **「连量两遍一致」不等于「页面是确定的」。** §78.4：63 页那趟 `/link` @390 报 −20px，
   单页复跑却是 UNST。实测线上 `/link?shuffle=false` **连装 10 次**得到
   2677 2677 2677 2674 2633 2654 2650 2670 2674 2674（**跨度 44px**），
   而每次装载**内部**连采 5 次完全相同 ⇒ 不是动画没停，是**每次装载结果本身不同**。
   定位到叶子：组内卡片**顺序每次都变**，390 下 4 列 × 84.1px，名字长短决定换行。
   根因是线上洗牌写在 `onMounted`（`FeedGroup.vue:21-24`，`randomInGroup: true`），
   而那个「关掉随机」的逃生口**在线上无效**（参数确实到了：纯 HTTP 三次取回 HTML
   逐字节相同 ⇒ SSR 顺序固定，变动在客户端）。判据已改成 `--samples`（默认 3）次
   判**极差**，报告摊开 N 次读数。只要抖动是间歇的，相邻两次落在同一档的概率就相当高。
   **Astro 侧 10/10 恒定，别为了让两边「看起来一样」把静态站也改成随机。**
17. **断网模式自己会造假，差值必须用 online 复核。** §78.3：`lemmy` 的 −19px
   （offline 9645/9626 vs online 9971/9971）——隔离之后是**线上自己变高 19.03px**，
   本地一点没动。危险在方向：d = Astro − 线上 = −19 读起来像「Astro 少渲染了东西」，
   而实际什么都没少。工具现在**自己**用第二个浏览器（没有 `--host-resolver-rules`）
   复量，落在 ±40（本工具 online 模式一直以来的默认容差）内就判 `ARTIF` 单独列出。
   **别把 `ARTIF` 混进「一致」**（看不出这一页曾经红过），也别混进「超差」
   （会让人去改本来正确的代码）。
18. **live 不是当前 Nuxt 源码——差异分三类，门禁自己分不出来。** §78.8：`git status` 显示
   Nuxt 树里有 **10 个已改动文件**（`BlogSidebar.vue` 状态 `MM`、`animation.css`、`Secret.vue`、
   `shared/utils/icon.ts`、6 个 `content/**`）。物证：`git show HEAD:app/components/blog/BlogSidebar.vue`
   里**没有** `listClass` 也没有 `sidebar-nav-leaf`，而工作区版有——
   线上 `/previews/example` 的 HTML 里 `sidebar-nav-leaf` 出现 **0 次**。
   ⇒ **Astro 照工作区移植，线上跑最后一次提交。** 于是每条差异只有三种可能：
   迁移缺陷（`git status` 干净） / **部署滞后漂移**（能被某个未提交改动解释） / 内容漂移。
   **正确动作是部署，不是改 Astro；绝不加进 `ACCEPTED`/`STYLE_ACCEPTED`/`known`**——
   那会把「Nuxt 源码还没部署」这个信号永久静音。
   其中 `Secret.vue` 那条是**本地更正确**：原写法 `&:hover > &` 拍平后要求元素是自己的后代，
   永不匹配，所以线上那个 secret 链接从来不可见。
   附三条做普查时会踩的仪器坑：**跳过 `svg` 子树会凭空造出「类缺失」**（`.domain-icon` 线上挂
   `<span>`、本地挂内联 `<svg>`）；**按 `"${cls}` 找上下文只命中该类名排在 class 首位的情况**；
   **只比对可见部分会漏掉折叠分支**（侧栏「资料」子列表在 DOM 里但 `display:none`——
   看不见不等于不存在，与坑位 12 的 `auto` 外边距 used value 同类）。
19. **「构建通过 + 门禁全绿 + 产物一字未变」也可能是「代码根本没执行」。** §79.2：
   标题 id 归一第一次接在 `with-article-meta.ts` 的 `load()` 里改 `entry.rendered.html`，
   构建过、门禁绿、`dist` 逐字节没变。物证是构建期一句 `console.error`：
   68 个条目的 `entry.rendered` **全是 undefined**——`@astrojs/mdx` 注册的 entry type
   带 `contentModuleTypes` 且不提供 `getRenderFunction`，glob loader 因此走
   `deferredRender` 分支（`astro/dist/content/loaders/glob.js:155-163`），
   写入 store 的条目里**根本没有 `rendered` 字段**，正文 HTML 是运行时由 MDX 组件产出的。
   **⇒ 没有「改完之后产物变了吗」这一项检查，一切「接上了」都是猜的。**
   正确位置是 rehype 插件且必须排在 `rehypeHeadingIds` **之前**——
   它排最后，但**尊重已存在的 string id**（`if (typeof node.properties.id !== "string")`），
   所以前置写好 id 能一处管住正文 DOM 与 `headings` 元数据两条通路。
   连带一条：slug 依赖的**标题文字提取规则必须照抄** `rehypeHeadingIds`（四处分支），
   简化实现会在某篇带表达式的标题上静默产出不同 slug，而那种缺陷没有任何门禁看得见
   ——与坑位 11 是同一个错误的两种形态。
20. **构建会改写正文字面，而所有几何门禁都看不见。** §79.5：`remark-smartypants`
   在 Astro 侧**默认开着**（判的是 `smartypants !== false`），Nuxt 侧没开，
   于是 20/64 页的 `"…"` 被写成 `“…”`、`...` 被写成 `…`。
   **换的是字形不是盒子**，页高与计算样式两条都测不出来；
   是在语义探针的一处 h4 文字（`Key社，我哭死...` vs `…`）上偶然撞见的。
   补门禁时**第一版判据是「dist 里每个 `…` 在源里都出现过」——它红不了**：
   源 `.mdx` 里本来就有 `“ ” … ’ –`，于是每个字符都「有出处」，判据形同虚设。
   定稿是**逐字符计数不等式** `产物次数 ≤ 源次数`：`≤` 不是 `=`（构建也可能减少），
   增加才是改写。**一个从不报错的门禁比没有门禁更糟**——它让人以为这条已被覆盖。
21. **断言自己会错，两个仪器结论打架时先怀疑仪器。** §79 追加 findings 时用
   `if (/\n(?!\r)/.test(s))` 判「有没有裸 LF」，它**匹配了全部 5728 个换行**——
   lookahead 看的是 `\n` **之后**的字符，而 CRLF 的 `\n` 后面接的是下一行开头。
   差点照着它把 32 万字节的换行全改掉。同一份文件用 `latin1` 与 `utf8` 两种读法
   分别数过都是 CRLF 5728 / 裸 LF 0，**文件从来没脏过**。正确写法 `/(?<!\r)\n/`。
   同源的一条：后台任务读到的脚本内容可能不是你刚写的那份——连续三次首腿与脚本
   不符（换过文件名、脚本内容确认无误、同一脚本**前台 dry run 完全正确**），
   而磁盘上的产物证明它跑的确实是旧参数。所以
   **起完任务先对一眼它的第一行输出，别信「我已经改了脚本」。**
   **同源的第二条：判断「构建产物变没变」不要用整体哈希。** 实测连续两次
   **同样源码**的构建给出两个不同哈希，逐文件追下去只有 4 个文件变
   （`atom.xml` 的 `<updated>`、OPML 的 `dateModified>`、首页与归档页 BlogStats 的
   `title="构建于 …"`）——**全是构建时间戳**。我据此差点断定「`eslint --fix` 改了语义、
   测量基线过期」，而它其实只改了格式。整目录哈希这种粗判据会把「时间戳」误报成
   「代码变了」。查产物差异必须**逐文件 + 定位到首个不同字符**，不能停在哈希不相等。
22. **「把字符串当 HTML 吐出去」= 静默空白；判据必须是「未求值即失败」。** §79.10：
   `rehype-meta-slots` 在 Nuxt 侧存 **MDC AST** 并用 `ContentRenderer` **求值**；
   Astro 侧 codemod 产出 frontmatter 里的**字符串**，而 `BlogWidget.astro` 用
   `set:html={meta.content}` 注入 ⇒ `<LinkCard />` 变成浏览器不认识的未知元素，
   `/previews/example` 的**第三个侧栏 widget 整个空白**。
   **页高看不见它**（空白也是合法盒子），**计算样式看不见它**（压根没有元素），
   语义探针只报「数量差 1」。
   门禁 `check-mdc-eval.mjs` 的判据是**零歧义**的：注册表里 26 个组件名与 HTML 原生标签
   **无一重名**，所以「产物里出现 `<linkcard`」严格等价于「未求值」。
   配套的解析器（`src/lib/meta-slot.ts`）对不认识的形态**抛错让构建失败**——
   这条当场救了一次：第一版正则漏了 `</Blur>`，构建立刻炸在「`<Blur>` 没有闭合」，
   而宽松跳过就会安静渲染出一个缺 children 的 `<Blur>`。
23. **Vue/MDX 的「属性」在两侧不在同一处；只读对、写错就静默无效。** §79.11：
   `prose.ts` 的 `tagOf()` 只把 MDX 元素里 `name === 'code'` 认出来，
   于是手写的 MDX `<a>` 整条绕过 `buildLink`——没有 `z-link`、没有图标、
   `icon` 属性原样漏进 DOM。**判据应该是「这个标签在 Nuxt 侧有没有对应的 `Prose*` 组件」，
   不是「它是不是小写」**（`ProseCode` 与 `ProseA` 都会被 codemod 转成 JSX）。
   修完又暴露第二层：`getAttr` 早就同时读 `properties` 与 `attributes`，
   但 `addClass` 只写 `properties`，**对 MDX 节点是无声空操作**。
   第三层更阴：新增的 MDX 属性对象**必须带 `type: 'mdxJsxAttribute'`**，
   裸 `{name,value}` 会被 hast→estree 静默丢弃——症状是「图标渲染了、`icon` 也清掉了，
   唯独 `class` 没加」，看起来像 `addClass` 没被调用。
24. **巧合正确的路径会掩盖整类缺陷；探针的失败模式不止一种。** §80：
   ① `BlogSidebar` 的 `currentMark` 写 `path === item.url`，而
   `build.format: 'directory'` 让 `Astro.url.pathname` **带尾斜杠**，
   于是精确命中恒不成立、该给 `page` 的退化成 `true`。
   **首页之所以「看起来是对的」，只因为 `item.url` 恰好也是 `/`**——
   一个巧合让这条缺陷在最容易测的那一页隐形，却在 `/link` `/archive` `/games`
   `/drive` `/about` 五页同时发作。**一个断言在某个输入上通过，
   必须问「它是因为正确而通过，还是因为巧合」。**
   ② 同一个探针的失败模式我先后猜错了两次：以为产物错（实际是 EdgeOne 的
   `?cb=` 命中了**另一个 cache key**、父层还没刷新，而真实用户走的普通 URL 早就是新的），
   以为正则慢（逐阶段计时全是 48ms/9ms 的正常值，实际是 `indexOf` 返回 **-1**、
   `i = -1 + 1 = 0` 把指针送回开头**死循环**，白烧 99s CPU）。
   **仪器卡住时先分段计时再猜原因；`indexOf` 一类会返回哨兵值的 API，
   指针运算必须显式处理哨兵。**
   ③ 顺带两条 HTML 事实：双引号属性值里**允许**裸 `>`（禁的只有 `"` `<` `&`），
   所以 `<a\b([^>]*)>` 这类匹配会在属性值中间截断，产出「引号未闭合」的假象；
   而 `riddle-joker` 的 `title` 里真有 `式部茉优 > 在原七海`，线上序列化成 `&gt;`
   而本地是裸 `>`——**这不是缺陷**，`getAttribute` 拿到的字符串逐字相同，
   页高与计算样式两道门禁都看不见它。


> 观测手段本身也要证伪。§67.3 里我因为 glob 只覆盖了 `dist/*.html`、
> 而归档页在 `dist/archive/index.html`，差点把一条**根本没丢**的字体规则报成缺陷。
> 查出来「少了一个值」时，先确认你的查询覆盖了全部路径，再去解释那个数字。
> §76.4.1 是同一个教训的加强版：新门禁里那列「这个选择器命中 N 页」的口径
> **连错四次**，而且每次都往相反方向错（把 CSS 选择器文本当成元素、把命中 39 页
> 的规则报成 0 页、把 `nav-icon` 里的 `icon` 算成独立 class）。定稿是不看正则——
> `class="([^"]*)"` 整个取出来按空白切分再判成员。**一个门禁自己的计数器不可信，
> 它的结论就一条都不可信。**
> §77.4.1 又添一个盲区形态：枚举「命中且声明了某属性的规则」时，
> 直接对含 `cssRules` 的样式规则 `continue` 去递归，会**跳过该规则自身的声明**——
> 而 CSS 嵌套里目标规则正是嵌套子规则，签名文本是 `& > .x`，`matches()` 直接抛错，
> 于是返回**空数组**。结论当时是靠 `getComputedStyle` 数字与静态 CSS 搜索交叉定出来的。
> §78.2 再添两条，同属「仪器错了而不是站点错了」：
> ① **正则在字符数上限处截断会造出「元素不存在」的假象**——
> `<h1[\s\S]{0,200}?<\/h1>` 扫线上得出「没有 h1」，实际闭合标签在 200 字符之外
> （里面塞着 iconify 的 span）。这是 §76.4.1「先确认查询覆盖了全部路径」的同一形态。
> ② **树遍历的递归不能写在 `if (n.tagName)` 里面**——parse5 的 `#document` 节点没有
> `tagName`，于是整棵树一次都没被遍历，工具报「线上 0 个 `<button>`」。
> 我差点据此得出「线上根本没有按钮」。

25. **「量了外框」可以连续错三次；列测量清单的依据必须是遍历出来的普查表。**
    §82：用户报侧栏差异，先查出 `STYLE_SELECTORS` 里侧栏只有 2 条**外框**。
    按组件结构补到 17 条后**仍然全绿**——第二次失败的原因是 `#blog-sidebar` 两侧
    都是 `visibility:hidden`，`visible()` 判不可见，所有后代在**「可见吗」这一层就出局**，
    `nv.visible === 0` 直接 `continue`，**补多少选择器都没用**。
    修好可见性后第三次全绿：补的 17 条里页脚只有两个外框，
    真正承载样式的 `<menu>` 里的 `<a>` 不在表里，而反向测试注入正好写在那个 `<a>` 上。
    **应用**：测量清单不能靠「读一遍组件结构时的理解」来列，要遍历整棵子树、
    按 `tag.class` 汇总两侧签名、拿一张普查表当依据；清单里每一条都要能指着普查表
    说「这条两侧同名」。**判据在更上游的环节出局时，往下游补清单是白费力气——
    先确认判据那一层本身成立，再谈覆盖面。**
    ⚠️ **同形态的第四层（§82.9）：量了「盒」，没量盒「里面」。** 用户报「图标和字不是很对齐」，
    而「盒中心 vs 文字中心」两侧全是 0、盒高 21.5938 逐位相同——**一个数字都没错**，
    但它们回答的都是「多大」，没有一条回答「在哪」。真凶是内层 `<svg>` 按
    `vertical-align: baseline` 贴到父级的基线上，**偏下 1.72px**，而父级那个
    `line-height: 1` 正是为了把盒高压回 21.6px 才写的。
    两台仪器结构上都看不见它：`STYLE_PROPS` 里**一条几何偏移都没有**（补选择器那一步看不出这个缺口），
    而 `.nav-icon > .iconify` **跨侧不匹配**——线上根本没有内层 svg。
    **⇒ 补测量维度时，除了「补选择器」还要问「补位置类指标」；
    两侧没有同一个东西可对时，那是单侧不变量，得另写门禁而不是继续往表里加。**
26. **`X.check()` 这类便利谓词往往不是你以为的那个问题，而且答案可能是反的。**
    §82：`span.split-char` 高 35（线上）/ 32（Astro），两侧 CSS 逐字相同，
    `fontSize`/`lineHeight`/`fontWeight`/`fontVariationSettings`/动画 `currentTime` 全部一致。
    读 `document.fonts.check('600 24px "LXGW WenKai Screen"', …)` 得**线上 `true` / 本地 `false`**，
    据此写下「本地字体没加载、回退到 Noto」——**这个结论正好反了**。
    改查 `document.fonts` 的 face 列表与那条 `<link>` 的 **`media` 运行时实际值**：
    线上 `media` 停在 `print`（`onload` 未执行，样式表下载了却**永不应用**，静默无错）、
    `LXGW WenKai Screen` 一个 face 都没有；本地 `media=all`、3 个 face `loaded`。
    **应用**：判断「某个资源到底用上没有」，必须用与该问题**定义相符**的字段——
    `fonts.check()` 判的是「该文本能否无回退渲染」且把整条 fallback 链算进去，
    `getComputedStyle().fontFamily` 则原样回显声明值，两个都不是。
    **同一个探针里两个字段互相打架时，挑定义与被测问题相符的那个，
    而不是先读到的、或看起来更权威的那个。** 顺带两条：基线的成立条件要显式写下来——
    本项目「两侧字体环境一致」是靠**断网隔离**碰上的，不是任何检查保证的，
    切到 online 模式就必须重取基线。
    ⚠️ 另有一条**只对 Windows PowerShell 成立、但后果最严重**的同类陷阱在坑位 27。
27. **仪器自己失败的三种形态，全都会被读成「站点有缺陷」——这是最贵的一类错误。**
    §82.8 一节里我连犯五次，其中三次照着读会直接得出「站点坏了」的错误结论：
    ① `Get-Content` 按 GBK 读无 BOM 的 UTF-8，**中文注释全成乱码**，
    差点判 `BlogHeader.astro` 损坏；直读字节数 5364 B、U+FFFD 计数 0 ⇒ 文件一直是好的。
    **判编码必须用 `[System.IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)` 或 `Get-Content -Encoding UTF8`。**
    ② 探针里写 `{ 有has-quote-button: n }`——**未加引号的对象 key 不能含连字符**，是语法错误，
    CDP 返回 `undefined`，两侧同时 undefined 被读成「线上和本地都没有这个按钮」。
    **求值失败必须抛错，不能静默返回 undefined**；同一段表达式里也**别用中文当 key**。
    ③ 想验证「CDN 边缘节点刷新不同步」，我在 URL 上加了 `?probe=<时间戳>`——
    带 query 是**独立 cache key**，每次都请求全新条目，必然拿到最新内容，
    恰好测不到边缘节点差异。**想观察缓存这一层，cache-buster 会把你直接送到缓存之外。**
    另两条不致命但同样误导：逐行比对两个文件报「1417 行不同」，
    其实只是 `--fix` 插入行导致的**行号错位**，该用 `git diff --no-index -w`；
    拿 `toString('utf8')` 的**字符数**去比 `Get-Item` 的**字节数**，
    中文 3 字节/字符，「差 7.7KB」实际是差 **788 字节**。
    **应用**：每次读到「异常结果」先问一句「仪器自己是不是先挂了」——
    有没有报错信息、有没有单位不一致、有没有偏移/编码问题。
    这与坑位 21、25、26 同源，但更隐蔽：**那几条是判据选错，这一条是判据根本没运行起来。**
28. **「exit 0」只有在检查的**作用域**覆盖到你改的文件时**才算通过。**
    §83.4：改完 `.astro` 顺手跑 `npx eslint .`，先得到 **359 errors**，
    追下去发现两层错位——`astro-site/` **没有自己的 eslint 配置**，
    命令向上找到仓库根 `eslint.config.mjs`（Nuxt 那份）去判 astro-site；
    而 `.astro` 文件**根本不在它的作用域里**，单跑会得到
    `warning  File ignored because no matching configuration was supplied`。
    ⇒ 那 359 个 error 全在 `scripts/*.mjs` / `src/**/*.ts` / `tsconfig.check.json`
    这些平时没人单独 lint 的文件上，**真正改动的两个 `.astro` 一个都没被检查**。
    更糟的是上一轮汇报过的「eslint exit 0」是**窄范围调用**的结果，对 `.astro` 一直是空判；
    且 `acceptance.ps1` 里**根本没有 lint 这一步**。
    **应用**：汇报任何检查结果前，先确认它**实际检查了哪些文件**——
    打印工具列出的文件清单，而不是只看退出码。
    **一个从不加载目标文件的检查，和没有检查是同一个东西**（与坑位 4「没接进流水线就等于不存在」互补：
    那条是检查存在但没人跑，这条是检查在跑但没看你改的东西）。
29. **「到边的距离」不是「相对基准的偏移」；居中的判据是对称性，不是绝对值小。**
    §83.5：判内层图标是否在行内居中，第一版判据写成
    `svg 到行上沿 > 0.5px ⇒ FAIL`，跑出 4.313px 直接报红——
    差点照着去"修"一个完全正确的布局。实际是行高 25.9063、图标 17.2656，
    `(25.9063 − 17.2656) / 2 = 4.32`，**上下各留 4.31px 正是居中**。
    定稿三条：`|上沿距离 − 下沿距离|`（对称即居中，两值都可以很大）、
    `svg 中心 − dt 中心`、`svg 中心 − dd 中心`。
    **⇒ 绝对量级大不等于有缺陷。** 与坑位 27 同源但更隐蔽：
    那条是仪器返回 `undefined` 被读成「两边都没有」，
    这条是**仪器返回了一个正确但被我读错了含义的数**。
30. **批量改写脚本：「按第一个匹配定位」是错的；而且你只验了你改的那一种结构。**
    §84 用一次性脚本把 25 段内容从 2 个 tab 扩成 3 个，连犯三次，**没有一个会被行数或标签总数看出来**：
    ① `slotRange` 只找区间内**第一个** `<div slot="tab2">`，而 `Tab` 组件段的 tab1 里嵌了 4 个
    `<Tab>` —— 抓到的是**嵌套 Tab 的槽位**，外层真实 tab1 被删、4 个嵌套 Tab 变成孤儿漂在文档里。
    ② 替换区间只到 `</div>`，而新块自带一个 `</Tab>` —— 凭空多出 **26 个**闭合标签
    （写完数开闭才发现：开 34 / 闭 60）。
    ③ **只写了围栏开头、没写闭合围栏** —— 每个 ` ```astro ` 被**后面某一节**的围栏错配吃掉，
    一路错位到文件末尾，最后一个未闭合的围栏把 `</div>` 吞进代码块，
    MDX 报 `Expected a closing tag for <div>`，报在**文件末尾**而不是出错的那一行。
    **根因是同一个**：我验了 `<Tab>` 开闭配平（因为在改 Tab），**没验围栏配平**（因为围栏是新引入的）。
    **⇒ 改一种结构就要验那一种；引入一种新结构就得给它配一条新断言。**
    嵌套结构的定位要**整段跳过子结构**，不能靠「第一个匹配」；
    写盘前把断言跑在**重新解析**的结果上，不通过就拒绝写盘。
31. **注释里不要出现可解析的 import 语句或相对路径**——词法门禁不认注释。
    §84.5 一天内被 `check-self-contained.mjs` 绊了两次，两次都是**我自己写的反面教材**：
    先在 `BlogTech.astro` 写「不改成 `import pkg from '../../package.json'`」，
    门禁报 `[missing]`；修掉之后又在 `component-source.ts` 的注释里把 `mdast` / `unified`
    的 import 原样写出来，门禁再报 `[undeclared]`。
    第二次顺手修掉一个真问题：那两个是 **transitive** 依赖、`package.json` 里没声明，
    改成**本地声明接口**后插件零第三方类型依赖。
    **⇒ 门禁报错时先确认命中的是不是注释**——它可能正是在告诉你「你写的这句话本身有问题」。
32. **门禁打印 `RESULT: FAIL` 不等于它能失败；退出码才是结论，而屏幕上往往只看得到前者。**
    §85.5 给新断言验红时发现 `check-integration.ps1` 打印了 `RESULT: FAIL`、
    `$LASTEXITCODE` 却是 **0**。原因在调用链：`acceptance.ps1:175` 用
    `powershell -File <gate>` 起子进程，`Step()` 只取 `$LASTEXITCODE`。
    **PowerShell 脚本不调 `exit` 就返回 0**，哪怕它满屏 `FAIL`。
    普查 12 道静态门禁：**8 道没有任何 `exit` 语句**（`check-integration`、`check-layout`、
    `compare-urls`、`compare-titles`、`check-content-preservation`、`check-dates`、
    `audit-deferred`、`audit-image-pipeline`），只有 4 道 `.ps1` + 那个 `-File` 之外的
    `check-head-vs-live` 会真的返回非零。
    **为什么能活这么久**：汇总表的 `Note` 一列是从输出文本正则抓的，屏幕上**确实看得到**
    `RESULT: FAIL`——看着是红的；而历史上报出来的每一次失败恰好全是 `.mjs` 或带 `exit` 的
    `.ps1`，与「另外 8 道从来没红过」完全自洽。
    **⇒ 这是坑位 20「一个从不报错的门禁比没有门禁更糟」的加强版：不是不报错，是报错了但
    记成通过，比不报错更难发现。加任何新断言之前，先确认它所在文件能返回非零退出码。**
    ⚠️ 退出码一旦修好，这些门禁立刻翻出从未被处理的结果（`check-content-preservation`：
    `/drive/` 缺 1 段正文；`check-dates`：40 个受检页 **40 个全 mismatch**）。
    `check-dates` 的 100% 失败率本身就是信号——它拿 Nuxt frontmatter 裸串和产物里的
    UTC ISO 做**字符串相等**比较，带时分秒就永远不可能相等；抽样 10 条全是整 8 小时差、
    日历日相同，即同一瞬间的表示差异。
    ⚠️ 附带一层：`check-dates.ps1` 用 `$root = (Resolve-Path '..')`，那是相对**进程 CWD**
    解析的、不是 `$PSScriptRoot`，于是它读的是 **`blog-v4/content`（Nuxt 树）**而不是
    `astro-site/src/content-mdx`。`check-self-contained.mjs` 抓不到——它扫 import，
    不扫运行时按 CWD 拼出来的路径。**「自包含」目前只覆盖了 import 形式的外流。**
33. **报错文案会把「假设」写成「结论」——照着它去修，等于去确认一件已经成立的事。**
    §85.8：`check-text-literal` 变红，报错写死「smartypants 会把 `"..."` 改成它」
    并给出「修法：保持 `smartypants: false`」。**而 `smartypants: false` 本来就设着**
    （`astro.config.mjs` 的 `createProcessor()`）。门禁在教我去确认一个既有事实。
    独立验了两条假设：H1（转换还开着）**被证伪**——产物里 `“ ”` 是 318/310，
    **少于**源 390/382，开着的话必然多于源；H2（有插件把源外内容注入正文）**成立**——
    `component-source.ts` 注入 25 个文件 92157 字符，带进 `…` 15 / `—` 40，
    恰好对上超出量 +14 / +32。真因是我自己上一轮加的功能。
    **⇒ 报错文案是门禁作者的猜测，不是测量结果。看到「因为 X」先问「这条是谁测出来的」；
    判据没指明来源的因果，一律当作待验假设。**（与坑位 21「断言自己会错」同源，
    但那条讲的是仪器算错，这条讲的是仪器**说错**。）
    ⚠️ 同一次里还踩了口径错：临时探针数整个 dist 得 `—`=218，门禁说 98——
    门禁只数 `<article>` 内、剥标签后的文本。**两个数字在量不同的东西，差点被我拿来互相解释。**
    ⇒ 引用别人的数字之前先对齐口径（这条与坑位「先确认你的查询覆盖了全部路径」同源）。
    ⚠️ 第三条：**为一个改动找到了机制，不等于那个机制覆盖了它的全部影响面。**
    §85.4 我为删分享按钮给出了「`space-between` 单子元素 ≡ flex-start」这个**横向**机制，
    就顺手断言了竖向也不变——实测每篇文章页 **−10 ~ −11px**，因为那个按钮比
    `.post-info` 高，是它在撑行高。**推出来的结论要和被测量的维度对齐，不能跨维度搬运。**
    ⚠️ 第四条：「有 / 无某因素」这类判据要比较**两种状态下差值之差**，而不是绝对窗口。
    `compare-ui-parity.mjs` 的 `ARTIF` 复核用「online 复量落在 ±40 内 ⇒ 隔离噪声」，
    于是把本轮 −11px 的**真实**布局差异当成噪声放过了（同成因的另两页却判红）。
    而隔离噪声的定义是「断网与联网读数不同」：已知真 ARTIF（lemmy）offline −19 / online 0，
    差值 19；本轮 misskey offline −11 / online **−11**，差值 **0**。
    **两个样本都指向同一条修正**：`offline_d ≈ online_d` ⇒ 真实差异照报。

> **`live:ui-parity` 的红灯理由已经变了。** 它此前 exit 1 的 7 条差异里，
> 5 条是「本地内容比线上多」（用户删了 `## 相关条目`、移除了 Bangumi，线上还留着）。
> **2026-10-02 已把这批部署上线**（`89136cb` → CI `37029853527` 全绿 → `blog-public` `91291045`），
> 这一类理由随之消失。**仍然不要为了让门禁变绿而把任何页加进 `known` 列表**——
> 要先分清剩下的每一条属于「迁移缺陷 / 部署滞后漂移 / 内容漂移」哪一类，
> 后两者的正确动作是部署，绝不豁免。详见 findings §80.1–§80.2。

## 部署

GitHub Actions（push main 触发）：`pnpm generate` 后把 `.output/public` 推送到 PaloMiku/blog-public（GitHub Pages），站点经 EdgeOne CDN 对外服务（edgeone.json 只管 /api 与 OPML 的 Content-Type）。CI 是否绿是部署是否成功的唯一事实源。

**两处验证部署的注意点**（§80.2）：

- `gh` 在本仓库会**优先解析 `upstream` remote**（`L33Z22L11/blog-v3`），
  所有 `gh run list` / `gh workflow list` 都必须显式 `-R PaloMiku/blog-v4`。
- 站点在 EdgeOne 后面，**带 query 的 URL 是独立的 cache key**：
  `?cb=<时间戳>` 这种 cache-buster 会命中尚未刷新的父层，拿到**旧内容**，
  而同一时刻普通 URL 已经是新的。**验证部署一律用普通 URL**；
  要绕过 CDN 就查 `blog-public` 的部署产物本身。

## 当前状态（2026-10-03）

- 包版本 3.8.0，已完全同步上游 v3.8.0；已完成 SCSS→纯 CSS 迁移
- Bangumi 功能已于 2026-09-30 移除：bangumi-clarity 模块暂不引入（源码在仓库外 D:/Projects/Bangumi-Clarity）；`app/pages/bangumi.vue` 与无引用的 `HomeHeroBar.vue` 已删、可从 git 历史找回；自包含的 `InfoCard.vue` 与 `content/previews/bangumi-components.md` 保留，作为恢复时的展示资产
- 分支 `feat/sync-upstream-v3.7.1` 已完全合并进 main，可删
- Nuxt 侧工作区已清空，`89136cb` 已部署（见上方「部署」小节）
- 🔀 **2026-10-03 方向已定：本地正式迭代目标回到 Nuxt 版本。**
  `astro-site/` 已加进 `.gitignore`、**整份只留本地不入库**（它是实验产物，且自带
  独立 pnpm workspace）。下面这几条关于 `astro-site/` 的记录仅作历史参考，
  **不再是当前的工作目标**；`.github/workflows/build-astro.yml` 也已随之删除。
  未提交的残留：`docs/astro-phase1-findings.md`（417 KB 实测记录）、
  `scripts/baseline-analyze.ps1`、`scripts/remove-bgm-directives.ps1`
- 评论区**暂时关闭**（2026-10-03）：`blog.config.ts` 顶部 `commentEnabled = false`，
  三处读它（`twikoo.enabled`、两处页面的 `<PostComment v-if>`、`Toc.vue` 里的
  `href="#twikoo"` 入口）。判据是 **opt-out**——未显式为 `false` 即视为开启，
  删掉这个键会回到开启状态而不是静默永久关闭。`Comment.vue` 与自建 Twikoo 地址原样保留。
  ⚠️ `ProseP` 的「引用整段到评论区」按钮**不受这个开关影响**，它靠
  `onMounted` 里的 `querySelector('#twikoo')` 自行判断；`Toc.vue` 那个跳转链接
  原本没有这层保护，是关评论区时必须一起处理的一条死链。
- PR #2（`PaloMiku/blog-v4`，分支 `chore/nuxt-fork-maintenance`）含以上三项改动 +
  README 改写。⚠️ **合并它等于部署**：`build.yml` 在 push `main` 时触发。
- `astro-site/scripts/acceptance.ps1` 的产品门禁 **11 道**（新增 `check-heading-ids`、`check-text-literal`、`check-mdc-eval`、`check-aria-current`、`check-icon-box`）
- 侧栏「技术信息」widget 的**构建信息组**已按用户要求改成 **Astro 版 + 竖列带图标**
  （`DlGroup` 新增第四种尺寸 `stack`；service 组与线上保持一致未动）。
  这是**用户主动要求的偏离**，不是迁移缺陷，且默认折叠状态下不影响页高/样式/语义三道门禁 —— 见 findings §83
- ⚠️ `astro-site/` **没有 eslint 配置**，`npx eslint .` 会向上用仓库根那份（Nuxt 的），
  且**不覆盖 `.astro`**；`acceptance.ps1` 也**没有 lint 步骤**。见坑位 28
- ⚠️ 本项目 `eslint.config.mjs` 配的是 `'style/eol-last': ['warn', 'never']`——
  **文件末尾不要留换行**，与常见默认相反。`.gitignore` 至今无末尾换行；
  改这几个文件时若误加会凭空多出整行 diff。
- 文章分享按钮与 `ShareModal` **已从两侧源码移除**（Nuxt `app/components/popover/Share.vue`、
  Astro `src/components/popover/ShareModal.astro` 均已删，孤儿依赖 `qrcode` 一并清掉）。
  实测代价是**每篇文章页 −10 ~ −11px**（那个按钮比 `.post-info` 高，是它在撑行高），
  线上侧读数未变 ⇒ 全部来自移除本身。见 findings §85.9
