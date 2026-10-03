# Phase 1 实施记录与计划纠错（2026-10-01）

本文件记录 Phase 1 的实测结果、对 `astro-migration-plan.md` 的纠错，以及子智能体调查发现的转换风险。
**计划文档中与本文冲突之处，以本文为准。**

## 1. KaTeX Spike 结论（Markdown 管线选型已定）

实测 Astro **7.3.5**（不是计划里写的 7.2；7.3 为当前最新）。

| 能力 | Sätteri（Astro 7 默认） | unified（`@astrojs/markdown-remark`） |
| --- | --- | --- |
| GFM / 任务列表 / 表格 / 删除线 | ✅ | ✅ |
| heading ID（含中文 slug） | ✅ | ✅ |
| Shiki 代码高亮 | ✅ | ✅ |
| **行内公式 `$E=mc^2$`** | ❌ 原样输出为文本 | ✅ MathML + katex-html |
| **块级公式 `$$...$$`** | ❌ 原样输出为文本 | ✅ |
| **`aligned` 环境的 `\\` 换行** | ❌ **被破坏**，`\hat{y}_i \nabla` → `\hat{y}<em>i \nabla</em>` | ✅ `<mtable>` 两行完好 |

**决策：使用 unified 管线。** 代价是失去 Astro 7 的 Rust Markdown 加速；收益是公式正确渲染。

成本可接受：每公式约 5 KB HTML 增量。
KaTeX CSS 继续从 CDN 引入（`nuxt.config.ts` 已有 `katex@0.16.44` 的 link 标签），无需 npm 依赖。

> 注：`katex@0.18.10` 因发布于 2026-09-30，落在 pnpm 12 的 `minimumReleaseAge` 策略窗口内被拒绝。
> 未采用 `minimumReleaseAgeExclude` 绕过，而是移除该依赖——`rehype-katex` 自带 katex 作为传递依赖。

### ❌ 后续更正：真实含公式的文章只有 1 篇

初稿称「9 篇文章（63 篇中的 14%）用到公式」是**误报**。
检测用的正则 `\$[^\s$][^$]*\$` 没有排除代码块，命中了 shell 变量，例如
`content/posts/2025/10/fnos-vps-started.md` 里的 `wget -O ${_##*/} $`——那是 shell 语法，不是公式。

**排除代码块后重新统计，全库只有 `content/previews/example.md` 一篇真实含公式（6 处）**，
且该文件是预览页，列在 `blogConfig.article.robotsNotIndex`（`/previews/*`）中不被收录。

**这对选型的影响（诚实评估）**：
「保住 9 篇文章的公式」这个理由不成立，unified 管线的收益远小于初稿所述。
但**决策维持不变**，理由改为：
1. 统一管线更简单，`.md` 与 `.mdx` 行为一致，不会出现「同一站点两种数学渲染」的分叉
2. Sätteri 编译器对未闭合标签严格报错，是批量转换 `.astro` 时的额外风险源
3. **实测构建耗时 63 页仅约 3 秒**，Rust 加速在本项目规模下不构成瓶颈

### MDX 独立管线的三个配置陷阱

Phase 2 的转换产物是 `.mdx`，而 `.mdx` 与 `.md` 走**两条独立的管线**。三个坑全部是**静默失败**：

1. **MDX 集成不继承 `markdown.processor`**
   `extendMarkdownConfig` 为 `false`（默认）时，`@astrojs/mdx` 会退回干净的 `satteri()` 处理器。
   必须把同一个处理器配置**显式传给 `mdx({ processor })`**。

2. **插件不能用字符串形式**
   `remarkPlugins: ['remark-math']` 在 MDX 处理器里不会被解析，构建时只打印
   ``[@astrojs/mdx] `remark-math` not applied`` 警告然后跳过——`.mdx` 里的公式静默不渲染。
   必须 `import remarkMath from 'remark-math'` 后以**函数**传入。

3. **处理器实例不可共用**
   `markdown.processor` 与 `mdx({ processor })` 复用同一个 `unified()` 实例会导致一侧静默丢失插件。
   需用工厂函数 `createProcessor()` 各建一个实例。

正确写法：

```js
const createProcessor = () => unified({
	remarkPlugins: [remarkMath],
	rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: false }]],
})

export default defineConfig({
	integrations: [vue(), mdx({ processor: createProcessor() }), sitemap()],
	markdown: { processor: createProcessor(), shikiConfig: { theme: 'github-light' } },
})
```

### Content 组件映射机制（已验证可用）

`render(entry)` 返回的 `<Content />` 接受 `components` 映射对象：

```astro
const { Content } = await render(entry)
<Content components={{ Probe }} />
```

MDX 文件中即可直接使用**未 import 的**组件名 `<Probe />`。
**这意味着 63 个转换后的 MDX 文件无需各自写 import**，组件表在页面层集中维护。
已实测通过（`astro-site/src/spike-content/probe.mdx` + `src/components/Probe.astro`）。

### Astro 7 配置 API 变更

`markdown.remarkPlugins` / `markdown.rehypePlugins` 在 Astro 7 已弃用，正确写法：

```js
import { unified } from '@astrojs/markdown-remark'

markdown: {
	processor: unified({
		remarkPlugins: ['remark-math'],
		rehypePlugins: [['rehype-katex', { throwOnError: false, strict: false }]],
	}),
}
```

## 2. Content Layer 实施结果

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 依赖隔离 | ✅ | `astro-site/pnpm-workspace.yaml` 切断 pnpm 向上查找，避免子目录依赖被并入 Nuxt 根项目 |
| glob loader | ✅ | 直接读 `../content`，迁移期不复制内容 |
| `generateId` | ✅ | 复刻 permalink 优先 + `hidePostPrefix` 去 `/posts`；**额外处理了 `index.md` 剥离**（Nuxt 文件路由行为，初版遗漏导致 4 个 `/index` 错误） |
| 日期强制转换 | ✅ | Astro 的 YAML 解析器把 `2024-09-21 23:18:18` 转成 `Date`，需转回**本地时区**同格式字符串，否则 `new Date()` 的 UTC 解释会导致显示时刻偏移 |
| `readingTime` | ✅ | 见 §3 |
| 63 URL 零差异 | ✅ | 与基线完全一致，零多余 URL |
| 标题一致性 | ✅ | 62/63；唯一差异 `/link/` 的标题来自尚未移植的 `link.vue` |
| `api/stats` | ✅ | SQL `orWhere(LIKE)` 改写为 JS 过滤，`posts`/`tags`/`categories`/`annual` 与基线一致 |

### 构建耗时对比

| | Nuxt 基线 | Astro 7.3 |
| --- | ---: | ---: |
| 客户端构建 | 18.48 s | — |
| 服务端构建 | 5.32 s | — |
| 预渲染 | 15.54 s | — |
| **总构建** | **约 40 s** | **约 3 s** |

## 3. readingTime 的两个陷阱

**陷阱一：glob loader 没有 transform 钩子。**
写在 collection 上的 `transform` 会被**静默忽略**——不报错，只是永远不执行。必须包一层自定义 loader（`src/loaders/with-reading-time.ts`）。

**陷阱二：`store.set()` 必须同步刷新 digest。**
只改 `data` 不改 `digest` 时，增量存储判定为「未变更」并**丢弃整次写入**，且不报错。必须同时传入 `context.generateDigest(data)`。

**陷阱三：内容存储缓存会让 loader 根本不执行。**
`node_modules/.astro/data-store.json` 命中时，Astro 跳过整个 sync，loader 一次都不跑。
调试 loader 时必须先清掉该文件，否则会看到「代码明明写了却零效果」的假象。

### 字数统计口径

统计渲染后 HTML 的可见文本（剥离标签与 `katex-mathml` 重复表示），而非原始 body。
当前与 Nuxt 基线相差 **+9.6%**（106,717 vs 97,397），**这是预期内的暂时性偏差**：
当前构建尚不认识 MDC，那 350 处指令被当作 Markdown 标题解析，整段 YAML（含 URL、class 名）
都成了标题文本被计入（仅 `example.md` 一页就有 213 处 `::` 残留）。
Phase 2 的 MDC → MDX 转换完成后该偏差会自动收敛，届时需重新对基线。

## 4. 对迁移计划的纠错

### ❌ 纠错 1：`bgm-*` 组件没有任何实现

计划 §1 称 `bgm-card` / `bgm-collection` / `bgm-calendar` 由 `nuxt-studio` 提供。**这是错的。**
已独立复核：`app/components/` 下无 `Bgm*` 组件，`node_modules/nuxt-studio` 中检索不到
`bgm-card` / `BgmCard` / `bgm-collection` / `bgm-calendar`。这与 `CLAUDE.md` 记录的
「Bangumi 已于 2026-09-30 移除，源码在仓库外 `D:/Projects/Bangumi-Clarity`」一致。

**影响：这是一个既有线上缺陷，不是迁移任务。**

| 指令 | 出现次数 | 所在文件 |
| --- | ---: | --- |
| `bgm-card` | 13 | `takagi` `clannad-zh-linux` `gal-up` `koichoco-psp` `nukitashi-gv-end` `bangumi-components` |
| `bgm-collection` | 2 | 同上 |
| `bgm-calendar` | 1 | 同上 |

共 16 处，分布在 **5 篇已发布文章** + 1 篇预览页，当前渲染为空白。
迁移时**不要为它们设计转换目标**；是否恢复属独立决策（需从 `D:/Projects/Bangumi-Clarity` 取源码），
或从这 5 篇文章中移除这些指令。

### ❌ 纠错 2：指令调用次数

计划 §1 的次数来自不完整的正则。独立重算（`^\s*:{1,3}name`，含行内形式与前导空白）：

| 组件 | 计划 | 实测 | | 组件 | 计划 | 实测 |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| `alert` | 45 | **61** | | `info-card` | — | 8 |
| `folding` | 45 | **49** | | `key` | — | 6 |
| `tab` | 39 | **42** | | `blur` | — | 4 |
| `pic` | 39 | 39 | | `timeline` | — | 4 |
| `link-card` | 26 | 26 | | `chat` | — | 3 |
| `link-banner` | 23 | 23 | | `resource-list` | — | 3 |
| `video-embed` | 20 | 20 | | `series-group` | — | 2 |
| `bgm-card` | 16 | 16 ❌无实现 | | `poetry` | — | 2 |
| `copy` | 12 | 12 | | `emoji-clock` | — | 2 |
| `card-list` | 11 | 11 | | `meta-aside-*` | 6 | 6 |

### ❌ 纠错 3：patch 归属

「行内代码 `props.code` 传原文」来自 **`@nuxtjs__mdc.patch`**（改 `inlineCode.js` 注入 `code: text.value`），
不是 `plain-shiki.patch`。后者只修 CSS `::highlight()` 选择器缺空格。
`pnpm-workspace.yaml` 的注释把这两件事混在一起了。

### ❌ 纠错 4：组件分诊修正

- **`InfoCard.vue` 归类上调 B → C（island）**：全部逻辑在 `onMounted` 里 `fetch`，
  依赖 `runtimeConfig.public.bangumi`。Astro 静态站必须改为构建期抓取或保留为 `client:visible` 岛。
  若按原分诊当作静态组件重写，3 篇文章的卡片会永久空白。
- **`MdTitle.vue` 可直接删除**：全仓库零引用（无 MD 调用、无组件引用）。
- **`SeriesGroup` / `ProjectGroup` 分诊正确**（B / A），子智能体建议的「偏保守」不成立。

## 5. 子智能体发现的转换风险（Phase 2 必读）

以下来自对 33 个 content 组件 + 63 篇文章的逐项调查，按易错程度排序。

### 🔴 R1 `Tab` 的动态具名 slot `tab1..tabN`
`Tab.vue:83,99` 是 `<slot :name="\`tab${activeTab}\`" />`，slot 名由运行时状态决定，**从 1 开始**。
MDX 无法静态映射。**建议先把 `Tab` 重写为接受 `panels: {title, content}[]` 的单一 API**，
codemod 再从 `#tabN` 生成数组——这比动态 slot 稳得多。

### 🔴 R2 `Chat` / `Timeline` 反射 Vue 内部 vnode 结构
两者都是 `(node.children as any)?.default?.()[0].children`，依赖 `@nuxtjs/mdc` 生成的 slot vnode 形状，
代码里自带 `WARN` 注释。**在 Astro/MDX 下 100% 失效，且失效是静默的**
（`{caption}` 段落消失，全部渲染成 body）。
**必须重设计为显式 props**（如 `<Chat items={[{caption, control, body}]} />`）。
转换后需逐页核对 `<dt class="chat-caption">` / `<dt class="timeline-caption">` 数量与基线一致。

### 🔴 R3 `Folding` 的未声明 prop `open`
`::folding{open}` 依赖 Vue attribute fallthrough 落到根 `<details open>`。
Astro/MDX 无 fallthrough，`open` 会被丢弃或变成非法的 `open="true"`。**重写时必须显式声明 `open?: boolean`。**

### 🟠 R4 MDC 的 `#slotName` 与 `::` 闭合边界不可靠
`drive.md:37-56` 里 `#default` 的内容在 `::` 之后仍有兄弟内容继续归属 `#tab1`；
`example.md:89-99` 里一个 `#default` 内嵌 `::tab`，`::` 出现 4 次；`example.md:562-564` 用 `:::` 三层嵌套。
**codemod 不能基于缩进判断 slot 归属**，必须实现 `::` 计数状态机（`:::` 开、`::` 闭）。
两种 slot 写法都要支持：`#tab1`（无空格）与 `# tab2`（带空格，见 `clarity-resource-list.md:245`）。
golden-test 文件：`example.md`、`drive.md`、`aokana.md`、`link.md`、`nukitashi-gv-end.md`。

### 🟠 R5 YAML fence 必须用 parser，不能用正则
- 注释行：`example.md:862,864,807,835,819` 用 `# 注释` 做属性占位说明；`example.md:1095` 真实属性块里也有注释
- 类型保持：`video-embed` 的 `id: '7339041157571169546'` 必须保持 string；`count: 3` / `active: 2` 保持 number；`tabs` / `cover` / `items` 保持数组
- 裸 boolean 属性必须转 `={true}`：`{card}` `{flat}` `{open}` `{center}` `{combobox}` `{border}` `{rotate}` `{copy}` `{ctrl}` `{shift}` `{icon}` …

### 🟠 R6 kebab → camel 无风险，但 `class` 是坑
全部 prop 名都是单词或已是 camelCase（`openInNewTab` / `extractPassword` / `singleTitle`），
**不存在连字符 prop**，这是好消息。
但 `LinkCard` / `LinkBanner` 的 `class` **不是 prop**，靠 fallthrough → MDX 必须写 `className="gradient-card active"`。

### 🟡 R7 `ProseCode.code` / `ProsePre.code` 靠 patch 注入
Astro 内置 Shiki 不会给行内代码 / 代码块传 `code` prop，而这两个组件渲染的是 `{{ code }}` 而非 slot
——**没有该 prop 就什么都不显示**。需自行写 remark 插件注入，并复刻 patch 语义：
**不做 detab**、**代码块保留结尾 `\n`**（否则 `ProsePre.vue:33` 的行数与折叠阈值 `triggerRows=32` 会算错）。
`ProsePre` 的 `meta` 二级协议（`wrap` / `expand` / `indent=N` / `icon=`）同样需重新实现。

### 🟡 R8 其他
- `Music` 的 prop 是 `name` 不是 `title`；`example.md:1345` 写的 `title:` 是既有的错误用法
- `Poetry` 依赖 `white-space: pre-wrap`，转换时**不要顺手 reformat 缩进**，会改变换行语义
- `SeriesGroup.openInNewTab` 声明了但模板硬编码 `target="_blank"`，prop 实际未被消费
- `FeedCard` / `FeedGroup` 无 MD 调用，仅 `link.vue` 从 `blog.config.ts` 渲染，无需 codemod
- `Alert` 无 children 时会渲染空 `<p>`（Vue slot fallback 语义），MDX 不会——需在 DOM diff 白名单中登记

## 6. Astro 组件移植的三个作用域陷阱

移植 Vue SFC 到 `.astro` 时，`scoped` 的实现差异导致三处**静默失效**——
CSS 能编译、构建能通过，但选择器永远不匹配。必须靠「编译 Vue 原件对比产物」才能发现。

### ❌ 陷阱 1：Astro 不做 attribute fallthrough

**我最初的迁移简报里写错了一条**，子智能体实测推翻：

> ❌ 错误说法：「MDX 传入的 `className` 会作为 Astro 属性落到组件根元素上，这一条移植后自动成立」

Astro **没有** Vue 的 attribute fallthrough。`class="extra"` 会被**静默丢弃**。

**影响**：`LinkCard` / `LinkBanner` 的 `class`（来自 `example.md` 与 `drive.md` 的
`class: gradient-card active`）如果照搬 Vue 的写法就会丢失。
**修法**：显式声明 `class?: string` 并用 `class:list` 合并。

**范围核查**：全库只有 `link-card`（2 处）在 MDC 块里带 `class` 属性，
已由上述修法覆盖；其余组件无需扩展。已核实，不是遗漏。

### ❌ 陷阱 2：`article &` 编译结果不同

| | 编译产物 |
| --- | --- |
| Vue | `article .link-card[data-v-x]` —— scope 只加在 `&` 上 |
| Astro（错误写法） | `article[data-astro-cid-x] .link-card[data-astro-cid-x]` |

`<article>` 来自父页面，永远拿不到子组件的 scope 属性，因此**居中规则完全不生效**。
**修法**：写 `:global(article) &`。

> 附带发现：Vue 实际把 `article[data-v-x]` 也放进了规则里，意味着 Nuxt 侧的这条居中规则
> **很可能从来没生效过**。子智能体选择「与 Vue 行为保持一致」而非顺手修正，标注待复核。

### ❌ 陷阱 3：`:global()` 不向嵌套规则传播

`CardList` 里 `:deep()` 包裹块内部的 `> li` 仍然会被加上 scope，
导致 slot 传入的 `<li>` 匹配不上。**每个面向 slot 内容的层级选择器都要单独写 `:global()`。**

### 迁移期不要用假实现糊

`getGithubAvatar` / `getFavicon` 实际在 `app/utils/img.ts`（**不在** `shared/utils/`，
我最初的简报写错了位置）。子智能体选择跨项目 import 保持与 `shared.ts` 一致的先例，
而不是编一个返回固定值的假实现。Phase 5 应把 `app/utils/img.ts` 物理移植到
`astro-site/src/lib/img.ts`。

## 7. codemod 交付后的复核结果

codemod 已交付：63/63 转换零异常，产物用与生产同插件集的 `@mdx-js/mdx` 编译校验全部通过，两次全量跑产物字节一致（幂等）。报告含 19 条待复核点（`astro-site/scripts/mdc-report.md`）。

### 已决策

| # | 事项 | 决策 |
| --- | --- | --- |
| 0.2 | Chat/Timeline items 形状冲突 | **选项 A**：`Chat.astro` / `Timeline.astro` 改为按分组 `{caption, control, body}` 渲染，产物不动 |
| 4 | 16 处 `bgm-*` | **暂不处理**，保持 MDC 原文。这是内容决策，等用户拍板（恢复 / 移除 / 占位） |
| 5 | `music` 的 prop 名 | 组件侧同时接受 `name` 与 `title`（`example.md` 的文档示例用的是 `title`，真实文章用 `name`），不回头改文档 |
| 1/2 | `metaSlots` | 键名去 `meta-` 前缀（`aside-foo`），`content` 是已转换的 MDX 片段字符串；消费侧在 Phase 3 布局层实现 |

### ❌ 复核推翻：#12「clarity-resource-list.md 含裸 Vue SFC」是误报

子智能体报告称该文件前 93 行是**没有代码围栏**的 `<script setup>`/`<template>` 源码，
「MDX 会当 JSX 解析并报未定义组件」。我第一次读到这条时也认为它是对的。

**核实结论：误报，源文件与产物都没问题。**

```
源文件  content/posts/2025/10/clarity-resource-list.md
  行  26: ```vue      行 217: ```        围栏总数 4（配对）
产物    content-mdx/posts/2025/10/clarity-resource-list.mdx
  行  26: ```vue      行 217: ```        围栏总数 4（配对）
基线    .output/public/2025/10/clarity-resource-list/index.html
  <pre> ×2  <code> ×2   —— Vue SFC 本来就渲染为代码块
```

Vue SFC 一直位于 ` ```vue ` 围栏内，Nuxt 侧渲染为代码块，MDX 侧同样保持在围栏内。

**误报原因**：肉眼看片段时，围栏内的 `<ZRawLink>`、`<Icon>` 看起来像「泄漏的组件引用」，
而我用一个**不排除代码围栏**的正则去统计组件名（`<([A-Z][A-Za-z0-9]*)`），
把围栏内的 Vue 源码也算了进去。两次都是同一个方法错误。

**教训**：验证代码围栏类问题时，**必须程序化数围栏配对**，
不能用「正则扫全文 + 肉眼看片段」。这与之前「.ps1 中文注释吞换行」是同一类错误——
**用错误的检查方法得出了错误的结论，并差点据此做决策**。

## 8. 🔴 重大发现：Nuxt 生产站存在 MDC `:::` 内容丢失

在做 DOM 对比门禁时发现的。**这不是迁移引入的问题，是当前线上就存在的缺陷。**

### 症状

| 页面 | 指标 | 源文件 | Nuxt 生产产物 | Astro |
| --- | --- | ---: | ---: | ---: |
| `/games/galgames/clannad/` | `路线提示` 出现 | 14 | **0** | 14 |
| | `美佐枝` 出现 | 32 | **0** | 32 |
| | `<details>` 渲染 | 17（期望） | **3** | 17 |
| | `<table>` / `<td>` | 508 表格行 | **0 / 0** | 31 / 1778 |
| `/previews/example/` | 代码块 | 52 | **11** | 41 |

即：**clannad 页的「路线提示」整块内容在生产环境完全不存在**，
配套的 31 张路线表格也全部丢失。

### 根因

MDC 的 `:::`（三冒号）嵌套状态机在某些写法下无法正确闭合，
其后的内容被整段吞掉。受影响的是**属性式**组件：

```
::folding                    ← 槽位式（#title / #default），Nuxt 正常
#title
个人进度
::

:::folding{open title="路线提示"}   ← 属性式，Nuxt 整块丢失
- 美佐枝的"光"在自己的路线中无法得到…
:::
```

`clannad/index.md` 中 `::folding`（槽位式）3 处全部正常，
`:::folding`（属性式）14 处全部丢失——规律完全吻合。

Astro 侧的 codemod 采用**冒号计数 + slot 栈**的状态机，不依赖缩进，
因此 17 处全部正确渲染。

### 影响面

这是**迁移顺带修掉的第一个真实线上 bug**。切流后这部分内容会重新出现，
属于内容增加而非变化，对 SEO 是正向的。但需要事先知晓，
以免上线后被误认为是迁移引入的 diff。

### 同批发现的其他 Nuxt 侧问题

- **16 处 `bgm-*` 指令**：组件已被移除，5 篇已发布文章里渲染为空白
- **`raw/` 目录**公开 63 篇文章原始 markdown 全文
- **`__nuxt_content/content/sql_dump.txt`** 公开整个内容数据库

## 9. Phase 2 门禁结果

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| 内容保留（对**源文件**） | ✅ **58/58 = 100%** | 抽样正文行全部出现在 Astro 产物中 |
| URL 零差异 | ✅ 63/63 | 仅缺 `/archive` `/preview` 两个未移植页面 |
| 标题一致性 | ✅ 62/63 | `/link` 标题来自未移植的 `link.vue` |
| `api/stats` 字段 | ✅ posts/tags/categories/annual 全一致 | words +1.3% |
| DOM 结构标记 | ✅ 10 页抽样中 4 页 21 项全等 | 其余差异已逐项归因 |
| 构建 | ✅ 64 页 / ~5 s | Nuxt 基线约 40 s |

### 关键指标对比

| 指标 | Nuxt 基线 | Astro（Phase 2 后） | 变化 |
| --- | ---: | ---: | --- |
| 文章页引用资源 | 87 个 | **1 个** | — |
| 文章页 JS+CSS 原始 | 1,561.9 KB | **23.8 KB** | **−98.5%** |
| 部署产物体积 | 38.35 MB | **4.80 MB** | **−87.5%** |
| 产物文件数 | 852 | 171 | −80% |
| 构建耗时 | ~40 s | ~5 s | −87% |

> 产物体积尚未包含布局、页面组件与全局 CSS（属 Phase 3），因此这个数字还会继续下降。

### 字数统计对齐

从 Phase 2 前的 +9.6% 收敛到 **+1.3%**。关键在于读 `remark-reading-time` 源码确认其语义：
`visit(info, ["text", "code"])` —— **围栏代码块计入**（`code` 节点），
只有行内代码（`inlineCode` 是另一个节点类型）不计入。
我最初的实现把两者都剥掉了，导致过校正到 −7.1%。

### `.mdx` 与 `.md` 的 readingTime 差异

Astro 的 data store 对 `.mdx` **不保存 `rendered.html`**（MDX 编译为组件而非 HTML 字符串），
因此只能从原始 body 近似提取。这是个会静默失败的地方：
loader 里 `if (!html) continue` 会让所有 MDX 条目的 readingTime 直接变成 `null`，
而构建依然绿灯。已在 `withReadingTime` 中加 body 回退路径并注明。

## 10. 测量方法的五次自我修正

本轮我有三次因为**检查方法本身有缺陷**而得出错误结论，都记录下来：

| # | 错误的检查方法 | 导致的错误结论 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 肉眼看片段判断 `clarity-resource-list` 的 Vue SFC 是否在代码围栏内（worker 与我都判断错） | 误以为存在内容泄漏缺陷 | **程序化数围栏配对**（源与产物都是 4 个，成对） |
| 2 | 用 `class="link-card` 前缀匹配 | 把 `link-card-info`/`-title`/`-description` 子元素也计入，得出「15 vs 10 有差异」 | 锚定**完整根元素签名** `class="link-card card"` |
| 3 | 内容保留检查把 frontmatter、MDC 的 YAML 属性块、Markdown 图片语法当正文采样 | 保留率误报为 46.49% | 排除 frontmatter / 围栏 / 属性块 / 链接图片语法，修正后 100% |
| 4 | URL 门禁里 `TrimEnd('/')` 把站点根 `/` 压成空串，随后被空值过滤 | **首页被静默排除在门禁之外，且两侧同时被排除 → 报出「零差异」的假绿灯** | 根路径恒返回 `/`；修正后门禁立刻暴露出真实的首页缺失 |
| 5 | 交互审计的正则只匹配单双引号 | 压缩后的内联脚本用**反引号**做字符串引号 → 报「无任何事件监听」 | 正则加上反引号；顺带发现门禁只看内联脚本会漏掉被代码分割的 chunk |
| 6 | 证据脚本用 `-split` 直接 `.Count` 数行数 | 末尾换行后的空元素被算成一行（报 570/569） | 排除末尾空元素，实为 569/569 |
| 7 | 日期检查写成一次性命令，`$_` 是 `FileInfo` 不是字符串 | `.TrimEnd` 抛错 → 路径拼错、61 页被跳过，误报「40 篇不一致」 | 拆成独立脚本 + 显式类型 + `TrimStart('/')`（`Substring` 在 content 根上会留前导斜杠，使 `StartsWith('posts/')` 失效）；实为 40/40 通过 |

共同点：**用宽松的字符串处理代替结构化判断**。
这些脚本必须先在一个已知会失败的样本上自证有效，才能用来判定差异。
第 4 条尤其值得记住：**门禁自身出 bug 时，报出的往往是「一切正常」。**
第 6、7 条说明：**统计类脚本最容易在取数环节出错，而它报出的数字看起来总是合理的**——
所以「不报错」绝不能当作「算对了」。

## 12. Phase 3 结果与新发现

### 门禁

| 门禁 | 结果 |
| --- | --- |
| 布局外壳 | ✅ PASS（结构 id、CSS 令牌、`:has()` 响应式折叠、作用域陷阱、非法嵌套） |
| URL 零差异 | ✅ 63/63，仅缺 `/archive` `/preview` 两个未移植页面 |
| 内容保留 | ✅ 58/58 = 100%（3 处“缺失”经核实为检查器误报） |
| 标题一致性 | ✅ 62/63 |
| 构建 | ✅ 63 页 / 5.9 s |

### 关键指标

| 指标 | Nuxt 基线 | Astro（Phase 3 后） | 变化 |
| --- | ---: | ---: | --- |
| 产物文件数 | 852 | 175 | −79% |
| 产物体积 | 38.35 MB | 6.48 MB | **−83.1%** |
| 文章页引用资源 | 87 个 | 5 个 | — |
| 文章页 JS+CSS | 1,561.9 KB | ~50 KB | **−97%** |
| modulepreload 链接 | 74 | **0** | — |
| 构建耗时 | ~40 s | 5.9 s | −85% |

组件规模：`content` 25 个 / `blog` 11 个 / `widget` 6 个 / `partial` 11 个 / `post` 5 个，
合计 58 个组件 + 2 个布局 + 7 个样式文件。

### 五个新踩的坑

**1. Astro 组件不会自动接收 `class`**
`<Icon class="chevron" />` 里的 class 被**静默丢弃**。经隔离测试确认（`<IconWithClass>` 探针）：
必须显式声明 `class?: string` 并 `class:list` 合并。已修 `Icon.astro`。
影响面很大——侧栏 23 个图标、目录箭头、展开按钮的样式都依赖它。

**2. Astro 不做 CSS 嵌套拍平**
源项目靠 `postcss-nesting`，会把 `.x { :hover > & {} }` 拍成 `:hover > .x[data-v-y]`。
Astro **原样输出** `[cid]:hover>&` —— 这是非法 CSS，浏览器直接丢弃，**构建全程无报错**。
`Quote.astro` 命中此坑。已按 Nuxt 生产产物逐字改写为顶层 `:global(:hover) > .icon-line`，
编译结果 `:hover>.icon-line[data-astro-cid-yum7eigc]` 与 Nuxt 的
`:hover>.icon-line[data-v-1e23e0f6]` 结构完全一致。已加入布局门禁防复发。

**3. Shiki 双主题 CSS 变量缺失**
`main.css` 的 `.shiki` 规则依赖 `--shiki-light-*` / `--shiki-dark-*`。
Astro 默认只输出单一主题的**内联颜色**，深色模式代码块会不可读。
已配 `themes: { light: 'catppuccin-latte', dark: 'one-dark-pro' } + defaultColor: false`，
实测生成 12 组 `--shiki-light` / `--shiki-dark` 变量。

**4. JSX 注释里不能出现连续的斜杠加星号**
`BlogPanel.astro` 的注释写了 `data-*/class`，其中的 `*/` **提前闭合了 `{/* */}`**，
后续中文全角逗号被当作 JS 解析 → `Invalid Character`。**这类错误报在莫名其妙的位置**。

**5. 提取 `<style>` 时的 off-by-one**
用 PowerShell 的 1-based 行号去索引 0-based 数组，导致 `<style>` 起始标签被丢掉、
只剩 `</style>`。已加「所有 `.astro` 的 `<style>` 必须配对」的自检。

### 三个子智能体检出的问题

- **`is-empty` 被硬编码**：`BlogAside` 的 `class:list` 里 `is-empty` 写死，
  会导致三栏布局**永远无法展开**。另外 `hasAside` 作为裸属性在 Astro 里到达时是 `""`（非 undefined），
  两处已改为 `Boolean()` 归一化。
- **`Icon` 不是自动导入的**：8 个组件抛 `ReferenceError: Icon is not defined`，需显式 import。
- **`Secret.vue` 的 CSS 在生产上是死的**：`&:hover > &` 是自嵌套选择器。
  即「查看预览文章」链接与归档页的密度调节按钮，**在线上永久不可见**。同源于坑 2。

## 13. Phase 3 收尾：页面与端点全部补齐，门禁首次全绿

### 最终门禁

| 门禁 | 结果 |
| --- | --- |
| 布局外壳 | ✅ PASS |
| **URL 零差异** | ✅ **66/66 零差异**（含首页） |
| **标题一致性** | ✅ **66/66 零差异** |
| 内容保留 | ✅ 58/58 = 100% |
| 构建 | ✅ 66 页 / 6.1 s |

### 最终指标

| 指标 | Nuxt 基线 | Astro | 变化 |
| --- | ---: | ---: | ---: |
| 产物文件数 | 852 | 183 | −78% |
| 产物体积 | 38.35 MB | 7.09 MB | **−81.5%** |
| 文章页 HTML | 108.6 KB | 44.2 KB | −59% |
| 文章页引用资源 | 87 个 | 7 个 | — |
| 文章页 JS+CSS | 1,561.9 KB | 58.4 KB | **−96.3%** |
| 构建耗时 | ~40 s | 6.1 s | −85% |

### 端点保真度

| 端点 | Astro | Nuxt 基线 |
| --- | ---: | ---: |
| `atom.xml` | 60.8 KB | 60.8 KB（**完全一致**） |
| `llms.txt` | 23.2 KB | 23.2 KB（**完全一致**） |
| `subscriptions.opml` | 4.1 KB | 4.2 KB |

### 归档页的忠实度验证

`queryArticleIndex()` 的默认参数就是 `path = 'posts/%'`，即原版**只看文章不看游戏库等**。
Astro 侧用 `isPost` 过滤，语义等价。逐项对比：

| 指标 | Nuxt | Astro |
| --- | ---: | ---: |
| `data-list-key` 条目 | 41 | 41 |
| 年份分组 | 3（2024/2025/2026） | 3（2024/2025/2026） |

## 14. 又一个门禁自身的 bug

修完页面后 URL 门禁报「66 vs 66 零差异」，但 `dist/index.html` **根本不存在**。

根因：`Normalize-Url` 之前是 `$_.Trim().TrimEnd('/')`，站点根 `/` 被 `TrimEnd('/')`
压成空串，随后被 `Where-Object { $_ -ne '' }` 过滤掉——**首页被静默排除在门禁之外**，
而且两侧都被排除，所以「零差异」看起来是绿的。

已改为 `Normalize-Url`：根路径恒返回 `/`，其余才 `TrimEnd('/')`。
修正后门禁立刻暴露出真实的 `/` 缺失（66 vs 65），由首页页面补齐。

**这是本项目第三次出现「检查方法自身有缺陷导致错误结论」**（前两次见 §10），
三次都属于同一类：用**局部的字符串处理**代替**结构化判断**。
门禁脚本本身必须先在一个已知会失败的样本上自证有效。

## 15. 🔴 我引入的日期 +8h 偏移（子智能体检出）

`content.config.ts` 的 `toLocalDateString()` 用了 `getFullYear()` 等**本地** getter，
而 YAML 把 `2024-03-07 19:24:26` 这种无时区标量解析成 `2024-03-07T19:24:26Z`（**UTC**）。
在 UTC+8 的构建机上，本地 getter 又加了一次 8 小时：

```
源文件   date: 2024-03-07 19:24:26
修复前   date=2024-03-08 03:24:26     ← +8h
修复后   date=2024-03-07 19:24:26     ← 逐字一致
```

影响面是**全站 63 篇文章的发布时间**，且 `atom.xml` 里有 44 个日期字段同时偏移。

改用 `getUTC*` 系列后，`atom.xml` 的 45 个日期字段与基线**逐字一致**（唯一剩下的
差异是 feed 自身的构建时间戳，本就应该不同）。

**为什么难发现**：构建不报错、门禁全绿、文章照样渲染，只是每个发布日期都错了 8 小时。
这类「语义正确性」缺陷只能靠与基线做字段级比对才能暴露。

## 16. `shared/utils/icon.ts` 的一个潜在缺陷（子智能体检出）

`shared/utils/icon.ts:93` 的 `getDomainIcon` 调用了 `getDomain` / `getMainDomain`，
但**文件里没有 import 它们**——依赖 Nuxt 的自动导入。在 Astro 侧会直接
`ReferenceError: getDomain is not defined` 并中断构建。

已在 `astro-site/src/lib/shared.ts` 复刻了一份带注释的版本作为绕过，
但**根项目修一行 import 之后那份复制就可以删掉**。

## 17. 最终指标

| 指标 | Nuxt 基线 | Astro | 变化 |
| --- | ---: | ---: | ---: |
| 产物文件数 | 852 | 183 | −78.5% |
| 产物体积 | 38.35 MB | 7.09 MB | **−81.5%** |
| 构建耗时 | ~40 s | 6.1 s | −85% |
| 页面总数 | 66 | 66 | — |

各页 JS+CSS 负担（基线统一为 87 个资源 / 1561.9 KB）：

| 页面 | 资源数 | JS+CSS | HTML |
| --- | ---: | ---: | ---: |
| `/` | 5 | 26.7 KB | 62.8 KB |
| `/link` | 6 | 49.8 KB | 101.3 KB |
| `/archive` | 5 | 26.7 KB | 91.2 KB |
| 文章页 | 7 | 58.4 KB | 44.2 KB |

友链页 `<img>` 数 76，与基线**完全一致**。

## 18. Phase 4：模态栈 / 弹窗 / 摘要 / 评论 / 轮播

新增集成门禁 `scripts/check-integration.ps1`，**18/18 通过**。

### 交付

| 能力 | 实现 | 说明 |
| --- | --- | --- |
| 模态栈 | `src/lib/modal.ts` | 框架无关单例，替代 `@bikariya/modals` |
| 宿主 | `src/components/ModalHost.astro` | 构建期静态渲染全部弹窗，运行期只切显隐 |
| 搜索 | `popover/SearchModal.astro` + `pages/search-index.json.ts` | MiniSearch，索引 391.6 KB 独立成文件而非内联 |
| 分享 | `popover/ShareModal.astro` | 含二维码（`qrcode` 懒加载） |
| 灯箱 | `popover/LightboxModal.astro` | `Pic` 的 `data-zoom` 接回点击 |
| AI 摘要 | `post/Excerpt.astro` | 打字机动画 + 选区无关（见下） |
| 评论 | `post/Comment.astro` | Twikoo，含 50ms 就绪轮询 |
| 轮播 | `post/Slide.astro` | Embla 核心库 + 原生脚本 |

### 子智能体的验证强度

模态 worker 用 **Node 内置 WebSocket 直连 Chrome DevTools Protocol**（零新增依赖）驱动真实浏览器，
用 `Input.dispatchMouseEvent` 而非 `element.click()`，**31/31 交互检查通过**：
打开/关闭/Esc/遮罩点击/焦点归还/输入框自动聚焦/搜索高亮/方向键/控制台零错误。
它为此自查出 3 个真 bug（遮罩没接点击、首次搜索因 `titles:[null]` 崩溃、围栏长度解析错误），
并把搜索索引的 **618/618 锚点与渲染 HTML 逐条比对通过**（用 `github-slugger`，与 Astro 同源）。

### 又一处我的简报错误

我告诉 Excerpt worker「`Excerpt.vue` 用 `useTextSelection`，改成 `selectionchange`」。
**这是错的**——全仓库唯一用 `useTextSelection` 的是 `stores/search.ts`。
它核对了源码，没有照做，也没有编一个监听器出来。这是第三次被纠正。

### `Button.astro` 的两个既有 bug

两个 worker 独立报告，我核实属实：

1. `primary` prop 被解构但**从未合并进 classes**，所有调用方都拿不到 `.button.primary` 规则
2. 未声明的 `data-*` **被静默丢弃** → `PostHeader` 的分享按钮三个 `data-share-*` 全丢，**分享功能完全失效**

均已修复（显式合并 + `...rest` 透传）。

### `lib/shared.ts` 不是 client-safe

它转出 `shared/utils/time.ts`，而后者顶层 `import blogConfig`，Rollup 无法摇掉，
从它 import 一个 5 行工具函数会把**整个 4.4 KB 站点配置拖进客户端 chunk**。
需要客户端安全的工具（如 `safelyDecodeUriComponent`）必须内联而非从 `lib/shared` 导入。

## 19. 🔴 推翻原计划的图片管线迁移

原计划 Phase 5 的第一项是「迁到 `astro:assets`」，理由写的是
「`@nuxt/image` 的 `densities: [1, 1.5, 2]` + `avif/webp` 需要对应实现」。

**实测证明这个理由不成立。** 扫描基线全部 HTML（`scripts/audit-image-pipeline.ps1`）：

```
img tags total      : 438
  with srcset       : 438
  srcset DEGENERATE : 438      ← 全部退化
  srcset USEFUL     : 0
  proxied via _ipx  : 0
```

**基线的 438 个 srcset 全部指向同一个 URL**（`1x`/`1.5x`/`2x` 三个候选完全相同），
且**没有任何一张图走 ipx 代理**。也就是说 `@nuxt/image` 在这个项目里
**没有产生任何真实优化**，只是让每张图多背了约 200 字节的无用 srcset。

**结论**：
1. Astro 侧用裸 `<img>` 与基线**功能等价**（两者都只下载一个文件），不存在我原以为的差距
2. 迁 `astro:assets` 是**净负收益**——它会在构建期下载全部 438 张远程图，
   构建变慢且易被 CDN 拒绝，而换来的优化基线从未有过
3. 真正可做的只有一件事：去掉无用的 srcset，让 HTML 更小

**这项原计划任务被取消**，改为把结论写进本文档，避免后来者重复投入。

## 20. 客户端安全入口 `src/lib/client.ts`

`lib/shared.ts` 转出了 `shared/utils/*` 全部四个模块，其中两个会把非纯函数拖进客户端 bundle：

| 模块 | 顶层依赖 | 后果 |
| --- | --- | --- |
| `shared/utils/time.ts` | `import blogConfig from '~~/blog.config'` | 整个 4.4 KB 站点配置进客户端 chunk（Rollup 摇不掉） |
| `shared/utils/str.ts` | `import { toArray } from '@vueuse/core'` | 引入 Vue 依赖，而 astro-site 没装 Vue |

这是两个 worker 各自独立发现的（Excerpt worker 内联复刻了 `safelyDecodeUriComponent`，
模态 worker 重写了 `highlightHtml`）。现已抽出 `src/lib/client.ts` 作为规范的客户端安全入口，
`Comment.astro` 改为从那里 import；`SearchModal.astro` 的 `highlightHtml` **保持内联**——
它刻意与原实现不同（输出 `<mark>` 而非 `<span class="highlight">`，且换行转 `<br>`），不可替换。

另注：`shared/utils/icon.ts` 的 `getDomainIcon` 在 Nuxt 侧依赖自动导入
（`getDomain` / `getMainDomain` 未 import），在 Astro 侧会抛 `ReferenceError`。
`lib/shared.ts` 里有一份带 import 的复刻，**根项目补两行 import 后即可删除**。

## 21. Phase 4 后指标

| 指标 | Nuxt 基线 | Astro | 变化 |
| --- | ---: | ---: | ---: |
| 产物文件数 | 852 | 196 | −77% |
| 产物体积 | 38.35 MB | 8.24 MB | **−78.5%** |
| 文章页资源 | 87 个 | 11 个 | — |
| 文章页 JS+CSS | 1,561.9 KB | 78.9 KB | **−95%** |
| 构建耗时 | ~40 s | 5.6 s | −86% |

产物体积比 Phase 3 的 7.09 MB 增加了 1.15 MB，来自模态栈、搜索索引与懒加载的
`minisearch`(17 KB) / `qrcode`(23 KB) / `mermaid` / `abcjs` 分包——都是**按需加载**，
不放进任何页面的首屏。

### 门禁总览

| 门禁 | 结果 |
| --- | --- |
| 集成（Phase 4） | ✅ 18/18 |
| 布局外壳 | ✅ PASS |
| URL 零差异 | ✅ 66/66 |
| 标题一致性 | ✅ 66/66 |
| 内容保留 | ✅ 58/58 = 100% |

## 22. Phase 5 / 6：收尾与切流就绪度

### Phase 5 交付

| 项 | 结果 |
| --- | --- |
| `/raw/**.md` 端点 | ✅ 63/63 URL **双向零差异** |
| `public/assets/atom.css` `atom.xsl` | ✅ SHA-256 校验逐字节一致 |
| `meta-aside-*` 槽位消费 | ✅ 侧栏 3 个 widget，class 签名与基线一致 |
| `/favicon.ico` 重定向存根 | ✅ 与基线**逐字节一致** |

`/raw/*` 的关键结构：**raw 路径 = 页面 URL + `.md`，不是源文件路径**。
`content/games/index.md` → `raw/games.md`（不是 `raw/games/index.md`）。
`entry.id` 已经把三条规则（permalink → 去 `/posts` → 去 `index.md`）编码进去了，
所以直接用它而不要重新实现路径逻辑。

### 又一处静默数据丢失（worker 检出）

`content.config.ts` 的 schema 字段名是 `slots`，而 codemod 写的是 **`metaSlots`**。
**zod 会静默剥离未知键** → meta-aside 的内容一直被整块丢弃，且没有任何报错。
已改名修正。这是本项目第三次出现「schema 与产物字段名不一致导致静默丢数据」。

### Phase 6：CI 与切流

新增 `.github/workflows/build-astro.yml`，**不动现有 `build.yml`**（那是当前生产部署流程）。

与 `build.yml` 的差异：

| 项 | build.yml | build-astro.yml |
| --- | --- | --- |
| 构建命令 | `pnpm generate --no-clear` | `cd astro-site && pnpm build` |
| 产物目录 | `.output/public` | `astro-site/dist` |
| 类型/内容缓存 | `.nuxt` | `astro-site/node_modules/.astro` |
| 缓存 key | `hashFiles('pnpm-lock.yaml')` | `hashFiles('astro-site/pnpm-lock.yaml')` |
| 产物自检 | 无 | ✅ 5 个关键文件存在性 + HTML 页数 ≥ 60 |

两处容易踩的坑已在文件里注明：
1. `defaults.run.working-directory` **只影响 `run` 步骤**，
   `actions/cache` 的 `path` 与 deploy 的 `folder` 必须是**仓库根相对**。
2. `astro-site` 是独立 pnpm workspace，缓存 key 必须带上路径前缀，否则与根项目互相污染。

另给 `astro-site/package.json` 补上 `packageManager: pnpm@12.5.1`——
原先缺失会让 CI 的版本读取退回 `latest`，既漂移又有供应链风险。

### 切流就绪度

```
基线 URL 67 个 -> Astro 缺失 0 个
raw 端点 63/63
favicon.ico 存根逐字节一致
```

## 23. 图标：最后一个可见缺口已补上

`Icon.astro` 从占位改为 `astro-icon` **构建期内联 SVG**。

| | 形态 | 客户端 JS |
| --- | --- | ---: |
| Nuxt 基线 | `@nuxt/icon` CSS 类（0 个内联 svg，52 个 `iconify` 类名） | **95 KB 图标包**（207 图标） |
| Astro 占位期 | 实心方块 `<i class="icon-stub">` | 0 |
| **Astro 现状** | **55 个内联 `<svg>`** | **0（字节级未变）** |

全站 **97 个不同图标名 / 3458 次使用，0 个解析不到，0 个走降级**。
客户端 JS **逐字节未变**（118 文件 / 4,098,993 B）——图标不产生任何 JS。

尺寸改为复用 `src/styles/main.css` 里已有的 `.iconify` 规则
（`font-size:1.2em; vertical-align:sub; display:inline-block`），与基线**完全一致**。

### ❌ 我的简报第四次被纠正

我给的集合清单有两处错：

1. **`lucide` 根本不在根 `devDependencies` 里**——`pnpm-workspace.yaml` 的
   `catalogs.ui` 只有 5 个 `@iconify-json/*`。是我从 `nuxt-studio` 的传递依赖里臆想出来的。
2. **只装那 5 个不够**。`shared/utils/icon.ts` 的映射表还会产出另外 5 个集合：
   `uim` / `material-symbols` / `icon-park-solid` / `devicon` / `icon-park-outline`。
   Nuxt 侧靠 **Iconify 运行时 API** 解析（那正是 95 KB 客户端包的来源）；
   改成构建期内联就必须本地安装，否则这 5 类图标会变成破图。
   其中 `devicon:cloudflare` 是 `BlogTech.astro` 里**硬编码**的，必然渲染。

共装了 10 个集合。`arcticons` 刻意不装（解压 11.6 MB，仅 `jd.com` 一处用到，
当前内容里没有），避免可见降级。

`zi` 本地集合：全仓库 **零调用点**，但仍接入了。
`astro-icon@1.2.0` 没有 `addCollection` API 且把本地集合前缀硬编码为 `local`，
所以 `src/lib/icons.ts` 做了 `zi:` → `local:` 的映射以保住契约。

**降级不是静默 throw**：`astro-icon` 的 `<Icon>` 对未知名字会抛异常导致整站构建失败，
所以 `Icon.astro` 先自行解析，失败时输出带 `data-icon-missing` 的红框并 `console.warn`，
可用 `node scripts/audit-icons.mjs` 复查。

## 24. 最终自查

### 冷构建可复现

清掉 `dist` 与 `node_modules/.astro`（内容存储）后重建：**67 页，五道门禁全绿**。
与 CI 冷缓存路径一致。

### 遗留占位符清查

`scripts/audit-deferred.ps1` 扫描全量 `.astro` / `.ts`，**只统计非注释行**
（注释里写明「暂不可用」是文档；组件静默渲染为空才是缺陷）：

| 类别 | 命中 |
| --- | ---: |
| `TODO` / `FIXME` / `XXX` | 0 |
| 未移植标记 | 0 |
| 留空 / 待接标记 | 0 |
| 占位实现关键字 | 0 |

> ⚠️ **这条只说明「代码里没有留占位标记」，不说明功能与原版一致。**
> 扫描器数的是源码里的关键字，而**移植过程中的缺失往往一行标记都不留**——
> 例如整层 `Prose*` 组件从未被识别为需要移植的对象（§33）、
> `<script>` 用了只在 frontmatter 声明的绑定（§38）、
> 丢了静态锚点类导致整份样式表挂不上（§31）。
> 截至 2026-10-01，实测确认的功能缺口见 **§41「当前全部未实现项与问题」**，
> 那里才是完整清单，本表不可当作「已全部完成」的依据。

### 根项目改动情况

`main` 分支未受影响（`8f37e4c`）。工作区仅剩你原有的两处 WIP
（`animation.css` +2 行、`BlogSidebar.vue`），**我全程未碰根项目的 `app/`、`content/`、
`package.json`、`nuxt.config.ts`**。新增的 `build-astro.yml` 是并行的新文件，不改现有生产流程。

## 25. 🔴 CI 双写隐患（自查发现并已修）

我原先把「不动 `build.yml`」说成更安全，却交付了一个**活着的** `build-astro.yml`：

```yaml
on:
  push: { branches: [main], paths: ['astro-site/**'] }
```

它和现有的 `build.yml`（`push: branches:[main]`，**无 path 过滤**）都部署到
**同一个目标**：`PaloMiku/blog-public` 的 `main` 分支。

**一旦合并到 main，两个工作流会同时触发并互相覆盖部署**，先后顺序不确定 ——
可能在 Astro 产物上覆盖 Nuxt 产物，或反之。这是**静默的线上事故，不是构建失败**。

**已修**：改为**只允许手动触发**（`workflow_dispatch` + 一个必须显式勾选的确认项），
并在文件头写明切流时必须**成对**操作（停用 `build.yml` + 把唯一的触发器换回 push）。

### 验证要用 YAML 解析，不能用文本匹配

修复后我先是用 `Select-String` 自查的——**这不够**。因为说明性注释里字面写着
`push: branches:[main]`，任何按文本扫描触发器的检查都会把注释当成生效配置。
这很可能就是外部校验反复报「`:14-20` 是活的 push 触发」的原因：它读到的行号
恰好是注释块的位置。

两条修法：

1. **注释改写为不含 YAML 键名**——现在全文 4 处 `push` 全在注释里，
   非注释行零 `push`。注释里写得像配置，本身就是隐患。
2. **改用 YAML 解析器做判据**（`scripts/check-ci-triggers.mjs`）：

```
build.yml       triggers: ["push"]              hasPush: true
build-astro.yml triggers: ["workflow_dispatch"] hasPush: false
both deploy to same target: true
both auto-trigger on push : false  → 竞态不可能发生
```

结构化解析出来的 `triggers` 集合是唯一可信的证据；
**注释、缩进、行号都不是**。这条已并入 `collect-evidence.ps1` 的第 0 项。

**教训**：新增/修改配置后，「我 grep 过没有」不是证据。
**判据必须是解析真实结构**。这条与第 4、6、7 条（统计脚本的取数错误）同源。

## 26. 最终证据（可复现）

`scripts/collect-evidence.ps1` 一次跑完所有关键断言：

| 项 | 结果 |
| --- | --- |
| **CI 触发器（YAML 结构解析）** | `build.yml` = `["push"]`，`build-astro.yml` = `["workflow_dispatch"]`；两者同目标但**不会同时自动触发** |
| CSS 共有文件 SHA-256 | **6/6 完全相同**（源 6 个 vs Astro 7 个，多出 `index.css`） |
| favicon 存根 | 两侧 153 B，SHA-256 同为 `E052D747…FEFA58` |
| `atom.xml` | 569 行 = 569 行，剥离时间戳后**完全相同**，62291 vs 62290 B |
| `subscriptions.opml` | 32 行 = 32 行，剥离时间戳后**完全相同**（4276 vs 4273 B，差的是时间戳长度） |
| `main` HEAD | `8f37e4c`，未受影响；Nuxt 基线 852 文件 / 38.35 MB 在位 |
| 日期偏移修复 | **40/40 页逐条核对，零不一致**（非抽样） |
| 文章页 JS+CSS | 11 个资源 / **79.9 KB**（基线 87 个 / 1561.9 KB） |
| `raw/*.md` | 63 / 63 |
| 端点 | `index.html` `atom.xml` `subscriptions.opml` `llms.txt` `search-index.json` 存在；`sitemap-index.xml` + `sitemap-0.xml` 存在但**有条件，见 §41-A7/A8**（相对基线的单个 `sitemap.xml` 旧 URL 404，且多收录 4 条本应屏蔽的 URL） |

> **行数口径**：两个 feed 文件都以换行结尾，`-split "\n"` 会多算一个空元素。
> 常规行数应排除它——两侧实际都是 **569 / 32**。我早前报的 570/33 是这个口径问题，非内容差异。

### 证据采集本身的两次返工

`scripts/collect-evidence.ps1` 初版有两个 bug，都属于同一类——**用错误的取数方式得出错误结论**：

1. 行数用 `-split` 直接 `.Count`，把末尾换行后的空元素算成一行（570 vs 实际 569）
2. 日期检查写成一次性脚本，其中 `$_` 是 `FileInfo` 而非字符串，
   `.TrimEnd('/')` 抛错后路径拼错，61 页被跳过、误报「40 篇不一致」

**修法**：日期检查拆成独立脚本 `scripts/check-dates.ps1`，显式类型 + 显式 `TrimStart('/')`
（`Substring` 在 content 根上会留下**前导斜杠**，导致 `StartsWith('posts/')` 判断失效）。

两处都是「脚本自己看起来跑通了、结果却是错的」。这是本项目反复出现的失效模式，
**判据是：任何统计类脚本，必须先在一个已知结果的样本上自证**。

### 产物构成（说明为什么总大小是误导性指标）

```
HTML (含内联 SVG)  67 文件  5.13 MB
JS  (全部懒加载) 118 文件  3.91 MB   ← mermaid/abcjs/cytoscape/katex，无一页面会加载
CSS                5 文件  0.08 MB
raw/*.md          63 文件  0.47 MB   ← 63 个公开 URL
其他              9 文件  0.51 MB   ← search-index.json 391.9 KB + feeds
合计            262 文件 10.09 MB
```

**3.91 MB 的 JS 全是 `import()` 懒加载分包**，逐页实测只有 79.9 KB。
「产物总大小」在这个项目里会严重误导——真正该看的是每页负载。

图标内联也贡献了 HTML 的增长：这是**有意的**——
基线用 95 KB 客户端图标包换 52 个 CSS 类，Astro 用 0 KB 客户端 JS 换内联 SVG，
两者的页面 HTML 都会因此变大，但只有后者是零客户端成本。

## 27. 最终状态

| 指标 | Nuxt 基线 | Astro | 变化 |
| --- | ---: | ---: | ---: |
| **文章页 JS+CSS** | 1,561.9 KB | **79.9 KB** | **−94.9%** |
| **文章页资源数** | 87 个 | **11 个** | −87% |
| **图标客户端 JS** | 95 KB | **0** | −100% |
| 产物文件数 | 852 | 262 | −69% |
| 产物体积 | 38.35 MB | 10.09 MB | −73.7% |
| 构建耗时（冷） | ~40 s | 6.0 s | −85% |

| 门禁 | 结果 |
| --- | --- |
| 集成（Phase 4） | ✅ 18/18 |
| 布局外壳 | ✅ PASS |
| URL 零差异 | ✅ 67/67 |
| 标题一致性 | ✅ 67/67 |
| 内容保留 | ✅ 58/58 = 100%（3 处为检查器误报） |
| 遗留占位 | ✅ 0 |

## 28. 已产出的可复用资产

| 文件 | 用途 |
| --- | --- |
| `astro-site/src/content.config.ts` | 内容层：schema、日期强制转换、`generateId` |
| `astro-site/src/loaders/with-reading-time.ts` | 包装 loader 补算 readingTime |
| `astro-site/src/lib/shared.ts` | `shared/utils/*` 的转出（框架无关，直接复用） |
| `astro-site/src/lib/app-config.ts` | `app.config.ts` 的 `component` 段 |
| `astro-site/src/lib/content-components.ts` | MDX 组件映射表（63 个 MDX 免 import 的关键） |
| `astro-site/src/pages/api/stats.ts` | `api/stats` 的 JS 过滤改写（含 SQL LIKE → RegExp 编译器） |
| `astro-site/src/pages/api/entries.json.ts` | 诊断端点，导出解析后的 frontmatter 供对基线 |
| `astro-site/scripts/mdc-to-mdx.ts` | MDC → MDX codemod（63/63，幂等） |
| `astro-site/scripts/mdc-report.md` | 转换报告：契约定义 + 19 条待复核点 |
| `astro-site/scripts/compare-urls.ps1` | URL 零差异门禁（读构建产物） |
| `astro-site/scripts/check-generated-urls.ps1` | URL 门禁的**静态版**：直接对 MDX 文件树模拟 `generateId`，不依赖构建成功 |
| `astro-site/scripts/compare-titles.ps1` | 标题一致性门禁 |
| `astro-site/scripts/compare-dom.ps1` | DOM 结构标记对比（21 项根元素签名） |
| `astro-site/scripts/compare-text-volume.ps1` | 全站可见文本量对比（定位内容增减的页面） |
| `astro-site/scripts/check-content-preservation.ps1` | **内容保留门禁**：对源文件抽样正文行，检查是否出现在产物中 |
| `astro-site/scripts/check-layout.ps1` | 布局门禁：外壳结构 id、CSS 令牌、`:has()` 折叠、两类作用域/嵌套陷阱回归 |
| `astro-site/scripts/check-anchor-classes.ps1` | **锚点类门禁**：逐页比对 `<article>` 的 class 集合，抓「CSS 在但选择器挂不上」（见 §31.1，已反向自证） |
| `astro-site/scripts/check-dead-css.ps1` | **死样式门禁**：Nuxt 有类 / Astro 无类 / CSS 仍有规则；含 Prose* 落地断言与代码块数量对比（见 §36，已反向自证） |
| `astro-site/scripts/interaction-check.mjs` | **交互门禁**：无头 Chrome CDP 真点真输入，20 项断言 + 67 页零未捕获异常扫描（见 §40） |

> 已退役的两个脚本（都进了回收站，可恢复）：
> `check-features.ps1` —— **设计上就不可能失败**：没有失败路径、永远 `exit 0`，
> 判定逻辑还把「Nuxt 为 0（该标记在 Nuxt 侧是运行时渲染的）」标成 `partial`。
> 灯箱完全坏掉时它照样打印一整表格 `ok / partial`。
> `audit-interactions.ps1` —— 数 `data-*` 钩子与 `addEventListener` 事件名的
> 文本匹配，回答不了「点了有没有反应」：绑定了空函数的按钮在它眼里也是健康的。
>
> 两者都属于本文件反复记录的**虚假信心产物**：看起来有覆盖，实际什么都没验证。
| `astro-site/MIGRATION-BRIEF.md` | 子任务共享交接文档（风格、陷阱、Nuxt API 对照、硬约束） |
| `astro-site/src/lib/content.ts` | 内容查询辅助层：`getPostsSorted` / `getSurroundings` / `getByCollection` |
| `astro-site/src/lib/layout-state.ts` | 框架无关的全局布局状态（替代 `useLayoutStore`） |
| `scripts/baseline-analyze.ps1` | Nuxt 基线指标采集 |

> 脚本注意事项：Windows PowerShell 5.1 按系统 ANSI 码页读取无 BOM 的 `.ps1`，
> 脚本内**不得出现中文字面量**，否则会被解析坏。对中文内容的比对要用前缀/包含关系而非精确匹配。
>
> **补充（比原记录更严重）**：这条规则不只针对字符串字面量，**注释里的中文同样会触发**。
> 实测中一个只含中文注释的 `.ps1`，其 UTF-8 多字节序列被按 GBK 解读后会吞掉后续换行，
> 导致紧随其后的**可执行语句被静默跳过**——表现为「过滤条件写了但没生效」，
> 没有任何报错。所有 `.ps1` 脚本一律纯 ASCII，包括注释。

---

## 29. 第九次失效模式：页面级 `<style>` 整块从未移植（截图验收发现）

`astro-site/src/pages/archive.astro` 的结构、数据分组、客户端排序脚本都移植了，
**唯独没有 `<style>` 块**。原 `app/pages/archive.vue` 有 77 行页面样式，一行都没过来。

后果：产物里 `.archive-title` / `.archive-list` / `.archive-year` / `.archive-info`
**零条 CSS 规则**（用 `dist` 全量文本搜索确认，只在 HTML 的 class 属性里出现过）。
归档页退化成一堆无样式的裸元素。

**为什么所有门禁都没抓到**：没有一道门禁检查「CSS 规则是否存在」。
`check-layout.ps1` 查的是布局外壳的 id、CSS 令牌、`:has()`、断点——都是全局的；
归档页的页面私有样式不在它的检查面里。

**怎么发现的**：截图。归档页只显示年份和「1176 字 2 篇」，下面整片空白。

补了整套样式后，又暴露出 `.archive-info`（字数/篇数）在 `.archive-title` 上是
`color: transparent`，只有带 `-webkit-text-stroke` 的年份以描边形式可见——
这是 Nuxt 的原设计，不是丢样式。**不要**把「统计信息看不见」当 bug 修。

### 29.1 端口审计：确认不是系统性遗漏

补完立刻做了一次全量审计，把 77 个 Vue 组件与其 `.astro` 对应件的 `<style>` 行数对比：

| 指标 | 结果 |
| --- | --- |
| 组件总数（Vue） | 77 |
| 样式完全丢失 | **0** |
| 样式明显偏薄 | **0** |
| 样式正常 | 62 |
| 无 `.astro` 对应件 | 15（Prose\* 7 个走 remark 管线、popover 4 个改了名、util 4 个内联/降级） |

页面级同样逐个比对（index 3→17、archive 77→0、link 3→8、preview 13→13），
**只有 archive 丢失**。所以这是一次孤立遗漏，不是移植流程的系统性缺陷。

## 30. 第十次失效模式：嵌套 `<li>` 被 HTML 解析器拆开，功能整体静默失效

`archive.astro` 原本这样写：

```
<menu class="archive-list">
  <li data-archive-item data-date=... >      <!-- 外层壳 -->
    <Archive />                               <!-- 组件自己又渲染一个 <li> -->
  </li>
</menu>
```

HTML 解析器在遇到「`<li>` 的列表项作用域里已有 `<li>`」时会**自动闭合前一个 `<li>`**。
Vue 的组件渲染走的是这套解析规则之外的路径，所以 Nuxt 版没事；Astro 是 SSR 出字符串、
浏览器再解析，于是实测 DOM 变成：

```
<menu class="archive-list">
  <li data-archive-item ...></li>        <!-- 空壳，--delay 也挂在这儿 -->
  <li class="article-item">...</li>      <!-- 真正的内容，变成了兄弟节点 -->
</menu>
```

**后果比看起来严重**：客户端排序/筛选脚本全程只操作 `[data-archive-item]`，
也就是那批**空 `<li>`**。所以归档页的**分类筛选与排序切换等于完全没接线**——
点「技术探索」没有任何反应，且不报任何错。

**为什么所有门禁都没抓到**：内容保留门禁只看正文文本是否还在产物里（还在），
URL/标题/日期门禁与 DOM 结构无关。没有任何门禁做「脚本选择器命中的是不是有内容的节点」。

**修法**：不要包壳。让 `Archive.astro` 接受并透传任意属性到根 `<li>`
（`interface Props` 加索引签名 + `...rest` 展开），数据属性和 `delay` 直接落在真实节点上。
修完实测 `data-archive-item` 与 `class="article-item"` 同节点 38/38，筛选功能实测可用。

## 31. 第十一次失效模式（最严重）：丢了静态锚点类，一整份样式表全站失效

这条是子智能体定位的，我逐条复核后确认成立。

`astro-site/src/styles/article.css` 全文 154 行，是**唯一一个顶层 `.article { ... }` 块**，
里面装着全部正文样式：行高、标题字体与颜色、列表、引用块，以及关键的
`img { max-width: 100% }` 和 `img:not([class]), img.image { display:block; margin:1rem auto; border-radius }`。

而 `pages/[...slug].astro` 输出的是：

```
<article class={`md-${entry.data.type || 'tech'}`}>     <!-- 少了静态的 article -->
```

Nuxt 侧 `app/pages/[...slug].vue:44` 是 `class="article"` + 动态类型类两个都写。
产物实测：

```
ASTRO  <article class="md-story">
NUXT   <article class="article md-story" data-content-id="..." data-transition-enter>
```

**后果**：`article.css` 在**每一个文章页上全部不生效**。行高、标题、列表、引用块都没了样式；
图片不再受 `max-width: 100%` 约束，按固有像素宽渲染，在 799px 下把正文列撑破——
这就是「Astro 文章页有横向滚动条、Nuxt 基线没有」的根因。

**为什么所有门禁都没抓到**：这是**样式存在但选择器挂不上**的经典形态。
所有既有门禁验证的是「文本/URL/标题/日期有没有活下来」，它们全部照常通过；
`check-layout.ps1` 只验证 CSS 令牌字符串出现在产物里，`.article {` 确实在——
只是没有任何元素带这个类。**「产物里有这条规则」和「这条规则命中了东西」是两件事。**

### 31.1 新增门禁：`check-anchor-classes.ps1`

针对这一类失效新增，逐页比对 Astro 与 Nuxt 产物的 `<article>` class 集合：

- 62 个带 `<article>` 的页面逐个比对 class 集合，任何缺失/多余都报 `DIFF`
- 额外确认 `.article` 规则确实进了 CSS 包、`max-width:100%` 仍在（防「样式表被整体丢掉」这个同症状异病因）
- **已做反向自证**：把产物里的 `class="article md-story"` 改回 `class="md-story"` 再跑门禁，
  正确报出 `MISSING vs nuxt: article` 且 EXIT=1；还原后 PASS。
  按本项目历史（`TrimEnd` 假绿灯、`$_` 是 FileInfo、注释伪装成配置），
  **没做过反向自证的新门禁一律当作未验证**。

## 32. 附带修正：`hidden` 属性被作者级 `display` 压过

补回归档样式后，`position: sticky` 让一个本该隐藏的面板浮进了视口。
根因不是 sticky，而是：

```
<div class="archive-tuning card" data-archive-tuning hidden>
```

全局 `.card { display: block }` 是**作者级**声明，优先级高于 UA 样式表的
`[hidden] { display: none }`。所以这个面板**一直可见**，只是此前没有 sticky，
沉在长页面文档流末尾看不见。

它同时也是彻底的死 UI：控制它显隐的 Secret + Toggle 在 Astro 版里已被丢掉，
`data-archive-tuning` 全项目只有它自己一处，没有任何脚本会解开它或读滑块。
按 `Secret.vue` 自嵌套死 CSS 的同一标准，连同绑定在 `column > 1` 上的
`.hide-info` 规则一起删除，`--archive-item-column` 恒为 1。
## 33. 第十二次失效模式：整层 prose 组件从未被识别（六个组件 / 影响每一个文章页）

§29-31 修的都是「组件在、样式或类名丢了」。这一条更靠前：
**Nuxt Content 按约定自动把 markdown 产出的元素映射到 `Prose*` 组件，
而这六个组件从未被识别为「需要移植的对象」。**

| 组件 | 作用 | 缺失后果 | 影响页面 |
| --- | --- | --- | --- |
| `ProsePre` | 代码块外壳、语言标签、复制/换行按钮、长块折叠 | 22 个页面的代码块没有外壳和按钮 | 22 |
| `ProseA` | 链接样式 `z-link` + 域名图标 | 40 个页面的正文链接裸奔 | 40 |
| `ProseP` | `prose-paragraph` + 引用到评论区 | 61 个页面 | 61 |
| `ProseTable` | `figure.md-table` 包装 + 换行切换（**切换按钮形态有降级，见 §41-B4**：Nuxt 是 `<Tooltip :delay="500">` 内挂按钮，移植版是常驻 `<button>`） | 17 个页面 | 17 |
| `ProseCode` | 行内代码 + 复制按钮（**行内语言着色未移植，见 §41-B2**） | 1 处（演示页） | 1 |
| `ProseH1..H6` | 标题包 `<a href="#id">` | `article.css` 的 `&.md-tech > h2 > a::before` 等规则全部失配 | 全部 |

**为什么之前判为「无对应组件」**：Phase 4-6 的端口审计把它们归进
「Prose* 7 个走 remark 管线」一句话带过，没有逐个核对 Nuxt 产物里
对应的类名是否出现。**这是审计本身的方法缺陷，不是记录疏漏。**

发现方式：把 Nuxt 与 Astro 产物里所有 `class="..."` 做集合差，
再交叉「Astro 的 CSS 里是否仍有该类的规则」——三者同时成立即为死样式。
见新增门禁 `check-dead-css.ps1`。

### 33.1 附带发现：代码语法高亮从未生效

`shikiConfig.defaultColor: false` 让 Shiki 只输出 CSS 变量
（`--shiki-light` / `--shiki-dark`），**但全站 CSS 里没有任何规则把变量映射成 `color`**。
Nuxt 不需要这层映射——它的 ProsePre 在运行时调 shiki，直接内联 `color:`。
结果 Astro 侧每个代码 token 都继承正文色，**等于没有高亮**。
`prose.css` 开头补了这段映射后才出现颜色。

### 33.2 实现上的四个坑（都实测过，记录以免重蹈）

1. **`<code copy>` 在 rehype 阶段不可见**：MDX 里手写的 `<code lang="sh" copy={true}>`
   在插件运行时还是未编译的 `mdxJsxTextElement`，由 MDX 编译器自行处理，绕过插件。
   改到客户端补（与标题锚点同一套路）。
2. **围栏 meta 传不到 rehype**：三条路全断——hProperties 被 Astro 的 shiki 重建节点丢弃；
   模块级队列被并行构建的其它页面冲掉；`tree.data` 不过 mdast→hast。
   唯一稳定的通道是 **VFile 的 `path`**：在 rehype 阶段重读源文件按顺序配对，
   并用 lang 校验避免错配。
3. **hast 属性键名有两种约定**：`data-language` 与 `dataLanguage` 都可能出现，
   只查一种会让语言标签全部退化成 `text`。
4. **不能塞 raw HTML**：`{ type: 'raw' }` 会让 MDX 抛
   `Cannot handle unknown node 'raw'`，图标必须构造成结构化 hast 节点。

## 34. 第十三次失效模式：配置字段没跟着迁移（4 处 UI 静默消失）

组件移植了，**喂给组件的配置没跟着走**，于是组件走了另一条分支：

| 类 | 根因 | 后果 |
| --- | --- | --- |
| `.post-subtitle` | `subtitle` 不在 `content.config.ts` 的 schema 里 | 13 篇带副标题的文章副标题全丢 |
| `.no-toc` | `[...slug].astro` 用 `tocHeadings.length > 0` 跳过整个 Toc 组件 | 无目录的页面目录组件整个消失 |
| `.carousel-action` | 只移植了样式没移植元素 | 首页轮播没有上一页/下一页 |
| `.archive-age` | `lib/app-config.ts` 的 `component` 段漏了 `stats` | 归档页没有年龄 |

**`CODEBLOCK` 常量是我一开始硬编码的**（12/6/2/4），而
`app/app.config.ts` 的实际值是 `triggerRows: 32 / collapsedRows: 16 / indent: 4 / tabSize: 3`。
已改为从 `appConfig.component.codeblock` 读取，并在注释里写明不要再写死。

## 35. 第十三、四次失效模式：`import.meta.url` 少算一层

`lib/app-config.ts` 曾用 `new URL('../../../../package.json', import.meta.url)`。
从 `src/lib/` 上溯三层才是仓库根，**这条路径多了一级**。
它此前能跑只是因为 Vite 内联模块时 `import.meta.url` 的解析恰好不同——
典型的「靠运气成立」。改成按 `process.cwd()` 逐候选尝试，并且**永不抛错**：
版本号只用于页脚一行文案，读不到退回 `0.0.0`，不值得让整站构建挂在
`Unable to load your Astro config` 上。

## 36. 门禁清单（当前 11 道）

| 门禁 | 作用 | 自证 |
| --- | --- | --- |
| `check-integration` | Phase 4 集成完整性 18 项 | — |
| `check-layout` | 布局外壳、CSS 令牌、作用域/嵌套陷阱 | — |
| `check-anchor-classes` | 逐页比对 `<article>` class 集合 | ✅ 注入回归验证 |
| `check-dead-css` | Nuxt 有类 / Astro 无类 / CSS 仍有规则；Prose* 落地断言；代码块数量对比 | ✅ 两类回归均验证 |
| `compare-urls` | 67 URL 零差异 | — |
| `compare-titles` | 67 标题一致 | — |
| `check-content-preservation` | 正文行保留率 | — |
| `check-dates` | `<time>` 与 frontmatter 一致 | — |
| `audit-deferred` | 组件移植清单 | — |
| `audit-image-pipeline` | 图片管线收益审计 | — |
| `check-ci-triggers.mjs` | 两个工作流不争抢部署目标 | — |

> 两道新门禁都做了**反向自证**（注入回归 → 必须 FAIL → 还原 → PASS）。
> `check-dead-css` 自身也踩过同一个坑：初版没剥离 Nuxt 内联的 `<style>`，
> 把 ProsePre 样式表里的 `.z-codeblock` 也数进页面计数，
> 于是每页都报 `nuxt=2N astro=N`，一度报出 70 个假回归。

## 37. 已知未修：MDX JSX 块内的行间公式

`previews/example.md` 里有 8 处 `$$...$$`，Astro 侧**全部没渲染成 display 数学**
（`.katex-display` 0 个，Nuxt 2 个），内容退化成了无高亮的代码块。

已确认**是既有缺陷、非本次移植引入**：把 `rehypeProseChrome` 从管线摘掉重建，
`katex-display` 仍然是 0。行内 `$...$` 正常（12 处 `.katex`）。
影响面仅限这一个 robotsNotIndex 演示页的「数学公式」小节。

`check-dead-css.ps1` 的白名单里显式登记了 `katex-display` 并注明
「修好之前不要删掉这条」——避免为了让门禁变绿而掩盖它。
## 38. 第十四次失效模式：`<script>` 不继承 frontmatter（三个绑定，灯箱从未打开过）

Astro 的 `<script>` 块**不继承 frontmatter** 的 import / const / function。
`LightboxModal.astro` 把 `subscribeModals`、`getModalByKey`、`DURATION`
三个都只写在 frontmatter 里，脚本里当裸标识符用——编译产物里它们是
**没有任何导入的裸标识符**，运行到就抛 `ReferenceError`。

**为什么此前完全看不出来**：

1. 页面照常渲染，没有任何视觉症状；
2. 十道静态门禁全部通过（它们验证的是产物里有没有这段标记）；
3. `initAll()` 先执行 `bindLightboxTriggers()` 再进 `initLightbox` 循环，
   所以 `document.documentElement.dataset.lightboxBound` 被置成 `'1'`——
   **一个"已绑定"的标记，反而把失败掩盖了**；
4. 出错点在 `initLightbox` 里，而默认路径不点图片就永远走不到。

同组件里还有第二个 bug：`getModalByKey(entries, 'lightbox')`。
该函数签名是 `getModalByKey(key: string)`，只收**一个**参数；
数组被当成 key 去和栈里每项的 key 比对，永远匹配不到 →
`show` 恒为 `false` → 即便没有 ReferenceError，弹窗也永远不显示。
`SearchModal` / `ShareModal` 的调用都是对的，只有它写成了数组版。

> 结论：**灯箱这个组件从移植到上线从未工作过**，而十一道门禁没有一道
> 察觉。原因不是门禁不够多，而是它们**全是静态的**——没有一个会真的点一下。

## 39. 第十五次失效模式：服务端模块被客户端脚本 import（我自己引入的回归）

修 `ShareModal` 的 `siteTitle` 时，我在它的 `<script>` 里加了
`import { appConfig } from '../../lib/app-config'`。
而 `app-config.ts` 顶层有 §35 刚加的 `readRootVersion()`，里面用 `process.cwd()`。

**服务端没问题，浏览器里 `process` 根本不存在** →
`ReferenceError: process is not defined`，把引用该模块的弹窗脚本整个打挂。
全站扫描显示 **66/67 个页面**都中招（ModalHost 在每个页面上）。

讽刺的是：这正是 §35「不抛错」的修复**不够彻底**的连带后果——
当时只考虑了 Node 侧抛错会拖垮构建，没考虑这个模块会被打进浏览器包。

**教训**：`lib/` 下的模块只要可能被 `<script>` 引用，就必须**双向安全**：
Node API 要探测后再用（`typeof process !== 'undefined'`），
或者干脆拆成 server-only / client-safe 两份。
「在服务端不抛错」不等于「在客户端能用」。

## 40. 门禁升级：静态文本匹配 → 无头 Chrome 真驱动

新增 `scripts/interaction-check.mjs`。零依赖：Node 24 自带全局 WebSocket，
直接讲 Chrome DevTools Protocol（拉起无头 Chrome、附 target、
`Runtime.evaluate` 求值、`Input.dispatch*` 发真事件、`Log` / `Runtime.exceptionThrown` 收错）。

### 40.1 为什么不用已有的 `audit-interactions.ps1`

那个脚本做的是**文本匹配**：数 `data-*` 钩子、匹配 `addEventListener` 的事件名。
它回答不了「点了有没有反应」——一个绑定了空函数的按钮在它眼里也是健康的。
本脚本每一项都断言 DOM 的**可观察变化**（类名翻转、面板可见性、
`location.hash` 变化、按钮文案改变、`<html>` 暗色类翻转）。

### 40.2 关键设计：任何未捕获异常都让门禁失败

这一条直接对应 §38/§39：`ReferenceError` 不产生任何视觉症状，
只有运行时才拿得到。因此脚本订阅 `Runtime.exceptionThrown` /
`Runtime.consoleAPICalled(error)` / `Log.entryAdded(error)`，
并在**全部 67 个页面**上扫描。第三方统计的 CORS 噪声
（Cloudflare Insights / Umami 在 localhost 下必然失败）按域名白名单排除。

> 顺带一提：我一度写过一个**静态版**的同类扫描器
> （检测 `<script>` 裸用 frontmatter 绑定），误报率高到
> `dataset.orderKeys`、`.key`、局部 `const aside`、解构声明全被误判，
> 放宽匹配后反而更糟。**误报的门禁比没有门禁更糟**——它只会训练人忽略失败。
> 最终删掉它，用运行时扫描替代：运行时的 `ReferenceError` 是确定性的，
> 而静态扫描靠猜声明形式。

### 40.3 交互门禁当前覆盖 20 项

文章页：代码块复制 / 换行 / 折叠、标题锚点、外链 `target`+`nofollow`、
域名图标 SVG、段落类、**灯箱开→Esc 关**、**分享弹窗能打开且有内容**、
TOC 跳转；演示页：Tab 切换、行内代码复制按钮、表格换行切换、域名图标；
归档页：分类筛选、排序切换；首页：轮播翻页、**三态主题切换**；
外加四个页面的零未捕获异常断言与 67 页全站扫描。
### 40.4 门禁自身的假阳性：关页竞态

全站扫描第一次跑出「7 个页面抛 `Uncaught (in promise) 0`」，两次运行数量还不同
（先 2 后 7），但**单独加载那些页面时一个异常都没有**。

原因是**门禁自己的拆页竞态**，不是页面 bug：快速连续开关 67 个 target 时，
页面里还在飞的动态 `import()` 被中途打断，冒泡成一条**没有消息**的
unhandled rejection——长得极像页面缺陷。

修法：关页前先 `Page.navigate('about:blank')` 并等一下，让在途工作落地再关。

> 这条本身也是「门禁要反向自证」的又一例：门禁红了，第一反应应该是
> 「**先确认门禁自己没坏**」，而不是直接去改被测代码。
> 本项目的历史里，假绿灯（`TrimEnd` 压掉根路径）和现在这条假红灯是同一类问题的两面。

### 40.5 三次「以为是自己引入的」判定

本轮有三处差点被误判成回归：

| 现象 | 一度以为 | 实际 |
| --- | --- | --- |
| `$$` 行间公式不渲染 | 我新写的 rehype 插件弄坏了 | 把插件摘掉重建仍然 0 命中 → 既有缺陷 |
| 66/67 页面报错 | 交互门禁误报 | 真回归，但**是我自己上一轮引入的**（见 §39） |
| 7 个页面报无消息 rejection | 页面 bug | 门禁自己的拆页竞态（见 §40.4） |

区分它们的手段都一样：**做一次对照实验**，而不是推理。
§38 的两个灯箱 bug 则是反向的——推理「不可能是既有缺陷」之后，
用产物里 `subscribeModals` 出现 0 次这种**可直接数出来**的证据才坐实。
### 40.6 最终判据：只认页面自己观察到的 rejection

全站扫描一度稳定报出 6~7 个页面 `Uncaught (in promise) 0`（无消息、无堆栈）。
逐项排查：

| 假设 | 验证方式 | 结果 |
| --- | --- | --- |
| 第三方统计 / CDN 网络噪声 | 对照 Nuxt 基线跑同一批页面 ×3 轮 | **不成立**：NUXT 0/24，ASTRO 6/24 |
| 门禁拆页竞态 | 关页前先导航到 about:blank | 部分缓解，仍有 6 |
| 我自己引入的 twikoo init 未接住 | 给 `twikoo.init()` 加 catch | 无变化 |
| 站点代码真的抛了 | 在页面里装 `unhandledrejection` 监听器 | **不成立**：页面一次都没捕获到 |

最后一条是决定性的：**CDP 报了、页面没报**，说明异常来自一个**已被销毁的执行
上下文**（导航/拆页时在途请求被取消），站点代码并没有抛。

于是判据改成：页面级 `unhandledrejection` 才是失败；CDP 独有的归入
「上下文销毁」并**计数上报**（不静默丢弃）。改完 67/67 全绿。

> 这是门禁设计的第三条纪律（前两条见 §31.1、§40.4）：
> **门禁红了，先确认门禁自己没坏。**
> 本项目历史上有假绿灯（`TrimEnd` 压掉根路径），本轮又遇到假红灯
> （拆页竞态、上下文销毁）。而每一次的破局点都不是推理，是**对照实验**：
> 同样的页面打 Nuxt 基线、单独加载、装监听器换判据。
### 40.7 门禁自身的第四个问题：进程泄漏

`interaction-check.mjs` 用 `spawn('npx', [...], { shell: true })` 拉起
`astro preview`。Windows 上 `shell: true` 会把命令交给 `cmd.exe`，
于是 `child.kill()` 杀的是 cmd.exe，**真正的 `node astro preview` 活了下来**——
每跑一次门禁就在 4398 上留一个孤儿服务。

修法分两步，两步都是实测出来的：

1. Windows 上用 `taskkill /pid <pid> /T /F` 杀整棵进程树，而不是只杀直接子进程；
2. 而且必须用 **`spawnSync`** 而不是 `spawn`——门禁在 teardown 之后立刻退出，
   异步的 `taskkill` 还没来得及跑，4398 上的孤儿服务照样活了下来
   （第一版就是这么漏的，是跑完门禁后手工查端口才发现的）。

已反向验证：跑完门禁后 4398 端口释放、Chrome 调试端口无残留、无新增 node 进程。

> 这也是「门禁要有反向自证」的第四个实例。**一个会往用户机器上留垃圾的门禁，
> 比没有门禁更糟。**
## 41. 当前全部未实现项与问题（2026-10-01 实测汇总）

> 本节是**当前状态的总表**，与前面各节冲突时以本节为准。
> 数字全部来自对 `astro-site/dist` 与 Nuxt 基线 `.output/public` 的全量统计（非抽样），
> 不是从源码推断。

### 一览速查表

| 组 | 内容 | 数量 | 严重度 |
| --- | --- | ---: | --- |
| A | 爬虫与社交预览（description / Open Graph / twitter:card / robots meta / JSON-LD / robots.txt / sitemap / 404） | 9 | 🔴 最高，0/67 页面 |
| B | prose 组件未实现的细节（链接 tooltip / 行内代码着色 / 表格 Tooltip 形态 / 缩进参考线） | 4 | 🟠 中 |
| C | 已知缺陷（`$$` 公式、两处代码块数量） | 3 | 🟡 低（均为演示页；原列的「图片 mirror」经核实为误判，已更正移出） |
| D | 有意取舍，不是缺陷 | 4 | ⚪ 无 |
| E | 死代码与卫生（4 个孤儿组件、`lang="scss"` 错标、构建噪音告警） | 3 | 🟢 低 |
| F | 架构隐患（`app-config.ts` 双向引用 / `getModalByKey` 签名 / 死样式模式） | 3 | 🟠 中，需长期留意 |
| G | 验证覆盖缺口（games 家族未交互验证、断点未验证、4 项功能未入门禁） | 3 | 🟠 中 |
| H | 待用户决策（切流时机） | 1 | 🔴 阻塞切流 |

**建议修复顺序**：A 组（改动集中在 `Base.astro` + 一个 `robots.txt` + sitemap 过滤）
→ I 组（补 404 页）→ B 组（4 项，工作量都不大）→ C / E 组。

### A. 爬虫与社交预览（最严重，0/67 页面）

| # | 缺口 | Nuxt | Astro | 证据 |
| --- | --- | ---: | ---: | --- |
| A1 | `<meta name="description">` 缺失 | 66 页 | **0 / 67** | Astro `<head>` 仅 charset、viewport、author、color-scheme、generator、mobile-web-app-capable 六项 |
| A2 | **Open Graph 全缺**（`og:type` / `og:title` / `og:description` / `og:image` / `og:url` / `og:site_name` / `og:locale`）→ 分享到微信 / X 无卡片预览 | 66 页 | **0 / 67** | 同上 |
| A3 | `twitter:card` 缺失（基线为 `summary_large_image`） | 66 页 | **0 / 67** | 同上 |
| A4 | `robots` meta 缺失（基线含 `max-image-preview:large` 等） | 68 页 | **0 / 67** | 同上 |
| A5 | **结构化数据（JSON-LD）全缺** | 66 / 69 页 | **0 / 67** | 全量统计 |
| A6 | **`robots.txt` 完全缺失** | 存在（`Disallow: /preview` + `Disallow: /previews/*`） | **不存在** | `dist` 根目录只有 `atom.xml` `index.html` `llms.txt` `search-index.json` `sitemap-0.xml` `sitemap-index.xml` `subscriptions.opml` |
| A7 | **sitemap 主动收录本应屏蔽的页面** | 63 条，不含预览页 | 67 条，多出 4 条 | 尾斜杠规范化后精确 diff：多出 `/favicon.ico`、`/preview`、`/previews/bangumi-components`、`/previews/example` |
| A8 | **`/sitemap.xml` 这个 URL 消失** | 单个 `sitemap.xml` | `sitemap-index.xml` + `sitemap-0.xml`，旧 URL 404 | 而基线 `robots.txt` 正是指向 `/sitemap.xml` |
| A9 | **404 页面缺失** | `404.html` 11.2 KB | **不存在** | 文件存在性 |

> A7/A8 曾经被我误判成「Astro 多收录了 4 个页面」——实际 63 vs 67 的差异
> **全部来自尾斜杠**（Nuxt 发 `/about`，Astro 发 `/about/`）。规范化后
> NUXT 独有的 URL 为 0，真正的差异只有上面那 4 条。

### B. prose 组件未实现的细节

| # | 缺口 | 基线 | 移植版 |
| --- | --- | --- | --- |
| B1 | **ProseA 链接 tooltip 整个没做**：外链显域名、内链显解码后的 href | `ProseA.vue:10-17` 的 `v-tip` | `plugins/prose.ts` 中 `tip` / `tooltip` 出现 **0 次** |
| B2 | **ProseCode 行内代码不按语言着色** | `ProseCode.vue:16` 调 `shiki.mountInline(language)` | `prose.ts` 的 `buildInlineCode` 只补复制按钮 |
| B3 | **缩进参考线未启用**（`main.css` 的 `.indent` 规则是死的） | `app.config.ts:26` `enableIndentGuide: true`，`ProsePre.vue:59` 据此选 transformer | `astro.config.mjs` 的 `shikiConfig` 无 `transformers`，产物里 `.indent` 出现 **0 次** |
| B4 | **ProseTable 切换按钮形态降级** | `<Tooltip :delay="500">` 内挂按钮 | 常驻 `<button>`，无 Tooltip 包裹 |

### C. 已知缺陷

| # | 缺口 | 影响 |
| --- | --- | --- |
| C1 | `$$` 行间公式不渲染（`katex-display` 基线 2 / 移植版 0，残留 4 处 `$$`）。**已用对照实验证实为既有缺陷、非本次移植引入**（把 prose 插件摘掉重建仍是 0）；行内 `$...$` 正常 | 1 个 robotsNotIndex 演示页 |
| C2 | `/previews/example` 代码块数量 11 vs 44 | 同上（已登记为门禁 KNOWN） |
| C3 | `/link` 代码块数量 0 vs 1 | 1 页 |

> **更正（2026-10-01）**：本节原先还列了一条「图片 `mirror` 防盗链镜像未移植」，**该结论是错的**。
> 错因：我看到 `util/Img.vue` 没有 `.astro` 对应件，就直接推断能力缺失，
> 而没有去查内容真正使用的 `components/content/Pic.astro`。
> 实际上 `Pic.astro` 完整实现了该能力，且**与基线同源**：
>
> - `Pic.astro:4` — `import { getImgUrl } from '../../../../app/utils/img'`（与 Nuxt 侧同一份实现）
> - `Pic.astro:51` — `const imgSrc = getImgUrl(src, mirror)`
> - `Pic.astro:69` — `referrerpolicy={mirror ? 'no-referrer' : undefined}`
>
> 产物里 `referrerpolicy` 两侧都是 0，原因是**当前内容 0 处使用 `mirror`**，
> 不是功能缺失——行为与基线完全一致。
> 唯一有意的差异是 `util/Img.vue` 里的 `baseURL` 拼接，
> `Pic.astro:46-50` 已写明改由 `import.meta.env.BASE_URL` / astro:assets 统一处理；
> 本项目未设 `base`（默认 `/`），该拼接是空操作，**当前无影响**，
> 但若将来设置了 `base` 需要重新审视这条。
>
> 这条更正本身是个教训：**「某组件没有对应件」不等于「该组件的能力没被移植」**——
> 能力很可能被吸收进另一个组件（本次即 `util/Img` → `Pic`），
> 判断前必须查清内容实际走的是哪一个组件。

### D. 有意取舍（不是缺陷）

- 归档页密度调节面板已整体删除（连同绑定在 `column > 1` 上的 `.hide-info`）
- astro:assets 图片管线未迁移（`audit-image-pipeline` 已证基线侧 0 收益）
- KaTeX CSS / Twikoo / Cloudflare Insights 走 CDN，非本地打包
- Bangumi 功能已在根项目整体移除，演示页改为说明页

### E. 死代码与卫生

- **4 个孤儿组件**：`Slider` / `Toggle` / `Expand` / `RadioGroup`（真实 import 数为 0；
  前两个因删掉密度面板而孤立，`Expand` 的行为已内联进 `BlogTech.astro`，
  `RadioGroup` 在基线侧本身就是死的）
- `clarity-resource-list.mdx:95` 的 `lang="scss"` 错标（内容其实是纯 CSS，能正常编译）
- `MODULE_LEVEL_DIRECTIVE` 告警（实测 MDX head 注入生效，属 rollup 噪音）

### E2. 已修：站点字体文件漏拷贝（验证器补出的一项）

| 项 | 值 |
| --- | --- |
| 文件 | `public/fonts/LXGWWenKai.woff2`（17,048 B，SHA256 `442EF7A1…`，git 已追踪） |
| 消费者 | `src/components/BlogHeader.astro:99` 的 `@font-face` → `.header-title`（站点标题字体）；`public/assets/atom.css:41` 的 `@font-face` → `.title`（Atom 阅读器样式） |
| 症状 | Astro 构建产物里**根本没有** `fonts/`，两处 `@font-face` 全部 404，字体静默回退到 `Noto Sans SC` |
| 基线对照 | Nuxt 基线 `.output/public/fonts/LXGWWenKai.woff2` **存在**，与源文件 SHA256 完全一致 |
| 端口自述 | `BlogHeader.astro:19-20` 已把它列为迁移差异第 4 条（"尚未复制到 astro-site/public"），但从未被任何门禁覆盖 |

已修：把源项目那一份原样复制到 `astro-site/public/fonts/`，
重建后 `dist/fonts/LXGWWenKai.woff2` 到位（17,048 B），
构建 CSS 的 2 处引用不再是死链，8 道门禁复跑全绿。

> 又一次印证 §41 开头那句话：**缺口常常不留任何标记**。
> 这次连组件注释都主动记了「待办 4」，却因为「没人去读注释」而一直挂着。
> 已把 `BlogHeader.astro` 注释里的第 4 条同步改为已完成的说明。

> ⚠️ 排查时我连续两次用 `[System.IO.File]::Exists()` 判断**目录**，
> 对目录一律返回 `False`，一度把「基线有 fonts」误判成「基线也没有」，
> 进而差点把一条真缺口反向划掉。**PowerShell 5.1 下判断目录必须用
> `Test-Path -PathType Container`。** 这个坑我在本轮踩了三次。

### F. 架构隐患

- `lib/app-config.ts` 同时被 frontmatter（服务端）与 `<script>`（浏览器）引用。
  §39 记录过 `process.cwd()` 被打进浏览器包、波及 66/67 页的回归，目前靠
  `typeof process` 探测兜住。正确做法是拆成 server-only / client-safe 两份
- `getModalByKey(key: string)` 只接受一个参数，调用点极易写成数组版
  （§38 记录过灯箱就是这么错的），API 本身没有类型保护
- 「CSS 在但选择器挂不上」这一类失效模式（§31、§33），已加两道门禁覆盖，
  但模式本身仍需人工留意

### G. 验证覆盖缺口

- 交互门禁只测 4 个页面 + 67 页加载扫描；**games 家族 20 页、`/about`、
  `/drive`、`/preview` 从未做过交互验证**（仅验证「加载无未捕获异常」；
  games 20/20 缺 description，但 blog-aside 组件齐全）
- 响应式 `768px` / `1080px` 两个断点未系统验证（门禁跑 1440×900，截图用 799px）
- 搜索 / 摘要展开 / Mermaid / BGM 于 2026-10-01 首次验证（4/4 通过），
  **尚未纳入常驻门禁**

### H. 待办：待用户决策

- **切流时机**：必须成对操作——停用 `build.yml` + 把 `build-astro.yml` 的唯一触发器
  换回 push。单独改任一个都会造成双写事故

### I. 待办：建议由我直接修的（按优先级）

1. **A 组**（A1–A6）：在 `Base.astro` 补 description / Open Graph / twitter:card /
   robots meta / JSON-LD，新增 `public/robots.txt`，sitemap 过滤 `preview*` 与 `favicon.ico`
2. **A9**：新增 `404.astro` 并接入 `build.format`
3. **B 组**：ProseA tooltip（复用现有 Dropdown/tippy）、ProseCode 行内着色、
   ProseTable 恢复 Tooltip 形态、`shikiConfig` 加 `transformers` 启用缩进参考线
4. **E 组**：删 4 个孤儿组件、修正 `lang="scss"` 错标
5. **G 组**：把搜索 / 摘要展开 / Mermaid / BGM 四项并入常驻交互门禁；补 games 家族交互覆盖
6. **新门禁**：把「构建零告警」纳入门禁（§42 说明了 `:deep()` 这类问题只出现在构建日志里，
   没有任何门禁在看）

## 42. §41 审计过程中修掉的：两条活的 `:deep()`

`components/post/PostHeader.astro` 有两条**真实生效路径上的** Vue `:deep()` 没转换：

```css
.post-cover > :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.post-info :deep(.icon)   { display: inline-flex; align-items: center; gap: .25rem; }
```

Astro 不认 `:deep()`。Lightning CSS 在构建时明确告警：

```
'deep' is not recognized as a valid pseudo-class. Did you mean '::deep' (pseudo-element) or is this a typo?
```

**规则被静默丢弃**（不是构建失败），后果是文章头图既没有 100% 宽高填充、
也没有 `object-fit: cover`。全项目其余 `:deep` 命中都只出现在注释里，
只有这两条是活规则——所以构建告警里恰好也是 2 次。

已改为 `:global()`（Vue `:deep(x)` 的语义是「不关心 x 的 scope」，
对应 Astro 的 `:global(x)`），重建后该告警归零。

> 发现路径同样说明问题：**它既没让构建失败，也没进任何门禁**，
> 是靠人工读完整构建日志才发现的。构建告警目前没有任何门禁在看——
> 见 §41-G，应当把「零告警」也纳入门禁。
---

## 43. 第四轮：4 个 agent 并行修完 §41 全部缺口（2026-10-01 23:00 - 00:55）

按「文件独占 + 禁止各自 `pnpm build`（`dist/` 与 `node_modules/.astro` 共享，
并行构建会互相破坏）」拆分，最终由 `scripts/acceptance.ps1` 统一构建 + 统一验收。
**16/16 全绿，交互门禁 25/25，67/67 页零未捕获异常。**

### 43.1 三个 agent 各自纠正了我的错误描述

派活时我基于 §41 的结论写 brief，有三处是错的，被子智能体独立核对后纠正：

| 我写的 | 实际 |
| --- | --- |
| meta 来自 `app/app.vue` 的 `useSeoMeta` | `app/app.vue` 只有 4 行模板，meta 是**逐页** `useSeoMeta` |
| JSON-LD 大概率是 `BlogPosting` | 是 unhead 的 `schemaOrgGraph`，`@graph` 只有 `[WebSite, WebPage]` |
| `content/` 下有 `.mdx` | 内容源是 `content/**/*.md` 的 MDC 属性写法，codemod 才转成 `content-mdx/**/*.mdx` |

还有一个更严重的：**我之前用来判定「与 prose 插件无关」的对照实验是无效的**——
`astro.config.mjs` 的 mtime 晚于 dist，我读的是陈旧产物。
真实根因是 `rehypeProseChrome` 丢弃了 `code.language-math.math-display`，
已由 `src/plugins/math-code.ts` 修复（A/B 实测 `katex-display` 0 → 2，与基线一致）。

### 43.2 修完的项

- **A 组 9 项**：`description` / `og:*` / `twitter:card` / `robots` meta / JSON-LD
  全部 0/67 → **67/68**（第 68 页是 404，正确地 `noindex, nofollow`）；
  `robots.txt` 与 `404.html` 从无到有；sitemap 由 67 条（多 4 条应屏蔽的）压回 **63 条，与基线一致**
- **B 组 4 项**：ProseA 链接 tooltip、ProseCode 行内代码**构建期**着色、
  ProseTable 恢复 Tooltip 形态、标题锚点
- **C1**：`$$` 行间公式 `katex-display` 0 → **2**（与基线一致）
- **E 组**：4 个孤儿组件删除、`lang="scss"` 错标修正
- **F 组**：`app-config.ts` 的 `node:fs` + `process.cwd()` 换成静态 `import package.json`，
  彻底去掉客户端侧的 Node 依赖（构建日志里的 externalized 告警归零）

### 43.3 本轮暴露的新失效模式

**① MDX JSX 元素的「读」和「写」是两套形状，而且只有一边被修过。**
`mdxJsxTextElement` 的标签名在 `name`、属性在 `attributes` 数组里。
子智能体修了**读**（`tagOf` / `getAttr` 的 MDX 分支），于是构建期着色生效了；
但 `addClass` 仍写 `properties.class`——**被 MDX 序列化器静默忽略**。
症状极具欺骗性：token span 在（着色成功），类名一个都没有。
更要命的是运行时的 `initInlineCodeCopy` 看到「按钮已存在」就整段跳过，
**两边各做一半，正好谁都没补上类名**。

试过「把 MDX 节点规范化成 hast 再改」——不行：
`items={[...]}` 这类 JSX 表达式属性不是合法 JSON，`JSON.parse` 还原会退化成字符串，
下游 `items.map` 直接炸（`TypeError: items.map is not a function`）。
最终保持 MDX 节点原样，类名与按钮一律交给客户端补。

> 这类「**产物里东西在、但少了一半**」的缺陷最难查：
> 任何只断言「元素存在」的检查都会通过。

**② shiki 的 `transformerRenderIndentGuides` / `transformerRenderWhitespace` 与 Astro 不兼容。**
接上去构建直接炸在 `Cannot read properties of undefined (reading 'type')`：
它们要求 Astro 的 shiki 传下去的树里有 `<pre><code>`，而 Astro 直接输出
`<pre class="astro-code">`。二者是纯装饰（缩进参考线、空白可见化），已摘掉；
语义性的 `notationDiff` / `Highlight` / `WordHighlight` / `Focus` / `ErrorLevel` 五个保留。

**③ 我自己的验收脚本连续踩了三个 PowerShell 陷阱。**

| 坑 | 症状 |
| --- | --- |
| `$LASTEXITCODE` 被 `Out-String` 管道污染 | 构建明明成功，验收却报 `pnpm build` exit 1 |
| `New-Object System.Collections.Generic.ArrayList` | 类型不存在，脚本当场语法错 |
| 原生命令往 stderr 写（node 的 DEP0190、pnpm 提示） | PS 5.1 抛 `NativeCommandError`，被 `ErrorActionPreference=Stop` 变成终止性错误 → 绿灯报红 |

修法：`Step()` 内临时把 `$ErrorActionPreference` 降到 `Continue`，
再读真正的 `$LASTEXITCODE`。

**④ `check-build-warnings` 自己的隔离目录选错了盘。**
Astro 收尾时用 `rename()` 把资源从 `.astro/.prerender` 移到 outDir；
项目在 `D:`、`GetTempPath()` 在 `C:`，跨盘移动抛
`EXDEV: cross-device link not permitted`，门禁把**跨盘移动失败**报成了**构建告警**。
改为放在项目同盘。另外给门禁加了多行告警的前瞻匹配：
vite 的 reporter 会在首行只打 `[WARN] [vite] [plugin builtin:vite-reporter]`、
正文在后面几行，逐行匹配会把那个空头单独判红。

**⑤ 我的核对脚本自己也错了一次。**
统计 JSON-LD 时把 `application/ld\+json` 整个转义成了字面量 `\+`，
模式永远匹配不上，于是报出「JSON-LD 0/68」——**产物里一直有，是我查错了**。

### 43.4 新增门禁

| 门禁 | 作用 | 自证 |
| --- | --- | --- |
| `check-assets.ps1` | 静态资源引用完整性（字体就是靠它从手工发现变成常态拦截） | 注入缺失 → FAIL → 还原 → PASS |
| `check-build-warnings.ps1` | 构建零告警；5 类检测器 + 3 条带理由的白名单 | 用文档里记录的真实告警串验证 5 类全部触发 |
| `interaction-check.mjs` | 无头 Chrome CDP，20 → **25** 项断言 + 67 页零未捕获异常 | 注入 4 处回归 → 恰好那 4 条 FAIL（21/25），干净态 25/25 |
| `acceptance.ps1` | install → build → 14 道门禁 → 汇总表，一条命令 | — |

### 43.5 仍待处理

- **缩进参考线 / 空白可见化**（§41-B4）因 43.3② 暂缓，`main.css` 里对应规则仍是死的
- **切流时机**待用户决策（需成对停用 `build.yml` + 把 `build-astro.yml` 触发器换回 push）
- games 家族 20 页 + `/about` `/drive` `/preview` 仍只验证了「加载无异常」，
  未做交互验证（§41-G）

## 44. 迁移效果可视化：`scripts/screenshot.mjs`（2026-10-02 01:20 - 01:30）

为了实际看见迁移后的样子（而不是继续看门禁数字），新增截图脚本，
从 `interaction-check.mjs` 的 CDP 客户端派生，产出 14 张图
（`.astro-shots/`，不入库）。

选它而不是内置浏览器面板，是因为**面板宽度实测锁死在 799px**——
那是移动端单栏，恰好展示不出 Clarity 的三栏桌面布局，
而三栏正是这次迁移最该被看见的部分。

### 44.1 脚本要点

| 点 | 做法 |
| --- | --- |
| 视口 | `Emulation.setDeviceMetricsOverride` 自设 1600×1000 与 420×900@2x |
| 主题 | 走 ColorMode 兼容键 `nuxt-color-mode`，用 `addScriptToEvaluateOnNewDocument` 在页面脚本前写入 |
| 懒加载 | 逐步滚到底再回顶，逼 IntersectionObserver / `import()` 真正触发，否则图里是空占位 |
| 补拍 | `--only=<子串>` 过滤 + `slice: [y0, y1]` 分段，组件集大成页实高 19853px，单张截不下也不可读 |
| 收尾 | `taskkill /T` 杀进程树 + 删临时 profile，端口固定 4397（避开 4398/4399） |

### 44.2 第十六次失效模式：截图伪影差点被我当成站点 bug

第一轮截图里，文章列表的**分页器「← 1 2 3 4 →」压在第 4 张卡片上**，
移动端则压在第 2 张上，看着像 sticky 定位错了。

查 `Pagination.astro:202` 才发现是**截图工具的问题，不是站点的问题**：

```css
&.sticky {
    position: sticky;
    bottom: min(2em, 5%);
```

它在真实浏览器里吸在**视口底部**（Nuxt 原版设计，没问题），
位置也对得上——桌面 1600 视口高 1000，伪影出现在 y≈950；
移动端视口 900@2x，伪影出现在 y≈1694。两个都精确等于「视口底边」。

原因：`Page.captureScreenshot({ captureBeyondViewport: true })`
把整页压成一张长图时，sticky 元素按**当前 scrollY**（脚本已回 0）定位，
于是被画到长图里 y≈视口高度 的地方。

修法与 §40 的 `interaction-check.mjs` 一致——那边早就有
`[data-pagination-snapshot]` 处理，截图脚本漏了。补上后重拍，
分页器回到列表末尾，压住的卡片也完整了。

> 这条的教训不是「 sticky 不能用」，而是：
> **上一套工具里已有的伪影处理，新写的工具默认不会继承。**
> 同一类问题在两个脚本里各修一次，第二次靠的是记得，不是靠机制。

## 45. 第五轮：拿生产站当基线，逐字段对比（2026-10-02 01:20 - 02:30）

前四轮的验收基准全是「Nuxt 源码」与「Astro 产物」之间的静态检查。
问题在于：**源码对齐不等于线上对齐**。中间隔着 content 转换、shiki 配置、
`useFetch` 的运行时端点、乃至 CSS 落到浏览器后的实际排版。
这一轮改成把 `https://blog.sotkg.com`（Nuxt 真实生产站）当事实源，
用四个互补的探针逐项比对。

### 45.1 四个探针与各自覆盖的东西

| 探针 | 手段 | 抓什么 | 为什么需要它 |
| --- | --- | --- | --- |
| `compare-remote-sitemap.mjs` | HTTP | 两站 URL 集合 | 唯一能发现「切流后全站 404」的检查 |
| `check-head-vs-live.ps1` | HTTP + 正则 | 19 个 head 字段 × 8 页 | 纯静态、最快，不受渲染时序干扰 |
| `compare-dom-live.mjs` | 无头 Chrome + CDP | 34 个 DOM 特征 × 8 页 | 唯一能看到「排版后果」的一类 |
| `screenshot.mjs` | 无头 Chrome | 像素 | 兜底：前面三个都漏了才靠它看 |

**实测 URL 集合 63 = 63 完全一致**，sitemap 侧可以放行。
head 字段在修掉一个编码 bug 后剩 14 处差异，首页与文章页**完全一致**。

### 45.2 我在这一轮自己犯的四个错（都不是 worker 的锅）

**① 补尾斜杠，13 张「基线图」全是 404。**
生产站深层路径不容忍尾斜杠（`/2025/10/xxx` 才是 200），
我脚本里无脑补了，于是抓回来的每一张都是 EdgeOne 的 404 页——
而它看起来「就是内容少」，差点被我当成基线。
修法不只是改代码：**加截图前 HTTP 预检，URL 取不到内容就直接硬失败退出。**

**② PowerShell 把远程 HTML 按 ANSI 解码，54 个差异里 40 个是假的。**
`Invoke-WebRequest` 返回的字符串用的是控制台代码页，所有中文成乱码，
于是 title / description / author **每一项都被判为不同**。
改成按字节取 + 显式 UTF-8 后，差异降到 14 个。
> 中文站点上做文本比对，**取字节自己解码**是唯一可靠的做法。

**③ 对比工具把「彻底失败」报告成「全绿」。**
`compare-dom-live.mjs` 第一版把全部特征塞进一个巨型 IIFE，
页面里求值不出结果且 `exceptionDetails` 为空，Node 侧拿到 `undefined`——
而 `diff(undefined, undefined)` **每一项都判定相等**，
于是八页全部报「无结构差异」、退出码 0。
一次彻底的失效看起来像满分，**这比直接崩溃危险得多**。
修法：探测失败必须硬报错退出；`undefined` 永远不参与相等判定。
重构成逐字段小表达式（`dom-probe.mjs`，34 个字段）后，通道立刻通了。

**④ `node --check` 不检查跨模块导出。**
`dom-probe.mjs` 漏写 `export`，语法检查一路绿灯，
真正运行时才 `does not provide an export named 'EXTRACTORS'`。
> 语法检查 ≠ 模块检查。跨文件改动要实际 import 一次。

### 45.3 第十八、十九次失效模式：迁移时「知道该做但标成后续阶段」

这一轮最有价值的产出，是两个**早就被代码注释自认、但一直没做**的缺口：

- `Article.astro` / `Archive.astro` 头部都写着「`util/Date.vue` 属其他组件的
  迁移范围，这里内联最小渲染；**待 `util/Date.astro` 落地后可收敛**」，
  而 `util/Date.astro` 至今不存在。结果卡片日期显示成
  `2026年04月01日星期三 中国标准时间 14:00:00`（线上是 `4月1日`），
  **每张卡片高 25px，一页 10 张 = 250px**——
  这正是「Astro 每页都比线上高 200~600px」的来源。
- `BlogStats.astro` 写着「未传 `stats` 时显示 `--`，与原版 stats 为空时一致」，
  但布局层从来没传过，于是线上「总字数 9.74 万」在 Astro 侧永远是 `--`。
  `index.astro:26` 甚至把这条记成了已知缺口第 3 条。

> 「先记下来，后续阶段做」在迁移项目里是最常见的静默失败形式：
> 注释写得越详细，读代码的人越觉得**已经处理过了**。
> 代码注释不能代替测试，缺口清单也不能代替修。

### 45.4 代码块行号：CSS 在，数据源不在

`prose.css:179` 完整复刻了 Nuxt 的行号规则
（`content: var(--line-indicator, "") attr(data-line)`），
但全仓库 grep `data-line` **只在 CSS 的 `attr()` 里出现，没有任何地方写出这个属性**。
Nuxt 侧的真身在 `app/composables/useShiki.ts:48-50`——
一个自写的 shiki transformer：`line(node, line) { node.properties['data-line'] = line }`。
CSS 齐全、数据源缺失，于是行号列渲染成一块空白缩进。
Astro 侧补上同款 transformer 即可（与 `transformerRenderIndentGuides`
那类会重建子树的 transformer 不同，纯属性写入不碰树形状，所以没有兼容问题）。

### 45.5 本轮修复清单

| 项 | 线上 | Astro（修复前） | 处置 |
| --- | --- | --- | --- |
| 博客统计·总字数 | 9.74 万 | `--` | 抽出 `lib/stats.ts`，构建期注入 |
| 技术信息·构建平台 | GitHub | **整行缺失** | 修 `CI_PROVIDER` → `GITHUB_ACTIONS` |
| 代码块行号 | 有 | 空白 | 加 `transformerLineNumbers` transformer |
| 卡片/头部日期 | `4月1日` | full 级别长串 | 移植 `util/Date.astro` |
| 文章字数 | 424 字 | 390 字 | 对齐取文本规则 |
| `/preview*` 的 meta robots | `noindex, nofollow` | `index, follow, …` | 加 `isNoindexPath` 判定 |

后三项由 worker 并行处理，前两项见各自交付。

### 45.6 六项修复全部在产物里复核通过

| 检查 | 线上 | 产物实测 |
| --- | --- | --- |
| 博客统计·总字数 | 9.74 万 | **9.73 万**（余量来自 5 篇 codemod 遗留） |
| 技术信息·构建平台 | GitHub | 本地无 CI 变量故不渲染；`GITHUB_ACTIONS=true` 模拟构建 → **GitHub** + `ri:github-fill` 内联 SVG 正常 |
| 代码块行号 | 有 | `data-line` **289 处** |
| `/preview` robots | `noindex, nofollow` | ✅ |
| `/previews/*` robots | `noindex, nofollow` | ✅ |
| URL 集合 | 63 | **63 = 63** |

head 字段对比在加了「已知有意差异」白名单后**未接受差异归零**（线上 `/about`、`/drive`、`/games/*`、`/previews/*` 缺 meta description，`og:description` 干脆是字符串 `"true"`，属 Nuxt 侧缺陷，不复刻）。

## 46. 验收流水线的四个坑（2026-10-02 02:20 - 03:35）

这一节与站点代码无关，全是**门禁自己在骗人**。它们的共同点是：
症状都长得像「站点回归了」，而实际都不是。

### 46.1 先说结论：内存确实咬过一次，但不是主因

`interaction-check` 在 25/25 与 7/25 之间摇摆，同一个 `dist`、同一份代码。
**最终没能在流水线里稳定复现，根因未确定（见 46.3）；**
这一节记的是排查途中那个**确实成立、且修掉后立刻见效**的因素：
一个 00:19:58 启动的 `tail.exe -1` **孤儿进程**占了 **1945MB**
（父进程早已退出）。可用内存被压到 1312MB，而无头 Chrome 本身要 ~700MB。
内存不足时门禁不会稳定地失败，而是**随机地把一批断言判红**：
需要点击/输入的全挂、纯查询照过，单次耗时从 90 秒涨到 334 秒。
终止该进程后可用内存回到 3578MB，同一份产物立刻 25/25。

> 顺带一个 Windows 口径陷阱：WMI 的 `Win32_OperatingSystem.FreePhysicalMemory`
> 不含可回收页，曾显示「4MB 空闲」，而 Node 的 `os.freemem()` 显示 3578MB。
> 后者才是真实可用量——**照着前者做阈值判断会得出完全相反的结论**。

由此加的护栏（`interaction-check.mjs` 启动前查可用内存，低于 1.5GB 打
`SKIPPED` 并退出 0）仍然保留：它那条路是真实存在的，且**宁可说"没跑"，
也不能谎报"18 项失败"**——谎报会让人去改本来正确的代码。
但它不是 7/25 的答案：3.5GB 可用时依然复现。

### 46.2 批量替换 `process.exit` 毁掉了控制流

给 `compare-remote-sitemap.mjs` 批量把 `process.exit(0)` 换成
`process.exitCode = 0`（想避免 Windows 上的 libuv 断言），
结果标志位**不终止执行**，控制流继续掉进下面的 FAIL 分支：
打印「URL 集合不一致」并把退出码改回 1。
集合明明完全一致，输出却长得像真失败。

（想用顶层 `return` 收尾也不行——那在 ESM 里是语法错误，只能 if/else 单一出口。）

> **`process.exit()` → `process.exitCode` 不是等价替换**：
> 前者立即终止，后者只是设标志。批量改这类语义要逐处看控制流。

### 46.3 那串 7/25 最后不是内存，也不是管道：门禁的诚实边界

日志里每条 FAIL 的消息是关键：

```
ProseP: only 0 paragraphs marked
ProseA: no external z-link found
ProseH*: no heading anchor found
```

而**同一个 dist** 里静态复核到 42 个 `prose-paragraph`、`z-link` 也在。
页面确实加载了（归档有 38 项、`<html>` 有 `dark` 类），
所以只能是**客户端 JS 没执行**——`prose-paragraph` 是运行时增强的产物。

逐项排除（都是实验，不是推理）：

| 假设 | 排除方式 |
| --- | --- |
| 端口抢占 | 干净环境同样失败 |
| `node_modules/.astro` 被改 | `data-store.json` mtime 从首次 build 起从未变 |
| 时序竞争 | 等 30 秒仍是 10/25 |
| `check-build-warnings` 污染 dist | 正常 build 重建后静态复核 12/13 通过 |
| 内存不足 | **它确实咬过一次**（杀掉 1945MB 的 `tail.exe -1` 孤儿后立刻 25/25），但在 3.5GB 可用时依然失败 |
| PowerShell 管道污染 | 改用 `Start-Process` 原生重定向，同样 10/25 |
| MIME / charset | `.js` 全部 200 + `text/javascript` + utf-8，均正常 |

剩下的线索是**模块图间歇性不执行**，而抓不到根因（浏览器日志里只有
第三方资源的 Cloudflare 525 与 rum 统计 CORS，没有一条模块加载失败）。

**处置：把 `interaction-check` 移出 `acceptance.ps1`，改为独立运行。**
这不是"丢掉一道失败的门禁"——它单独跑是可靠的（反复 25/25），
嵌在流水线里不可靠，而**一个会哭狼的门禁比没有门禁更糟**：
它训练人忽略红色，下一次红色就是真的了。
汇总里显式打印「NOT RUN HERE + 怎么单独跑」，不留悄悄少一道的空间。

> 这一条最值得记住的不是结论，是方法：
> 当症状指向"站点坏了"时，**先证明产物是对的**。
> 用断言自己的选择器在产物上静态复核一遍，比改十次代码都快。

### 46.4 正则假设了属性顺序，差点把「有 1 个」误判成「全站 0 个」

查 `a.z-link[href^=http]` 时我写成 `<a[^>]*z-link[^>]*href="https?://"`,
隐含假设 `z-link` 出现在 `href` 之前。实际输出是
`<a href="..." class="z-link" target="_blank" rel="nofollow noopener noreferrer">`，
于是数出 0 个，差点得出「全站 z-link 丢失」的结论——而实际是**完全正确**。

> 查 DOM 属性用「属性无关」的写法；顺序敏感的正则会在改版后静默归零。

### 46.5 .ps1 里两处想当然的直觉错误

`Remove-Item Env:\VAR` 与 `Remove-Job -Force` 都被本地安全策略判成删除操作而拦截。
**环境变量会随每个 bash 调用自然消失，根本不需要清理**；`Stop-Job` 足够。

### 46.6 沉淀成门禁的两条规则

1. **探针失败必须硬报错**。`diff(undefined, undefined)` 每一项都判相等，
   会把一次彻底失效报成「无结构差异、退出码 0」。
2. **依赖外部条件的门禁，网络/资源不可用时 SKIP 而非 FAIL**。
   断网和内存不足都不是迁移缺陷，会哭的门禁很快会被无视。
## 47. 页脚的 CSS 作用域 bug：每页凭空多出 349~582px（2026-10-02 04:00 - 04:20）

### 47.1 现象

全量 DOM 对比（8 页 × 34 字段）发现一个**规律性**的高度差：
每个带页脚的页面，Astro 都比线上高 349~582px。截图上肉眼可见——
线上页脚是「探索 / 社交 / 信息」三栏并排，Astro 侧被挤成了纵向。

### 47.2 定位过程（每一步都用实测排除）

| 步骤 | 结果 |
| --- | --- |
| 页脚 DOM 结构对比 | **逐字相同**（只差 `data-v-` vs `data-astro-cid`） |
| `.footer-nav` 的 CSS 规则 | **逐字相同**（`display:flex; flex-wrap:wrap; gap:5vw clamp(2rem,5%,5vw)`） |
| 产物 CSS 里有没有这条规则 | **有**，且正确 |
| `#blog-root` grid / `grid-area` / 媒体查询 | **两侧逐字相同** |
| `#blog-root` 实际宽度 | 1376 / 1376 **相同** |
| 三个分栏的实际宽度 | 92 / 146 / 191 **完全相同** |
| **`.footer-nav` 实际宽度** | **1048 vs 248** ← 唯一的差异 |

前三列宽度完全一致、容器宽度却只有 248px（正好等于单列的 max-content），
这一下把范围锁死在「`.blog-footer` 没被当成 grid item」。

### 47.3 根因：Astro 的 `:global()` 只作用于紧邻的选择器

写的是：

```css
:global(#blog-root) > .blog-footer { grid-area: 2 / 2 / auto / -1; ... }
```

Astro 编译出来是：

```css
#blog-root > .blog-footer[data-astro-cid-z73i2dm2] { grid-area: 2/2/auto/-1; ... }
```

**`#blog-root` 变全局了，组合符后面的 `.blog-footer` 仍然被 scoped**，
于是编译器给它加上了 **Blog.astro 自己的** cid。
而 `.blog-footer` 是 **BlogFooter.astro** 渲染的，带的是它自己的 cid。
**这条规则永远不匹配**——页脚因此不参与 grid 布局，宽度退化成 shrink-to-fit。

**修法**：把整个选择器包进一个 `:global()`：

```css
:global(#blog-root > .blog-footer) { ... }
```

产物变成 `#blog-root>.blog-footer{...}`，无多余 cid，实测宽度恢复 1048px、三栏同行。

> 判据：**凡是不在本组件模板里的元素，选择器就得整体 global**。
> 同文件里 `.blog-aside-track` 之所以能裸写，是因为它确实由本组件渲染；
> 混着写就踩坑。全仓库扫了一遍，其余 `:global(...) >` 形式要么每个部分
> 都 global 了（`FeedCard.astro`），要么目标元素就在本组件模板内
> （`Quote.astro` / `OrderToggle.astro`）——**同类 bug 仅此一处**。

### 47.4 修复后的页高收敛

| 页面 | 修复前 | 修复后 |
| --- | --- | --- |
| `/archive` | -358 | **0** |
| 文章页 | +29 | **+2** |
| `/about` | -367 | **-8** |
| `/drive` | -367 | **-8** |
| `/games/galgames/clannad` | -373 | **-15** |
| `/` | -349 | **+9** |
| `/link` | -582 | **-223** |
| `/previews/example` | +261 | **+296** |

### 47.5 剩余两处差异（下一轮的起点）

**`/link` 差 223px**，用逐区块实测（`_diag-sections.mjs`）精确定位到
**第二、第三个 `section.feed-group`**（分别 +60 / +173）；
`footer.blog-footer`、相邻的 `section.feed-group`、`section.z-comment` 都是 0。
卡片 `width:14em`、网格、间距两侧一致，故剩余嫌疑在分组内部的换行或某元素尺寸。

**`/previews/example` 差 296px**（Astro 更矮），尚未定位。

**另有一个 DOM 契约缺口**：`/link` 页 Nuxt 有 `a.skip-link.gradient-card`（无障碍跳转链接），
Astro 侧没有——静态 HTML 与浏览器实测都没有，属于真实缺失。

### 47.6 一条容易误判的信号

link 页 `h3Count: 4 vs 42`、`images: 39 vs 78` 看着像严重内容差异，实际是
**SSR 与 CSR 的固有差别**：Nuxt 水合时 Vue 重渲染，
把静态 HTML 的 41 个 h3 / 76 张 img 简化成 4 个 / 39 张；
而 Astro 是 SSG、没有水合，保留原始结构。
线上用户看到的是简化后的样子，Astro 用户看到的是原始结构——**内容都完整**，
所以这些计数类字段带一层噪声，不能当差异判据；
**只有实测高度能定性**，这也是 47.5 要另写一个逐区块量测脚本的原因。
### 47.7 第二个根因：`is-empty` 永远不生效，`/link` 的 -223px 由此而来

页脚修好后 6/8 页已收敛，`/link` 还差 -223px。逐区块实测把范围收窄到
`section.feed-group`，再往下量祖先链，答案一目了然：

```
Nuxt : feed-list=1048 < feed-group=1048 < main#main-content=1080 < #blog-root=1376
Astro: feed-list=752  < feed-group=752  < main#main-content=784  < #blog-root=1376
```

`1080 = 1376 - 280 - 16`（两列），`784 = 1376 - 280 - 16 - 280 - 16`（三列）。
`#blog-root` 两侧都是 1376，差的是**侧栏有没有内容**——
`#blog-root:not(:has(> .blog-aside-track > #blog-aside:not(.is-empty)))`
这条规则负责在无侧栏时收成两列。

**而 `<aside>` 永远拿不到 `is-empty`。** 链条是两处配合出的错：

```astro
<!-- Blog.astro -->
<BlogAside>
	<slot name="aside" />      <!-- 无论页面有没有 aside，都会被塞进默认 slot -->
</BlogAside>
```

```js
// BlogAside.astro（原来）
const filled = hasAside === undefined
	? Astro.slots.has('default') || metaNames.length > 0
	: Boolean(hasAside)
```

上面那个 `<slot>` **本身就是默认 slot 的内容**，所以 `Astro.slots.has('default')`
**恒为 true**，`filled` 恒为 true。
而 `Blog.astro` 明明有 `hasAside` prop（默认 `false`），**却从没往下传**。

**修法**：布局层显式传，组件层不再做那个恒真的推断。

```astro
<BlogAside hasAside={hasAside || Astro.slots.has('aside')}>
```
```js
const filled = Boolean(hasAside) || metaNames.length > 0
```

build 后 `link/index.html` 的 `<aside>` 正确带 `is-empty inert hidden`，
其余 5 个有侧栏的页面仍是 `FILLED`，行为符合预期。

正文从 784 放宽到 1080 后，友链网格 `repeat(auto-fill, minmax(12em, 1fr))`
每行从 3 个变回 5 个，22 项从 8 行回到 5 行——223px 归零。

> 教训同样具体：**"页面没提供 slot 内容"不等于"接收方收到的 slot 是空的"**。
> 中间隔了一层转发时，接收方从 slot 存在性推断内容必然出错，
> 正确做法是让**发起方**显式声明。

### 47.8 顺带修掉一处工具写入损坏

`pages/link.astro` 第 39 行是 58 个 tab 后接 `import blogConfig from ...`——
某次工具写入把缩进和 import 挤进了同一行。它能通过 build 只是因为
`import` 语法本身合法，ESLint 也只报「缩进超限」。
**这类损坏比编译错误更阴险：不报错，只是悄悄把代码放错位置。**

### 47.9 7/8 页收敛，剩一个演示页

| 页面 | 起始 | 页脚修复后 | is-empty 修复后 |
| --- | --- | --- | --- |
| `/archive` | -358 | 0 | **0** |
| `/` | -349 | +9 | **+9** |
| 文章页 | +29 | +2 | **+7** |
| `/link` | -582 | -223 | **+8** |
| `/about` | -367 | -8 | **-8** |
| `/drive` | -367 | -8 | **-8** |
| `/games/galgames/clannad` | -373 | -15 | **-15** |
| `/previews/example` | +261 | +296 | **+620**（未定位） |

`/previews/example` 是目前唯一未收敛的页面，已知两个成因：

1. **内容差异**：线上该页 aside 里有 2 个 `BlogWidget`（`widgets: 2 vs 0`），
   Astro 侧 0 个。
2. **测量噪声**：该页有 Mermaid、abcjs 乐谱等大量异步渲染组件，
   同一份产物两次测量能差 300+px（296 → 620 就是这么来的）。
   要可靠测量必须等这些组件真正渲染完。

它是 `robots.txt` 里 `Disallow: /previews/*` 的演示页，不影响生产 SEO，
排在 `/link` 之后处理。
## 48. 一条无障碍通路的静默丢失 + 探针自己制造的假差异（2026-10-02 04:40 - 04:50）

### 48.1 `a.skip-link`：组件写好了，从没被引用

`components/blog/SkipToContent.astro` 早就存在，且与基线
`app/components/blog/SkipToContent.vue` 逐字一致（含 `calc(infinity)` 那条注释）。
但 `layouts/Blog.astro` **从没 import 它**。

结果：`/`、`/link`、`/previews/example` 三类页面的静态 HTML 与浏览器实测里
都找不到 `a.skip-link`——键盘用户的「跳到正文」入口整条消失。

**这是迁移项目里最难发现的一类缺陷**：组件是对的、样式是对的、
ESLint 过、类型过、构建过、不报任何错。唯一的破绽是"没人引用它"，
而这件事不留任何痕迹。已挂到 `BlogSidebar` 之前（与 `default.vue` 一致）。

### 48.2 探针的三重噪声（这一节记的是我自己犯的错）

查 Toc 高度差时，`widgets` 提取器连着骗了我三次：

1. **`.filter(w => w.title || w.rows.length)`** 把没有 `dt`、
   标题又不在 `h3/h4/[class*=title]` 里的 `BlogWidget` 全部滤掉，
   于是 `/previews/example` 上报「0 个 widget」——而产物里明明有 4 个
   `blog-widget` 和一份完整目录。
2. **`className.split(/\s+/).slice(0, 2)`** 截断 class 名，
   `widget-body scrollcheck-y scrollbar-hidden` 被截成 `widget-body.scrollcheck-y`。
3. **Vue 与 Astro 的 class 序列化顺序不同**：
   Vue 合并静态 `class` 与动态 `:class` 时动态在前，输出
   `scrollcheck-y scrollbar-hidden ...`；Astro 输出 `widget-body scrollcheck-y ...`。
   两侧因此报出「线上 `scrollcheck-y.scrollbar-hidden` / Astro `widget-body.scrollcheck-y`」，
   看着像少了一个 class——**而 class 顺序根本不影响 CSS 选择器匹配**，
   这是个完全无害的差异。

叠加第 1 条的过滤错位（`[class*="widget"]` 同时命中 `.blog-widget` / `.widget-body` /
`.widget-card`，数量一变就整体错位），结论是：**当时看到的那组 widget 差异全部不可信。**

> 教训：**探针的"简化"就是它自己的 bug 来源**。截断、去重、过滤都会丢信息，
> 而一旦输出看起来整齐，人就不会怀疑它。宁可输出原始字符串。

### 48.3 真正未解的一条

侧栏目录高度：article 页线上 604px / Astro 478px（-126），
game/about/drive 依次 -52/-27/-22，previews 反向 +57。
而 article 页**总**高只差 +7——目录矮的 126px 被正文高的约 126px 正好抵消，
说明正文里还有一处等量的反向差异。两处都没定位，是下一轮的起点。

### 48.4 当前收敛状态

7/8 页面页高差落在 0~15px，`acceptance.ps1` 17/17 全绿，
`live:head` 未接受差异 0、`live:sitemap` 63=63。
唯一未收敛的 `/previews/example` 是 robots noindex 的演示页，
且已确认其测量受 Mermaid / abcjs 异步渲染影响（同一产物两次测量差 300+px）。
## 49. 三处嵌套 `<main>`，以及"静态站不需要等"这个错误直觉（2026-10-02 04:50 - 05:10）

### 49.1 结构问题：`#main-content` 里又套 `<main>`

`layouts/Blog.astro` 提供了 `<main id="main-content">`，而三个页面各自又套了一层：

| 文件 | 多余的包裹层 |
| --- | --- |
| `pages/[...slug].astro` | `<main data-path data-type>`，且 `post-header` 与 `excerpt` 被塞进了它里面的 `<article>` |
| `pages/archive.astro` | `<main>` → `<div class="archive proper-height">` |
| `pages/preview.astro` | `<main>` → `<div class="preview">` |

一个文档只能有一个 `<main>`，嵌套是**无效 HTML**；
而 `[...slug].astro` 更麻烦——`styles/article.css` 的注释明写
「`article` 是正文样式的唯一入口」，`post-header` 与 `excerpt` 在它内部
就开始继承正文样式（行高、标题、列表、`img` 的 `max-width:100%` 与居中圆角）。

那层 `<main>` 上的 `data-path` / `data-type` 全仓 grep **零使用**，纯多余。

用真解析（`_diag-tree.mjs`，走一层 HTML 树而不是正则猜嵌套）确认修复后：

```
article  #main-content 直接子元素
  nuxt (6): post-header, md-excerpt, article, post-footer, surround-post, z-comment
  astro(8): post-header, md-excerpt, [script], article, post-footer, surround-post, z-comment, [script]
```

完全一致，只多两个 `<script type="module">`（Excerpt / Comment 的），
而 `<script>` 默认 `display: none`，不占布局。archive / index 同样对齐。

> 上一轮我是用**正则列标签**得出"Nuxt 的 post-header 与 article 平级"的，
> 而压平的 HTML 用正则无法判断嵌套——**结论碰巧是对的，方法却是错的**。
> 层级问题必须真解析。

### 49.2 修完结构后，数值反而"变差"——因为隐藏的差异显形了

| 页面 | 修结构前 | 修结构后 |
| --- | --- | --- |
| `/about` `/drive` | -8 | **0** |
| `/previews/example` | +570 | **+93** |
| 文章页 | +7 | **+355** |
| `/games/galgames/clannad` | -15 | **-336** |

后两个**不是回归**。此前 `post-header` 继承正文样式而虚高，
恰好把另一处差异**抵消**掉了；结构一对齐，被掩盖的差异就显形。
结构正确是前提，视觉一致要靠后续逐个组件对齐。

### 49.3 「静态站不需要等」是错的

修完结构后测文章页，同一份 `dist` 两次测量 Astro 侧分别是
**10369 与 12419（差 2050px）**，`post-header` 在 **542 / 132** 之间跳——
后者是封面图还没被懒加载触发。

根因是我两个诊断脚本都按"静态站不需要水合"给本地只留了
700ms / 1200s，线上留 4500ms。但**Astro 站同样有 Mermaid、灯箱、
代码块折叠等异步渲染**，"静态站 = 同步渲染完"是个错误直觉。
两个脚本已改成两侧一律等 4500ms。

> 代价：compare-dom-live 每页多等约 4 秒，全量 8 页多花半分钟。
> 换来的是数字不再飘——**不能信的测量比没有测量更费时间**。
## 50. 同一个坑的第三次：封面图 547px 变 3355px（2026-10-02 05:00 - 05:15）

### 50.1 定位链

逐区块实测把文章页的偏差钉死在一个元素上：

| 元素 | Nuxt | Astro | 差 |
| --- | --- | --- | --- |
| **div.post-header.has-cover** | 547 | **3355** | **+2808** |
| div.md-excerpt | 126 | 148 | +22 |
| article.article.md-tech | 8737 | 8709 | **-28** ✓ |
| div.post-footer | 269 | 269 | 0 ✓ |
| section.z-comment | 427 | 427 | 0 ✓ |

正文只差 28px（基本对齐），**全部偏差来自文章头图虚高 6 倍**。

### 50.2 根因：又是 scoped 跨组件，这次是 `.post-cover`

两侧的 CSS 规则**逐字相同**（`width:100%; height:auto; aspect-ratio:16/9`
+ `>img{width:100%;height:100%;object-fit:cover}`），`<img>` 也都**没有**
`width`/`height` 属性——所以逐条比对 CSS 完全看不出问题。

差别在**产物里的 scope id**：

```
Nuxt : <figure class="image post-cover" data-v-33b9aef5 data-v-bb6a4939>   ← 两个 id
Astro: <figure class="image post-cover" data-astro-cid-dy6iz5vj>            ← 只有 Pic 的
```

Vue 的 scoped CSS 有一条机制：**子组件的根元素会同时带上父组件的 scope id**，
所以 `PostHeader` 里的 `.post-cover[data-v-33b9aef5]` 匹配得上。
**Astro 没有这条机制**——`figure` 由 `Pic.astro` 渲染，只带 `Pic` 自己的 cid，
于是规则编译成 `.post-cover[data-astro-cid-5kfkgu4y]` 后**永不匹配**。

`aspect-ratio` 与 `>img{height:100%}` 整组失效后，封面图退回按原始像素渲染。

修法：`:global(.post-cover)`。build 后规则变为 `.post-cover{…}`（无 cid 后缀），
实测高度 **3355 → 542**，线上是 547。

> 至此同一个坑出现三次：§47.3 页脚 `:global(#blog-root) > .blog-footer`、
> §49 三处嵌套 `<main>`、以及这次的 `.post-cover`。
> **判据统一为：凡是要作用于「不是本组件模板里那个元素」的选择器，就得整体 global。**

### 50.3 `scripts/audit-scope-crossing.mjs`：想自动扫出来，但两版都误报

想把这个坑一次性扫干净。写了检查器，**两版判据都是废的**：

1. 第一版取"模板里第一个带 class 的元素"当根元素 →
   `SkipToContent` 的 `active` 被当成根 class，全站 `&.active` 全误报（45 处）。
2. 第二版改成只认 `<Component class="…">`（大写标签）→ 降到 19 处，
   但正则 `[\s\S]{0,300}?` **会跨标签边界**，把后续某个元素的 class
   误安到组件标签头上，于是 `.title` / `.content` / `.date` 这些
   通用 class 全被误报。**仍然一处真的都没有。**

正确判据必须**真正解析属性归属**（只取属于该标签自身的 class），
而不是正则扫字符串。工具没到位之前，它给出的 19 条**一条都不能当真**。

> 误报的检查和没有检查一样有害——甚至更坏：
> 它会让人以为"已经扫过了"。**先验证检查器本身能不能抓到已知的真问题**
> （本例应该是 `post-cover`），再去相信它的结论。
### 50.4 自动化这个坑：源码推断两版都是废的，产物验证才可靠

想一次性扫干净同类问题。写了 `audit-scope-crossing.mjs`（从源码推断），
**两版判据都不可用**：

| 版本 | 判据 | 结果 |
| --- | --- | --- |
| 1 | 模板里第一个带 class 的元素 = 组件根 | 45 处，`SkipToContent` 的 `active` 被当成根 class，全站 `&.active` 全误报 |
| 2 | 只认 `<Component class="…">`（大写标签） | 19 处，但正则 `[\s\S]{0,300}?` **跨标签边界**，把后续元素的 class 误安到组件标签头上，`.title`/`.content`/`.date` 全误报 |

第二版还暴露了一个**判据逻辑错误**：`post-cover` 恰恰是**同文件**的情况
（`PostHeader` 把 class 传给 `<Pic>`，再在同一文件里写样式），
而我用"排除本组件自己的 roots"把它滤掉了。

**真正可靠的是在产物上验**——`audit-dead-scope.mjs`：

1. 扫全部 HTML，收集真实存在的 `(class, data-astro-cid)` 组合；
2. 扫全部 CSS 的 `.X[data-astro-cid-Y] { … }`；
3. 若 `(X, Y)` 不存在、而 `X` 存在于别的 cid 上 → **规则永不匹配**。

它不猜、不推断，只读浏览器真正会看到的东西。
结果 **6 处，零误报**（已修好的 `post-cover` 确实不在列表里，判据自洽）。

| 死规则 | 现象 |
| --- | --- |
| `.blog-header[cid]` | `BlogHeader` 的根 class 规则整体失效 |
| `&>.collection-icon[cid]` / `&>.chevron[cid]` | `Collection.astro` 经 `<Icon class>` 传下去的 class 够不着 |
| `.ai-gpt-icon[cid]` | `Excerpt.astro:59` 同上 |
| `&>.iconify[cid]` ×2 | `Icon` 的根是 astro-icon 包的组件，带的是它自己的 cid |
| `.active[cid]` | 待定位 |

修法都是 `:global(...)`，但那会把选择器放宽到全站，**每处都要先对线上核一遍视觉影响**，
不适合批量改。故先把**数量钉进验收门禁**（`$knownDeadScope = 6`），
新增一条死规则就让验收红，悄悄修掉一条则降低基线——**它是棘轮，不是橡皮章**。

> 三条通用教训：
> ① 判据要先用**已知真问题**验证能抓到，再相信它的"无发现"；
> ② **源码推断会跨边界误归属，产物验证不会**；
> ③ 修复扩大选择器作用域的 bug 时，**基线数字要钉住**，否则"悄悄修好"和"没查"无法区分。
### 50.5 修一处验证方法：6 → 5，检查器判据也跟着修了一处

先挑 class 名唯一、全站只此一处使用的那条（`Excerpt.astro` 的 `.ai-gpt-icon`）
下手，改成 `:global()`，build 后重扫：**6 → 5**。
一条规则少一条、检查器跟着降一，说明**判据正确、修法正确**。

但这一步同时暴露了检查器自己的一个缺陷：我原打算用
`&:global(.iconify)` 这种**父选择器保持 scoped、只放开子元素**的写法
（特异性高、影响面比整体 `:global()` 小得多），
而检查器要求"每个 class+cid 都配对"，会把这种**正确**的修法误报成死规则——
等于在逼人用更宽的选择器。

改成按 CSS 真实语义判：**一条规则只要有一个 class+cid 锚点存在就可能匹配**。
scoped 本来就只需要一个锚点元素，整条规则就命中了。

并给检查器补了自检，三种情形各一条：

| 情形 | 期望 | 结果 |
| --- | --- | --- |
| 死规则（class 存在但 cid 对不上） | 报出 | ✓ |
| `父锚点 + :global 子元素` 的正确修法 | **放过** | ✓ |
| 死 CSS（class 压根不存在） | 不报（归 check-dead-css） | ✓ |

自检第一次也失败了，原因是**样本自己写错**：把样本 (a) 的 class 在
`live`/`cidsOf` 里都没登记，而末步要求"该 class 在别的 cid 上存在"，
它压根不存在就被跳过了。**样本没构造出真正的死规则，判据当然抓不到。**

> 自检的价值就在这：它把"我的判据对不对"从信念变成了可执行的一行。
> 而**自检失败时先怀疑样本**——连续三次都是样本或判据的某一半写错，
> 没有一次是"就这样吧"。
### 50.6 死规则 6 → 2，以及挖出的组件冗余

按「父锚点保持 scoped、只 `:global()` 子元素」的写法逐个修：

| 处 | 修法 | 死规则 |
| --- | --- | --- |
| `Excerpt` `.ai-gpt-icon` | `:global(.ai-gpt-icon)` | 6 → 5 |
| `Collection` `> .collection-icon` / `> .chevron` | `> :global(…)` | 5 → 3 |
| `PostSurround` `> .iconify` ×2 | `> :global(.iconify)` | 3 → 2 |
| `blog/BlogHeader` `.blog-header` | `:global(.blog-header)` | 仍 2（见下） |

**验证手法**：把两侧 `<style>` 剥掉注释、空白、`:global()` 后**逐字符比对**。
Collection 改完后与 Nuxt 侧只差 8 个字符——`<style>` vs `<style scoped>`，其余完全一致。
这个手法能精确回答"除了预期改动外有没有别的损失"，
而单看 build 是否成功回答不了（我中途就误删过 4 条规则，是它抓出来的）。

**剩 2 条，其中一条挖出组件冗余**：

```
src/components/blog/BlogHeader.astro   ← index.astro / link.astro / BlogSidebar.astro 用
src/components/BlogHeader.astro        ← content-components.ts（MDX ::blog-header）用
```

**两个同名同职责的组件并存。** 产物里所有 `.blog-header` 元素的 cid 都是**调用方**的
（`cgl6nrfz`），说明后者那个静态 `<span>` 版本**根本没被渲染**，
但它的 CSS 仍随 import 打进产物——于是 `.blog-header[data-astro-cid-3mf7hpah]`
成了永不匹配的死规则。

`blog/BlogHeader.astro` 那条我已修：它的根是**动态标签**
（`const Target = to === undefined ? 'span' : 'a'`），Astro 在编译期无法给
动态标签加 scope，而 Vue 的 `<component :is>` 在运行时会补上——
所以线上那个 `<a>` 带**两个** `data-v`，Astro 侧只有一个。

**待办**：把两个 BlogHeader 合并成一个（`blog/` 那份是多数调用方在用的），
顺带清掉随之而来的死 CSS。合并要动 MDX 组件映射与 `blog/BlogSidebar.astro`，
不是纯样式改动，故留作独立一轮。

> 另有一条 `.active[cid 66nxmncj]`（来自 `blog-search` 的嵌套规则）尚未定位到源头，
> 一并留给下一轮。
### 50.7 第七次"门禁自己骗人"：`Step` 的 note 过滤吞掉了 WARN

接上：把 `audit-dead-scope` 塞进 `acceptance.ps1` 后，第一次跑出来是
`scoped dead rules: 0`——**但单独跑同一个脚本明明报 2**。

原因在 `Step` 函数：

```powershell
$note = ($out | Where-Object { $_ -match 'RESULT|PASS:|passed|CONCLUSION|HAZARD|Complete!|page\(s\)|ACCEPTED' } | Select-Object -Last 1)
```

**`WARN: 2 处 scoped 死规则…` 一条关键字都不匹配 → `$note` 是空串 →
我的 `WARN:\s*(\d+)` 匹配失败 → `$deadCount` 停在初始值 0 → 门禁报绿。**

与 §46 记录的 `diff(undefined, undefined)` 是同一类：
**一个拿不到值就保持默认的计数器，等价于一个永远绿的门禁。**

改成不经过 `Step`，自己跑、自己解析输出、自己算 `$deadCount`，棘轮逻辑仍是
`$deadCount > $knownDeadScope → 红`。基线定为实测的 2。

顺带修掉 `Set-Content` 写出的 UTF-8 BOM（3 个非 ASCII 字节）。
`Set-Content -Encoding UTF8` 在 PS 5.1 会加 BOM，而无 BOM 的 `.ps1`
被按 ANSI 读时，**BOM 之后的中文注释可能吞掉换行、让下一条语句被静默跳过**——
本项目的 `.ps1` 一律用 `[IO.File]::WriteAllText(..., UTF8Encoding $false)` 写。

### 50.8 本轮终态

| 页面 | 页高差（Nuxt vs Astro） |
| --- | --- |
| `/archive` | **0** |
| `/about` | **0** |
| `/drive` | **0** |
| `/games/galgames/clannad` | **0** |
| `/` | +9 |
| `/link` | +8 |
| 文章页 | +35 |
| `/previews/example` | +304（robots noindex 演示页） |

**7/8 页面收敛到 0~35px**，验收 18/18 全绿，head 未接受差异 0，URL 集合 63=63。

`game` 从 -336 归零、文章页从 +355 降到 +35，都来自同一类修复：
`.post-cover`、`.collection-icon`、`.chevron`、`.iconify`、`.ai-gpt-icon`
——**class 经由子组件传下去时，父组件的 scoped 样式够不着**。
### 50.9 检查器的第四个判据缺陷，自检把它挖出来了

`blog-search` 那条"死规则"经查是**误报**：产物里
`<div class="blog-search" … data-astro-cid-66nxmncj>` 带着正确的 cid，规则是活的。
真凶是切规则的正则 `/([^{}]+)\{([^{}]*)\}/g` **不跟踪嵌套深度**——
Lightning CSS 输出的嵌套规则里，它会从一条规则的**声明中间**起匹配，
抓出 `opacity:.5;…;.active[cid] &` 这种以属性开头的假选择器。

改成按括号深度只取最外层。**但改完自检反而报 FAIL**——
`(a) 真死规则` 和 `(e)` 两条本该报出的被放过了。
继续查，发现边界切错了两次：一次把 `start` 指向 `{` **之后**（切出的是声明），
一次把 `start` 指向 `{` **本身**（切出来连声明带花括号一起）。
最终要分别记录**规则起点**与 **`{` 的位置**，切 `[ruleStart, braceAt)`。

> 这一段值得完整留着，因为它精确演示了**为什么"自检失败先怀疑工具"是对的**：
> 修好判据后，真实扫描立刻多报出 3 条**此前被漏掉的真死规则**。
> 判据坏着的时候，它报的是 PASS——**一个抓不到东西的检查器，
> 它的"没问题"是最危险的一种输出**。

自检现在 5 例全过，覆盖：真死规则、父锚点修法（须放过）、class 不存在（归
`check-dead-css`）、嵌套规则、真死规则（无其他锚点）。

### 50.10 组件冗余已合并；真实死规则基线 3

**`components/BlogHeader.astro` 的映射改指向 `components/blog/BlogHeader.astro`**
（后者 props 是超集：不传 `to` 时根元素同样是 `<span>`，行为一致）。
旧文件已无人引用，其样式不再进产物。

判据修好后扫出的真实死规则 **3 条**（基线已从 2 改为 3）：

| 死规则 | 备注 |
| --- | --- |
| `.tech-service[…] img, .tech-stack[…] img, .tech-stack[…] .dl-icon` | **BlogTech 的图标样式整组失效**（该组件本轮刚被改过） |
| `.search-input[…]` | `Tab.astro` 里经 `<SearchModal>` 传下去的 class |
| `.content[…]` | `PostFooter.astro` |

三条都留作下一轮：修法同上，都是 `:global()`，但需先核视觉影响。
### 50.11 死规则 3 → 1：只剩一条"条件未渲染"的假阳性

判据修好后扫出的 3 条真死规则，逐个修掉 2 条：

| 处 | 修法 | 说明 |
| --- | --- | --- |
| `Tab.astro` `.search-input` | `:global(.search-input)` | 照抄自 Nuxt Tab.vue 的 `:deep()` 语义（穿透组件边界样式化 SearchModal 的 input）。Astro 的 scoped 够不着；该 class 全站仅一个元素，无扩散 |
| `BlogTech.astro` `.tech-service` / `.tech-stack` | `:global(...) :global(img)` | **父级选择器自身也要 global**：它们是经 `<DlGroup class="…" />` 传给子组件的，元素带 DlGroup 的 cid。此前只放开后代不够，整组三条规则全失效——EdgeOne 那枚外链 favicon 因此没有 1.2em 约束、会按 32px 固有像素撑高整行 |

**剩 1 条不是同一类问题**：`PostFooter.astro` 的 `.content[cid 2z6spp2e]`。
产物里 `class="content"` **完全不存在**——那个 div 是条件渲染的，当前没渲染出来。
也就是说它既不是 scoped 失效、也不是"需要 global"，而是**目标元素此刻不存在**，
改了也无法验证。检查器把它报出来，是因为 `live` 收集会把多 class 元素
（`class="reference content"` 之类）拆词后算进来。

留作下一轮：要么给它加一个"该选择器目标在产物中完全不存在 → 归死 CSS"的分流，
要么找到会渲染出它的文章再判。**在能验证之前不动它**——这与本轮反复强调的
"改不动的东西先别改"是同一条。
## 51. 全站对比推翻抽样结论，并挖出 `hidden` 被作者样式压过（2026-10-02 06:20 - 08:00）

### 51.1 从抽样 8 页改成全站 63 页：29 → 13，但数字不可信

之前的"UI 已与 Nuxt 一致"只建立在 **8 页抽样**上。扩到全量 63 页后立刻冒出
29 项超容差，其中最大的几条在两次重跑之间**方向都变了**：

| 页面 | 第一跑 | 第二跑 | 第三跑（判据修好后） |
| --- | --- | --- | --- |
| `/about` | −2259 | **+1096** | **ok −29** |
| `/2025/08/kde-customization` | ok | **−1007** | **ok +4** |
| `/2025/05/fediverse` | ok −19 | **+1885** | **DIFF +1885** |

**同一份 dist、同一批页面，三次结果互相矛盾。** 这说明"页高"这个指标
在当前站点上**本身不可信**，不是差异清单变了。

### 51.2 真因：远程图片没有占位高度，页面高度跟着加载进度漂

站点的图片大量放在远程 CDN（`blog-files.101045700.xyz`、`imgheybox.*`、
`fastly.jsdelivr.net`…），而 CSS 只给 `max-width:100%; height:auto`，
**没有占位高度**（Nuxt 基线同样如此）。未加载完时图片高度是 0，
加载完跳到自然高度——两站的图片还来自不同主机（线上过 EdgeOne CDN，
本地是 localhost），漂移幅度自然不同。

修法（`compare-page-heights.mjs`）：
1. 等**所有 `<img>` 的 `decode()` 完成**再量（20 秒兜底，防单张坏图卡死）；
2. 每页**连测两遍**，不一致就标 `UNST` 并**排除出结论**——而不是把平均值当结果；
3. `scrollHeight` 恰好等于视口高时判定"未撑开"并重测（`/about` 曾因此假报 −2259，
   逐区块复测却是**两边完全一致、差 0**）。

> 这已经是同一类错误的第 N 次：**量测工具骗人时，症状长得最像真差异。**
> 唯一有效的对策是给量测本身加自检与"不可信"出口。

### 51.3 真差异：`hidden` 属性被作者级 `display` 压过

剔除 UNST 后最大的真差异是 `/2025/05/fediverse` 的 **+1885px**，逐区块定位到
`article.article` 虚高 **2036px**（34 个段落 × 约 60px）。

顺着数元素发现：两边 `img` / `figure` / `div` / `p` 几乎完全一致
（5/5、5/5、2/2、34/34），只有 **`svg`：Astro 35 个、线上 0 个**。
（线上 `@nuxt/icon` 不内联 SVG，由客户端注入，所以静态产物里一个都没有。）

看这 35 个 SVG 的宿主：

```html
<button class="paragraph-quote-btn" data-paragraph-quote hidden><svg width="1em" …>
```

**它带着 `hidden` 属性**，本该完全不占布局。但 `prose.css` 给
`.paragraph-quote-btn` 设了 **`display: inline-flex`**——**作者级样式
压过 UA 的 `[hidden] { display: none }`**，于是那 34 个隐藏按钮一直占位可见。

`prose.ts:572` 在构建期给每段插入这个按钮，`prose-enhance.ts` 只在
「评论区存在 + 桌面指针设备」时才 `removeAttribute('hidden')`。
线上 Nuxt 侧走的是「运行时插入 / 不插入」，静态产物里不该留下任何占位。

修法：给该规则补 `&[hidden] { display: none; }`（特异性高于外层的
`display:inline-flex`）。产物已确认生成 `&>.paragraph-quote-btn{…&[hidden]{display:none}}`。

**这与 §32 记录的「`hidden` 被作者级 `display` 压过」是同一类问题，
只是当时只修了归档页那一处。** 全站扫了一遍带 `hidden` 的元素共 5 处
（`BlogAside` / `BlogSidebar` / `Tab` ×2 / `prose.ts`），
只有 `prose.css` 这一处存在冲突——`Tab.astro` 的 `.tab-panel` 根本没有
自己的 display 规则，所以没有同类问题。

### 51.4 一条被误判的"发现"

排查中我一度以为「合并两个 BlogHeader 没生效」，依据是**每篇文章恰好多 2 张
`<img>`**。查下来是 `ShareModal` 的二维码 img（`data-share-qr hidden`）和
灯箱的 `data-lightbox-img`——两个**隐藏浮层**，线上文章页同样有、首页没有，
而且**在 Astro 侧每页恒定**。恒定元素不可能造成 −1007 或 +1374 的差值。
**合并其实是生效的**（产物里只有 1 个 `blog-header`，映射已全指向 `blog/` 那份）。

> 又一次：**在定位真因之前，先排除"这个信号其实与现象无关"。**
## 52. 换一个量法：断网对比器，以及它自己踩的 5 个坑（2026-10-02 08:00 - 09:10）

§51 的结论是「页高这个指标在当前站点**本身不可信**」。但真正的问题不在指标，
在于**两侧的实验条件不对称**：图片与字体全在远程 CDN，且没有占位高度，
而基线跑在 EdgeOne CDN 上、候选跑在 localhost——延迟不同、加载时序不同。
于是「站点差异」和「网络运气」混在同一个数字里，谁也分不开。

### 52.1 做法

给 Chrome 加一条规则，把**除 `localhost` 与基线域名以外的所有域名**解析到
`~NOTFOUND`：

    --host-resolver-rules=EXCLUDE localhost,EXCLUDE 127.0.0.1,EXCLUDE blog.sotkg.com,MAP * ~NOTFOUND

两侧于是都拿不到远程字体 / 图片 / Twikoo，页面只剩本站自己的 DOM + CSS。
**剩下的差值必然来自标记或样式，而不是网络运气。**

这不是把问题藏起来，是把测量前提固定住。它也**不覆盖**远程字体/图片/评论在
真实网络下的行为——那部分由 `compare-page-heights.mjs`（live 模式）与
`live:*` 门禁负责。两个门禁职责不重叠，合起来才叫「与原 Nuxt 一致」。

新工具：`astro-site/scripts/compare-ui-parity.mjs`（含 `--sel=` 节点级下钻）。

### 52.2 自检先行的代价：工具自己错了 5 次

照例先写自检，回报是**判据本身**先崩了五次。逐条记下来，因为它们全部属于
「拿不到值 / 判据有洞 → 输出一个看起来很专业的错数字」：

| # | 缺陷 | 后果 | 自检怎么抓到的 |
| --- | --- | --- | --- |
| 1 | `EXCLUDE` 顺序 / 漏掉基线域名 | 规则把 `blog.sotkg.com` 一起打死，基线返回 Nuxt 自己的错误页（`#main-message`，高 1000px）。**每一页都报「差 1615px」，全部是假的**，而工具跑得好好的 | 跨域 fetch 自检返回 `BLOCKED`（通过），但页面自检发现 `#blog-root` 不存在 |
| 2 | 没做「基线是正常页面」断言 | 同上，错误页被当成基线继续算差 | 同上 |
| 3 | 剥 frontmatter 后取下标、回原文切片 | 偏移量少了一截 frontmatter 长度，抓出来的「CSS」其实是模板 + 脚本 → **62 处误报** | 真数据第一次运行就炸 |
| 4 | 没抹掉注释与字符串 | `/* } { ; */`、`content: "};"` 被当成结构 | 自检用例 5 |
| 5 | 自检通过条件写错 | 期望报错的用例因 `clean=false` 被判失败 | 自检本身 |

另有一条是判据逻辑漏洞：**顶层自定义属性（`--x: 1;`）是合法 CSS**，
被当成裸声明误报，由新增的自检用例抓到。

> 62 处误报值得单独记一笔：它说明**判据在真数据上第一次运行时还没被真正验证过**。
> 这不是「工具不好用」，是「没验证的判据不能用来下结论」。

### 52.3 顺手挖出来的东西

**`Tab.astro` 的 `<style>` 少了一整行选择器。** 它现在长这样：

    <style>
    	position: revert !important;
    }

`.float-in-leave-active {` 那一行不见了——某次批量改写把它连同前一条规则的
花括号一起吃掉了。后果不是编译报错：Astro 把这段原样塞进产物，浏览器的 CSS
解析器在顶层遇到裸声明会「跳过到下一个 `}`」，于是

- `.float-in-leave-active`（含它的 `position: revert`）**静默消失**
- 紧接着的 `.center { … }` **侥幸活下来**（错误恢复刚好在它之前闭合）

**构建全绿、页面大体正常、只有一条规则悄悄失效。** 与 §47 记录的
`link.astro:39` 是同一类损坏。

为此新建 `astro-site/scripts/audit-css-blocks.mjs`：8 例自检（含上面这段真实
损坏）先跑，全过才允许输出结论。首次运行报 1 处损坏（即 `Tab.astro`）、
5 个文件带 BOM。判据：顶层出现裸声明（排除 `--` 自定义属性）、花括号不配对。

**`link.astro` 里还留着一条写于组件落地之前的全局覆盖。**

    .z-comment { margin: 2em 1em; }   /* 组件已自带 margin: 3rem 1rem */

`<style>` 没写 scoped，这条规则会把 `Comment.astro` 自己的外边距顶掉。
因为边距与相邻块合并，**页高差恰好被抵消成 0，肉眼与页高对比都看不出来**——
典型的「指标测不到，但确实错了」。已删。同一处的注释还写着
「随组件一起待移植」，而组件早就落地了；一并更正。

### 52.4 `/link` 天然不可比

`app.config.ts` 里 `link.randomInGroup: true`，而 FeedGroup 两侧都是**挂载后**
打乱组内顺序（Nuxt `onMounted` / Astro 原生脚本）。于是 `/link` 每次打开的
卡片顺序都不同——实测同一页两次量到的第一张 `.feed-card` 分别是
「南栀 / Space」和「陈郑逸 / 领域」。

这不是缺陷，是设计；但它让 `/link` 的内容顺序**天然不可比**。好在两侧实现了
同一个逃生口：

- Nuxt：`route.query.shuffle !== 'false'`
- Astro：`new URLSearchParams(location.search).get('shuffle') !== 'false'`

对比器因此默认给两侧都加 `?shuffle=false`，把顺序钉回配置顺序。

### 52.5 断网后立刻见真章：`z-comment` 的 345px 是假的

§44 记的「`section.z-comment` 427 vs 82（+345）」在多页反复出现，一度被当成
系统性问题。断网后同一区块是 **82 vs 82，d=0**。

真因：断网前 Twikoo 只在**一侧**加载成功（远程 `twikoo.sotkg.com`），
渲染出的评论表单把高度从 82px 撑到 427px。两侧主机不同、时序不同，
所以「哪一侧加载成功」是随机的。**和 UI 实现无关。**

> 这是本轮最值钱的一条：**同一个数字，换一个可证伪的实验条件就完全变样。**
> §51 把 19 页判为 UNST 时是对的（拿不到结论就别下结论），
> 但「不下结论」不等于「停在这里」——换一个能出结论的条件继续。

### 52.6 `/link` 剩下的 8px：内联行盒，不是组件差异

- `div.link-tab` 274 vs `div.tab-panel` 266
- 逐层量到最后：`.copy` 全部 34px、`code.copy` 外边距两侧都是 `8px/8px`、
  `.feed-card` 盒模型两侧**完全一致**（h=56 w=604 margin=0 display=inline）
- 唯一差异：FeedCard 包裹 `span` 与第一个 `.copy` 之间的间距 **Nuxt 16 / Astro 8**

包裹 span 是 `display:inline`，它与后面的块级 `.copy` 之间**不发生外边距合并**，
间距由**行盒**决定——而 Astro 在这个位置多插了一个 `<script>`（组件脚本被
去重后挂在首次出现处）。**已定位，未修**：全站 63 页跑完后按量级统一排序处理，
不值得为 0.4% 单独开一轮。
## 53. 断网对比器的第一批战果：4 个真缺陷 + 1 个被证伪的结论（2026-10-02 08:40 - 09:30）

§52 把测量条件钉住之后，全站 63 页第一次给出**可信**数字：
22 ok / 35 DIFF / 6 UNST。逐条定位下来，35 条里绝大部分归到 4 个成因。

### 53.1 `PostSurround` 的 `.date` 漏了 `:global()`（影响每一篇文章）

`.surround-link` 线上 41px / Astro 32px。逐层量到 `.surround-text` 是 41 vs 23。

根因：`PostSurround.astro` 写

    > .surround-text {
        > .date { display: block; … }
    }

`.date` 是经 `<UtilDate class="date" />` 传给**子组件**的，`<time>` 由 UtilDate 渲染、
带的是它自己的 cid，这条规则永不匹配。**同一条规则块里往下两行的
`> :global(.iconify)` 是对的**——同一个组件边界，浅一层就被想到了，深一层漏了。

后果比想象的大：日期不再独占一行 → `.surround-text` 矮 18px、**链接宽了 116px**
→ 本来一行放得下的上下篇被挤成两行 → `.surround-post` 41px 变 80px。
全站清单里那些 `−19` 与 `+39` **全部是这一个 bug**。

修完实测：99 vs 99（两行）与 41 vs 41（一行）都归零。

### 53.2 审计器自己有个洞，正好把这个 bug 放了进来

`audit-dead-scope.mjs` 原本只扫 depth 0 的规则。而 Astro/Lightning CSS **保留原生嵌套**：

    .surround-link[cid] { … > .surround-text[cid] { … > .date[cid] { … } } }

外层 `.surround-link` 的 class 存在且 cid 对得上 → 判为「活的」→ **整条链被跳过**，
里面的 `.date[cid]` 从来没被检查过。

> **「外层活着」不等于「里面的选择器也活着」，而组件边界恰恰出现在嵌套最深处。**

改成递归扫描后立刻多出 2 处，都查实不是缺陷：Collection 的样式（按用户决定关掉
组件后自然不再渲染）、SearchModal 的 `.search-item.active`（脚本在键盘导航时
运行时切换，静态产物里不可能有）。棘轮基线 1 → 3，逐条写明理由。

自检从 5 例加到 7 例，并且**真的拦下了我两次写错的递归实现**（只推进 `{}` 不推进
`;`，取出来的嵌套选择器被上一条声明粘住）。

### 53.3 代码块的 `wrap` 类从来没挂上去

`prose.ts` 里 `hasWrapMeta` 只被拿去拼按钮文字（`横向滚动` / `自动换行`），
**从没给 `pre` 加过 `wrap` 类**。按钮显示得对，行为没跟上：
线上 `white-space: pre-wrap`、Astro 侧 `pre`。
Nuxt 那边是 `ProsePre.vue:96` 的 `:class="[props.class, { wrap: isWrap }]"`。

### 53.4 `.shiki` 不该自带 `color`——一个可证伪的实验

样式门禁报出 `.article pre` 的 color：线上 `rgb(230,230,230)`、Astro `rgb(76,79,105)`，
而两侧 `background-color` **完全相同**。这两个事实不自洽——
近白色文字意味着深色背景，可背景既然相同就该两边都深。

我先猜了两轮都没结论，于是把它做成一个**可证伪的实验**而不是继续推理：

- `rgb(76,79,105)` 正好是 Astro 的 `--shiki-light`（catppuccin-latte 前景）
- `main.css:170-179` 只给 **token（span）** 写了 `.dark` 覆盖，
  `.shiki` **元素本身**没有任何深色覆盖——而 Nuxt 根本不需要，因为它的
  ProsePre 在运行时由 plain-shiki 直接写内联 `color`

于是假设：Nuxt 的 `pre` **压根没有自己的颜色**，是继承来的正文色；
而 Astro 无条件套了 `--shiki-light`。做法是删掉 `.shiki` 的 `color`
（保留 token 的 span 规则），让 `pre` 继承。结果：该页样式差异 **12 → 4**，
`pre` 的 color 差异**全部消失**。假设成立。

> 这是本轮最值得记的方法：**当两个测量值在逻辑上不自洽时，不要调和它们，
> 去找一个能同时证伪两个解释的实验。**

顺带删掉 `border-radius: inherit`（Nuxt 的 `pre` 规则里没有这条，实测 6.8px vs 0），
但**保留**了相邻的 `background-color: transparent`——那条不是多余的改动，
正是它让两侧背景一致，删了反而会让 Astro 显示自己的浅色背景。

### 53.5 一次差点把方向读反的自造工具输出

区块对照把「Nuxt 缺这个块」标成了「仅线上有」。方向正好反了：
`nb` 缺失 = 线上没有 = **只有 Astro 有**。差点把「Astro 多渲染了 249px」
读成「线上多渲染了」。工具把话说错，比不说更贵。

同时修掉的三处测量缺陷：

- **按下标配对**：一侧多一个元素，后面全部错位，一行差异把整张表推歪
- **只按类名配对**：Nuxt 水合后给段落加 `has-quote-button`，同名段落落进两个分组，
  一口气炸出几十条并不存在的差异。改按**文本**配对，类名差异单独显示
- **定点下钻覆盖全站结果**：输出名带上页数，否则查一个区块就把 63 页的权威结果冲掉

### 53.6 我自己造成的一次事故

清理孤儿进程时我写了 `taskkill` 遍历**所有** chrome PID——那会把用户自己的浏览器
一起杀掉。用户浏览器当时还活着，但标签页可能因此重载。

脚本现在只杀自己 spawn 出来的 PID 树，并且挂了 `uncaughtException` /
`unhandledRejection` / `SIGINT` 兜底：之前只在正常路径末尾清理，
中途抛一次异常就留下 preview 服务 + headless Chrome 占着端口，
下一次运行还会连到上一次的残留实例，报出与本次改动毫无关系的错。

### 53.7 一条自造的证据，以及它推翻的东西

先前判断「生产没有保留 `## 相关条目`」，依据是
`Invoke-WebRequest` 取到的 HTML 里搜不到这四个字。**那是 UTF-8 被按 ANSI 解码了**，
中文全成了乱码，自然搜不到。显式 `UTF8.GetString` 之后：生产**有**这个标题。

后果不小：`content/` 下 5 篇文章有未提交的本地改动（删掉该标题与一个 `::bgm-card`），
生产没有。这 5 页会一直报假差异，而且占了剩余差异里最大的一块。
用户决定提交并部署让生产追平。

> 又是同一类错误：**「我搜到了」不等于「它不存在」**，尤其在编码可能出错的场合。
> 这一轮里，中文乱码、UTF-8 BOM、CSS 嵌套深度，三次都是同一类：
> **工具的观测能力被高估了，而高估观测的工具比没有工具更危险。**
## 54. 一个「防重复」的守卫，杀掉了整个功能（2026-10-02 09:30 - 11:15）

### 54.1 全站 `−29px`：一个 bug 拆成两个后果

§53 结束时剩下 9 个页面**恰好**都差 `-29px`。这种「整齐的常数」几乎总是同一个
成因，而且通常不是布局。

定位过程（这次每一步都有证据，不是推理）：

1. 逐区块量：差值全落在 `article.article`，页头/页脚/侧栏/上下篇/评论区全是 0。
2. 逐子节点量：**全部一致**，文本长度也全部一致——却仍然差 29。
   > 这里我栽了一次：当时只看了输出里的**前 16 行**，而前 16 行恰好都是 `d=0`，
   > 于是下了「末子节点外边距塌陷」的结论。改用「过滤出所有非 0 行」之后，
   > 真正的差异立刻出现：某段 `58px vs 29px`，文本 44 字、位置 topΔ=0。
3. 同宽同字却多一行 → 只能有**强制换行**或**可用宽度被占**。
   回到源文件：markdown 里那一行没有任何尾随空格或反斜杠（按字节查过）。
4. 再回到产物：Nuxt 的 `<p>` 在 SSR 里**没有**按钮、按钮是运行时创建的；
   Astro 的 `<p>` 里**已经带着**按钮且带 `hidden`。
5. 顺着查到 `ProseP.vue:61-63`：

       &.has-quote-button { padding-inline-end: 1.8em; }

   Nuxt 在「评论区存在 + 桌面指针」时给段落加 `has-quote-button`，
   右侧留出 1.8em 给引用按钮。Astro 的 CSS 里这条**一模一样**，
   但类名永远加不上——因为 `prose-enhance.ts` 里有这么一句：

       if (p.querySelector(':scope > .paragraph-quote-btn')) continue

   这个「已经有按钮就跳过」的防重复守卫是照着 Nuxt 的直觉写的，
   但两边的按钮来源根本不同：

   | | 按钮来源 | 需要防重复吗 |
   | --- | --- | --- |
   | Nuxt | `ProseP.vue` 在 `onMounted` 里 `v-if` **创建** | 需要 |
   | Astro | `plugins/prose.ts` 在**构建期**写进静态 HTML | 不需要 |

   于是这个判断在 Astro 侧**对每一段都为真**，`continue` 掉了全部段落，后果是两条：

   - `has-quote-button` 永远不加 → `padding-inline-end: 1.8em` 永远不生效
     → 右侧不留位 → **恰好排满一行的段落会少一行**（这就是那 9 个页面的 −29）；
   - `hidden` 永远不摘 → 按钮始终 `display:none`
     → **「引用整段到评论区」这个功能在 Astro 侧等于没有**。

   也就是说，这不是一个排版偏差，是**一个功能整体失效**，只是恰好先以「差 29px」
   的形式露出来。如果只按页高差去查，永远查不到「按钮不见了」这一层。

修法：类名照加、`hidden` 照摘，只在**真的缺按钮**时补一个。
三页实测从 `-29` 变成 **0 / 0 / 0**。

### 54.2 另一个来源完全不同的 `+23px`：打字机动画

修完上面那条，`+22/+23` 又在 7 个页面上整齐地冒出来。逐层量到智能摘要时，
探针给出 `字数 59/67`——文本长度不一致。

**但两边其实一个字都不差。** `Excerpt.vue` 的摘要是打字机动画，50ms 一个字符；
67 个字要打 3.35 秒，而量测只等 2.5 秒，于是**量到的是「才打了 59 个字」的中间态**，
对面 Astro 是一次性输出的 67 字。

这不是站点差异，是**量测时刻的差异**——和 §52 的远程图片时序同一类，
只是这次藏在客户端动画里。处置方式是给 Chrome 加
`--force-prefers-reduced-motion`：两侧都跳过入场动画、直接呈现终态。
`/2025/08/kde-customization` 从 `+23` 变成 **0**。

> 同一个「量测时机不对」的错误，这已经是第三次换个马甲出现：
> 远程图片时序（§52）、Twikoo 单侧加载（§52）、打字机动画（本节）。
> **一个指标要可信，必须先证明它量的不是「还没长完」。**

### 54.3 三次把「工具报错」当成了「站点有 bug」

这一节记的是我自己。三次都是**门禁/脚本报错**，我却先怀疑站点：

1. `live:ui-parity` 与 `live:style-parity` 双双 `FAIL: preview never came up`。
   第一反应：这两道门禁被放在了 `check-build-warnings` 之后的「不可靠窗口」里
   （文件里确实写了这个约束）。于是把 live 门禁挪到前面——**重跑，一样失败**。
2. 真因是 Astro 7.x 的 `astro preview` 自带一份**跨端口**的运行中服务器登记表，
   端口空着、进程死了，登记还在；新起的 preview 直接被拒。
   先试 `--force`——**不管用**；最后老老实实 `astro preview stop`，才通。
3. 而这一切之所以浪费两轮，是因为 preview 是 `stdio: 'ignore'` 起的——
   它自己那句 `Run \`astro preview stop\` …` 被整个丢掉了，
   只剩一句没有任何线索的 `FAIL: preview never came up`。

> **报错必须带着证据一起出来。** 一个只说「失败了」不说「为什么失败」的工具，
> 会让人把工具的问题当成项目的问题去查——这一轮我为此多花了两轮返工。

### 54.4 进度

断网全站对比：**26 ok / 31 DIFF / 5 UNST → 38 ok / 22 DIFF / 2 UNST**
（另加 1 个用户拍板的 KNOWN 豁免）。两个系统性成因（引用按钮守卫、打字机动画）
合计清掉约 16 个页面的差异。

剩余 22 条里，最大的一部分来自 §53.7 记的**内容漂移**：
`takagi` / `clannad-zh-linux` / `gal-up` / `koichoco-psp` / `nukitashi-gv-end`
这 5 篇有未提交的本地改动，生产还没追上——用户决定提交并部署，
它们会在部署后自然消失，**因此不写进豁免清单**。
## 55. 一条注释里的假陈述，代价是 177px（2026-10-02 11:20 - 11:45）

### 55.1 注释声称的「与线上一致」，与产物对不上

`InfoCard.astro` 开头写着：

> 更关键的是：**当前线上这个组件本来就渲染成空**。
> 原组件的模板只有 loading / error / data 三个分支，而 `status` 初值是 `idle`，
> 数据从未到达过，三个分支一个都不命中，产出的就是一个空的 `<section class="info-card card">`。
> 因此这里的选择是**保持与线上一致**……

这段推理本身是自洽的，但它是从**源码的状态机初值**推出来的，没有核对产物。
实测（2026-10-02，页高对比 + 逐节点量）：

| | 线上 | Astro |
| --- | --- | --- |
| `section.info-card.card` | **59px**，显示「暂时无法加载条目信息」+「重新加载」 | **0px**（空壳） |

线上之所以进 `error` 分支，是因为原组件在 `onMounted` 里 fetch Bangumi API，
而模块已随 2026-09-30 的功能移除一起没了——请求必然失败。
**注释里「初值是 idle、三个分支都不命中」的前提，在真实运行时并不成立**：
那个 `idle` 是 SSR 期间的初值，客户端拿到的是失败。

代价：`piece-hy1`（×3）差 177px，`nukitashi-gv-end`（×5）差 295px。

> 又一次同一条教训：**源码注释不是证据，产物才是。**
> 这条注释写得很有把握、有推导过程，读起来比多数注释都可信——
> 恰恰是这种「看起来论证充分」的注释最危险，因为它让人不再去核对。

### 55.2 决定与处置

用户 2026-10-02 拍板：**不复刻那个坏掉的错误卡**，Astro 侧保持空壳。
理由充分——把一个「加载失败 + 点了也没用的重新加载按钮」摆回读者面前，
对两篇都提到 Bangumi 的文章没有任何好处。

处置：

1. 订正 `InfoCard.astro` 的注释：写进实测数字（59px / 0px / 两页各几张），
   并写明「不再复刻错误卡」是用户决定，而非「本来就一致」。
2. 两页写进 `compare-ui-parity.mjs` 的 `ACCEPTED` 豁免清单，**都带上限**：
   - `/2025/11/piece-hy1` 上限 **200px**（info-card 实占 177px，恰好覆盖）
   - `/2025/10/nukitashi-gv-end` 上限 **350px**（info-card 实占 295px）

第二条的上限是**刻意**留了余量的：这一页同时还有 §53.7 记的内容漂移
（生产仍保留「## 相关条目」，本地已删且未提交），当前总差 −731px，
**超过 350 → 门禁照红不误**。内容提交部署之后差值会降到 −295px，
自动落进豁免范围、门禁转绿。

也就是说：

- 已经拍板、且差异已被完全解释的部分 → 有上限地豁免；
- 还没处理的部分 → **不许被豁免盖住**。

实测验证：`piece-hy1` → `KNOWN`，`nukitashi-gv-end` → 仍 `DIFF`。正是设计意图。

### 55.3 进度

断网全站对比（本轮起）：

| | 26 ok | 31 DIFF | 5 UNST |
| --- | --- | --- | --- |

→ **49 ok / 13 DIFF / 0 UNST**，另加 3 条带上限的 KNOWN。

剩余 13 条里：4 条是等待用户提交部署的内容漂移、3 条是已知豁免、
剩 7 条小残差（8–35px）待查。
## 56. 最后一个系统性成因：解析器对「松散列表」的处理不同（2026-10-02 11:45 - 12:00）

### 56.1 症状与误导

剩下的残差是 `+26 / +35 / +17` 这种小而整齐的数。逐层量到文章内部后，
三个 `ul` 全部变高，且**逐个 `li` 的文本两侧都更长**（51/54、51/60、169/175）。

先做了两件无用功，都记下来：

1. 修 `plaintext → text`：Astro 的 shiki 把没标语言的围栏写成 `data-language="plaintext"`，
   Nuxt 写 `text`。这**是真差异**（产物文本确实不同），但 `.language` 是 `height: 0`，
   **不产生高度差**。修完之后 26px 一动不动。
2. 查 `info-card`、查引用按钮守卫——都不是这条线。

真正的原因在产物里：

    Nuxt : <ul><li>一台服务器（建议至少1c2g）并安装Docker和Docker Compose</li>…
    Astro: <ul><li><p class="prose-paragraph">一台服务器…<button class="paragraph-quote-btn" hidden>…</p></li>…

### 56.2 源文件里是空行分隔的列表

    - 一台服务器（建议至少1c2g）并安装Docker和Docker Compose
    <空行>
    - 一个域名，建议为顶级域名

按 CommonMark，列表项之间有空行就是 **loose list**，每个 `<li>` 的内容会被
包进 `<p>`。Astro 照做，**Nuxt Content 不做**——线上产物就是紧凑的 `<li>文本</li>`。

后果有两处，第二处比排版严重：

1. 多出来的 `<p>` 带自己的上下外边距，每个 `<li>` 变高；
2. `prose.ts` 会给**每个** `.prose-paragraph` 插入「引用整段到评论区」按钮，
   于是**列表项里也冒出了引用按钮**——线上没有。

修法：`prose.ts` 增加 `tightenLooseLists`，只在「该 `li` 的唯一元素子节点就是那一个
`<p>`」时拆包（内容本来就只是单独一段，拆掉不丢语义），且必须排在主 `walk` **之前**，
否则拆完的 `li` 还会被当成段落再补一个按钮。

实测：`docker-deploy-outline` +26 → **0**，`write-1panel-app` +35 → **0**，
`oyiso-tianligpt` +17 → **0**。

### 56.3 顺手修掉的两个产物文本差异

- `data-language="plaintext"` → 归一成 `text`（`buildCodeFigure` 里的 `?? 'text'`
  兜底从来没生效过，因为属性一直有值、只是值不对）。
- `prose.ts` 里那条 `/^\s*(`{3,}|~{3,})(.*)$/` 有多项式回溯风险，
  去掉尾部组改用 `slice`，语义不变、复杂度线性。

### 56.4 探针自己撒的谎：第三版配对

`/2024/08/docker-deploy-outline` 一次报出 **9 个「仅线上有」对 9 个「仅 Astro 有」**——
**完全对称**，这本身就说明元素两边都在、只是没配上，而不是 Astro 少了东西。
可工具把它当成了「Astro 缺 9 个」报出来。

两个错叠在一起：

1. 只按文本配对时，代码块图注首词是 `text`（Nuxt）vs `plaintext`（Astro），
   键对不上，两边各剩 9 个孤儿；
2. **pass 1 在没有对面元素时也把 nuxt 标记成已用**，于是那 9 个 nuxt 孤儿
   直接被吞掉、不再上报——最后只剩 astro 那 9 个，读起来就像「Astro 多渲染了东西」。

修法：两轮配对（文本 → 类名+顺序），且**只有真配上才标记 used**；
仍然配不上的明确打印为「未能配对」，并写明含义是**对不上，不是缺失**。

> 这是同一天第三次犯同一类错（§54.3、§55.1、此处）：
> **把工具的失败当成项目的差异**。
> 前两次是「报错没带证据」，这次更隐蔽——工具给出了**具体的、带数量的、
> 看起来非常像结论的**错误结论。数量对称这种线索本来一眼就能看出不对，
> 但前提是你注意到它是对称的。

### 56.5 仍未查清的一项

`/2025/10/lemmy-fediverse-deploy` 差 `-18px`，定位到一个 `yaml` 代码块：
394 vs 375，**文本长度两边都是 403 字、位置也一致**，差的正好是一个行高。
不是松散列表（该文无空行分隔的列表），文本一致，wrap 状态一致。
在预算内没有继续追，记为**有界未决项**：单页 18px（约 0.19%）。
## 57. 收敛：53/63，以及还剩什么（2026-10-02 12:00 - 12:30）

### 57.1 断网全站页高对比（本轮最终）

| | 会话开始 | 现在 |
| --- | --- | --- |
| 一致 ok | 22 | **53** |
| 超差 DIFF | 35 | **8** |
| 测量不稳定 UNST | 6 | **0** |
| 已接受 KNOWN（带上限） | 0 | **2** |

本轮清掉的成因，按贡献页数：

| 成因 | 页数 | 性质 |
| --- | --- | --- |
| `PostSurround` 的 `.date` 漏 `:global()` | 9 | 每篇文章都错，且**引用按钮功能整体失效** |
| 智能摘要打字机动画的量测时机 | 7 | 噪声，不是站点差异 |
| 松散列表被包进 `<p>` | 3 | 排版 + **列表项里冒出引用按钮** |
| `post-collection`（用户决定对齐） | 4 | 线上本来就从不渲染 |
| 代码块 `border-radius` / `wrap` / `.shiki` 颜色 | 多页 | 页高看不出来，颜色门禁抓到的 |

### 57.2 剩下的 8 条，逐条交代

**5 条等你提交部署**（§53.7 的内容漂移，不是代码问题）：
`nukitashi-gv-end` −731、`clannad-zh-linux` −82、`gal-up` −82、
`takagi` −82、`koichoco-psp` −81。后四条几乎同值，正是被删掉的
`## 相关条目` 标题（h2 43px + 上下外边距）。提交部署后自动消失，
因此**不写进豁免清单**。

**3 条有界残差**：
- `lemmy-fediverse-deploy` −18px：定位到一个 `yaml` 代码块，394 vs 375，
  文本长度两边都是 403 字、位置一致，差的正好是一个行高。该文无空行分隔的列表，
  不是 §56 那条。约 0.19%。
- `/` −9px 与 `/link` −8px：同一成因。`/link` 的 `.link-tab` 里，
  FeedCard 外层 `span` 与第一个 `code.copy` 的间距，线上 16 / Astro 8。
  外层 span 是 `display: inline` 且内含块级元素，差的是行盒半行距那一类
  inline formatting 细节。约 0.4%。

### 57.3 样式门禁的信号质量也修了一轮

全站跑下来 63 个页面**全部**报差异、共 295 条，看着像天塌了。聚合之后发现
252 条是同一件事：`count` 统计把**隐藏弹层**也算进去了。

| 条目 | 线上 | Astro | 是什么 |
| --- | --- | --- | --- |
| `.tip` | 0 | 1 | `<div class="tip" data-search-tip hidden>` |
| `.hide-above-mobile` | 1 | 2 | 搜索弹层的静态外壳 |
| `.button` | 1 | 2 | 评论区确认框的「访问」按钮 |

SSG 必然把弹层静态输出，Nuxt 是用到才渲染——**架构差异，不是缺陷**，而且都是
`hidden`，页面上看不见。改成**只比可见元素**（过滤 `hidden` / `aria-hidden` /
`display:none` / `visibility:hidden` / `opacity:0` / 无 client rect）之后：

    DIFF    1  /2024/10/write-1panel-app   (另有 3 处仅隐藏元素数量不同，不计)

每页从 4 条降到 **1 条**，真正的样式差异不再被噪声淹没。

剩下那 1 条是 `.gradient-card[1].text-align`：线上 `center` / Astro `start`，
即侧栏搜索按钮。**两边 CSS 里那条规则逐字节相同**（`.search-btn{…text-align:start…}`），
我没能定位到计算值为何不同，因此**不下结论**，记为有界未决。

### 57.4 这一轮最该记住的一条

四次「工具的失败被当成项目的差异」，一次比一次隐蔽：

1. 门禁报错没带证据 → 以为是执行顺序问题（§54.3，实际是 preview 服务器登记表）
2. 注释里的推理自洽但没核对产物 → 以为 info-card 线上渲染成空（§55.1）
3. 探针报「Astro 缺 9 个元素」→ 数字对称本身就是线索，我没看（§56.4）
4. 样式门禁报 252 条 → 全是隐藏外壳，真正的差异被埋在里面（§57.3）

共同点不是「工具不可靠」，而是**工具给出了看起来像结论的东西**。
判据只有一条：**结论必须能追到产生它的那条证据**，追不到就不写。
## 58. 最后一条样式差异：线上自己漏链了一个 CSS chunk（2026-10-02 12:30 - 13:00）

### 58.1 现象

样式门禁每页都报同一条：`.gradient-card[1].text-align`，线上 `center` / Astro `start`。
`[1]` 是侧栏的搜索按钮（`[0]` 是 skip-link，两侧都无差异）。

### 58.2 先排除掉所有「Astro 改错了」的可能

- 产物里 `.gradient-card` 都只有两个元素：skip-link 与搜索按钮，两侧一致；
- `.skip-link` 在门禁里没有任何差异 → 可见数一致 → 索引没错位，`[1]` 就是同一个按钮；
- 两边**编译产物里那条规则逐字节相同**：
  `.search-btn{opacity:.5;outline:…;text-align:start;cursor:text;…}`。

到这里看起来是「CSS 一样却算出不同值」，按理说不该发生。于是去查规则**是否真的被加载**。

### 58.3 真因：线上根本没加载包含这条规则的样式表

    nuxt html references 12 css files
    css files referenced AND containing .search-btn:  (NONE)

全站所有 `_astro`/`_nuxt` CSS 里，`.search-btn` 只出现在
**`/_nuxt/default.z4v_I5lo.css`**，而**页面从未引用这个 chunk**。
（同一文件里的 `.sidebar-footer` 也一样未被引用。）

于是线上那条 `text-align:start` 从未生效，按钮落回 UA 对 `<button>` 的默认
`text-align:center`。**Astro 按 Nuxt 源码如实应用，线上是因为构建漏链样式表才偏离。**

### 58.4 处置：记录在案，不改

与 §55 的 info-card 不同——那次是 Nuxt **源码逻辑本身**走到错误分支，
复刻它等于复刻一个功能缺陷；这次是 Nuxt **构建产物没送达**，
复刻它等于**故意让一条源码里明写的规则失效**。没有任何一种读法把这条算作「对齐」。

因此写进 `compare-ui-parity.mjs` 的 `STYLE_ACCEPTED`，带完整理由与证据。
样式门禁从「63 页全部报差异」变成：

    有差异的页面: 0 / 63
    已接受的差异（线上构建缺陷，用户/源码判定）: 1 类

> 顺带记一条给未来的切流：**线上侧栏搜索按钮的图标位置和 Astro 不一样**
> （线上居中、Astro 靠左）。这是线上构建的问题，不是迁移引入的；
> 修 Nuxt 构建（让 chunk 被引用）后两边自然一致。

### 58.5 这一轮的门禁最终形态

| 门禁 | 覆盖 | 状态 |
| --- | --- | --- |
| `audit-css-blocks.mjs` | CSS 块被改坏（选择器行丢失等） | 8 例自检 + 真实产物 |
| `audit-dead-scope.mjs` | 够不到任何元素的 scoped 规则（**递归**） | 7 例自检 + 棘轮 3 |
| `compare-ui-parity.mjs --mode=offline` | 全站 63 页页高，断网对照 | 53 ok / 8 DIFF / 2 KNOWN |
| `compare-ui-parity.mjs --styles` | 28 个计算样式属性 × 62 个选择器，**只比可见元素** | 0 DIFF / 1 已接受 |
| `acceptance.ps1` | 21 道，含上述前三项 + sitemap/head/warnings | 19/21 |

剩下的 8 条页高差异：5 条等用户提交部署（内容漂移），3 条为 8–18px 的有界残差。
## 59. 同一个错犯在第二个门禁上：按下标配对（2026-10-02 13:00 - 13:20）

### 59.1 症状

修完 §57 的「只比可见元素」之后，全站跑下来仍有 11/63 页报差异、共 35 条。
其中 `piece-hy1` 一页就占 15 条，全是段落样式：

    .article p [1].font-size      nuxt=12.96px  astro=16px
    .article p [1].text-indent    nuxt=0px      astro=32px
    .article p [1].color          nuxt=rgb(179,179,179) astro=rgb(230,230,230)

`text-indent` 一边 0 一边 32px（= 2em），像是两段完全不同的文字被当成了同一段。

### 59.2 真因：又是下标，不是元素

样式门禁和 §56 的页高探针一样，是**按可见元素的下标**逐个比样式。
而这一页线上有 **13 个**可见的 `.article p`、Astro 只有 **10 个**——
`[1]` 在两边根本不是同一段文字。

多出来的 3 个来自哪？正是 §55 已经拍板的那件事：
**线上每张加载失败的 info-card 里有一个 `<p class="info-card-error-text">`
（3 张 = 3 个 `p`），Astro 侧是空壳，没有这个 `p`。**

所以数量差本身是已知且已接受的；而数量差**之后**那一串样式差异，
纯粹是错位产生的噪声。

### 59.3 三处修法

1. **可见元素数量不同 → 不再逐项比样式**。数量差异上面已经单独报过了；
   在两个不等长的集合之间逐项比对，产出的只会是「把 A 段当 B 段」的假差异。
2. 数量相等时**按文本签名配对**（与 §56.4 的页高探针同一套做法）。
3. `.article p` 的数量差登记进 `STYLE_ACCEPTED`，理由指向 §55 的决定。

### 59.4 这已经是同一个错误的第四次

| # | 门禁/工具 | 表现 |
| --- | --- | --- |
| 1 | 页高探针 v1 | 按下标配对，一侧多一个元素 → 后面全错位 |
| 2 | 页高探针 v2 | 只按类名配对，运行时加的类把同一段拆进两组 |
| 3 | 页高探针 v3 | 只按文本配对 → 一次报出 9 对「单边缺失」 |
| 4 | **样式门禁** | 只按下标配对 → 报出 15 条根本不存在的段落样式差异 |

四次里有三次是**跨门禁复现同一处设计缺陷**：
按「元素在文档里的第几个」来配对两侧元素，而两侧的 DOM 本来就不保证一一对应
（SSR vs 水合、构建期插入 vs 运行时插入、`<!--[-->` 片段标记 vs `<script>`）。

> 教训：**一个已经踩过的坑，换个文件重写一遍就会再踩一次。**
> 判据应该沉淀成共享模块，而不是每个脚本各写一遍。
> 本轮的补救是让两个门禁的行为一致（按文本配对 + 数量不等不比），
> 但更彻底的做法是把配对逻辑抽成 `scripts/lib/pair.mjs` 供所有探针复用——
> 这条记在待办里，本轮没有做。
## 60. 样式门禁挖出的三个真缺陷：按钮全裸、轮播控件、侧栏提示（2026-10-02 13:20 - 14:00）

§59 修掉错位之后，全站样式差异从 35 条降到 19 条，剩下的一看就是**真差异**。
这一节记的是它们共同的那个成因——**迁移时把「用了公共组件的地方」降级成了裸元素**。

### 60.1 翻页 / 轮播按钮丢了底子（首页 + 归档页，肉眼可见）

Nuxt 的 `Pagination.vue:46,67` 与 `Slide.vue:65,73` 用的是 `<ZButton class="pagination-button …">`，
ZButton 渲染出来是：

    <button class="z-button button pagination-button rtl-flip" …>
      <div class="button-main"><svg/></div>
    </button>

Astro 的对应实现是手写的 `<button class="pagination-button rtl-flip">`。

差别不在 `.pagination-button`（它只负责把 border / border-radius / box-shadow 抹掉），
而在**被它抹掉的那一层**——`.button` 的底色、内边距、圆角、cursor、line-height
全都没了，图标也不在 `button-main` 的 flex 居中里。实测 Astro 产物里
`button-main` 计数从 0 变成 5，与线上一致（改前是 0）。

顺带纠正一个我差点又犯的错：查「Astro 产物里没有 `.button` 规则」时，
差点直接判成缺陷。**其实 `Button.astro` 的样式是被内联进 HTML 的**
（文章页 `<style>` 里就有），而首页当时根本没引用用到 Button 的页面——
所以那份 CSS 自然不产出。差点把「页面没用到」误判成「样式丢了」。
判缺陷之前必须先确认规则**本该**出现在那里。

### 60.2 侧栏 QQ 提示的字号 / 行高整条规则缺失

线上 `.tip[data-v-fe07b412]{font-size:.9em;line-height:2}`，Astro 侧压根没有这条规则。
根因还是那个跨组件边界：`CommGroup.vue` 的 **scoped** 规则作用在
`<Tip>` 子组件的根元素 `<span class="tip">` 上，靠的是 Vue 的
「子组件根元素同时带父 scope id」。Astro 没有这个机制，
而这里连规则都忘了写——于是用继承的 14.4px / 1.4 去顶替本该是 12.96px / 2 的值。

按既有写法补成 `:global(.tip)`，首页与归档页的 `.tip` 差异归零。

### 60.3 为什么这些缺陷会漏过前面那么多道门禁

页高门禁看不见它们：按钮与提示都在文档流内（或绝对定位），
少一层底色不改变盒子高度。样式门禁本该抓住，但 §57 之前它被 252 条
隐藏外壳噪声埋着，§59 又被错位噪声埋着。

> 三轮下来，**同一类缺陷被三道不同的机制依次挡住**：
> 页高门禁（对样式无感）→ 样式门禁（被数量噪声淹没）→ 错位（把真差异冲掉）。
> 每一层都得先把自己的假阳性清干净，下一层才看得见真问题。
> 这大概是「门禁要先自检」这件事最实在的理由。

### 60.4 最终样式结果

    有差异的页面: 0 / 2   （首页 / 归档页，抽验）

全站复跑数字见 §61。
## 61. 门禁抓到了我自己刚引入的死规则（2026-10-02 14:00 - 14:20）

### 61.1 把翻页/轮播按钮改走 `Button` 之后

§60 修了首页与归档页的按钮底子，跑完整套门禁，`audit-dead-scope` **当场变红**：

    _astro/index.bDJz14Rf.css | &>.pagination-button[data-astro-cid-4lhk3nrq]
    _astro/index.bDJz14Rf.css | .carousel-action[data-astro-cid-msvpecjd]

原因就是 §60 那个改动的副作用：按钮改由 `Button.astro` 渲染之后，
元素带的是 **Button 的 cid**，而 `Pagination.astro` / `Slide.astro`
自己的 `.pagination-button` / `.carousel-action` 规则仍然是 scoped 的，
于是**这两条规则变成了死规则**——按钮有底子了，但本组件对它的定位/抹平全丢了。

这是同一个跨组件边界陷阱的**反向版本**：
前面是「本组件的规则管不到子组件的元素」，这次是「把元素交给子组件之后，
本组件的规则就管不到了」。Vue 两种情况都能成立，因为它给子组件根元素
**同时**打上父 scope id；Astro 两种都不成立。

修法照旧：父锚点保持 scoped，子元素 `:global()`。

    > :global(.pagination-button) { … }
    :global(.carousel-action) { … }

死规则数回到 3（即棘轮基线）。

> 这一条值得单独记：**门禁不是用来「发现历史遗留问题」的，
> 也是用来当场拦住我刚犯的错误**。
> §60 的修复方向是对的，但它顺带打坏了两个组件自己的规则——
> 如果没有那道棘轮门禁，这两条死规则会静悄悄地留到下一次迭代才被发现。

### 61.2 样式门禁现在剩下的，全是「数量差」，且都能归因

修完错位之后全站样式差异只剩 16 条，**没有一条是计算样式不同**，
全部是元素数量差：

| 页面 | 选择器 | 差 | 归因 |
| --- | --- | --- | --- |
| takagi / clannad / gal-up / koichoco / nukitashi | `.article h2` | 少 1 | §53.7 内容漂移（`## 相关条目`） |
| 同上 | `.article a` | 少 1 | 同一个标题被 `<a href="#id">` 包着 |
| clarity-resource-list / nukitashi | `.article h1` | 少 1 | §55 tab 解析缺陷留下的 `h1#tab2` |
| clarity-resource-list | `.article pre` | 少 1 | 同一原因多出来的展开代码块 |
| maitetsu / misskey-sidebar / lemmy | `.article a` | **多** 4 / 63 / 6 | **未查清**，见 61.3 |

### 61.3 唯一还没查清的一类：链接数量 Astro 更多

`/2025/05/misskey-sidebar`：SSR 产物里 Nuxt 反而更多
（`<a>` 316 vs 204），但**水合之后的可见元素**是 Nuxt 113 / Astro 176。

也就是说 **Nuxt 的水合过程把大量链接移除了**，Astro 没有。
这与 §31 记过的「/link 页 Nuxt 水合后 img 从 76 掉到 39」是同一族现象，
但这次方向相反、幅度更大（差 63 个可见链接）。

**很可能**是某个可折叠/分组的组件（SeriesGroup / ProjectGroup / 表格折叠一类）
在 Nuxt 侧水合后收起，Astro 侧保持展开——那样就是**真实可见差异**。
本轮预算用尽，记为**首要未决项**，数字留在上面可直接复核。
## 62. 本轮收官状态（2026-10-02 14:20）

### 62.1 数字

| 门禁 | 结果 |
| --- | --- |
| `compare-ui-parity --mode=offline`（全站 63 页页高） | **54 ok / 7 DIFF / 0 UNST / 2 KNOWN** |
| `compare-ui-parity --styles`（28 属性 × 62 选择器，只比可见） | **9 / 63 页有差异，且无一条是计算样式不同** |
| `audit-dead-scope` | 3（棘轮基线，未新增） |
| `audit-css-blocks` | OK |
| `acceptance.ps1` | **19 / 21**（两个失败项就是上面那两道 parity 门禁） |

对比本会话开始时的 **26 ok / 31 DIFF / 6 UNST**。

### 62.2 剩下的 7 条页高差异，全部已归因

- **5 条**：takagi / clannad / gal-up / koichoco / nukitashi —— 用户尚未提交的本地内容改动
  （线上仍保留 `## 相关条目`）。部署后自动消失，故不进豁免清单。
- **2 条有界残差**：`lemmy-fediverse-deploy` −18px、`/link` −8px（均 < 0.4%）。

样式门禁剩下的 16 条里，13 条同样是上面两类（内容漂移少一个 `h2` + 其包裹的
`<a>`；tab 解析缺陷多一个 `h1#tab2` 与一个展开的 `pre`）。

### 62.3 唯一未查清的一类，以及为什么就此打住

`maitetsu-video-fix`(+4) / `lemmy-fediverse-deploy`(+6) / `misskey-sidebar`(+63)
三页 `.article a` 的**可见数量** Astro 更多。已排除的假设：

- 不是文章正文：这几篇正文一共只有 20 个 markdown 链接；
- 不是侧栏：Astro 的侧栏项**更少**（9 vs 26）。

继续查时我自己的切片开始自相矛盾——同一页先后量出「文章区内 Nuxt 113 / Astro 0」
与「全文件 Nuxt 316 / Astro 204」。**测量本身已经不可信，此时继续挖就是又一次
「拿不可信的观测去下结论」**，正是本会话反复出现的那类错误。

所以停在这里，并把数字与已排除项一并记下，交给下一次带着更可靠切片接手。
这一条的性质是：**内容/结构层面的链接数差异，页高看不出来（侧栏等固定高度区域
装得下），所以它只被样式门禁的数量项抓到，尚未定位。**

### 62.4 本会话最值得带走的

1. **门禁要先自检**：§52–§62 里，至少 10 次是**工具自己错了**而不是项目错了
   （隔离误杀基线、偏移量混用、注释/字符串当成结构、自定义属性误报、
   `preview` 服务器登记表、方向标反的「仅线上有」、四次按下标配对、
   252 条隐藏外壳噪声、`z-button` 规则其实是被内联的）。
2. **不设「不可信」出口的门禁等于没有门禁**：§51 的 6 页 UNST、§54 的 60s 超时、
   §61 的死规则，都是靠「拿不到值就不下结论」或「失败必须带证据」兜住的。
3. **注释不是证据，产物才是**：`InfoCard.astro` 里那段推导充分、语气笃定的
   「与线上一致」，实测错了 177px。
4. **豁免要带上限**：`ACCEPTED` / `STYLE_ACCEPTED` 全部带 `maxDelta`，
   超限照红——`nukitashi-gv-end` 就是这么一边被豁免 info-card、一边继续
   因为内容漂移而报红的。
## 63. 最后一条没查清的差异：标题锚点多包了 h5（2026-10-02 14:40 - 14:50）

### 63.1 为什么上一轮要停手

§62.3 记的那个「首要未决项」——三页 `.article a` 可见数 Astro 更多（+63/+6/+4）——
当时**字符串切片自己开始打架**：同一页先后量出「文章区内 113 vs 0」和
「全文件 316 vs 204」。切片不可信还继续挖，就是又一次拿不可信的观测下结论。

所以这次换了观测源：给对比器加了 `--census=<选择器>`，
**在浏览器里对 DOM 后代做 `tag.class` 普查**再对比。浏览器是唯一可信的观测源。

### 63.2 普查结果直接给出答案

    0 -> 176   a.heading-anchor          （Astro）
  119 ->   0   span.iconify.i-tabler:message-circle-quote   （Nuxt）
  113 ->   0   a

先排除两个假设（这次是**证伪**，不是猜测）：

- 不是正文：这几篇正文一共只有 20 个 markdown 链接；
- 不是侧栏：Astro 的侧栏项**更少**（9 vs 26）。

然后关键数字对上了：

| | 数量 |
| --- | --- |
| 两侧 `h1..h6[id]` 标题总数 | **176 = 176**（h2 2 + h3 30 + h4 81 + h5 63） |
| Nuxt SSR「标题内含 `<a>`」 | **113 = 2+30+81**，`h5 > a` 数量为 **0** |
| Astro（修前） | **176**，h5 也被包了 |

**176 − 113 = 63 = h5 的数量**，分毫不差。

### 63.3 成因

Nuxt Content 的 `anchorLinks` 默认 `depth: 4`——**只包 h1–h4**。
侧栏三级导航用的正是 `h5`，线上它们没有锚点。
Astro 的 `prose-enhance.ts` 里选择器写的是 `h1[id] … h6[id]`，于是多包了 63 个。

改成 `h1[id], h2[id], h3[id], h4[id]` 之后：

    0 -> 113   a.heading-anchor     （与 Nuxt 的 113 个 a 一一对应）

三个页面全部归零。

### 63.4 为什么只能在客户端做（不是偷懒）

Astro 的 heading `id` 由它自己的 rehype 阶段生成，**晚于** `plugins/prose.ts`——
实测 63 篇里有 25 个标题在该插件运行时还没有 id。所以构建期包锚点会漏掉它们。
Nuxt 是在 markdown 管线里就完成锚点的（SSR 产物里就有 113 个 `<a>`），
这一层等价性确实没做到，但**没有可见后果**：页高一致，
`heading-anchor` 这个类在产物 CSS 里 0 条规则，多出来的类不影响外观。

### 63.5 普查里剩下的差异都是「写法不同」而非「看起来不同」

| Nuxt | Astro | 性质 |
| --- | --- | --- |
| `span.iconify.i-tabler:message-circle-quote` ×119 | `svg` + `path` ×120 | 引用按钮图标：iconify span vs 内联 SVG |
| `pre.language-text.shiki` | `pre.astro-code…` | 同一段代码，shiki 版本不同导致的类名 |
| — | `symbol` / `use` / `script` | astro-icon 的符号表 |

这些是**表示方式**的差异，不是渲染结果差异，样式门禁也不报它们。

## 64. 第十六次失效模式的家族：门禁全绿，但功能是死的（2026-10-02 15:43 - 17:13）

### 64.1 这一轮的起点

§62 收官时 `acceptance.ps1` 是 19/21，两道红是页高与样式门禁。看上去只剩收尾。
这一轮先重跑 `compare-ui-parity --mode=offline` 取新鲜基线，**跑到第 24 页自己失败了**：

```
FAIL: 本地（Astro 候选）侧不是正常页面：…/2025/05/shr-misskey
      #blog-root 存在=false 子节点=0 页高=1000px
      基线或候选端出错了（错误页 / CDN 拦截 / 构建产物缺失）。继续比差值只会得到假结论。
```

不是站点回归：`dist/` 的 mtime 仍是本次构建（15:45:05），目标页文件在，
是**门禁自己的 preview 服务器（4391 端口）中途死了**。§62.4 第 1 条说的正是这一类——
门禁先把证据摆出来再拒绝下结论，这次它做到了，所以代价只是「少测 39 页」而不是「报 39 个假 diff」。

### 64.2 但真正的问题不在这里：绿色的门禁测不到「功能是死的」

页高一致、计算样式一致、`interactive-check` 25 项全过——这些全绿的情况下，
一次源码级对照审计挖出 **15 条缺陷，其中 11 条是页高与样式测量在原理上看不见的**。
最重的三条是**功能完整渲染、完全无法响应**：

| 缺陷 | Nuxt 行为 | Astro 现状 | 影响面 |
| --- | --- | --- | --- |
| 首页排序 / 分类 / 分页全部失效 | `useArticleSort` / `useArticleCategory` / `usePagination` 三个响应式源接 `v-model` | 三个控件照常渲染、照常接受点击，页面**不重排**；第 11 篇之后的 68 篇文章从首页不可达 | 全站最高流量页 |
| `/archive` `/preview` 丢弃排序字段 | `v-model:sort-order` / `v-model:is-ascending` | `partial:change` 处理器只读 `category`，把 `sortOrder` 与 `isAscending` 扔掉后套回构建期默认值 | 3 个页面 |
| 「引用整段到评论」谎报成功 | `useCommentQuote.ts:72-91` 滚动 `#twikoo`、轮询 6s、写回 `> <段落>`、剪贴板兜底 | `twikoo.getComments(() => flash('已插入'))` ——回调拿到实例就丢弃，**什么都没插**，却提示「已插入」 | 61 个文章页 |

第三条比不响应更糟：**它给出的反馈在断言一件没有发生的事**。

### 64.3 同一个根因：事件契约写了，消费者从来没写

`OrderToggle` 派发 `partial:change`、`Key` 派发 `press`——两个事件的**生产端**都在，
**消费端**要么不存在，要么写错。`archive.astro:169` 甚至把 `window.__applyArchiveSort`
标注为「给页面级控制器用」，而那个控制器从来没被写出来。

这类缺陷能一路逃过这么多道门禁，原因很具体：门禁量的是**几何与计算样式**，
而这三项测的是**状态是否随交互改变**。一个死按钮和一个活按钮渲染完全一样。

### 64.4 第四种：图标交换是静默 no-op，且修错会更糟

`astro-icon` 改掉了 `@nuxt/icon`，从「响应式 `:name`」变成「构建期内联 SVG、零客户端 JS」。
产物是：

```html
<svg class="iconify" data-icon="tabler:chevron-down"><use href="#ai:tabler:chevron-down"></use></svg>
```

三处客户端脚本去改那个**惰性的** `data-icon`，以为字形会跟着变。不会——
字形来自写死的 `<use href>`，而 astro-icon 的观察器根本没打包进来。

**关键在于「修对」比「不修」更难**。我核对了 `dist/previews/example/index.html` 的 sprite：
57 个 symbol，含 `tabler:chevron-down` 与 `tabler:arrows-minimize`，
但**不含** `tabler:chevron-up` 与 `tabler:arrows-horizontal`。
所以只把 `<use href>` 改写成另一个名字，得到的是一个**指向不存在 symbol 的空图标**——
比现在的 no-op 更糟。sprite 只收「页面上静态用到的」图标，
任何交换方案都必须先证明目标 symbol 存在。

顺带查出引用按钮的**客户端路径本身就是坏的**：
`prose-enhance.ts:333` 拼 `<use href="#ai:tabler:message-circle-quote">`，
而该 symbol 不在 sprite 里 → 空图标；而构建期路径 `prose.ts:660` 用的是
`tabler:quote`（双引号，不是气泡）。**同一条按钮的两条代码路径互相不一致**，
且其中一条产出空图标。

### 64.5 被误判为「有意省略」的两个组件

`archive.astro:196-201` 有一段注释，解释了为什么删掉归档页的「密度调节」面板：

> `Astro 版的 OrderToggle 没有那个槽位、也没有任何脚本驱动列数或间距，于是面板成孤儿 … 连同 .hide-info 一起移除；--archive-item-column 恒为 1。`

**当时的推理是对的，结论是错的**：这不叫「死 UI」，这叫**一个还在工作的功能被删掉了**。
`partial/Toggle` 与 `partial/Slider` 已按 Nuxt 原样移植（`z-toggle` / `z-slider`
的类名必须保留，样式门禁在比对选择器），面板与 `--archive-item-column`
的驱动一并接回即可。

同一族还有 `UtilListTransition`：Astro 侧连一个 `.animate()` 都没有，
`index.astro` 只留了 `.list-transition` 的壳和 CSS，`data-changing` 永远没人写。
FLIP 排序动画在 Nuxt 侧是完整的（含 FLIP 位移、离屏淡入、容器高度过渡、
`prefers-reduced-motion` 与 `data-article-transition` 两个逃生口）。

### 64.6 一次性关掉的覆盖盲区：端点内容

审计把「atom / opml / sitemap 内容未比对」列为待定。本轮补上（`.output/public` vs `dist`）：

| 文件 | 结论 |
| --- | --- |
| `atom.xml` | 62 291 字节**完全相同**，逐字符扫描仅 **7 个字符**不同，全部落在同一个 `<updated>` 构建时间戳内；`<entry>` 两侧各 **38** 个 |
| `subscriptions.opml` | 4 271 / 4 270 字节，唯一差异是 `dateModified` 的构建时间戳 |
| `robots.txt` | 规则逐条照抄，`Sitemap:` 已正确改指 Astro 实际产物 |
| sitemap | **结构不同**：Nuxt 单个 `sitemap.xml`（54 944 B）vs Astro 的 `sitemap-0.xml` + `sitemap-index.xml`。`@astrojs/sitemap` 默认拆分。`robots.txt` 已同步指向 index，所以是**已处理的差异**，不是缺陷——但它确实改变了对外暴露的 URL，值得在切流清单里记一笔 |

### 64.7 解耦：`astro-site` 此前根本不能独立运行

目标要求「Astro 迁移要解耦 Nuxt 相关部分独立运行」。实测**不成立**，而且比「多几个跨目录
import」更深一层：

```
astro-site/node_modules:  @vueuse/core=False  parse-domain=False  site-config-stack=False
root/node_modules:        @vueuse/core=True   parse-domain=True   site-config-stack=True
```

`shared/utils/{link,str,time}.ts` 位于 `D:\Projects\blog-v4\shared\utils\`，
裸 import 由 Node 逐级向上解析到 **Nuxt 根的 `node_modules`**。
`astro-site/pnpm-workspace.yaml` 正确隔离了自己的安装，但对**树外文件**毫无作用。
也就是说：即使把 40 处 `../../../blog.config` 全部改掉，只要还引用着
`shared/utils/*`，astro-site 就仍然依赖 Nuxt 根那份已安装的依赖图。
Nuxt 树一下线，astro-site 就构建不了。

另外三处跨树 `package.json` import（`Base.astro` / `app-config.ts` / `atom.xml.ts`）
读的是 Nuxt 根的 `clarity@3.8.0`。若改读 astro-site 自己的 `blog-astro@0.1.0`，
`<meta name="generator">`、atom 的 generator、页脚「主题: Clarity 3.8.0」会**全部变样**——
所以这三项冻结为 `src/config/site-meta.ts` 的字面量，并在产物里逐条复核。

新门禁 `scripts/check-self-contained.mjs`：扫 140 个文件，越界引用 0，
并用四种注入（相对路径逃逸 / `~~` 别名 / `h3` 运行时 / 未声明包）验证过它**真的会红**。

### 64.8 两次「简报里的描述是错的」

派发时我按记忆写了两条实现提示，worker 读源码后发现两条都错，且都选择了信源码：

- `isPathFile` **不是**「看起来像文件路径」的粗判断，而是 site-config-stack 内部
  一份约 110 项的**扩展名白名单**（`/foo.xyz` 返回 false）。照抄清单后与真包
  做了 126 例差分测试，0 处不一致。
- `toArray` **没有** null 兜底，真实实现是 `Array.isArray(v) ? v : [v]`，
  所以 `toArray(undefined)` 是 `[undefined]` 而非 `[]`。

两条在唯一调用点上都不可观测，但按描述实现会让代码与上游语义悄悄分叉。

### 64.9 本轮的门禁账

| 门禁 | 状态 |
| --- | --- |
| `check-self-contained.mjs`（新） | 绿，0 越界引用，四种负控已验证会红 |
| `check-flip-gates.mjs`（新） | **刻意红**——组件已写好但尚未接线，接完转绿 |
| `tsc -p tsconfig.check.json`（新） | 42 个既有错误，集中在 5 个本次未触碰的文件 |
| `pnpm build` | 68 页，绿，9.43s |

### 64.10 独立性证明抓到了词法门禁看不见的那一类

§64.7 的自包含门禁是**词法**的：它扫 import 说明符。为了不只靠推理，
把 `astro-site`（去掉 `node_modules` / `dist` / `.astro`）整份复制到
`%TEMP%\astro-standalone-proof`——那条路径的祖先链里**没有** Nuxt 树、
没有 `blog.config.ts`、没有本项目的 `node_modules`——然后从零 `pnpm install` + `pnpm build`。

**第一次构建是红的：**

```
ERROR Caught error rendering /: Error: ENOENT: no such file or directory,
open 'C:\Users\PaloMiku\AppData\Local\Temp\package.json'
  at AstroComponentInstance.BlogTech …
```

`src/components/widget/BlogTech.astro` 写着「以 `import.meta.url` 为基准向上走四层，
再 `readFileSync` 根 `package.json` 与根 `pnpm-workspace.yaml`」。
在仓库里它一路向上正好命中 `D:\Projects\blog-v4\package.json`，**构建是绿的**；
复制出去以后，它读的是 `%TEMP%\package.json`，直接 ENOENT。

而词法门禁此时报的是「**0 越界引用**」——它只认 import 说明符，
对**构建期运行时读文件完全失明**。这正是 §35 记过的 `import.meta.url`
少算一层那个坑的第二次出现。

处置：5 个实际用到的值（`3.8.0` / `^3.5.42` / `^4.5.2` / `^3.16.0` / `12.5.1`）
冻结为字面量，与 `site-meta.ts` 同一原则。改完后隔离构建 **68 页全绿**，
且与仓库内 `dist` 的冻结值出现次数**逐项相同**，产物等价。

**所以「把门禁全绿」和「站点真的独立」是两件事。**
词法检查证明不了后者，唯一诚实的证明是**把树搬走再构建一次**。

### 64.11 给门禁补规则时，我自己连犯三次「门禁自己骗人」

补 `runtime-escape` 规则的过程本身又复现了 §62.4 的老模式，三次都靠负控才发现：

1. **规则写在了引号的错误一侧。** 捕获组写成 `(\.[^'"]*)['"]` 而不是
   `['"](\.[^'"]*)['"]`，于是 `new URL('../../../../', import.meta.url)`
   一个都匹配不到。门禁输出「0 越界引用」——**看上去完全正常**。
2. **新加的正则字面量打断了 `stripComments`。** 该函数跟踪字符串状态机
   但不识别正则字面量，我的模式里含裸引号，把状态机带偏，
   导致它把自己的文档注释判成一条 `undeclared x` 假违规。
   改成 `new RegExp(string)` + `\x27`/`\x22` 转义才解决。
3. **`SPECIFIER_RE` 本身有个既存假阳性。** `['collapse-enter-from', …]`
   这种数组字面量里，`\bfrom` 因为前面紧挨 `-` 仍然成立，
   于是把 `from', 'collapse-enter-from` 之间的 `, ` 当成模块说明符。
   补 `(?<![\w$.-])` 负向后顾修掉——**`\b` 对连字符后的标识符片段不成立**。

三次的共同点：**如果只跑「当前是绿的」这一步，三次都会静默通过。**
最终三个负控全部按预期变红：

| 负控 | 期望 | 实测 |
| --- | --- | --- |
| 重新注入 BlogTech 的原始写法 | 红 | 红 `runtime-escape ../../../../` |
| `readFileSync('../../../../package.json')` | 红 | 红 `runtime-escape` |
| `readFileSync('../../app-config.ts')`（站内） | **绿** | 绿，无误报 |

注意第二个控制我第一次也写错了：从 `src/components/widget/` 往上三层
落在 `astro-site/` 之内，本就不该报红。**负控本身也要先验算，
否则「负控是绿的」会被误读成「规则漏了」。**

### 64.12 第十七次失效模式：三道新门禁只读外链资源，看不见内联的产物

修完 §64.2 那批缺陷后，四道新门禁在真实构建上的结果是：

| 门禁 | 自检 | 结果 |
| --- | --- | --- |
| `check-icon-swap` | 12/12 | **PASS** |
| `check-affordances` | 12/12 | FAIL 2 |
| `check-list-controls` | 15/15 | FAIL 21 |
| `check-flip-gates` | 11/11 | FAIL 14 |

14 条全部是同一类：说 `z-toggle` / `--motion-duration` / `list-transition-content`
「不在产物里」。**但它们都在。**

根因是三道门禁的产物收集只认外链文件：

```js
css: files.filter(f => f.endsWith('.css')).map(read).join('\n')
js:  files.filter(f => f.endsWith('.js')).map(read).join('\n')
```

而 **Astro 7 会把足够小的按页 CSS/JS 直接内联进 HTML**，不产独立 chunk。实测：

- 外链 `.css` 4 个 / 76.4 KB，外链 `.js` 120 个 / 4019 KB
- **内联 `<style>`/`<script>` 共 1431 段 / 849 888 字节**

`dist/archive/index.html` 里明明有 `.z-toggle[data-astro-cid-r2klkxft]{user-select:none}`、
有 `` getPropertyValue(`--motion-duration`) ``、有 FLIP 引擎全文。

`check-icon-swap.mjs` **一个这种收集器都没有**——它本来就同时聚合内联与外链
（报告里写着「68 个页面，954 段脚本（内联 + 外链 chunk）」），所以它是唯一一道直接绿的。

这一条和 §64.2 是同一个教训的两次：**门禁测的东西，必须确认它真的在测目标。**
上一轮是「测了几何，没测状态」；这一轮是「读了产物，但只读了一部分产物」。

### 64.13 第十八次失效模式：`hidden` 又一次被作者级 `display` 压过

§32 记过一次，这次换了三处，全在同一个函数族里：

- `.article-item { display: flex }`（`post/Archive.astro`）压过 UA 的 `[hidden] { display: none }`
  → **`/archive` 的分类筛选其实早就是静默 no-op**（不是「只支持分类」之外的问题，是分类本身也不生效）
- `.card { display: block }`（`reusable.css:2`）
- `:where(.iconify) { display: inline-block }`（`main.css:87`）

所以「密度调节面板是死 UI」这个判断，**连它自己依赖的 `hidden` 都没生效过**。
三处现在都有显式规则。

同一批还挖出两条：

- **`/preview` 渲染的是空卡片。** `preview.astro` 给 `Article.astro` 传了
  `entry=` / `to=`，而该组件两个 prop 都不认——没有标题、没有 `href`、没有日期。
- **`/archive` 一直没传 `showCategory`。** Nuxt 传的是 `column < 3`（`column=1` → true），
  对着线上 `https://blog.sotkg.com/archive` 确认：每个标题前确实有
  `iconify i-tabler:bulb`。这条是拿生产站当基准查出来的，不是推理。

### 64.14 Nuxt 自己引用的那个图标根本不存在

修引用按钮字形时发现：`ProseP.vue:52` 写的是 `name="tabler:message-circle-quote"`，
而 **这个图标不存在**——`@iconify-json/tabler@1.2.41` 的 6268 个图标与 194 个别名里都没有，
Iconify API 对 `tabler/message-circle-quote` 直接 404。

也就是说 Nuxt 那个按钮**画不出任何东西**；再加上它本身是 `v-if` 在客户端 ref 上，
`.output/public` 的页面里**一个 `paragraph-quote-btn` 都没有**。

所以「与 Nuxt 完全一致」在这里没有可对齐的对象。Astro 侧现在用
`tabler:message-circle-2`（同族的真气泡图标），并且**从结构上**杜绝两条路径画出不同结果：
构建期路径直接内联 SVG，客户端兜底路径**不再含任何图标名**，
改成克隆构建期按钮的图标子树。

### 64.15 `flash()` 把图标吃掉了

改引用按钮时顺带发现：`prose-enhance.ts` 的 `flash()` 原本是
`button.textContent = text`，超时后再把**捕获的 textContent** 写回去。
对一个只含 `<svg>` 的按钮来说，捕获到的 textContent 是 `''`——
于是**任何一次提示都会永久销毁图标**。它一直在悄悄破坏引用按钮和行内代码复制按钮
（`.copy-button` 里是 `.inline-code-icon`）。改成 `replaceChildren` 快照/还原子节点。

### 64.16 我自己用 PowerShell 写文件，写出了 BOM

`audit-css-blocks.mjs` 一直报「源码内无 BOM」，这轮变成
`WARN: 1 个文件带 BOM`——`src/components/widget/BlogTech.astro`。
来源是我用 `Set-Content -Encoding UTF8` 回写该文件：**Windows PowerShell 5.1
的 `-Encoding UTF8` 会写 BOM**（`acceptance.ps1` 开头那条 ASCII-only 注释防的正是这一类）。

这条值得单独记：**在 PS 5.1 上回写 UTF-8 源文件，要么用文件工具，要么用
`[System.IO.File]::WriteAllBytes` 手工剥 BOM。** 已修，门禁恢复
`OK: 源码内无 BOM`。另有 `scripts/check-ci-triggers.mjs` 与
`scripts/compare-remote-sitemap.mjs` 也带 BOM，但不在该门禁扫描范围内，属既存。

### 64.17 修完之后的全站门禁账

中央构建：**68 页，绿，10.72s**。

**既存静态门禁 15 道，14 绿**（`audit-dead-scope` 的 exit 1 是它自己的 WARN 计数 3，
等于 `acceptance.ps1` 里的 `knownDeadScope = 3` 棘轮基线，属预期通过）。
`compare-urls` 零差异、`compare-titles` 全通过、`check-dead-css` 无死类、
`check-anchor-classes` 62 页一致、`audit-css-blocks` 无 BOM、`check-self-contained` 0 越界。

**新门禁 4 道**：

| 门禁 | 自检 | 结果 |
| --- | --- | --- |
| `check-icon-swap` | 12/12 | **PASS** |
| `check-self-contained`（含新 `runtime-escape` 规则） | — | **PASS** |
| `check-flip-gates` | 11/11 | 14 处（= §64.12 的内联盲区） |
| `check-list-controls` | 15/15 | 21 处（同上） |
| `check-affordances` | 12/12 | 2 处（经核实**两条都是误报**，见下） |

`check-affordances` 那 2 条查到底了，两条都是**门禁错，不是站点错**：

- 「135 个同源链接带了 noopener」——判据用「href 有没有 scheme」判断外链，
  但 Nuxt 的规则是 `isExtLink()`，而 `isExtLink` 还包含 `isPathFile()`
  （那份约 110 项的扩展名白名单）。所以 `/atom.xml` 在 Nuxt 侧**就是**外链。
  Nuxt 基线逐字：
  `<a href="/atom.xml" rel="noopener noreferrer" target="_blank" aria-label="Atom订阅">`
  与 Astro 产物**完全一致**。另 1 条是 `SeriesGroup` 的 `.detail-link`，
  Nuxt 基线同样是 `rel="noopener noreferrer" target="_blank"`。**零真实缺陷。**
- 「42 个只有 noopener 缺 noreferrer」——`FeedCard` / `ResourceList` / `InfoCard`
  三处都显式传了 `rel="noopener"`，**盖掉** NuxtLink 的默认值。这是**已发布的 Nuxt 行为**，
  即 parity。补全它反而是**制造**新差异。

**全站页高对比（63 页，断网模式，±4px）：49 一致 / 14 超差**，其中：

- 2 条是用户 2026-10-02 拍板的已接受项（`clarity-resource-list` -449 上限 600、
  `piece-hy1` -178 上限 200）
- 5 条是用户未提交的本地内容改动（`## 相关条目` + `::bgm-card` 被删），
  Astro 侧已经领先于线上，部署后自动消失
- 7 条是本轮新出现的，正在定位：`nukitashi-gv-end` **-731**（上一轮还是 -82）、
  五个 +14…+33（全部是含可折叠代码块的技术文章）、`/link` -8

对比本会话开始时的 **26 一致 / 31 超差 / 6 不稳定**。

### 64.18 剩下 7 条的定位结果：两个真缺陷，且都逃过了现有全部门禁

先把方法学记在前面：**这轮的探针是自建的，不复用 `compare-ui-parity.mjs`**——
后者自己会起 `astro preview`（而 `.astro/preview.json` 里是死 pid），
本轮约束是不许动预览服务器与端口登记表。探针自起静态服务器 + 无头 Chrome，
**逐字复刻了门禁的 Chrome 参数**（同样的 `--host-resolver-rules`、
`--force-prefers-reduced-motion`、1600×1000、同样的 2.5s settle + 滚到底序列），
并且**先验证自己能复现门禁记下来的每一个数字**才继续。

验证结果（能复现，才说明后续数字与门禁可比）：
`docker-deploy-outline` 4888/4921、`nukitashi-gv-end` 7244/6513、`/link` 1875/1867，
以及 5 条正差与 `piece-hy1` −178，全部逐个吻合。

**顺带一条方法学警告**：`.output/public` **不能**当离线的参照物。
它是**改过的工作树**构建的——`相关条目` 计数 0、`bgmcard` 计数 0，
用它会把那 −81px 的内容漂移项**整项藏起来**。所有数字都是对着线上打的。

#### 缺陷一：`Chat.astro` 的四条 CSS 被静默丢弃（−267px）

`src/components/content/Chat.astro:65,70,83,88` 把四条规则写成**裸的顶层子代选择器**：

```css
> .chat-body { … padding: 0 1em; max-width: 90%; margin-bottom: 1em; white-space: pre-wrap; … }
```

花括号深度为 0 时这是**非法的顶层 CSS**，被压缩器静默丢弃，构建照样绿。
产物 `dist/_astro/content-components._Z93KDvc.css` 里只有
`.chat[data-astro-cid-knx2e2po]{margin-inline:2vw;font-size:.9em}`，
`chat-body` / `chat-caption` / `chat-myself` **一个都没有**。

实测后果：`dd.chat-body` 的 padding `0px`（线上 14.4px）、`max-width: none`（线上 90%）、
`margin-bottom 0`（线上 14.4px），于是正文宽 688px 永不换行（26px），
线上是换行后的 40/66px。`dl.chat` 682 vs 415。

**这不是 Astro 的通病，对照组就是证据**：

| 写法 | 所在 | 结果 |
| --- | --- | --- |
| `> .surround-text`（**深度 1**，嵌在父规则里） | `PostSurround.astro:95` | 编成 `&>.surround-text[...]`，**存活** |
| `.timeline > .timeline-caption`（显式父选择器） | `Timeline.astro` | **存活** |
| `> .chat-body`（**深度 0**） | `Chat.astro` | **整条消失** |

全站 `dist/_astro/*.css` 普查：`&>` 出现 91 次，显式父选择器有，**裸 `> .x` 出现 0 次**。
全仓另有 36 处 `> .x` 写法，但都嵌在父规则里，都正常。
Nuxt 侧对应的是 `Chat.vue:44` 用 `:deep()` 包起来。

**而 `audit-dead-scope.mjs` 看不见这一类**——死规则审计找的是「规则在、但匹配不到元素」，
这里是「规则根本不在产物里」。这是门禁的覆盖盲区，已单独补门禁。

#### 缺陷二：全站每个代码块的折叠按钮高 16.31px

6 个受影响页面上，`figure.z-codeblock.collapsible > button.toggle-btn`
一律 **线上 24.47px / Astro 40.78px**，而**标签文本逐字相同**
（两侧都是 `64 lines, 1899 chars, 2.11 KiB`）。

关键在于**这不是 CSS 的差异，是 DOM 结构的差异**：

- `src/styles/main.css:71-73` 的 `button > .iconify:only-child { display: block }`
  **线上原样也有**（`app/assets/css/main.css:68-72`），规则本身不是分叉。
- 线上按钮有**两个元素子节点**：`<span class="iconify">`（箭头）+ `<span>`（标签），
  `:only-child` 永远匹配不到那个图标 span，它保持 `inline-block`，与标签同一行。
- `src/plugins/prose.ts:393-394` 把箭头渲成**裸 `<svg class="iconify toggle-icon">`**，
  标签是裸文本节点。于是 SVG 成了**唯一的元素子节点**，`:only-child` 命中，
  `display:block` 把图标推到独立一行，多出 16.31px。

算术严丝合缝：1 个可折叠块 → +16，2 个 → +33（2×16.31=32.63）。
`lemmy` 量到 +14 是因为它还叠着一个已知的 −19px 残差（2×16.31−19=13.6≈+14），
**符号翻转就是这么来的，不是新回归**。

#### 被证伪的三个假设

1. **「prose 图标加上 `iconify` 导致了那批正差」——证伪。** 那些图标现在确实正确地是 1.2em
   （Astro 的 svg 19.19px，改前是裸 1em），方向是对的；但每个
   `button.paragraph-quote-btn` 都是 `position:absolute`，**不在文档流里**。
   `docker-deploy-outline` 上文章里**唯二**有差异的子节点就是那两个代码块，
   所有散文段落 d=0。**这个改动对高度是中性的。**
2. **「chars/bytes 读数多了一个字符导致标签换行」——用字符串比对直接证伪。**
   两侧标签逐字相同。`source + '\n'` 那个改动是让数字**对上**，不是差值来源。
   真正换行的是**箭头变成 `display:block` 之后标签被挤到第二行**——
   症状看着像，机制完全不同。
3. **「行高 / `vertical-align: sub`」——证伪。** 30 个属性逐个量过，
   两侧的 line-height、padding、width、position、text-align 全同。

#### 定位工具本身也翻了一次车

`compare-ui-parity.mjs` 对 `nukitashi-gv-end` 报
`div.blog-aside-track` −732、同时报 `aside#blog-sidebar` 1000/1000。
看着像第二个缺陷。实测是**度量假象**：`.blog-aside-track` 是个空壳包裹层，
它的高度跟着文章走，等于把同一个 −731 又报了一遍。直接量 aside 是 1000/1000，无差异。

**这是本会话第四次出现「切片/配对本身不可信」**（前三次见 §62.3、§63.1）。
规律不变：先证伪观测手段，再挖。
## 65. 功能验证补齐，以及两次「我报了假数字」（2026-10-02 15:30 - 16:20）

### 65.1 页高门禁的数字：54 是对的，30 是一次残缺运行

上一轮我把 **54 ok** 报成 **30 ok** 并当成了订正。两次都不完全对：

- 30 那次跑在**被杀掉的 `pnpm build` 留下的半截 `dist`** 上，跳过了 63 页里的 24 页；
- 54 是那次完整运行的结果；
- 我之所以读错：JSON 里一直有 `skipped` 字段，我从没打开过。

最要命的地方在于**残缺运行看起来比完整运行更好**：跳掉 24 页之后
「超差 7」而不是更多，人只会盯着分子。分母一藏，结论就无法自证。

已改：摘要里直接打印

    ⚠⚠ 跳过 N 页（本地无对应产物）—— 本次结论只覆盖 M 页，不是全站

并逐条列出被跳过的路径。当前完整运行的实测：`rows=63  skipped=0`，
`ok=54  KNOWN=2  UNST=0  DIFF=7`。

### 65.2 源码在磁盘上被改坏了一次

`src/lib/shared/link.ts` 在 15:50:42 被改成 `'eot',`（少了开头引号），
**时间点在最后一次成功构建之后**，来源不明。此后每一次
`astro build` / `astro preview` 都直接失败：

    [PARSE_ERROR] Unexpected token  src/lib/shared/link.ts:94:2

对比器立刻报出了真实原因（`Unable to load your Astro config` + 文件位置）——
因为它把 preview 的输出接了出来。这正是 §54 记的那条教训：
**失败必须带证据**，否则就会以为是别的问题再折腾一轮。
修回 `'eot',` 后 lint 干净、构建 68 页。

### 65.3 按钮换成组件之后，功能要真点一次

§60 把 `Pagination` / `Slide` 的按钮改走 `Button` 组件（为了拿回
`z-button button` 的底子）。静态看 `data-page-next` 确实落在了按钮上，
但**结构对不等于点得动**——这正是本轮反复栽跟头的地方。

`interaction-check.mjs` 里原本**没有分页的断言**（只有 carousel 的），
补了一条：

    pagination: next button advances the visible page

它同时断言三件事：只有一个 next 按钮、按钮**仍带** `z-button button`
（防止有人再退回裸 `<button>`）、以及点击后 `data-value` 真的翻页。

    OK  pagination: next button advances the visible page
    passed 26 / 26

### 65.4 收官数字

| 项 | 值 |
| --- | --- |
| 页高（全站 63 页，断网对照，跳过 0） | **ok 54 / DIFF 7 / UNST 0 / KNOWN 2** |
| 样式（28 属性 × 62 选择器，只比可见） | 6/63 页有差异，**无计算样式差异** |
| `interaction-check`（真实 Chrome） | **26 / 26** |
| `audit-dead-scope` / `audit-css-blocks` | 棘轮 3 / OK |

7 条页高差异：5 条是未提交的内容漂移（等部署自然消失），2 条为 8–18px 的有界残差。
## 66. 补上最后一道缺的门禁：解耦（2026-10-02 16:30）

### 66.1 「Astro 与 Nuxt 解耦」原来是靠人记着的

迁移目标之一就是 **Astro 独立运行、与 Nuxt 解耦**。检查脚本一直存在
（`package.json` 的 `check-self-contained`），实测也是干净的：

    扫描目标：src, scripts, astro.config.mjs
    扫描文件：140 个
    越界引用：0

**但它没有接进 `acceptance.ps1`。** 也就是说，谁在 astro-site 里写回一行
`import ... from '../../app/utils/img'`，整条流水线依然全绿。
今天确实有一次差点发生：我早先读到过 `LinkBanner.astro` 与 `pages/link.astro`
里的 `../../app/utils/img`、`../../../app/feeds` 引用（现在都已换成
`src/lib/img`、`src/lib/feeds`、`src/config/blog`），如果哪天改回去没有任何东西会拦。

已接入第 4b 节。现在这一条和「页高一致」「样式一致」「作用域规则可达」
一样，是**门禁守着的**，不是靠记性的。

### 66.2 最终门禁表（22 道）

| 门禁 | 覆盖 | 结果 |
| --- | --- | --- |
| `compare-urls` / `compare-titles` | URL 与标题集合 | OK |
| `check-content-preservation` / `check-dates` | 内容与日期 | OK |
| `check-layout` / `check-anchor-classes` / `check-dead-css` / `check-assets` | 结构与资源 | OK |
| `audit-deferred` / `audit-image-pipeline` | 图片管线 | OK |
| `audit-dead-scope` | 够不到元素的 scoped 规则（递归） | 棘轮 3 |
| `audit-css-blocks` | CSS 块被改坏 | OK，无 BOM |
| `check-ci-triggers` | CI 触发器 | OK |
| **`check-self-contained`** | **astro-site 不得引用 Nuxt 项目** | **0 越界** |
| `live:sitemap` / `live:head` | 与线上 URL / head 一致 | 未接受差异 0 |
| `live:ui-parity` | 全站 63 页页高（断网对照） | 54 ok / 7 DIFF / 2 KNOWN |
| `live:style-parity`（`-Styles`） | 28 属性 × 62 选择器，只比可见 | 6/63 页，仅数量差 |
| `check-build-warnings` | 构建告警 | OK（必须最后跑） |
| `interaction-check`（单独跑） | 真实 Chrome 交互 26 条 | **26 / 26** |

### 66.3 剩下的 7 条页高差异

- 5 条 = 5 篇未提交的文章（线上仍保留 `## 相关条目`），部署后自然消失；
- 2 条 = `lemmy` −18px / `/link` −8px，均为 0.4% 以内的有界残差。

**切流前唯一有意义的动作就是把那 5 篇提交并部署。**

## 67. 把门禁接进流水线，以及一次「结论下早了」（2026-10-02 17:20 - 17:35）

### 67.1 十九次失效模式：门禁存在，但从没被调用

§66 补上了 `check-self-contained`，而且**只补了它一个**——于是同一个病的下一处
立刻出现：**§64 那一轮新写的五道门禁，一道都没进 `acceptance.ps1`**。

| 门禁 | 守着的是什么 | 写它是因为 |
| --- | --- | --- |
| `check-icon-swap` | `data-icon` 交换必须伴随真实 `<use href>` 改写 | 4 处 `data-icon` 是静默 no-op |
| `check-flip-gates` | `ListTransition` / `Toggle` / `Slider` 已编译进产物 | 组件写完了但没接线 |
| `check-list-controls` | 排序 / 分类 / 分页 / 密度四组控件有消费者 | 首页控件**全部**无消费者 |
| `check-dropped-css` | 无花括号深度 0 的裸 `> selector` | 4 条 Chat 规则被静默丢弃 −267px |
| `check-affordances` | 键帽 / `rel` / `zoom-in` / collapse 类名 | 4 层提示，0 层接线 |

也就是说：这五道门禁当时**只有在有人记得手动敲的情况下**才存在。已接入为
`acceptance.ps1` 第 4c 节。实测 7/7 绿（含 `check-self-contained`）。

接线之后没有直接跑整条流水线就宣布成功，而是**用文件里真正的那个 `Step`
函数**（从 `acceptance.ps1` 正则抠出来 `Invoke-Expression`，而不是抄一份）
单独跑了这 7 道——确认 `foreach` 里的 `$g` / `$script` 闭包在 `Step` 立即调用
时取值正确。7 格全绿、退出码全 0。

### 67.2 顺手发现：汇总表其实不是汇总

接完之后第一次看汇总表，发现 `Note` 一列每格是**整个门禁输出**（三十多行），
`Format-Table -Wrap` 把它铺开，表格完全没法看。

原因是 `Step` 里 `$out = & $block`，而每个 block 都以 `| Out-String` 收尾——
`$out` 是**一个**多行字符串。于是 `Where-Object { $_ -match 'PASS:' }` 匹配的是整块，
`Select-Object -Last 1` 取回的还是整块。

改成先按行切再匹配。顺带暴露第二处：`check-self-contained` 的 Note 是**空的**——
它的判据正则（`RESULT|PASS:|...`）全英文，而这道门禁打的是中文
（`✓ astro-site 自包含检查通过` / `  越界引用：0`）。加了兜底取最后一行。

    改前：7 格 Note 里有 1 格空，且每格都是整段输出
    改后：7 格全非空、单行、最长 55 字符

改的是**观测手段**，不是判据——退出码一直取自 `$LASTEXITCODE`，没动。

### 67.3 一次「结论下早了」：我以为归档页丢了一条字体规则

做字体对比（§67.4）时顺手比 `font-family`，得到一个差集：

    --- 只在 Nuxt 里有的取值 ---
      var(--font-stroke-free)

`--font-stroke-free` 用在 `archive.vue` 的归档页大号年份数字上，而且是**唯一**
一个 Astro 侧完全没有的取值。看起来正是本轮反复出现的那类缺陷：规则被丢，
而它的表现只是字体不同，页高门禁看不见。

去产物里查，第一轮查询是：

    Select-String -Path 'astro-site\dist\**\*.css','astro-site\dist\*.html'

命中 1 次，在 `Blog.css`（`FeedGroup` 那处）。归档页没有。**看起来坐实了。**

第二次查询才查对：把 `dist\**\*.html` 补上，命中 `dist/archive/index.html`，
里面规则完整：

    &>.archive-year[data-astro-cid-maku5qik],
    &>.archive-age[data-astro-cid-maku5qik]{
      font-family:var(--font-stroke-free);font-variant-numeric:tabular-nums;...}

**没有缺陷。** 第一轮的 glob 只覆盖了 `dist` 顶层的 `*.html`，而归档页在
`dist/archive/index.html`——`-Leaf` 又把不同目录下的 `index.html` 显示成同一个名字，
让「按文件名分组」这条退路也看不出来。

这是本轮第二次栽在观测手段上（第一次是 `.output/public` ≠ 线上）。记在这里是因为
它和 §62 是同一个教训：**先证伪观测手段，再解释它给出的数字。**

### 67.4 字体对齐（此前没有门禁覆盖的维度）

页高、计算样式、交互都查过了，**字体**这一维一直没有被单独比过。补上：

    @font-face family   Nuxt: LXGWWenKai | Noto Serif SC-Local
                        Astro: LXGWWenKai | Noto Serif SC-Local
    font-family 取值集合  归一化后完全相同

唯一多出来的一条是 `&quot`，来自**文章正文里的一段 CSS 代码示例**（讲 LXGW WenKai
的那篇），被正则误当成声明——不是本站样式。**字体这一维无差异。**

### 67.5 一次做坏了的仪器：CSS 声明集合差集

本来想用「忽略选择器、只比声明集合」来抓「规则被丢但页高看不出来」的差异
（Astro 保留原生嵌套，Vue 展平，比选择器会报上千条假差异，所以不比选择器）。

写完一跑，输入就是垃圾：括号扫描器把 `.html` 里的**压缩 JS**
（`let n=t.queryselector(...)`、`const target = "https://blog.sotkg.com/"` ×67）
和 **Shiki 高亮的文章正文**（`--shiki-light` span）全当成 CSS 声明抓了进来。
284 条「缺失」里绝大多数是这两类，以及两类**预期内**差异：

- lightningcss 剔掉的冗余厂商前缀（`-webkit-mask-image` 等 40+ 条）；
- Vue 的 `data-v-*` 作用域 id（Astro 侧是 `data-astro-cid-*`）。

结论是**这个仪器不成立，丢弃，不报告任何数字**。而且它本来就不该做：
`acceptance.ps1 -Styles` 的计算样式对比是严格更强的仪器（比的是渲染后的值，
不是文本）。探针已从 `%TEMP%` 删除。

### 67.6 实测记录本身的三个缺陷

1. **编号重复**：文档里有两个 `## 64.`。交叉引用（`§64.2` / `§64.7` /
   `§64.10–64.12`）全都指向第一个，但第二个块里也有一个 `### 64.2`
   （"源码在磁盘上被改坏了一次"）——按 `§64.2` 找过去会走错。已重编为
   `## 65.`（原 65 → 66）。核对后顶层编号无重复、单调。
2. **时间区间写到未来**：`## 64.` 标着 `15:43 - 17:30`，而文件最后修改时间是
   17:00。已改为 `15:43 - 17:13`（对应验证用的那次构建）。

另有一个**既存**缺口：§10（L418）直接跳到 §12（L438），§11 从未写过。
不补——凭空编一节比缺一节更糟；也不重编 12–66，那会打断 `CLAUDE.md` 里
`§62.4` / `§64.10–64.12` 的交叉引用。

3. **一行里有 3 个 U+FFFD 替换字符**（L3717），是更早某次写入留下的编码损坏，
   把 `）\uFFFD\uFFFD\uFFFD`/link` -8` 里的枚举顿号啃掉了。按上下文（该 bullet
   列举三项：`nukitashi-gv-end` −731、五个 +14…+33、`/link` −8）还原为 `、`，
   U+FFFD 归零，文件字节数正好 −6（3×3 字节 → 3 字节），其余中文未受影响。

## 68. 修复后的全站复测（2026-10-02 17:14 - 17:32）

### 68.1 页高：54 一致 / 9 超差 / 0 不稳定

63 页，断网模式，容差 ±4px。相比修复前的 49 / 14 / 0：

| | 修复前 | 修复后 |
| --- | --- | --- |
| 一致 | 49 | **54** |
| 超差 | 14 | **9** |
| 不稳定 | 0 | 0 |
| skipped | 0 | 0 |

**而且 54 个一致页全部是「精确 0 差」**，不是落在容差带里——63 页里只有
9 页的 `d` 非零，其余 54 页 `nuxt === astro`。

收敛的 5 页正是上一轮定位为「+14…+33、全部是含可折叠代码块的技术文章」的那 5 页，
现在逐页归零。**折叠按钮 DOM 修复在产物里确认生效**（每页 +14…+33px 的偏差消失）。

`section.z-comment` 在逐区块诊断里 `nuxt 82 / astro 82 / d 0`——Chat 那 267px
的死 CSS 确认已修复。

剩下 9 条超差，逐条归因：

| 页面 | d | 归因 |
| --- | --- | --- |
| `/link` | −8 | 既存有界残差（§66.3） |
| `/2025/10/lemmy-fediverse-deploy` | −18 | 既存有界残差（0.4% 以内） |
| `takagi` / `clannad-zh-linux` / `gal-up` | −82 ×3 | 未提交的本地内容改动 |
| `/2025/05/koichoco-psp` | −81 | 同上 |
| `/2025/10/nukitashi-gv-end` | −565 | 5 张 `::info-card` 295px（已接受）+ 其余内容漂移 |
| `/2025/10/clarity-resource-list` | −465 | 已接受（用户 2026-10-02） |
| `/2025/11/piece-hy1` | −178 | 已接受（用户 2026-10-02） |

后三条的 `reason` 是门禁自己写进 JSON 的，**不采信、另行核实**（见 §68.2）。

### 68.2 核实 `nukitashi` 的 −565：不是布局缺陷

`reason` 说是「5 张 info-card + 内容漂移」。逐条查证：

- **该页根本没有代码块**：两边 `<pre>` 均为 0、`collapsib` 均为 0。
  `codeblock` 子串 Nuxt 3 / Astro 0 的差异是 **CSS 打包**——Nuxt 把这段选择器
  放进全站共享 chunk，Astro 按页发射，无代码块就不发。不是内容缺失。
- **info-card 存在且是内容差异**：`info-card` 子串 Nuxt 26 / Astro 15，与
  「线上拿不到 Bangumi 数据、每张渲染成错误卡，Astro 侧是空外壳」一致。
  用户 2026-10-02 已决定不复刻坏掉的错误卡。
- **Astro 多一个 `<figure class="lightbox-figure">`（7 vs 6）**：查了两侧实现——
  Nuxt 是 `app/components/popover/Lightbox.vue`，SSR 里 `lightbox` 出现 **0 次**
  （用到才生成），配图靠内联 `style="cursor:zoom-in;"`；Astro 用
  `LightboxModal.astro` 预渲染一个 `src=""` 的隐藏容器，配图靠 `data-zoom`。
  **两边光标行为一致**，差别只在容器是预渲染隐藏还是按需生成。
  而 Astro 这一页**整体还矮 565px**，所以那个多出来的 figure 不占高度——
  算术上直接排除了它撑高度的可能。**不是视觉缺陷。**

结论：`−565` 由内容漂移构成，不是 Astro 的布局问题。

### 68.3 剩下 4 条 −82 的归因：实测确认，不再靠记忆

`--mode=offline` 的 Nuxt 基准是**线上生产站**（`compare-ui-parity.mjs` L53
`REMOTE = 'https://blog.sotkg.com'`），不是 `.output/public`。所以「内容漂移」
这个说法是可以证伪的，而且必须证伪——上一轮的结论是凭印象写下的。

拿 `takagi` 拉线上实页，和两份本地产物逐项比：

| | 字节 | `<h2>` 章节 |
| --- | --- | --- |
| 线上 Nuxt | 88 332 | 机缘 / 深入 / 结语 / **相关条目** |
| 本地 Nuxt 构建 `.output/public` | 84 535 | 机缘 / 深入 / 结语 |
| Astro 产物 `dist` | 73 390 | 机缘 / 深入 / 结语 |

线上多一个 `## 相关条目` 章节，用户的本地内容里已经删掉了。Astro 与本地内容
**逐章节一致**。

所以这 4 条（`takagi` / `clannad-zh-linux` / `gal-up` / `koichoco-psp`）
的 −81 / −82 是**「Astro 领先于线上」**，不是布局缺陷：把当前本地内容部署上去，
线上那一节同步消失，这几条自然归零。

顺带一个读法陷阱：PowerShell 的 `Invoke-WebRequest` 会把 UTF-8 当 Latin-1 解，
线上那行的中文在终端里是 `æç¼çº¥`。**那是终端解码问题，不是站点问题**——
同一段用 `[System.IO.File]::ReadAllText` 读本地文件就正常。

补充 git 层面的证据（这批漂移**不是**迁移改出来的）：

    M app/assets/css/animation.css                 2026-09-30 11:48
    M app/components/blog/BlogSidebar.vue          2026-09-30 11:49
    M content/posts/{takagi,clannad,gal-up,        2026-10-01 19:02
      koichoco-psp,nukitashi-gv-end}.md
    M shared/utils/icon.ts                         2026-10-01 19:03
    M app/components/partial/Secret.vue            2026-10-01 19:04
    ?? scripts/remove-bgm-directives.ps1

未跟踪的 `remove-bgm-directives.ps1` 就是把 `::bgm-card` 指令从那 5 篇里摘掉
的脚本。时间戳最新的是 **2026-10-01 19:04**，比本次迁移动手早一整天——
这些是站点主自己的内容工作，与 Astro 无关。**Astro 侧忠实于当前工作树，
所以它「领先于线上」；把内容部署上去，这几条自然归零。**


### 68.4 交互门禁：26 / 26

本轮修复的每条交互路径都有断言覆盖，全部通过：

    OK  archive: category filter hides non-matching items
    OK  archive: sort order toggle reorders the list
    OK  pagination: next button advances the visible page
    OK  lightbox: image click opens the modal, Escape closes it
    OK  Mermaid: the diagram actually rendered into an <svg>
    OK  ProsePre: copy button reports success
    OK  ProseH*: heading content is wrapped in an anchor
    OK  ProseCode: <code copy> gets a copy button at runtime
    OK  ProseA: domain icon renders as inline SVG
    OK  ProseTable: md-table wrapper + toggle flips the scroll class
    OK  share: opening the modal renders real content
    OK  TOC / search / AI excerpt / Tab / carousel / theme toggle …
    OK  no uncaught page errors (article / demo / archive / home / music)

前四条正是本轮修的**排序、分类、分页、灯箱**——它们在修复前是「控件渲染了但
没有消费者」，静态门禁看不见，只有真点一次才知道。

随后是全站扫描：

    OK  67 pages, zero uncaught errors
    passed 26 / 26        EXIT=0

**68 页产物、67 页逐一加载、零未捕获错误。** 门禁自己拉 4398 端口的
`astro preview`、按进程树清理（`taskkill /T`），不碰用户自己的 dev 服务器。

### 68.5 全新构建上的产物复核

`acceptance.ps1` 会先 `pnpm build`，所以 17:37 那次全量重建把上面所有验证对象
都换成了新产物。逐项重查（此前验证的是 17:13 那份）：

| 修复项 | 产物里的证据 | 结果 |
| --- | --- | --- |
| Chat 死 CSS | `chat-body` 在编译后 CSS 中出现 2 次 | OK |
| `collapsed` 构建期化 | `<figure class="z-codeblock collapsed collapsible">` ×12 | OK |
| 折叠按钮双子节点 | `<svg class="iconify toggle-icon is-collapsed">` + `<span>44 lines, 996 chars, 1 KiB</span>`，2 个元素子节点 | OK |
| 引用按钮字形 | `<svg class="iconify">` 内联 message-circle-2 的 path（`m3 20l1.3-3.9A9 8 0 1 1 7.7 19z`），1765 处 | OK |

最后一条顺带解释了为什么**产物里搜不到 `message-circle-2` 这个字符串**：
astro-icon 对这一个图标内联了 path 而不是走 sprite，所以字面量为 0。
`check-icon-swap` 比的是 path 数据而不是名字——这正是它能守住这条的原因。

68 页、`robots.txt` / `atom.xml` / `subscriptions.opml` / `sitemap-index.xml` 齐全。

## 69. 整条流水线跑完：25 / 26，以及那条**本来就红**的门禁

`powershell -File scripts/acceptance.ps1` 完整跑一遍（26 步 = install + build +
24 道门禁）：

    total: 26   passed: 25   failed: 1
    FAILED STEPS:
      - live:ui-parity  (exit 1)     1036.4s

**25 / 26。** 唯一失败的是 `live:ui-parity`，而它**在这次迁移里一直是红的**：

| 运行 | total | passed | failed | `live:ui-parity` | `live:style-parity` |
| --- | --- | --- | --- | --- | --- |
| `acceptance-run5` | 21 | 19 | 2 | **exit 1** | exit 1 |
| `acceptance-final2` | 21 | 18 | 3 | **exit 1** | exit 1 |
| `acceptance-final3` | 21 | 19 | 2 | **exit 1** | — |
| **本轮** | **26** | **25** | **1** | exit 1 | 未跑（opt-in） |

所以它红**不是回归**。本次跑的数字与单独跑的那一次**逐项完全一致**：

    rows 63 | 一致 54 | 超差 9 | skipped 0 | unstable 0 | 精确 0 差 54

两次独立运行给出同一组页面、同一组 `d`、且 `unstable` 都是 0——测量本身是稳定的。

### 69.1 我没有把这盏红灯抹掉，而且是有意的

`live:ui-parity` exit 1 的原因是存在 **7 条未接受差异**，而它们全部落在
「本地内容比线上多」这一类（§68.2 / §68.3 已逐条核实）：

- `takagi` / `clannad-zh-linux` / `gal-up` / `koichoco-psp` / `nukitashi-gv-end`
  ——线上还留着用户已从本地内容里删掉的 `## 相关条目`；
- `/link` −8 / `lemmy-fediverse-deploy` −18 ——0.4% 以内的有界残差。

门禁的 `known` 列表里有 `clarity-resource-list` 和 `piece-hy1` 两条已接受项。
**把上面 5 条也加进去确实能让它变绿，我没有这么做**：那等于把
「你的内容还没部署」这个信号**永久静音**。等这批内容部署上线，这 5 页自然归零，
红灯自己会灭。

一盏诚实的红灯，胜过一盏为了好看而刷绿、然后没人再部署内容的假绿灯。
**该做的动作是部署内容，不是改门禁。**

## 70. 计算样式对比复跑：Chat 修复没有引入颜色回归

`live:ui-parity` 只比页高，而**页高对「规则被丢、只影响颜色」完全瞎**。
Chat 那 267px 的缺陷之所以能活到本轮，正是因为它先表现为颜色问题、被页高门禁放过，
直到 Chat 版块本身被逐区块定位才暴露。

所以样式这一维必须单独验一次，而且**必须在当前构建上**——上一次
`style-parity.json` 是 15:51 写的，早于 Chat 修复与折叠按钮修复，那份结论已经过期。

    node scripts/compare-ui-parity.mjs --styles

结果（18:01:55，写入 `.astro-compare/style-parity.json`）：

    有差异的页面: 6 / 63
    count 类差异: 13      （全部落在那 6 个内容漂移页上）
    style 类差异:  0      ← 一个都没有

**63 页零计算样式差异。** 与 15:51 那次的 `0 style` 结论一致，也就是说
**把 Chat 那 4 条规则搬回 `.chat` 内部之后，颜色 / 边框 / 阴影 / 间距一个都没跑偏**。

门禁自身 `exit 1`，原因同 `live:ui-parity`：6 页还有 count 类差异，
且报出的 2 类已接受项都是**线上构建缺陷**，不是迁移缺陷：

- `.gradient-card.text-align` —— 线上漏链了含 `.search-btn{text-align:start}`
  的 CSS chunk（12 个被引用的 CSS 里没有任何一个含 `.search-btn`），
  按钮落回 UA 默认的 `text-align:center`。Astro 按源码如实应用。
  刻意复刻 = 故意让一条规则失效，故记录在案不改。
- `.article p.count` —— 线上每张加载失败的 info-card 里有一个
  `<p class="info-card-error-text">`，Astro 侧是空壳没有（§55 的决定）。

## 71. 本轮收官

| 维度 | 仪器 | 结果 |
| --- | --- | --- |
| 页高 | `live:ui-parity` 63 页断网对照 | 54 **精确 0 差** / 9 差异 / 0 不稳定 |
| 计算样式 | `compare-ui-parity --styles` | 63 页 **0 条 style 差异** |
| 交互 | `interaction-check` | **26 / 26**，67 页零未捕获错误 |
| 结构 / 资源 | 11 道 ps1 门禁 | 全绿 |
| 端点 | `live:sitemap` / `live:head` | URL 集合一致；0 处未接受字段差异 |
| 字体 | 本轮新增对比 | `@font-face` 两族一致，`font-family` 集合一致 |
| 解耦 | `check-self-contained` | 141 文件 / 0 越界 |
| 流水线 | `acceptance.ps1` | **25 / 26**（唯一红灯见 §69.1，是内容未部署） |

剩下的 9 条页高差异，逐条都有实测归因，没有一条是 Astro 的布局缺陷：
2 条用户已拍板接受，5 条是本地内容领先于线上，2 条是 0.4% 以内有界残差。

**切流前要做的只有一件事：把当前本地内容部署上线。** 那 5 页的 `相关条目`
同步之后，`live:ui-parity` 自己会变绿。

## 72. 第二十次失效模式：把「桌面一致」当成了「UI 一致」

§71 收官之后回头看那份「54 精确 0 差 / 0 样式差异」的表，发现它**只在一个宽度下量过**。

`compare-ui-parity.mjs` 把视口**硬编码在两处**：

    L254  '--window-size=1600,1000'
    L338  Emulation.setDeviceMetricsOverride { width: 1600, height: 1000 }

而站点里有大量 `@media (max-width: 768px)` 规则。**桌面逐像素相等完全不能推出
移动端相等**——断点写错、`hidden` 被作者级 `display` 压过、栅格
`repeat(auto-fill, minmax(...))` 收缩塌陷，都只在窄屏显形。这正是本轮反复
栽跟头的那一族（§64.13 的 `hidden` 就是在窄屏下打架的）。

### 72.1 补上 `--width`，并且证明它真的生效

    const VIEW_W = Number(argOf('width', '1600'))   // 默认不变，既有基线不作废
    const VIEW_H = Number(argOf('height', '1000'))

**自检**（不测就等于没加）：同一页 `/` 在两个宽度各量一次——

    viewport 1600x1000   nuxt 2624  astro 2624
    viewport  390x844    nuxt 3895  astro 3895

高度差 1271px，证明 CDP 的 override 真的生效了，不是换了个文件名而已。

顺带堵掉一个**我自己会踩的坑**：非默认宽度必须写进**另一个文件**
（`-w390x844` 后缀），否则一次手机宽度的运行会悄悄覆盖掉 1600px 的基线，
下一个人读到的就是一份「60 页全绿」但量的是手机宽度的东西。`viewport`
也一并写进 JSON，让每份结果自证量在什么宽度上。

### 72.2 63 页 × 两个宽度并排

| | 1600×1000 | 390×844 |
| --- | --- | --- |
| 精确 0 差 | **54** | **54** |
| 未接受差异 | 7 | 6 |
| 已接受（用户拍板） | 2 | 2 |
| 不稳定 | 0 | 1（`/link`） |

**关键：两个宽度下有差异的页面集合完全相同，54 个精确 0 差的页面也完全相同。**
没有任何一页是在窄屏下才坏掉的。

5 页的 `d` 变了，但全部是**同一份内容在窄屏下渲染高度不同**，
量级本就该不同：`clannad` −82→−52、`clarity-resource-list` −465→−503、
`nukitashi` −565→−519、`piece-hy1` −178→−177、`/link` −8→−11（并转为不稳定）。

**响应式这一维是干净的。** 代价是一次约 45 分钟的全站扫描。

### 72.3 逐区块定位挖出的两处，逐个查清

窄屏下 `nukitashi` 的逐区块诊断多出两行，桌面扫描里一条都没有：

    *** nuxt  86  astro  95  d  +9   div.panel-anchor  (节点数 6 -> 19)
    -  nuxt   -  astro 844       div.bg-mask.hide-above-mobile  <- 仅 Astro 有

**`div.bg-mask`「仅 Astro 有」是判据假阳性。** Nuxt 的 `Mask.vue` 用
`v-if="show"`，不显示时元素根本不在 DOM 里；Astro 的 `Mask.astro` 改成常驻 DOM +
`data-show` 驱动（文件头注释写明了这个取舍：为了吃到 CSS 过渡、且不依赖 JS 算
`max-height`）。隐藏态是

    opacity: 0; visibility: hidden; pointer-events: none;

`visibility: hidden` 会把元素移出无障碍树和 tab 序，**行为上与 `v-if` 等价**。
判据把它算成「可见」，是因为它是 `position: fixed`——固定定位元素的
`offsetParent` 是 `null`，而 `visible` 的启发式对 fixed 有兜底分支，于是
`visibility: hidden` 被漏掉了。**不是站点缺陷，是仪器缺陷。**

**`div.panel-anchor` +9px** 是真的。`.panel-anchor` 的 CSS 在两边逐字相同
（`position: fixed` + `bottom`，高度完全由内容决定），所以 9px 来自它**内部**
某个元素。节点数 6 → 19 的差异主要来自 astro-icon 内联的 `<svg>`。
用 `--styles` 模式在移动端再量一次来定位（见 §73）。

### 72.4 顺带堵住样式模式的同类坑

页高输出加了宽度标签，样式输出却是写死的 `style-parity.json`——**一次手机宽度的
样式运行会覆盖桌面的基线**。已一并加上标签，并让 JSON 带上 `viewport`：

    const styleName = `style-parity${widthTag}.json`

（`widthTag` 提到 `VIEW_H` 旁边定义：原本写在页高输出那行，而样式输出在它
**之前**，直接引用会触发 `const` 的 TDZ 报错。）

### 72.5 移动端的计算样式：同样是零差异

`--styles` 一起加上 `--width=390` 再跑一遍（`acceptance.ps1 -Styles -Mobile`）：

    有差异的页面: 6 / 63
    count 类差异: 13
    style 类差异:  0        ← 移动端也一个都没有

6 个有差异的页面与桌面**完全同一批**，判据也同一批：

    takagi              .article h2:4/3  .article a:4/3
    clannad-zh-linux    .article h2:4/3  .article a:6/5
    gal-up              .article h2:9/8  .article a:31/30
    koichoco-psp        .article h2:5/4  .article a:14/13
    clarity-resource-list  .article h1:1/0  .article pre:2/1
    nukitashi-gv-end    .article h1:1/0  .article h2:4/3  .article a:10/9

`/link` 与 `lemmy` 在页高上有残差，但在**样式维度两者都是 ok**——那点高度差
不落在被比的 28 个属性里。

## 73. 收尾：把那个 9px 挖到底，并修掉

`div.panel-anchor` 桌面 0、移动端 +9（`nuxt 85.8 / astro 94.7`）。
§72 只做到了「不采信、不谎称已解决」。这一节把它挖到底。

### 73.1 先补工具：现有门禁到不了这一层

`compare-ui-parity.mjs` 能说「这个块差了 9px」，但**到此为止**——它比的是
62 个写死选择器上的 28 个 CSS 属性，不会去比某个容器内部每一层子节点的几何。
「这 9px 来自哪个盒子」只能靠推理。

新增 `scripts/probe-subtree.mjs`：只针对一个选择器，把子树里**每个节点的
nth-child 路径、矩形高宽、display、line-height、vertical-align、font-size**
都列出来并按路径对齐两侧。跑一次约 40 秒，比全站扫描快两个数量级。

**节点必须按 DOM 路径配对，不能按标签名或 class**——两侧结构本来就不同
（astro-icon 渲成 `<svg>`，unplugin-icons 渲成 `<span>`），按名字配会把
「Astro 多包了一层 span」变成静默跳过。路径对不上的单独列进「仅一侧存在」。

### 73.2 量出来的结果

    节点            nuxt    astro     d     display
    (根)           85.8     94.7    +8.9    block
    /0             85.8     94.7    +8.9    block
    /0/0           42.9     47.4    +4.5    block
    /0/1            0.0     47.4   +47.4    none
    /0/0/0         26.9     27.0    +0.1

两个按钮**各高 4.48px**，合计 8.96 ≈ 实测 8.9。而

    4.48 = line-height 31.36px (1.4em) − 图标 26.88px (1.2em)

**Nuxt 按钮内容盒 = 1em（图标高，没有额外行盒）；Astro = 继承的 line-height。**
原因是两套图标系统：unplugin-icons 渲成不带内层 `<svg>` 的 `<span>`，
astro-icon 渲成 `<svg><symbol><use>`，行内 `<svg>` 参与行盒时把行盒撑到 line-height。

**这也解释了为什么桌面量出来是 0**：两个按钮分别带 `hide-above-mobile` 和
`hide-above-tablet`，在 1600px 宽时都是隐藏的。**这就是「只在一个视口量过
就收官」会漏掉的那一类**，而且它自己长得像「不可见元素的小差异」。

`/0/1` 那条 +47.4 是**配对错位**，不是几何差：Nuxt 的第 2 个子元素是
`display:none` 的预加载图标，Astro 把它移进了按钮内部，同一下标对应的
自然不是同一个东西。

### 73.3 修复

`src/components/blog/BlogPanel.astro` 的 `button` 规则加一行：

    line-height: 1;

把 strut 压回 1em，行盒高度就塌回图标高度。两个按钮里只有图标、没有文字，
压 line-height 不会挪动任何字形。

**验证**（`probe-subtree.mjs` 复跑同一页同一宽度）：

    节点            nuxt    astro     d
    (根)           85.8     85.8     0     ← 原 +8.9
    /0             85.8     85.8     0
    /0/0           42.9     42.9     0     ← 原 +4.5
    /0/0/0         26.9     27.0     0.1   （四舍五入）

**每一对真正配对的节点现在都逐值相等。**

### 73.4 一处必须写进注释的「不一致」

改完之后，两侧这个按钮的**计算 `line-height` 值是不等的**（Nuxt 31.36px /
Astro 22.4px），但**渲染几何完全相等**（都 42.9px）——因为 Nuxt 那边 strut
根本没参与行盒高度。**用户看得见的是几何，不是这个计算值。**

`compare-ui-parity.mjs` 的 `STYLE_PROPS` 含 `line-height`，但
`STYLE_SELECTORS` 里没有 `.panel-anchor button`，所以样式门禁不会报它。
**哪天有人把这个选择器加进列表，报出来的是假阳性——别顺手改回去。** 这句已经
写进组件的注释里。

### 73.5 这次改动没有动到任何页高（实测，不是推理）

面板是 `position: fixed`，`line-height` 只作用在面板自己的两个按钮上，
所以理论上不参与文档高度。**不靠推理，直接复测：**

    /2025/10/nukitashi-gv-end @ 390x844    改动前 -519  →  改动后 -519
    /2025/10/nukitashi-gv-end @ 1600x1000  改动前 -565  →  改动后 -565

逐值相同。**§68 / §72 那两轮全站扫描的结论依然成立，不需要重跑。**

## 74. 最后一个盲区：深色模式，此前只做过源码核对

前面所有测量都在**浅色**下进行。深色模式把整套颜色令牌换掉，而**页高对颜色
完全无感**——一个只写 `color` 的死规则在深浅两种主题下都不会让页高动一毫米。

之前只做过源码级核对，**从没量过渲染结果**：

    astro-site/src/styles/color.css  vs  app/assets/css/color.css
      1789 bytes，两边 mtime 都是 2026-09-29 23:45:43
      归一化后逐字相同

    .dark 作用域规则：两边各 4 条，差集为空

    落地方式：Nuxt 走 @nuxtjs/color-mode，Astro 走
              document.documentElement.classList.toggle('dark')
              —— 都把 .dark 挂在 <html> 上

源码相同不等于渲染相同。**「令牌文件一样」和「深色下看起来一样」之间还隔着
组件级规则、`:where()` 零特异性、以及任何只在深色下生效的覆写。**

### 74.1 加 `--theme=`，并且让它对称

两边默认主题都是「跟随系统」——Astro 的 `ThemeToggle.astro:69` 读
`window.matchMedia('(prefers-color-scheme: dark)')`，Nuxt 侧是 color-mode。
所以走 CDP 的 `Emulation.setEmulatedMedia` 翻这条媒体查询，
**两侧对称地切过去**，不需要往页面里注入 class（注入会造成非对称，
一边被测代码改了、一边没改）。

    Emulation.setEmulatedMedia
      features: [{ name: 'prefers-color-scheme', value: 'dark' }]

### 74.2 守卫必须是红的，否则等于没加

    if (THEME) {
        const isDark = await evaluate('document.documentElement.classList.contains(\'dark\')')
        if (isDark !== want) { ...报错退出... }
    }

**为什么非写不可：** 如果 `setEmulatedMedia` 静默失效（参数写错、站点改了默认
主题），两侧都会停在浅色——于是你会拿到一份 **63 页全绿、实际量了两次浅色**
的「深色结论」。这正是本项目栽过最多次的那类坑：仪器没在测目标，却报得很漂亮。

**负控已做**：把 `isDark !== want` 改成 `isDark === want` 之后立刻

    FAIL: --theme=dark 没有生效（<html> 上 没有 .dark）。
          继续跑出来的差值全部是浅色 vs 浅色，不作结论。
    EXIT=1

改回来后正向也验过：`preflight: 主题已生效（<html class="dark">）`。
**没被看过变红的守卫等于没有守卫。**

### 74.3 结果

    node scripts/compare-ui-parity.mjs --styles --theme=dark

    有差异的页面: 6 / 63
    count 类差异: 13
    style 类差异:  0        ← 深色下也是零

6 个页面、13 条判据、连数值都**与浅色和移动端完全同一批**
（`takagi` h2:4/3、a:4/3；`clannad` 4/3、6/5；`gal-up` 9/8、31/30；
`koichoco-psp` 5/4、14/13；`clarity-resource-list` h1:1/0、pre:2/1；
`nukitashi` h1:1/0、h2:4/3、a:10/9）。全部是内容漂移，与主题无关。

产物写进 `style-parity-dark.json`（**不覆盖**浅色的 `style-parity.json`），
JSON 里带 `viewport` 与 `theme`，每份结果自证量在什么条件下。

### 74.4 已接进流水线

`acceptance.ps1 -Dark`。和 `-Styles` / `-Mobile` 一样默认关闭——三次全站扫描
各要几分钟到几十分钟，不是每次改一行都该跑。但**已经接进去**，不是又一个
「只在有人记得手动敲时才存在」的门禁。

## 75. 全维度收官

| 维度 | 仪器 | 1600×1000 浅色 | 390×844 浅色 | 1600×1000 深色 |
| --- | --- | --- | --- | --- |
| 页高 | `live:ui-parity` 63 页 | 54 **精确 0 差** | 54 **精确 0 差** | 1 页抽测通过 |
| 计算样式 | `--styles` 28 属性 × 62 选择器 | **0 差异** | **0 差异** | **0 差异** |
| 交互 | `interaction-check` | **26 / 26** | — | — |
| 结构 / 资源 | 11 道 ps1 门禁 | 全绿 | 全绿 | 全绿 |
| 端点 | `live:sitemap` / `live:head` | URL 集合一致，0 处未接受字段差异 | — | — |
| 字体 | 源码对比 | `@font-face` 两族一致，`font-family` 集合一致 | — | — |
| 解耦 | `check-self-contained` | 141 文件 / 0 越界 | — | — |

三个视口/主题组合下，**精确 0 差的都是同样那 54 页**，没有任何一页只在某个
条件下才坏。`acceptance.ps1` 26 步中 25 绿，唯一红灯 `live:ui-parity` 是
「本地内容尚未部署」（§69.1），**刻意没有刷绿**。

## 76. 第二十一次失效模式：缺陷在**没被采样的第 83 个元素**上，而仪器**没有那一维属性**

§75 收官时剩两条「非内容、非已接受」的真实残差：`/link` −8px 与
`lemmy-fediverse-deploy` −18px。这一节把两条都定性，代价是**三台仪器各有一个洞**。

### 76.1 `/link` 的 8px：`:deep()` 在 Astro 侧丢了 scope 锚点

§52.6 当初推到「FeedCard 包裹 span 与首个 `code.copy` 的间距 线上 16 / Astro 8」就停了，
**说不清多出来的 8px 是哪个盒子给的**，也就没法改。`probe-subtree` 的 tree 模式
（逐节点高）也定不下来：能配对的子节点**逐值相等**（`code.copy` ×5 各 34/34、
`span` 56/56、`div.code` 32/32），根却是 274 vs 266。

给 `probe-subtree` 加了 `--mode=profile`（**垂直剖面**：把子树铺成若干条水平带，
外加空隙区间）。一次跑出来：

```
[0] nuxt   top       0 bot      56 h  56 gap  0   inline  span.-
    astro  top       0 bot      56 h  56 gap  0   inline  span.-
[1] nuxt   top      72 bot     106 h  34 gap 16   flex    code.copy   m8px/8px
    astro  top      64 bot      98 h  34 gap  8   flex    code.copy   m8px/8px
[2..5] 两侧 gap 都是 8
对账：带高合计 == 根高（两侧都铺满），带 + 空隙正好是根高的一个划分
```

**只有一处**：卡片那个 `span` 底边到首个 `code.copy` 顶边的空隙。两边 `code.copy`
自身 margin 都是 `8px/8px`，所以差值只可能来自 span 那一侧。

顺着查 CSS 就到底了。线上产物 `_nuxt/link.ybPUspFo.css` 里逐字是：

```css
[data-v-ad1ec0bb] .feed-card.feed-card{width:auto;margin:0}
```

`FeedGroup.vue:132` 的 `:deep(.feed-card.feed-card)` 是**顶层**的，Vue 编译成
`[data-v-ad1ec0bb] .feed-card.feed-card`——那个属性选择器要求**祖先里有 FeedGroup
的元素**。而 `/link` 上那张独立卡片（`link.astro:69`，`myFeed`）在
`.link-tab` 里直接渲染，**不在任何 FeedGroup 内**：

| | 线上 | Astro（改之前） |
| --- | --- | --- |
| FeedGroup 顶层规则命中那张卡片？ | 否 | **是**（写成裸 `:global(.feed-card.feed-card)`，锚点整个丢了） |
| 卡片自身 `margin` | `1em auto` | `0` |
| 与 `code.copy` 的 `8px` 塌陷成 | `max(16,8)=16` | `8` |

测量、机制、编译产物三者完全对上。修法是补回祖先条件
（`FeedGroup.astro`：`.feed-group :global(.feed-card.feed-card)`）。
修完 `/link` **1875 vs 1875，d = 0**。

顺带修了同文件 `FeedCard.astro` 里同源的一处：原来那条
`:deep() ~ [data-tippy-root] > .tippy-box { &[data-placement=top] > .tippy-svg-arrow }`
是**嵌套**的，编译后箭头那条**同样带** `[data-v-…] ~` 前缀；Astro 拆成两条时
第二条把前缀丢了。tippy 还没接（Phase 4）所以当前不可观测，但等它接上就会漏。

### 76.2 为什么样式对比没看见它：`.feed-card` 在列表里，**只采样头部**

`STYLE_SELECTORS` 里**本来就有** `.feed-card`。可样式对比报 0 差异。查下来是
**两个独立的洞叠在一起**：

1. `STYLE_PROPS` 里**一个 margin / padding 属性都没有**——只有颜色、边框、字体、
   换行。`margin: 1em auto` vs `margin: 0` 在样式层是**完全不可见**的。
2. 采样是 `all.slice(0, cap)` + `visible()`，即**只取前 3 个可见元素**。
   而 `link.astro:58-65` 把 FeedGroup 渲染在 `<Tab>` **之外**，
   于是前若干个 `.feed-card` 全是组内卡片（两侧 `margin` 都是 `0`），
   **有缺陷的那张排在尾部**，永远进不了样本。

补了两样：盒模型 8 个属性进 `STYLE_PROPS`（36 属性）；采样改成
**头 3 + 尾 3**，并加一条**全量取值分布比对**（`dist`：所有可见元素的取值直方图，
不需要配对，因此不会漏尾部）。检测靠 `dist`，采样只用来报「是哪一条」。

**负控**（把修复退回裸 `:global`，重建后重跑）：

```
DIFF  8  /link
      .feed-card [5].margin-top     nuxt=16px      astro=0px
      .feed-card [5].margin-right   nuxt=190.031px astro=0px
      .feed-card [5].margin-bottom  nuxt=16px      astro=0px
      .feed-card [5].margin-left    nuxt=190.016px astro=0px
```

`[5]` 是尾部样本，就是那张卡片；`190.031px` 是 `margin: 1em auto` 里 `auto`
解出来的实际值。恢复修复后同一命令回到 0 差异。**这条仪器是先被看着变红、
才被允许存在的。**

### 76.3 `lemmy-fediverse-deploy` 的 18px：不是缺陷，是**断网隔离的假阳性**

两次仪器在同一元素上给出**相反**结论：

- `compare-ui-parity`（离线）：`article.article` 8433 vs 8415，**−18**
- `probe-subtree`（不隔离跨域）：`article.article` 8414 vs 8415，**+1**

差别只有一个：页高扫描在量之前会**滚到底再回顶**并等图片解码，而断网模式会
**拦截页面的跨域 fetch**。查 `ProsePre.vue:41`：

```ts
const rawHtml = ref(escape(props.code))   // SSR 只输出转义后的纯文本
```

线上是**客户端** shiki 把它换成高亮 HTML 的。跨域被 BLOCK → 客户端 shiki 跑不起来
→ 线上代码块停在**纯文本**，而纯文本是 `props.code` = Astro 的 `source` + `'\n'`
（`prose.ts:334` 早就写明了这个偏移，作者只拿它补了**行数字样**，没管渲染文本）。
`source` 末尾单换行不产生额外行盒（它是块终止符），所以 16 个块看不出差别；
但 `lemmy` 第 5 块的围栏里本身多一个空行 → 线上是 `\n\n` → **多一个空行盒 = 18px**。
第 8 块也差一行，但它是折叠的，被 `max-height` 盖住，所以看不见。

切到 `--mode=online`（不隔离）复测：

```
[ 1/1]  ok        1  nuxt 10008 astro 10009  /2025/10/lemmy-fediverse-deploy
```

**+1px**（亚像素），且 10008/10009 与探针量的 `body` 逐位相同。真实浏览器下这一页
是干净的。

所以断网模式有个**系统性盲区**：凡是线上侧靠客户端 JS 才达到最终渲染的内容，
在离线测量里会比 Astro「少一步」。它不是这一次才存在（62 页干净说明影响面窄），
但它意味着**离线扫描报的差值必须用 online 模式复核**才能定性。已记在这里，
`/link` 那条则相反——它在 online 与 offline 下都存在，是真缺陷。

### 76.4 新门禁 `check-scope-anchors`：把这一类钉死

`:deep(X)` → 裸 `:global(X)` 是一个**缺陷类**，不只 `FeedGroup` 一处。
全量审计了两侧：Nuxt 顶层 `:deep()` 12 条、Astro 顶层裸 `:global()` 33 条。
逐条判定后，**只有 `FeedGroup` 是可观测的泄漏**——其余主体的全站分布证明它们
只出现在渲染本组件的页面上（`secret-container` 3 页全带 `.order-toggle`，
`#twikoo` 63 页全带 `.z-comment`，`tk-preview-container` 0 次）。

门禁 `scripts/check-scope-anchors.mjs` 的判据：

1. 逐 `.vue` 抽顶层 `:deep(X)`、逐 `.astro` 抽顶层裸 `:global(Y)`，同组件内
   **主体相同**即判红。
2. 例外写进 `KNOWN`，每条附一条**在 dist 上按 DOM 标记复算**的不变式
   （`id="twikoo"` 只允许出现在含 `class="z-comment` 的页面上）。
   刻意用 `id="twikoo"` 而不是 `#twikoo`——后者在每页内联 `<style>` 里都有，
   普查它会得到「63 页全中」，不变式就成了摆设。
3. 顺带把 src 里所有顶层裸 `:global()` 的主体与全站分布打出来。

**为什么那 3 条例外不把锚点加回去**：Vue 的 `[data-v-x] X` 恰好比裸 `X` 多
**一个属性选择器**的权重，而 Astro 任何 scoped 前缀都会连带加上 `data-astro-cid`，
补回去就是 `[data-v-x][cid] X`——**比基线还重**，同样不是 parity；`:where()` 又把
锚点权重抹成 0，等于没补。所以保持裸 `:global()`，改用可达性钉死泄漏面。

**门禁自己也翻过两次车**，都是负控逮住的：

- 第一版 `indexOf('<style')` 匹配到了 frontmatter JSDoc 里提到的 `` `<style>` ``，
  于是从文件开头开始扫，把模板和 `<script>` 当成了 CSS，**FeedGroup 整份没被认出来**，
  注入缺陷后它照样报绿。
- 注释是**逐行**剥的，跨行 `/* … */` 匹配不上，注释正文被当成选择器、花括号配平被带偏。

修好后负控立刻生效：注回去 → `FAIL: 1 处 [FeedGroup] …顶层裸 :global(.feed-card.feed-card)`，
`exit 1`；恢复 → `OK: 3 条 KNOWN 不变式成立`。

#### 76.4.1 门禁里的「普查」自己错了四次

清单里那列「出现在 N 页」是判断「主体会不会跑到组件外」的唯一依据，所以它的口径
必须对。它错了四次，**每一次都是往相反方向错**：

| 版本 | 做法 | 后果 |
| --- | --- | --- |
| 1 | 主体去点当 token（`#twikoo`） | 命中的是每页内联 `<style>` 里的**选择器文本**，不是元素。`#twikoo` 报「63 次 / 63 页」，不变式永远成立，**形同虚设** |
| 2 | 已知项改用 `id="twikoo"` | 这一条对了（KNOWN 的 `dom` 字段本来就是 DOM 标记） |
| 3 | 未知项留前导点（`.post-cover`） | HTML 里只有 `class="post-cover"`，没有 `.post-cover` → 报 **0 页**，而该规则实际命中 39 页 |
| 4 | 改正则 `class="[^"]*(?:^|[\s"])x(?:[\s"]|$)` | `[^"]*` 吃不到 `"`，于是 `(?:^|[\s"])` 永远落不到 `class="` 的**开引号**上 → `class="blog-widget shrink"` 匹不上，仍报 0 页 |
| 5 | 改用 `\b` 词边界 | 连字符不是单词字符 → `class="nav-icon"` 里的 `icon`、`class="…one-dark-pro…"` 里的 `dark` 全被误中（`.icon` 从 0 页虚报成 67 页） |

定稿是**不看正则**：`class="([^"]*)"` 整个取出来、按空白切分、再判断成员。
class 名里可以含 `-`，正则边界在这里没有意义。

最终数字（都可复算）：`#twikoo` 63/63、`ai-gpt-icon` 38、`post-cover` 39、
`search-input` 67、`blog-widget` 66、`carousel-action` 1、`tech-service` 1、
`.dark` 0——最后一个 0 是**正确**的，静态 HTML 是浅色默认，`<html>` 上没有那个类。

**这一条也解释了为什么 KNOWN 的 `dom` 字段必须手写**：它得是
`id="twikoo"` / `class="secret-container` 这种**属性形式**，
不能是选择器字面量，也不能靠通用推导——通用推导正是上面那块四次翻车的地。

### 76.5 顺手修掉的两个仪器洞与一个环境雷

**`probe-subtree` 崩溃时泄漏进程**。第一版把 `killTree` 放在正常路径末尾，
`evaluate()` 里任何一次抛错都会跳过清理，留下一棵 headless chrome 加一个占着
4393 的 preview——而那个 preview 还会写进 Astro 的跨端口登记表，让**下一道门禁**
直接起不来。仪器自己的 bug 变成了别人要查一小时的环境问题。改成幂等
`cleanup()` 挂 `exit` / `SIGINT` / `SIGTERM` / `uncaughtException` 四个入口。

**`preview stop` 会杀用户自己的 preview**。两个 live 脚本开头都是无条件
`astro preview stop`——因为 Astro 7 的登记表是**跨端口**的，残留条目会挡住新实例，
而 `--force` 实测无效。但那条命令**不看端口**，会连用户为本项目手动起的那个一起杀掉，
与「启停由用户管理」的约束直接冲突。

新增 `scripts/lib/preview-guard.mjs`：先 `preview status` 读登记，再按端口分三种情况——
干净则直接起；**是自己端口的残留**才 stop；**是别人（别的端口）的**就 `exit 2` 拒绝，
并把端口和 pid 一起打出来，绝不碰它。`scripts/preview-guard.selftest.mjs` 起真 preview
验这三条分支，包括最关键的那条「拒绝时那个 preview 还在不在」，8 项全过。
已接进 `acceptance.ps1`。

**`STYLE_PROPS` 缺整个盒模型**这件事本身就是 76.2 的根因，已在上面记。

**剖面模式的对账，第一版是恒等式。** 写的是「占住的高度差 + 空隙的高度差 == 根高差」，
可 `covered` 与 `gaps` 都是从 `rootH` 反推的（`covered = rootH - gaps`），于是
`explained` 恒等于 `rootDelta`，**守卫永远不会触发**。这已经是本项目第四次栽在
「守卫看起来在那里、其实从没被要求过正确」上（§74 的 `setEmulatedMedia`、§64 的一系列
正则、§67.3 的 glob）。改成真正的不变式：**所有后代的矩形必须不越出根盒子**——
一旦有 `position: absolute` / `transform` / 负 margin 戳出边界，「带 + 空隙」就不再是
根高的划分，上面的差值分解随之失去意义，此时 `exit 3` 而不是给结论。

### 76.6 本节新增/改动的文件

| 文件 | 改动 |
| --- | --- |
| `src/components/content/FeedGroup.astro` | `:global(.feed-card.feed-card)` → `.feed-group :global(...)`，补回 scope 锚点 |
| `src/components/content/FeedCard.astro` | tippy 箭头规则补回 `[data-feed-card] ~` 前缀 |
| `src/components/widget/CommGroup.astro` | 裸 `:global(.tip)` → `:global(.blog-widget) :global(.tip)`。裸的会连 `SearchModal` 的 `.tip` 一起改（今天不可观测，因为那个元素 `display: none`）。特异度 (0,2,0) 与 Vue 的 `.tip[data-v-x]` 逐位相同 |
| `scripts/check-scope-anchors.mjs` | **新门禁**：顶层 `:global()` 锚点 + KNOWN 可达性不变式 + 全站 DOM 普查清单 |
| `scripts/lib/preview-guard.mjs` | **新**：preview 端口协商，拒绝杀别人的 preview |
| `scripts/preview-guard.selftest.mjs` | **新**：三条分支的真 preview 自检 |
| `scripts/probe-subtree.mjs` | 新增 `--mode=profile`（垂直剖面 + 对账 + exit 3）；清理改四个入口幂等；接 preview-guard |
| `scripts/compare-ui-parity.mjs` | `STYLE_PROPS` +8 个盒模型属性；采样改头尾各 3 + 全量取值分布；接 preview-guard |
| `scripts/acceptance.ps1` | 4c 加 `check-scope-anchors`；新增 4d `preview-guard-selftest` |

## 77. 第二十二次失效模式：**「页面对应哪个源文件」是猜的，而猜测没人复核**

本轮起点是上一轮留下的一条样式差异：

```
.button [0].margin-right  nuxt=0px  astro=240.625px
.button [1].margin-left   nuxt=0px  astro=240.625px
```

`.button` 在首页命中 4 个元素：2 个轮播箭头（`opacity: 0`，被采样器的 `visible()` 滤掉）
加 2 个分页按钮。`[0]/[1]` 是分页的 prev/next。240.625px 是 `auto` 外边距在 flex 行里
被解析出的**实际值**——`getComputedStyle` 对 flex item 的 `auto` 外边距返回 used value，
不是 `auto` 字面量。

### 77.1 连续三次错误定性，全靠「读源码」而不是「问浏览器」

**第一次**：Nuxt 源码 `Pagination.vue` 里确实有

```scss
& > .pagination-button {
  &:first-child { margin-inline-end: auto }
  &:last-child  { margin-inline-start: auto }
}
```

Astro 侧规则也确实在产物里（`dist/_astro/index.QKg6t3Gu.css`），
`dist/index.html` 也确实引用了那张 CSS。
再扫线上：18 份被引用样式表里搜 `pagination` **0 命中**。
于是当时的结论是「**线上构建漏链样式表，规则从未生效**」——和此前已登记的
`.search-btn { text-align: start }` 同一类现象。

**这个结论是错的。** 打脸过程：

1. 线上首页与本地 `dist/index.html` 的 `<link rel=stylesheet>` 清单逐条对比，
   两边都是 18 份，差集只有 `entry` 与 `ListTransition` 的 hash 不同。
   含 `pagination-button` 的 chunk `pages.D_6TLywc.css` **两边都没引用**。
2. 两边的 `<head>` 里都各有 **29 个内联 `<style>` 块**，且**各有一个含 `pagination`**。
   把那一块打出来，两侧**逐字节相同**，规则一直在。
3. 线上真实标记 `<nav class="sticky pagination" … style="--collapsed-width:14em;">`，
   两个分页按钮都带 `data-v-f5f3e0f6`，`:first-child` / `:last-child` 都成立。

**第二次**（问浏览器之后）：写了个 CDP 探针，把「哪些样式表规则命中了该元素并声明了 margin」
全量列出来，结果是 **空数组**。配合 `isFirstChild: true`，一度以为是选择器不匹配。

**第三次**（改问几何）：真正的原因是 `margin-inline-end: auto` 在**没有剩余空间**时
used value 就是 `0px`。量 `.pagination` 本身：

| | 线上 | Astro（当时） |
|---|---|---|
| `.pagination` 宽 | **224px**（`max-width: var(--collapsed-width)` = 14em） | **752px** |
| 子项合计宽 | 222.0px | 268.75px |
| 剩余空间 | 1.998px | 483.25px |
| prev `margin-right` | 0px | 240.625px |
| next `margin-left` | 0px | 240.625px |

线上 224px 容器装 268.75px 的内容是**超满**的，auto 外边距分不到任何剩余空间 → 0px。
Astro 752px 装 268.75px，空出 483.25px，被两条 auto 各分一半。

**真正的差异是一个 class**：

```
线上   <nav class="sticky pagination">              ← 没有 expand
Astro  <nav class="pagination sticky expand">       ← 有 expand
```

`&:not(.expand) { max-width: var(--collapsed-width) }` 被这一位打掉。
`expand` 由 `useElementVisibility(anchorEl)` 驱动（`Pagination.vue:14`，
锚点是紧跟其后的空 `<div ref="pagination-anchor" />`），语义是
「**锚点可见 = true**」。Astro 侧写成了：

```js
root.classList.toggle('expand', !entry.isIntersecting)   // ← 极性反了
```

四个滚动状态的实测，修改前后：

| 状态 | 线上 `expand` / 宽 | Astro（改前） | Astro（改后） |
|---|---|---|---|
| ① 初始（顶部） | false / 224 | **true / 752** | false / 224 |
| ② 滚到锚点处 | true / 752 | **false / 224** | true / 752 |
| ③ 滚到最底 | true / 752 | **false / 224** | true / 752 |
| ④ 回顶部 | false / 224 | **true / 752** | false / 224 |

四个状态**逐字镜像**。`useElementVisibility` 的源码当时并不在 `node_modules` 里
（装不到），所以「极性」只能实测——这也说明：**当依赖的语义拿不到源码时，
不要用「读调用点」代替「量运行时」，调用点不携带语义。**

### 77.2 为什么 63 页页高门禁一次都没报它

因为它是**纯横向**差异。224 → 752px 变的是宽度，页高 34px 两边一样。
§72 已经吃过一次这个亏（9px 在 `position: fixed` 里），§76 又吃过一次
（`.feed-card` 的 margin 不在 `STYLE_PROPS` 里、且采样只取头部）。
这第三次是**同一个陷阱的第三个变体**：

> 页高门禁 + 采样式样式对比的交集之外，还有一整个类别：
> **「一个 class 改变了几何，但改的是横向」**。
> 它既不改总高，也不改被采样元素的纵向盒模型。

能抓住它的只有「按属性做**全量取值分布**比对」——
`margin-right` 在两侧的分布是 `{0px × 2}` vs `{0px, 240.625px}`，
不需要配对、不会漏尾部。§76 补的分布比对在这一轮第一次真正救了场。

### 77.3 第二个缺陷：把「组件根元素」翻译成了「枚举父元素」

同一轮里 `/2025/10/lemmy-fediverse-deploy` 的 21 条差异全是同一条：

```
.article code  font-size   nuxt 13.6px × 26      astro 13.6px × 25 + 16px × 1
               white-space nuxt break-spaces ×26  astro break-spaces ×25 + normal ×1
               border      nuxt 1px solid × 26    astro 1px solid ×25 + 0px none ×1
               …共 21 个属性，全是同一条分布差异
```

一开始判断成「内容漂移」（Astro 多写了一个行内 `<code>`）。
**又错了。** 浏览器分类每个 `.article code` 的祖先链后，异类浮出来：

```
code < strong < p.prose-paragraph.has-quote-button < article.article.md-tech
```

即 `<p><strong><code>…</code></strong></p>`。26 个 code 里 25 个是 `p` 的直接子元素，
只有这 1 个套在 `<strong>` 里。

线上那 26 个**全都是**同一套样式。追到源头：

```vue
<!-- app/components/content/ProseCode.vue:34-52 -->
<style scoped>
code { margin: .1em; padding: .1rem .3em; border: 1px solid var(--c-border); … }
</style>
```

Vue 把它编译成 `code[data-v-cee6d9c7]`——**组件根元素**，对任意嵌套深度都生效。
Astro 侧当时写的是：

```css
article p > code, article li > code, article td > code, article th > code,
p > code, li > code, td > code, th > code { … }
```

**枚举父元素**。这只在「code 是 p/li/td/th 的直接子元素」时等价，
一旦 code 套一层就漏。这与 §76 的 `:deep` 锚点丢失是**同一个错误的两种形态**：
都是「把 Vue 组件边界表达的东西，换成了一种在 CSS 里近似、但不完整的表达」。

改法不是继续往枚举表里加 `strong > code`、`em > code`、`a > code`——
那是打地鼠。改成按**同一集合**判定：

```css
article code:not(pre code):not(.copy):not(.domain), …（原枚举保留）
```

三个排除项各有实测依据，不是猜的：

| 排除 | 依据（`.output/public` 与 `astro-site/dist` 全站 `<code>` 标签普查） |
|---|---|
| `pre code` | 块级代码。Astro 的 `<pre>` 由 `.z-codeblock` 渲染，不加会把围栏代码涂上行内代码的边框 |
| `.copy` | `.copy` 块本身就是 `<code class="copy">`（线上产物 13 处），它有独立的 `contain/border/display:flex`，线上**不叠加**行内代码样式（`data-v-b61a6264` ≠ `data-v-cee6d9c7`） |
| `.domain` | `/link` 好友卡的域名（37 处），文章外也有 |

**集合口径（全站 `<code>` 开标签形态分布）**

| | 线上 `.output/public` | Astro `dist` |
|---|---|---|
| 无 class | 300 | 306 |
| `class="domain"` | 37 | 37 |
| `class="copy"` | 8 + 5 = 13 | 14 |
| 带 `language-*` / `copyable` | 4（`scope=cee6d9c7`，即仍属 ProseCode） | 0 |

改后复测：lemmy 26/26 逐位相同；`/2025/05/maitetsu-video-fix`（`.copy` 块所在页）
5/5 未变；`/link` 的 37 个 `.domain` 仍是 `border: 0 / padding: 0`（未被误伤）。

### 77.4 第三个缺陷：404 页**对应的源文件**就选错了

63 页页高门禁扫的是 sitemap 里的 URL，**404 不在里面**，所以它从来没被看过。
手工访问 `https://blog.sotkg.com/definitely-not-a-real-page-xyz` 时发现的：

| | 线上 | Astro（改前） |
|---|---|---|
| `<title>` | `404 \| Mikuの极光星` | `Mikuの极光星` |
| 容器 | `.error.proper-height` 直接在 `main` 里 | `.app-error > .error`（多一层 `margin: 1rem`） |
| 图标 | `line-md:document-delete-twotone` | `tabler:file-off` |
| 标题 | `内容为空或页面不存在` | `[404] 页面不存在` |
| `.operation` | **空 div** | 「返回主页」按钮 |
| 额外文案 | 无 | 「你访问的地址可能已被删除、改名，或从未存在过。」 |
| head | 有 og:title / og:url / og:site_name / og:locale / twitter:card | 同上，但**多** description / og:description / og:image / canonical |

`404.astro` 的文件头写着「对应 `app/error.vue`」。**这是错的。**
源项目有两条互不相干的 404 路径：

1. `app/error.vue` —— Nuxt **抛错**时的应用级错误页。静态站不抛错，**永不执行**。
2. `app/pages/[...slug].vue:56-60` —— catch-all 在「查不到 post」时就地渲染

   ```vue
   <ZError v-else icon="line-md:document-delete-twotone" title="内容为空或页面不存在" />
   ```

   同时 `setResponseStatus(event, 404)` 且 `route.meta.title = '404'`。

GitHub Pages 对任何不存在的路径都返回 `404.html`（Nuxt 的 SPA 壳），
壳水合后由 vue-router 匹配到 `[...slug]` → 走第 2 条。
**物证**：线上 404 的 Nuxt payload 是 `[{"prerenderedAt":1,"serverRendered":2}, …]`，
`serverRendered: false`——静态壳里根本没有错误页 HTML，那块 DOM 是客户端画出来的。
`app/error.vue` 的那些痕迹（`.app-error`、两个按钮、`[404] 页面不存在`）**一个都没出现**。

改法：按 `[...slug].vue` 的 no-post 分支重写 `404.astro`，
并给 `Base.astro` 加 `minimalSeo` 开关去掉那四个线上不存在的标签。
产物验证（`dist/404.html`）：

```
<title>  404 | Mikuの极光星        og:title  404 | Mikuの极光星
description/og:description/og:image/canonical  = (无)
og:type website   og:site_name Mikuの极光星   og:locale zh_CN
robots noindex, nofollow        twitter:card summary_large_image
.error.proper-height → span.error-icon[data-icon=line-md:document-delete-twotone]
                     → div.error-title「内容为空或页面不存在」
                     → div.operation（空）
app-error / 返回主页 / 从未存在过 / tabler:file-off   全部 gone
```

**唯一无法复刻的一项**：`og:url`。线上给的是**被请求的那个路径**
（`https://blog.sotkg.com/<任意不存在的路径>`），静态 `404.html` 承载全部 404 请求，
构建期无从得知，只能给 `/404`。这是静态站承载 404 的固有差异，已写进文件头。

#### 77.4.1 主体对齐之后，图标盒子还是 96×112 而不是 80×80

改完结构后逐项量 `.error` 的四个子元素，**三个已经完全相同**，
只有图标的盒子对不上：

| `.error` 的子元素 | 线上 | Astro（改结构后） |
|---|---|---|
| 空 `<div>` | 0×0 @ y 245.2 | 0×0 @ y 245.2 |
| `.error-icon` | **80×80** @ y 277.2 | **96×112** @ y 261.2 |
| `.error-title` | 240×33.6 @ y 389.2 | 240×33.6 @ y 405.2 |
| `.operation` | 0×0 @ y 454.8 | 0×0 @ y 470.8 |

差值 32px 整——**正好一个 `gap: 2rem`**。也就是说图标多占了 32px，
后面所有兄弟元素被依次推下去。而 `.error` 是 `height: 700px; justify-content: center`，
所以整块是**居中位移**，图标本身反而偏上 16px。

**根因**：`main.css` 有一条

```css
:where(.iconify) { vertical-align: sub; flex-shrink: 0; font-size: 1.2em; display: inline-block }
```

线上 Nuxt 的 `<Icon class="error-icon" :name="icon" />` 把 `error-icon` 和 `iconify`
放在**同一个元素**上：

```html
<span class="iconify i-line-md:document-delete-twotone error-icon" aria-hidden="true"></span>
```

`:where()` 的特异性是 **0**，而 `Error.vue` 的 `.error > .error-icon[data-v-fde94a2b]`
是 (0,3,0) —— `font-size: 5rem` 赢，Iconify 运行时给这个 span 1em×1em = 80×80。

Astro 侧 `Icon.astro` 确实把 class 合并进 `iconify`（`rootClass = ['iconify', className]`），
**但 astro-icon 的 `<Icon>` 组件自己又包了一层 `<span>`**，于是拆成两层：

```html
<span class="error-icon"><svg class="iconify" …></svg></span>
```

`5rem` 落在外层 span（`Error.astro` 自己的 cid），`1.2em` 落在内层 svg，
按外层的 5rem 解析成 **6rem = 96px**。`svg` 带 `width="1em" height="1em"`，于是 96×96；
外层 span 作为 flex item 收缩到 96 宽，高度是 96px 字号撑出的行盒 → 96×112。

**注意这里的因果方向**：`:where()` 零特异性在**线上救了场**（组件样式压得住全局尺寸规则），
在 Astro 侧因为**类被拆到两层**而失效。同一段 CSS，两边行为相反。

修法（定点，不动 `Icon.astro` 的结构——那会波及全站 50+ 处调用方）：

```css
> .error-icon {
	font-size: 5rem;
	color: var(--c-text-3);

	> :global(.iconify) {
		font-size: 1em;   /* 抵消 main.css 的 1.2em */
		display: block;   /* 去掉 inline-block 的基线间隙，盒子正好 1em×1em */
	}
}
```

`display: block` 不是随手加的：只改 `font-size` 的话外层 span 高度仍是行盒高（≈96×112），
而线上是 1em×1em。改完复测四个子元素**逐位相同**（80×80 @ y 277.2，
`.error-title` 回到 y 389.2，`.operation` 回到 y 454.8），`bodyH` 两侧同为 1339。

**这条差异的通用形状**（值得记住）：`class` 在两边落在**同一个元素**上还是**被组件
再包一层**，决定了「组件自己的 `font-size`」能不能压住 `:where(.iconify)` 那条全局规则。
凡是**调用方给图标包装元素显式设了 `font-size`** 的地方都要重新量一遍；
本次只发现 `Error.astro` 这一处（`Error.astro` 全站只被 `404.astro` 引用）。

**仪器自身的盲区**（记下来）：这一轮我先写了个「列出所有命中该元素且声明了
`font-size/width/height` 的规则」的 CDP 探针，结果返回**空数组**——
因为它对含 `cssRules` 的样式规则直接 `continue` 去递归，**跳过了该规则自身的声明**，
而 CSS 嵌套里 `.error-icon` 正是作为 `.error` 的**嵌套子规则**存在的。
即「嵌套规则的选择器文本是 `& > .error-icon`，`matches()` 直接抛错」。
结论仍然由 `getComputedStyle` 的数字和静态 CSS 搜索交叉定出，但那个探针本身是瞎的。

### 77.5b 390 维度首次真正跑起来，逮到一条**仪器自己的假阳性**

补上 `live:style-parity-mobile`（§77.7）之后第一次跑 390×844 的计算样式对比，
结果是 **63 页全部有差异**。逐条归类后只有两类：

**(a) 63 页各 1 条 `.hide-above-mobile { line-height }`：Nuxt 31.36px / Astro 22.4px。**

这条 `BlogPanel.astro` 的注释里早就预告过：

> `line-height`（Nuxt 31.36px / Astro 22.4px），但**渲染几何完全相等**（都 42.9px）——
> 因为 Nuxt 那边 strut 根本没参与行盒高度。用户看得见的是几何，不是这个值。
> `STYLE_SELECTORS` 里没有 `.panel-anchor button`，所以样式门禁不会报它。
> 哪天有人把这个选择器加进列表，报出来的会是**假阳性**，别顺手改回来。

`.hide-above-mobile` 现在确实在 `STYLE_SELECTORS` 里（62 项），于是这条假阳性
在 390 下把每一页都染红了。**注释不能直接当证据**，所以重新量了一遍：

| `.hide-above-mobile` 下的元素 | 线上 | Astro |
|---|---|---|
| skip-link | 390×50.39，lh 22.4px | 390×50.39，lh 22.4px |
| `toggle-sidebar` 按钮 | **42.88×42.88**，lh 31.36px | **42.88×42.88**，lh 22.4px |
| `bg-mask`（仅 Astro 有） | — | 390×844，lh 22.4px |

几何逐位相同，注释的结论成立。处理方式选**进 `STYLE_ACCEPTED` 而不是删选择器**：
删掉选择器会让这条差异彻底消失、连注释都跟着失效；写进接受表则把「为什么可以不等」
连同「别改回去」一起钉在仪器里。这与 `.gradient-card.text-align`（线上漏链样式表）
是同一类机制。

**(b) `/link` 的 13 条 `.feed-card` 差异：13 条全部落在 `nth = 2`。**

值分别是 `font-size 14.4px vs 16px`、`text-align center vs start`、
`list-style-type none vs disc`、`margin 0 vs 16/67px`、`padding 7.2 vs 8px`……
一眼就像「Astro 侧卡片换了个布局」。**但三条独立证据都否定这个读法：**

1. **全量取值分布两侧逐项相同**（同一份产物里 `dist` 与 `style` 两种判定自相矛盾）：

   | 属性 | 线上 | Astro |
   |---|---|---|
   | `font-size` | `14.4px ×36` + `16px` | `14.4px ×36` + `16px` |
   | `line-height` | `20.16px ×36` + `22.4px` | `20.16px ×36` + `22.4px` |
   | `text-align` | `center ×36` + `start` | `center ×36` + `start` |
   | `margin` | `0px ×36` + `16px` + `67px` | `0px ×36` + `16px` + `67px` |
   | 盒子宽 | `84.1 ×36` + `224` | `84.1 ×36` + `224` |

2. **37 张卡的几何逐张相同**：前三张 `x = 16 / 107.3 / 198.6`，`y = 207.2`，`84.1×100`。
3. **不是断网假阳性**：按 §76.4 的纪律用 `--host-resolver-rules` 复刻了门禁的隔离再量一遍，
   online 与 offline 两种模式下分布**完全相同**。（这一步是必要的——第一反应本来是
   「线上 `/link` 的好友列表靠客户端拉取，隔离下渲染不同」，实测否定。）

**真因是仪器自己的配对逻辑有洞。** 采样比对按「文本签名」配对，
签名取 `textContent` 的前 40 字符——**它可以重复**。37 张卡里有两张签名相同，
而两侧桶内顺序不同（线上 `[14.4px, 16px]`、Astro `[16px, 14.4px]`）。
原代码 `bucket.find(it => !usedA.has(it))` 按插入顺序取，把这两张配反了。

改成**逐桶比取值的多重集**：

```js
// 多重集相同 ⇒ 该签名下不存在任何取值差异，不产出 diff
// 多重集不同 ⇒ 报一次，并给出两侧的取值
// 某一侧整桶缺失（真·少元素）时退回按下标配对；
// 少掉的数量本身已由 visible 计数检查单独报出，不会漏
```

这条改动同时保留了 §76 引入签名配对时修的那个问题（piece-hy1 线上 13 个可见 `article p`
对 Astro 10 个，按下标比会把两段不同文字当成同一段）——少掉的元素仍然由 `visible` 计数报出。

**这一轮的教训和 §76.4.1 是同一条**：同一个 `sel.prop` 上，`dist` 判「相同」而
采样判「不同」时，**矛盾的一定是采样**。而且这次的假阳性不是「口径不同」，
是**配对错位**——分桶相同不代表桶内顺序相同。
更一般地说：**任何用下标或插入顺序去配对「可重复键」的逻辑，都会错位。**

### 77.5c 剩余 6 页红光的定性（本轮收口）

1600 浅色这一轮从 8 页降到 **6 页**，而且**再没有任何计算值差异**，全部是 `kind=count`：

| 页面 | 差异 | 定性 |
|---|---|---|
| `/2024/03/takagi` | `.article h2` 4→3、`.article a` 4→3 | 内容漂移 |
| `/2025/05/clannad-zh-linux` | h2 4→3、a 6→5 | 内容漂移 |
| `/2025/05/gal-up` | h2 9→8、a 31→30 | 内容漂移 |
| `/2025/05/koichoco-psp` | h2 5→4、a 14→13 | 内容漂移 |
| `/2025/10/clarity-resource-list` | h1 1→0、pre 2→1 | MDC 槽位解析瑕疵（源站自身） |
| `/2025/10/nukitashi-gv-end` | h1 1→0、h2 4→3、a 10→9 | 混合：MDC 瑕疵 + 内容漂移 |

**内容漂移这一类现在有了 `git` 层面的铁证**，不再是推断：

```
$ git status --porcelain -- content/posts
 M content/posts/2024/03/takagi.md
 M content/posts/2025/05/clannad-zh-linux.md
 M content/posts/2025/05/gal-up.md
 M content/posts/2025/05/koichoco-psp.md
 M content/posts/2025/10/nukitashi-gv-end.md

$ git diff -U1 -- content/posts/2024/03/takagi.md
-## 相关条目
-::bgm-card
----
-id: 219200
-compact: true
----
-::
```

五篇都删了同样这 9 行（一个 `## 相关条目` 标题 + 一个 `::bgm-card`），
**且未提交**。Astro 从当前工作区构建，线上跑的是最后一次提交。
所以每个页面恰好少一个 `h2` 和一个链接——与实测数字逐项吻合。
**这正是「内容还没部署」的信号，不该被静音**；部署完这 5 页，红灯自己会灭。

`clarity-resource-list` 的源文件**没有**未提交改动，所以它的 h1/pre 差是另一类。
追到 MDC 槽位语法：

```
HEAD 版 .md  的标题: ["## 前言","## 组件文件","### Github Gist","### 本站","## 使用","# tab2"]
当前   .mdx 的标题: ["## 前言","## 组件文件","### Github Gist","### 本站","## 使用"]
当前   .mdx 的组件: ["<Tab tabs={[\"组件\",\"语法\"]}>"]
```

`# tab2` 是 MDC 里给第二个 tab 起的锚点，被 MDC 当成**真正的标题**解析了。
浏览器实测线上确实渲染出一个**可见的**元素：

```
线上   .article h1  "tab2"  752×57.6  font-size 32px  父元素 div.tab-content
Astro  .article h1  （无）
```

`nukitashi-gv-end` 是同一个家族的另一个实例——源里的 `# icon` 槽位：

```
线上   .article h1  "icon"  752×57.6  font-size 38.4px  父元素 div.quote.title-like
Astro  .article h1  （无）   → 转成了 <Quote> 的 icon 槽
```

两处都是**源站自身的 MDC 解析瑕疵**：作者写的是槽位标记，MDC 把它当标题吐了出来，
于是线上文章里出现了一个 32–38px 的「tab2」「icon」大字。
刻意复刻它等于故意在正文里插一个假标题，因此**不改**——
与 `.search-btn`（线上漏链样式表）、`.hide-above-mobile`（几何相同）同类处理。

顺带确认深色维度：**63 页零计算值差异**，只剩上面那 4 类 `count`。

### 77.5d 修完配对缺陷，又暴露第二层：置换也是不可见的

把签名分桶改成「逐桶比取值的多重集」之后，`/link` 那 13 条假阳性确实消失了，
但 1600 那一趟**冒出三条新的**：

```
/link                    .gradient-card.list-style-type  nuxt=disc   astro=none
                         .gradient-card.margin-{top,right,bottom,left}
/games/galgames/riddle-joker   .article p.padding-right × 6
```

一度以为「改坏了仪器，把原来被配对错位掩盖的真缺陷放出来了」。
逐条查下来是**第三种**情况，而且它同时说明前两种改法都只对了一半。

**这三条的共同点**：同一个 `sel.prop` 上，**全量取值分布两侧仍然相同**。
也就是说取值集合没变，只是落到了**文本互不区分**的元素上：

- `/link` 的两个 `.gradient-card`（侧栏那个搜索按钮 + 搜索框里的那个）
  文本一样，四个 margin 在两侧恰好互换；
- `riddle-joker` 的若干 `.article p` 同理（`padding-right 0px ↔ 25.92px`）。

文本都一样 ⇒ **用户分不出哪张是哪张** ⇒ 置换不可见 ⇒ 不该报。

于是判据补上第二道门槛，**先算全量分布，再决定要不要看逐元素**：

```js
// 权威判定先行：先算出哪些属性的全量取值分布两侧不同
const distDiff = new Set()
for (const p of STYLE_PROPS) { /* …两侧 dist 逐项相同就不进集合… */ }

// 逐桶比较时，只对 distDiff 里的属性报
for (const p of STYLE_PROPS) {
	if (!distDiff.has(p)) continue
	// …比多重集 / 按下标配对…
}
```

**这不是放水**：分布不同的情况（真的多了一张、少了一张、某个值变了）一律照报。
两道门槛合起来的语义是完整的：

| 全量分布 | 逐元素 | 判定 |
|---|---|---|
| 相同 | 相同 | 一致，不报 |
| 相同 | 不同 | **同文本元素间的置换 → 不可见 → 不报** |
| 不同 | 任意 | **一定有可见差异 → 报** |

#### 负控（必须做过，否则不敢信）

改的是核心比较逻辑，所以按纪律注入真实缺陷看它变红。

**注入**：把 `FeedGroup.astro` 的 `.feed-group :global(.feed-card.feed-card)` 改回
裸的 `:global(.feed-card.feed-card)`（§76 修过的那条，锚点丢失 → `/link` 少 8px）。

```
$ pnpm build && node scripts/compare-ui-parity.mjs --styles --urls=/link
  DIFF    8  /link   (另有 10 处仅隐藏元素数量不同，不计)
        .feed-card [0].margin-top     nuxt=16px      astro=0px
        .feed-card [0].margin-right   nuxt=190.031px astro=0px
        .feed-card [0].margin-bottom  nuxt=16px      astro=0px
        .feed-card [0].margin-left    nuxt=190.016px astro=0px
        .gradient-card [0].margin-*  （同上）
  exit 1
```

**恢复**：

```
$ pnpm build && node scripts/compare-ui-parity.mjs --styles --urls=/link
   ok       /link
  有差异的页面: 0 / 1
  exit 0
```

红/绿双向都有证据。注意负控里 `.gradient-card` 的 margin 也红了——
这说明注入的缺陷确实改变了 `/link` 的整体分布（独立卡片丢了 `margin: 1em auto`
后相邻元素跟着移位），**不是**上一轮那种置换假象。两者可以用「全量分布是否改变」区分。

**顺带修掉两处既有文本损坏**（本轮扫 `U+FFFD` 时发现，与本次改动无关）：

| 文件 | 损坏 | 修复 |
|---|---|---|
| `src/lib/list-transition.ts` | `会拿<1 个 U+FFFD>过期的坐标` | `会拿到过期的坐标` |
| `scripts/audit-css-blocks.mjs` | `再回到原<3 个 U+FFFD>上切片` | `再回到原文上切片` |
| `scripts/compare-ui-parity.mjs` | `已知的、被用户明确接受<2 个 U+FFFD>差异` | `已知的、被用户明确接受的差异` |

全树 235 个源文件扫完，损坏文件数 0。

### 77.5 顺带证伪的一条「遗留取舍」

`BlogPanel.astro` 与 `layout-state.ts` 里都写着：

> `avoidTargets` / `useAvoidTransform` 未移植。Nuxt 侧只有 `pages/archive.vue`
> 和 `partial/Pagination.vue` 注册避让目标，**站点外壳自身从不注册** → transform 恒为 `''`。

**依据是错的**：`useAvoidTransform(originRef, targets)` 里 origin 是**面板自己**，
注册的是**目标方**，「外壳不注册」与「算不出 transform」毫无关系。
正确依据是**几何上永不重叠**。实测（CDP，7 页 × 2 视口 × 4 滚动状态）：

- 1600×1000：面板里两个开关分别带 `hide-above-tablet` / `hide-above-mobile`，
  被隐藏成 0×0，`.panel-anchor` 退化成 (1569, 968) 的零宽点。
  `#blog-panel` 的 transform 全程 `none`。
- 390×844：面板 42.9×85.8，x ∈ [331.1, 374]；sticky 分页收拢时 x ∈ [83, 307]
  （横向不重叠），展开时虽全宽 x ∈ [16, 374] 但 y ∈ [384.3, 418.2]，
  远在面板 y ∈ [726.3, 812] 之上（纵向不重叠）。

结论不变（省略它与线上不可区分），但依据换成了实测数字，
并注明这是**几何巧合而非不变式**——移动端若出现第三栏、或分页改贴右，差异会立刻显形。

### 77.6 两个从未跑过的脚本

普查 `scripts/` 接线情况时发现 **13 个脚本没有任何 Step 调用**。逐个看下来，
有两个不是「诊断工具所以不接线」，而是**根本跑不起来**：

**`compare-text-volume.ps1`** —— `$base = (Resolve-Path '..\.output\public')`
从 `astro-site/scripts/` 出发解析成 `astro-site/.output/public`，
而 Nuxt 产物在**仓库根**（`astro-site/` 的上一层）。第一行就抛异常。
改成从 `$MyInvocation.MyCommand.Path` 解析后能跑了，输出是：

```
pages compared : 68
total chars    : nuxt=217808  astro=271743  delta=53935 (24.8%)
pages where Astro renders LESS : none
biggest gains: / +430.6%  /games/galgames/clannad +670.4%  /archive +169.0%
```

**这个数字不能当结论读。** 它比的是两侧**静态 HTML 文件**的文本，而 Nuxt 侧
相当一部分页面只是 SPA 壳（`/` 的 payload 就写着 `serverRendered: false`），
Astro 则全部预渲染。所以「Astro 在 `/` 上多渲染 430%」的真实含义是
「`.output/public/index.html` 几乎是空的」。
「MDC → MDX 有没有丢内容」这个问题由**渲染后**的对比回答
（`compare-ui-parity.mjs` 的逐页节点数与页高），不由它回答。
已在文件头写死这一点，并明确**不要**把它接成门禁——
一个会误报的计数器比没有计数器更糟（§76.4.1 的同一条教训）。

**`check-generated-urls.ps1`** —— 更彻底：它要的 `astro-site/baseline-urls.txt`
**在整个仓库里都不存在**，且 `.\src\content-mdx` 同样是按进程 CWD 而非脚本位置解析的。
它想做的事（生成的 URL 集合是否等于 Nuxt 那套）已被
`compare-remote-sitemap.mjs` 更好地做了——后者拿**线上 sitemap** 做 diff，
当前 `remote 63 / local 63 / PASS`；而冻结的本地基线看不到线上变化。
`astro-site/` 是 untracked，删除不可从 git 恢复，因此**保留文件 + 加显著文件头**
标注「DEAD SCRIPT — DO NOT WIRE」，而不是删掉。

### 77.7 本轮新增的门禁接线

`.astro-compare/style-parity-w390x844.json` 这个产物已经手工跑了若干轮，
但 `acceptance.ps1` 里**没有对应 Step**。按 §67.1 的同一条纪律
（「新写的仪器不接进 `acceptance.ps1` 就等于不存在」），
在 `-Mobile` 下补了 `live:style-parity-mobile`：

```powershell
& node scripts/compare-ui-parity.mjs --styles --width=390 --height=844
```

`--Mobile` 关闭时（线上不可达的分支）同步补上对应的 SKIP 行。
三个 `.ps1` 改动后均验证：`nonAsciiBytes=0`、`BOM=False`、`PARSE=OK`。

### 77.8 本轮改动清单

| 文件 | 改动 |
|---|---|
| `src/components/partial/Pagination.astro` | `!entry.isIntersecting` → `entry.isIntersecting`；补极性注释；`avoid` 降级说明改为「已实测不可观测」 |
| `src/styles/prose.css` | 行内代码选择器加 `article code:not(pre code):not(.copy):not(.domain)` |
| `src/pages/404.astro` | 按 `[...slug].vue` no-post 分支重写（图标 / 文案 / 去 `.app-error` / 去按钮与提示 / `title="404"` / `minimalSeo`） |
| `src/layouts/Base.astro` | 新增 `minimalSeo` prop |
| `src/layouts/Blog.astro` | 透传 `minimalSeo` |
| `src/components/blog/BlogPanel.astro` | 「遗留取舍」注释换成实测几何依据 |
| `src/lib/layout-state.ts` | 同上，并指出原依据把 origin 与 target 搞混了 |
| `src/components/partial/Error.astro` | `> .error-icon > :global(.iconify){font-size:1em;display:block}`，把错误图标从 96×112 拉回 80×80 |
| `scripts/acceptance.ps1` | `-Mobile` 下新增 `live:style-parity-mobile`（含 SKIP 分支） |
| `scripts/compare-ui-parity.mjs` | ① 签名分桶改为逐桶比取值多重集；② 新增 `distDiff` 门槛（分布相同则不报逐元素差异）；③ `STYLE_ACCEPTED` 增 `.hide-above-mobile.line-height`；④ 修一处 U+FFFD 文本损坏 |
| `scripts/compare-text-volume.ps1` | 修路径 bug（从脚本自身位置解析）；加「这是报告不是门禁」文件头 |
| `scripts/check-generated-urls.ps1` | 加「DEAD SCRIPT — DO NOT WIRE」文件头（未删：untracked 不可恢复） |
| `src/lib/list-transition.ts`、`scripts/audit-css-blocks.mjs` | 修既有 U+FFFD 文本损坏（与本轮改动无关） |

### 77.9 覆盖率的边界：63 页之外还有什么

`dist` 里有 **68 个 HTML 页**，页高/样式门禁只量 **63 个**。差的 5 个是：

| 未覆盖页 | dist 大小 | 线上 | 为什么不在 63 页里 |
|---|---|---|---|
| `/404` | 49KB | 200 | 不在 sitemap。本轮已**手工**逐项对齐（§77.4） |
| `/favicon.ico` | 0KB | **404** | 是图标路由不是页面；线上也没有 |
| `/preview` | 71KB | 200 | robots.txt `Disallow: /preview`，不在 sitemap |
| `/previews/example` | 384KB | 200 | `Disallow: /previews/*`，不在 sitemap |
| `/previews/bangumi-components` | 63KB | 200 | 同上（保留的展示资产） |

也就是说 **3 个线上真实存在的页面（合计 518KB，其中 `/previews/example` 是全站最大的单页）
从来没被页高与样式门禁量过**。它们只能靠 robots 屏蔽才没进 sitemap——
这与坑位 10 是同一个形状：**不在清单里的东西等于没测**，
区别只是这次漏的不是「某个源文件」而是「整个路由」。

本轮的处理：先手工确认可达性与体量，把边界记在这里；
`check-head-vs-live.ps1` 的默认 `$Paths` 里已经有 `/previews/example`，
所以它的 head 侧是被比过的，缺的是几何与计算样式。
是否把它们纳入常规门禁，取决于「noindex + robots 屏蔽的页面算不算切流范围」这个判断，
留给你拍板，本轮没有擅自加进 63 页清单。

端点侧另有一处值得记：`/search-index.json` 与 `/api/entries.json` 在**线上是 404**，
是 Astro 侧新增的产物。`/atom.xml`、`/llms.txt`、`/api/stats`、`/subscriptions.opml`、
`/raw/*` 两侧都在。

## 78. 三个真缺陷、一个已定性的噪声、三处仪器增强

本轮从「页高×2 全部收敛」这个看起来很干净的起点出发，又挖出三样东西：
一个**真的功能缺陷**、一处**被当成缺陷扛了好几轮的噪声**、以及**仪器自己两个必须记的坑**。
外加一处「差值来源根本不在你以为是的那一侧」的量级。

### 78.1 第二十三种失效模式：「不在清单里的东西等于没测」的第二形态是**整条路由**

`compare-ui-parity.mjs` 的受测 URL 一直是从 `sitemap.xml` 取的。而 `robots.txt` 里写着：

```
User-agent: *
Disallow: /preview
Disallow: /previews/
```

于是 `/preview`、`/previews/example`、`/previews/bangumi-components` **三页**从来不在清单里。
`dist` 里有 68 个 HTML，页高与样式门禁只量 63 个——§77.9 把这个边界记下来了，
但当时的结论是「留给你拍板」，没有往下问一句：**不量它们的代价是多少？**

代价是可数的。`content/previews/**` 用到 19 个 MDC 组件，其中 **12 个在 `content/posts/**` 里
一次都没出现过**：

```
blur  card-list  link-banner  link-card  meta-aside-bar  meta-aside-foo
meta-copyright  poetry  project-group  series-group  timeline  video-embed
```

也就是说这 12 个组件的迁移正确性，**没有任何测量背书**。
（对照组：另 7 个是 `alert` 17 页、`pic` 7 页、`music` 4 页、`folding` 2 页、`tab` 2 页、
`quote` 1 页、`chat` 1 页——这些在文章页出现过，所以被 63 页门禁间接覆盖到了。）

手工核对 `/preview` 的 HTML，立刻就抓到一个真的功能缺陷：

```
线上：<h1 data-v-77ae54c9><a href="/" class="hide-above-mobile" title="返回首页">
        <span class="iconify i-tabler:chevron-left" aria-hidden="true"></span></a>预览 </h1>
Astro：<h1 data-astro-cid-ds7gzlj5>预览</h1>
```

`app/pages/preview.vue:19-23` 的 h1 里有一个「返回首页」箭头链接，
Astro 侧 `src/pages/preview.astro` 只写了裸文本「预览」——`UtilLink` + `Icon` 整个漏掉了。
这不只是少一个装饰：**移动端没有任何回首页的入口**（链接带 `hide-above-mobile`）。

**为什么两道门禁都看不见它**（这一条才是本节的重点）：

- 页高对比看的是**总高度**。这一页在 390 下线上 1176 / 本地 1176，**完全相同**——
  少一个内联图标链接不改变行盒高度。（下面 §78.5 的负控实验会把这个再演示一遍。）
- 样式对比比的是 `STYLE_SELECTORS` 里那几十个选择器 × `STYLE_PROPS` 里那几十个属性。
  表里**没有** `.preview-header a`，所以「那个元素在不在」根本不在判据里。

判据表覆盖不到的元素类别，就是门禁的盲区。**这和坑位 10 是同一个形状**：
坑位 10 是「猜错某个页面由哪个源文件产出」，这次是「整条路由连同它 12 个专属组件一起不在清单里」。

修法：

1. `src/pages/preview.astro` 补回 `<UtilLink class="hide-above-mobile" to="/" title="返回首页">`
   ＋ `<Icon name="tabler:chevron-left" />`；
2. `src/components/blog/UtilLink.astro` **显式声明 `title`**——它不在 `Props` 里，
   而 Astro 没有 attribute fallthrough（坑位 1），不声明就得靠 `{...rest}` 兜住，那正是
   「传了却被静默吞掉」的形状；
3. 新增 `scripts/lib/page-list.mjs`，把「sitemap + 这三页」收敛成**唯一**清单来源，
   清单变成 66 页。清单只有一处，以后加页面不会再漏掉另一道门禁。

顺带一条**别改回去**的：`/preview` 比线上多一层 `UtilListTransition` 包裹。
这一条是**有意**的，而且 `scripts/check-list-controls.mjs` 已经把它钉成不变式，
还配了一条负控（摘掉 wrapper 必须让该门禁变红）。`preview.astro` 的文件头现在写明了这一点。

### 78.2 第二十四种失效模式：**同一个渲染结果，两边的 HTML 结构上就不可比**

拿到「线上整站预渲染」这个事实之后，我做的第一件事是写一道**静态 HTML 语义对比**门禁
（不开浏览器、不跑 preview，直接 parse5 两边 HTML 比可交互元素的签名多重集）。
它的动机很正当：比浏览器快几十倍、不受隔离模式干扰、不产生假阳性。

它报出来的第一条差异是：

```
a|#前言|||          线上 2 / 本地 1
a|#介绍|||          线上 2 / 本地 1
...（13 条）
```

即「线上每个标题的文字本身是自链接 `<h2 id="前言"><a href="#前言">前言</a></h2>`，
Astro 侧只有 `<h2 id="前言">前言</h2>`」。看着像个整站级别的功能缺失。

**它是假的。** 三条独立证据：

1. Nuxt Content 的 `anchorLinks` 是**构建期**产物（§63.3 记过：`depth: 4`，只包 h1–h4），
   所以它进 SSR HTML；Astro 侧的等价实现 `prose-enhance.ts` 是**运行时**增强。
   同一件事，一边在建 HTML 时做、一边在浏览器里做 ⇒ **渲染结果一致，HTML 不同**。
   交叉验证：静态数 `.article` 里的 `a`，线上 17 个（其中 14 个在标题内），本地 3 个——
   而**真实正文链接两侧都是 3 个**，一个不多一个不少。
2. 反方向也成立：Astro 侧**静态输出**了搜索框、分享弹窗的按钮、65 个「引用整段到评论区」、
   二维码 `<img>`；这些在 Nuxt 侧是 client-only，HTML 里压根没有。
3. `button` 的 `type`：线上 46 个 `<button>` **全都没有** `type` 属性，Astro 全加了 `button`。
   这不是缺陷（甚至更规范），但足以把签名表淹掉——46 条纯噪声。

结论：**静态 HTML 不是这两站的可比基线。** 判据必须落在**渲染后的 DOM** 上。
这道门禁已删（`rm --`，不是留一个「DO NOT WIRE」的死脚本）。

顺带记下这道门禁自己踩的两个坑——都是「仪器错了而不是站点错了」：

- **`innerText` 没剔 `<script>` 子树。** Astro 把组件 `<script>` 渲染成**组件根元素的子节点**，
  于是 `BlogHeader` 里那个按钮的「文本」把整段 JS 吸了进来，签名长这样：
  `button|button|||搜索Ctrl+Kvar e=/mac?os/i.test(navigator.userAgent),t={" ":\`Space\`...`
  （这段还顺带演示了另一个雷：模板字符串里写反引号会终止字面量。）
- **探针的递归写在了 `if (n.tagName)` 里面。** parse5 的文档根节点 `#document` **没有**
  `tagName`，所以整棵树从来没被遍历过——「parse5 在线上 HTML 里找到 0 个 `<button>`」。
  我差点据此得出「线上根本没有按钮」的结论。
- 还有一条老坑的复现：**正则的字符数上限会造出「元素不存在」的假象。**
  我用 `<h1[\s\S]{0,200}?<\/h1>` 扫线上，结论是「线上 `/preview` 没有 h1」；
  实际偏移 54438 处就有 `<h1`，只是它的闭合标签在 200 字符之外（里面塞着 iconify 的 span）。
  这是 §76.4.1「先确认你的查询覆盖了全部路径」的同一形态。

### 78.3 第二十五种失效模式：**断网模式自己会造假，差值必须用 online 复核**

`/2025/10/lemmy-fediverse-deploy` 的 −19px 在基线里躺了好几轮。§76.4 记过一次，
说「切 online 是 +1px 亚像素」。这轮把它量化了：

| | 线上 | 本地 | d | `.article` 高度 |
|---|---|---|---|---|
| offline | 9645 | 9626 | **−19** | 8463.03 / 8444 |
| online | 9971 | 9971 | **0** | 8444 / 8444 |

机制很清楚：**隔离之后是线上自己变高了 19.03px**，本地一点没动。
线上那篇正文有「靠远程资源才达到的最终排版」（shiki 高亮那类），
断网后它停在 SSR 的纯文本状态，于是基线比候选**更高**。

危险的地方在**方向**：d 是「Astro − 线上」= −19，也就是「Astro 更矮」。
这个方向极易被读成「Astro 少渲染了 19px 的东西」，而实际上什么都没少。
§76.4 的规矩是「离线上报的任何差值必须用 online 模式复核再定性」，
但那一直是**靠人记得做**——于是 −19 就在基线里躺着。

改法：断网量出的差值一旦超容差，工具**自己**用 online 复量一遍
（`--host-resolver-rules` 是启动参数，去不掉，所以要**另起一个没有这条规则的浏览器**）。
落在 `--online-tolerance`（默认 40，就是本工具 online 模式一直以来的默认容差）以内，
就判成 `ARTIF`（隔离假阳性）单独列出——既不混进「一致」让人看不出这一页曾经红过，
也不混进「超差」让人去改本来正确的代码。超差页在报告里把两个数一起打出来。

冒烟验证：`lemmy` → `↳ online 复核：nuxt 12929 astro 12929 d=0px（±40 内）→ 判为隔离假阳性`。

### 78.4 第二十六种失效模式：**「连量两遍一致」不等于「页面是确定的」**

63 页那一趟在 390 下报 `/link` **−20px**，而 1600 下 `/link` 是 0。单页复跑却变成 `UNST`
（线上 2640 / 本地 2654）。这个自相矛盾值得追。

实测（offline，线上 `https://blog.sotkg.com/link?shuffle=false` 连装 10 次）：

```
线上  2677 2677 2677 2674 2633 2654 2650 2670 2674 2674      ← 跨度 44px
本地  2654 ×10（逐字节相同）
```

而**每一次装载内部**连采 5 次（间隔 1s）都是同一个值。
所以这不是「动画还没停」，是**每次装载的结果本身就不一样**。

定位到叶子：只有第 2、3 个 `section.feed-group` 在变（350.27↔353.63、748.14↔788.45），
卡片数不变（8 / 22），**但顺序每次都变**。390 下 `grid-template-columns` 是 4 列 × 84.1px，
卡片名字长短决定换不换行，顺序一变 → 哪几张共处一行就变 → 行高就变 → 总高就变。

根因是线上组内洗牌写在 `onMounted` 里（`app/components/content/FeedGroup.vue:21-24`）：

```js
onMounted(() => {
	if (props.shuffle && route.query.shuffle !== 'false')
		shuffleEntries()
})
```

`app.config.ts:110` 的 `link.randomInGroup` 是 `true`。**「关掉随机」那个逃生口在线上无效**，
三条证据：

1. 页面里 `location.search === '?shuffle=false'`，
   `new URLSearchParams(location.search).get('shuffle') === 'false'`——参数到了；
2. 纯 HTTP 三次取回 `/link?shuffle=false` 的 HTML **逐字节相同**（162127 bytes，同一内容哈希）
   ⇒ SSR 顺序是固定的，**变动发生在客户端**；
3. 渲染后的 DOM 顺序每次都变。

Astro 侧 10/10 次装载恒为同一个值——静态站在构建期就把顺序定死了。
**这不是 Astro 缺陷，更不许为了让两边「看起来一样」而把 Astro 也改成随机。**

改法：`measureStable` 从「量 2 次、判相邻差 `|a−b| ≤ 2`」改成
「量 `--samples`（默认 3）次、判**极差** `max − min ≤ --stability`（默认 2）」。
这和样式门禁的 `distDiff` 是同一个道理：**先看分布，再谈单点**。
只要抖动是间歇的，相邻两次落在同一档的概率相当高——「两次读数一致」是个很弱的判据。
报告里把 N 次读数原样摊开（`线上 2654 / 2657 / 2660  极差 6`），让人一眼分得清
「抖动」和「没停」；原话术「页面仍有未稳定的异步渲染」指向的方向是错的。

冒烟验证：`/link` @390 → `UNST`，`线上 2654/2657/2660 极差 6`、`本地 2654/2654/2654 极差 0`。

**残留局限（写明，不掩饰）**：3 次采样只能把 44px 的跨度降成「大概率被抓住」，不能根除。
`/link` 在 1600 下是稳定的（0 差）——1600 下列数更多、名字换行少，顺序对总高的影响被摊薄了。
真要根除只能让线上把顺序固定下来，而那个逃生口现在不工作。

### 78.5 补上「少了一个元素」这个盲区：语义签名多重集（红绿双向已验）

§78.1 暴露的盲区可以概括成一句：**页高看总高、样式对比看选择器表，
「某个元素在不在」两者都不管。** 于是加了一道语义探针，
和页高**共用同一次浏览器访问**（不额外加载页面）：

- 只收**可见**元素（复用样式探针那套 visible 判据，再加 `closest('[hidden]')`）；
  弹层、搜索框、评论引用按钮这些在 Astro 侧静态输出、在 Nuxt 侧 client-only，
  两侧都不可见，比它们只有噪声。
- 排除 `template`（inert，pre-render 出来的惰性数据集不算）与 `svg`
  （§5 早就定下的有意差异：线上是 Iconify runtime 的 CSS mask、本地是构建期内联 svg，
  它让 `svg`/`path` 的计数每页都不同，对「少了一个元素」零信息量）。
- 签名 = `tag|字段…|文字`；`href`/`src` 去 origin 去尾斜杠，文字合并空白、去零宽字符。
- 比**多重集**而不是按下标配对——与 §76.4 同一个理由，签名可以重复。

**负控（红）**：把 `/preview` h1 的链接注回去，重建，跑 `--urls=/preview --width=390`：

```
[ 1/1]  ok        0  nuxt   1176 astro   1176  /preview SEM+1
  语义签名不一致 : 1
      /preview  (1)
         a|/||
            线上 2 / 本地 1
```

**一次实验同时证明了两件事**：新探针能抓到；以及**页高在同一趟里仍然是 0 差**
（1176/1176）——「少了一个返回首页的链接」在几何上完全不可见。

**恢复（绿）**：改回去、重建、`语义签名不一致 : 0`、exit 0。

还有一层：移动端比桌面端**更要紧**。`/preview` 那个链接带 `hide-above-mobile`，
1600 那一趟两侧都是 `display:none`，语义探针在 1600 下根本看不见它——
这是当初漏掉它的**第二个**原因，也是为什么 `-Mobile` 那一趟必须也带语义检查。

### 78.6 本轮改动清单

| 文件 | 改动 |
|---|---|
| `src/pages/preview.astro` | h1 补回 `UtilLink` + `Icon` 的返回首页链接；文件头记下 ListTransition 包裹是**被门禁钉住的有意差异** |
| `src/components/blog/UtilLink.astro` | `Props` 显式声明 `title` 并落到根元素 |
| `scripts/lib/page-list.mjs` | **新增**。受测清单 = sitemap + 3 个 robots 屏蔽页，唯一来源 |
| `scripts/compare-ui-parity.mjs` | ① 接入新清单（63→66 页）；② 新增语义签名多重集；③ 断网超差自动 online 复量并判 `ARTIF`；④ `measureStable` 改多次装载判**极差**，报告摊开 N 次读数；⑤ UNST 话术改成能区分「抖动」与「没停」 |
| `scripts/acceptance.ps1` | `live:ui-parity` 与 `live:ui-parity-mobile` 的注释补上新清单、语义探针、online 复核三件事的来龙去脉 |

### 78.7 未决

- **`/link` 的组内顺序**：线上那个「关掉随机」的逃生口不工作（§78.4），
  所以这一页在 390 下无法做定高对比，只能记为 `UNST`。要么接受，
  要么推动上游修 `route.query` 的读法（Nuxt 树只读，不在本轮范围内）。
- **MDC 槽位假标题**（`clarity-resource-list` 的 `<h1>tab2</h1>` / `<h1>icon</h1>`）：
  线上渲出可见的假标题，Astro 正确渲成 Tab/Quote 槽位。此前的决定是**不复刻**，
  本轮维持，但这是「刻意与线上不一致」的一处，值得再确认一次。
- **内容漂移 5 页**：仍然是「本地内容比线上多」的部署前状态，**没有**加进任何豁免表。
  该做的动作是部署内容。

### 78.8 第七类差异来源：**部署滞后漂移**——线上根本不是当前 Nuxt 源码

§78.1 的普查顺手挖出一条比它自己更重要的事实。整理一下证据链：

`git status --porcelain`（`D:\Projects\blog-v4`）显示 Nuxt 树里有 **10 个已改动文件**：

| 文件 | 改动内容 | 它解释了哪条「差异」 |
|---|---|---|
| `content/posts/2024/03/takagi.md`<br>`content/posts/2025/05/clannad-zh-linux.md`<br>`content/posts/2025/05/gal-up.md`<br>`content/posts/2025/05/koichoco-psp.md`<br>`content/posts/2025/10/nukitashi-gv-end.md` | 删掉 `## 相关条目` + `::bgm-card` | 已知的 5 页内容漂移（§69.1） |
| `content/previews/bangumi-components.md` | 改写成「功能已移除」+ 原组件清单表格 | `/previews/bangumi-components` 的正文差异 |
| `app/components/blog/BlogSidebar.vue`（状态 `MM`，**暂存区和工作区都改过**） | 叶子项从 `<li><a>` 变成 `<li><ul class="sidebar-nav-leaf"><li><a>` | 侧栏多出 4 个 `ul.sidebar-nav-leaf` |
| `app/assets/css/animation.css` | 给 `will-change` 那组选择器补上 `.collapse-enter-active, .collapse-leave-active` | 侧栏折叠动画（与上一条配套） |
| `app/components/partial/Secret.vue` | 修一条**永不匹配**的嵌套规则 | secret 的「查看预览文章」链接**线上不可见** |
| `shared/utils/icon.ts` | 新增 `import { getDomain, getMainDomain } from './link'` | 友链的 `.domain-icon` 域名图标 |

关键物证是 `BlogSidebar.vue` 那条：

```
$ git show HEAD:app/components/blog/BlogSidebar.vue | grep listClass
（无输出）
$ git show HEAD:app/components/blog/BlogSidebar.vue | grep 'sidebar-subnav'
<ul v-show="..." :id="subnavId(...)" class="sidebar-subnav">
```

`HEAD` 版的模板里**只有** `sidebar-subnav`，既没有 `listClass` 也没有 `sidebar-nav-leaf`。
而工作区版是 `listClass: collapsible ? 'sidebar-subnav' : 'sidebar-nav-leaf'`
（`app/components/blog/BlogSidebar.vue:93`）。线上 `/previews/example` 的 HTML 里
`sidebar-nav-leaf` 出现 **0 次**、`sidebar-subnav` 5 次；
本地则是 `sidebar-nav-leaf` 4 次、`sidebar-subnav` 同样 5 次。

⇒ **Astro 是照「工作区的 Nuxt」移植的，线上跑的是最后一次提交。**
这与 5 篇内容漂移是**同一个成因的两种表现**，只是它这次落在**源码**上而不是内容上。

`Secret.vue` 那条尤其值得记，因为它说明**有些差异是「本地更正确」而不是「本地不一致」**：
原写法 `&:hover > &` 拍平后得到 `.secret[data-v-x]:hover > .secret[data-v-x]`
——要求元素是自己的后代，而模板里没有嵌套同名子元素，**该规则永远不匹配**，
所以线上那个 secret 链接从来不可见。工作区修好了，Astro 也就有了。

#### 这件事改变「怎么读每一盏红灯」

live 对比类门禁的基线是**已部署的 Nuxt**，而 Astro 移植自**工作区的 Nuxt**。
所以任何一条差异只有三种可能，而且**门禁本身分不出来**：

| 类别 | 判定方法 | 该做什么 |
|---|---|---|
| 迁移缺陷 | `git status` 干净、且差异无法用工作区改动解释 | 修 Astro |
| **部署滞后漂移** | 差异能被某个未提交改动解释 | **部署 Nuxt**，别改 Astro |
| 内容漂移 | 差异落在 `content/**` | 部署内容 |

**绝不把这一类加进 `ACCEPTED` / `STYLE_ACCEPTED` / `known`。**
理由和 §69.1 一样：加进去就把「Nuxt 源码还没部署」这个信号永久静音了。
正确动作是部署——部署完这些差异自己归零。

#### 顺带：三道普查仪器自己的坑（写下来是因为都会误导）

做这件事时我连着踩了三个，全属「仪器错了而不是站点错了」：

1. **普查里跳过 `svg` 子树 → 凭空造出「类缺失」。** `.domain-icon` 报「线上 9 / 本地 0」，
   实际上两侧都有 4+ 个：线上挂在 Iconify 的 `<span>` 上，本地挂在**内联 `<svg>`** 上，
   而普查把 `svg` 整棵跳过了。`.toggle-icon`、`.share-icon` 同理。
2. **按 `"${cls}` 找上下文 → 只命中「该类名在 class 属性里排第一」的情况。**
   于是 9 个命中的东西报成 0。正确做法是按解析后的元素找。
3. **只搜 `nav.sidebar-nav` 看不到三级导航。** 两边一级导航逐项相同（文章/归档/资料/友链/关于），
   我据此以为「侧栏一致」；差异其实在「资料」那一组折叠起来的子列表里，
   而它**在 DOM 里但默认 `display:none`**。判「结构一致」之前，
   要把**隐藏的分支**也算进去——这与坑位 12 里 `auto` 外边距的 used value 是同一类：
   **看不见不等于不存在。**

### 78.9 本轮未做但已定位的事

- `/previews/example` 与 `/previews/bangumi-components` 的**组件级**对齐目前只有
  「类名普查 + 语义签名 + 计算样式 + 页高」这四层，没有做到 §78.1 对 `/preview` 那样的
  逐组件核对（19 个 MDC 组件里 12 个只在这两页出现）。语义签名探针现在覆盖到了它们，
  首轮结果在 `live:ui-parity` 的 66 页里，跑完后按 SEM 差异清单逐条定性即可。
- `Secret.vue` 的死规则意味着 `/previews/*` 上「查看预览文章」链接**线上不可见**、
  Astro 可见。这是**本地更正确**的一类差异，若你希望严格对齐线上，需要显式决定。

## 79 标题锚点 id 与正文字面：两道「没有任何门禁看得见」的真缺陷

本节两处修复的共同形状值得先记下来，因为它们**都不改变任何一个盒子的尺寸**：
页高对比、计算样式对比、`interaction-check` 全都看不见，而它们都真实存在。
能被抓住的都是本轮新增的探针（语义签名多重集 / 定点字面比对），
所以顺手各补了一道**静态、零外部依赖**的门禁。

### 79.1 标题锚点 id：Nuxt 有三步后处理，Astro 一个都没有

**现象**。语义签名探针在 66 页里抓到 3 页的目录链接锚点对不上：

| 页面 | 线上 id | Astro id | 触发的后处理 |
|---|---|---|---|
| `/2025/12/oss-prepare-list` | `_123-网盘会员直链` | `123-网盘会员直链` | 首位数字补 `_` |
| `/2025/12/fedora-silverblue-install-and-immutable-future` | `distrobox-distroshelf可选` | `distrobox--distroshelf可选` | 折叠连续短横 |
| `/2025/05/misskey-sidebar` | `今天是他们的生日-今天是他们的生日` | `…-今天是他们的生日-` | 去尾短横 |

**规则**。Nuxt 用 `@nuxtjs/mdc` 的 `compileHast`，是 **github-slugger + 三个后处理**
（`@nuxtjs/mdc/dist/runtime/parser/compiler.js`）：

```js
node.properties.id = String(node.properties?.id || slugs.slug(toString(node)))
  .replace(/-+/g, "-")      // 折叠连续短横
  .replace(/^-|-$/g, "")    // 去首尾短横
  .replace(/^(\d)/, "_$1")  // 首位数字补 _
```

Astro 侧只有 `rehypeHeadingIds`，也就是光秃秃的 github-slugger。

**为什么严重**：目录链接与标题自链接都指向 id。线上分享出去的
`…/2025/12/oss-prepare-list#_123-网盘会员直链` 在 Astro 上点不动，反之亦然。
**页高与计算样式都看不见**——一个 `<a href="#…">` 指向不存在的 id，盒子尺寸一点不变。

### 79.2 归一点选：loader 层是错的，rehype 插件才对

第一次我把它接在 `src/loaders/with-article-meta.ts` 的 `load()` 里
（`await inner.load(context)` 之后改 `entry.rendered.html` 与
`rendered.metadata.headings[].slug`）。**构建通过、门禁全绿、产物一字未变。**

物证是构建期一句 `console.error`：68 个条目的 `entry.rendered` **全是 undefined**。
根因：`@astrojs/mdx` 注册的 entry type 带 `contentModuleTypes` 且**不提供**
`getRenderFunction`，于是 glob loader 走的是 `deferredRender` 分支
（`astro/dist/content/loaders/glob.js:155-163`），写进 store 的条目里**根本没有
`rendered` 字段**；正文 HTML 是运行时由 MDX 编译出的组件产出的，
`render(entry)` 在 `entry.deferredRender` 时改走 `astro:content-module-imports`。

**⇒ loader 层拿不到 HTML，MDX 条目上任何「后处理渲染产物」的写法都是死代码。**
已把那次改动整体撤回（含两个归一函数与那条调试打印），只在文件头留了一段
「为什么这里不能做 id 归一」的注释，免得下一个人再走一遍。

正确位置是 **rehype 插件，且必须排在 `rehypeHeadingIds` 之前**——
但「排在它之后」这条路本来就不存在，因为它排最后：

```js
for (const [plugin, opts] of loadedRehypePlugins) parser.use(plugin, opts)  // 用户插件
parser.use(rehypeImages)
parser.use(rehypeHeadingIds)   // ← 最后写 id
```

能走通是因为 `rehypeHeadingIds` 有一行关键实现
（`@astrojs/markdown-remark/dist/rehype-collect-headings.js`）：

```js
node.properties = node.properties || {};
if (typeof node.properties.id !== "string") {   // ← 已有 string id 就不动
  node.properties.id = slugger.slug(text);
}
headings.push({ depth, slug: node.properties.id, text });   // ← 元数据取的就是这个 id
```

**它尊重已经存在的 id。** 所以前置写好 id 之后，一处同时管住两条独立数据通路：
正文 DOM 的 `id`，以及 `file.data.astro.headings[].slug`（`Toc.astro` 消费的就是它）。

### 79.3 文本提取必须照抄，不能「简化」

slug 是从标题文字算出来的，所以插件必须用和 `rehypeHeadingIds` **完全一样**的规则取那段文字。
它的取法不是「所有子节点文本拼起来」，有四处分支：

1. 跳过 `element` 子节点（标题里的 `code`/`em`/`a` 只取**后代**文本）
2. `raw` 节点若形如 `\n?<…>\n$` 则整体跳过
3. 非 MDX 文件里 `{` 要先替换成 `${`
4. MDX 文本表达式 `{frontmatter.x}` 要回查 frontmatter 取真值

抄的代价是 `src/plugins/heading-ids.ts` 里有一坨看似多余的 estree 解析；
不抄的代价是「我简化了实现」在某篇带表达式的标题上静默产生不同 slug——
**那种缺陷没有任何门禁看得见**，而这正是本项目反复吃过的亏
（CLAUDE.md 坑位 11：把 Vue 的组件边界换成 CSS 里的近似表达）。
连带照抄了 `FORBIDDEN_PATH_KEYS`（3 个字符串），因为
`@astrojs/internal-helpers` 是 `@astrojs/markdown-remark` 的**传递依赖**，
不在本项目 package.json 里，import 它的内部路径在 pnpm 严格布局下会解析失败。

**验证**：定点比对 3 个受影响页面的**全部**标题 id 序列，线上 22/18/176 个逐条一致；
门禁红绿双向：注入「拆掉首位数字补 `_`」→ 重建 → 门禁报出该文件 + 目录链接指向不存在的 id
（证明目录链接那条检查不是空跑）→ 恢复 → 绿。

### 79.4 新门禁 `check-heading-ids.mjs`：四条不变式，不是字面量比对

判据不是「id 等于某个写死的值」，而是那三个后处理的可判定形式（外加幂等）：
不含 `--`、不以 `-` 开头/结尾、首位不是裸数字、再过一次后处理不变。
外加「目录里的链接必须指到真实存在的标题 id」。

**第一版的锚点检查范围错了**：我扫了全页的 `href="#…"`，于是
`#main-content`（跳转开头）、`#twikoo`（评论区容器，客户端才有）、
GFM 脚注的 `#user-content-fn-…`（挂在 `<li>` 上）、MDC 组件的 `#link-banner`
全被算进来，**67/68 个文件报「有问题」**，三处真缺陷被彻底埋掉。
改成只扫 `[data-toc]` 容器之后才干净。

**另一处「静默不做任何事」**：标题 `id` 一开始写成正则的必需部分
（`…\sid="([^"]*)"`），于是「标题压根没有 id」这件事被正则**静默跳过**。
改成 `id` 可选，并把「没有 id」的计数**摊开在总结行里**（现在 401 个）。
逐条查过这 401 个全是布局壳标题——`h1.post-title`（文章头）、
`h3.title`（侧栏文章列表）、`h3.text-creative`（评论区）、
`h3`「分享方式」（分享组件）——都在 `.astro` 模板里写死，压根不走 markdown 管线。
抽样三页核对线上：同样只有前三个（第四个是 Astro 静态输出、线上客户端才渲染，已在坑位 15 记过）。
所以只统计、不判红，但**必须把数字打出来**——一个「安静地不做任何事」的数字比没有数字更危险。

### 79.5 smartypants：默认开着，20/64 页正文字面被改写

语义探针在一页的 h4 文字上撞见：`Key社，我哭死...`（线上）vs `Key社，我哭死…`（本地）。
根因是 `remark-smartypants` 在 Astro 侧**默认开启**（判的是 `smartypants !== false`），
Nuxt 侧没开。全站复核 20/64 页受影响，最极端的 `/games/galgames/clannad`：
`”` 111 个 vs 2 个、`…` 24 个 vs 2 个。典型句子：
`安装"飞牛播放器"登录 NAS` 线上是 `&quot;…&quot;`，本地被改成 `”…”`。

一处 `smartypants: false` 修好。定点复核 5/5 一致；
**重叠前缀**复核 64 页 0 差异。

**这里我自己犯了两次仪器错误，都记下来**：

1. **拿本地静态 HTML 对线上 SSR HTML 比**，得到「本地 613 段 / 线上 69 段」这种荒谬结果。
   线上有一大块内容是客户端才渲染的（MDC 的 `Tab` 块、`ClientOnly`、搜索框、分享按钮、
   评论区），静态 HTML 里根本没有。**这正是 §78.2 证伪掉静态 HTML 语义对比的同一个理由，
   我在写新探针时又踩了一次。** 改成只在两边都服务端渲染的 `<article>` 正文里比。
2. 定点比对取「关键词前后固定 N 个**原始 HTML 字符**」，于是两站的标记长度不同
   （Vue 的 `data-v-*` vs Astro 静态多出的「引用整段」按钮）把窗口两端推到了不同的句子上，
   5 条里 4 条**误报不一致**。改成「先整篇剥成纯文本，再在纯文本里找关键词」才准。

### 79.6 新门禁 `check-text-literal.mjs`，以及它第一版红不了

判据定稿是**逐字符计数不等式**：

    dist 产物里的出现次数  ≤  源 markdown 里的出现次数

`≤` 而不是 `=`：构建也可能**减少**这些字符（标题被抽走、frontmatter 与代码块里的
字符不进入正文），减少合法；增加则一定是构建改写了字面。

**第一版是「dist 里每个 `…` 在源里都出现过」——它红不了。**
注入 `smartypants: true` 重建后仍然 exit 0：源 `.mdx` 里本来就有
`“ ” … ’ –`（clannad 正文里就写着 `切换“横向滚动”和“自动换行”`），
于是每个字符都「有出处」，判据形同虚设。
**一个从不报错的门禁比没有门禁更糟**：它让人以为这条已被覆盖。
定稿后注入 `smartypants: true` 重建 → 报「`…` 产物 98 / 源 83，多出 15 个」→
恢复 → 绿（`…` 82/83、`—` 50/58、`–` 99/99、`“` 318/390、`”` 310/382、`’` 2/2）。

判据里只扫 `<article>` 内是必须的：页头/页脚/侧栏文案写在 `.astro` 模板与
`app.config.ts` 里，不走 markdown 管线，混进来会全部误报。

### 79.7 顺带修掉的一处既有 lint 错

`astro.config.mjs` 的 sitemap `filter` 用了捕获组却不用它
（`/^\/previews?(\/|$)/`），`pnpm lint` 一直在报。改成非捕获组
（`(?:\/|$)`）。不是为了门禁变绿，是因为这条文件我本来就在改，
留着会让「lint 红了」被归因到本次改动上。

### 79.8 语义探针剩下的差异：先分类，再决定动不动

66 页首轮 sem 差异共 **213 行 / 48 种形状**。逐类定性：

| 形状 | 行数 | 定性 |
|---|---|---|
| `a{/,true}`、`a{/games,true}` 等 `aria-current` | ~79 | **部署滞后**：`BlogSidebar.vue` 的 `HEAD` 版里**根本没有 `aria-current`**，工作区版才有 `currentMark`（精确命中 → `page`，栏目命中 → `true`）。线上跑最后一次提交 |
| `h2|相关条目` + `a|#相关条目|` | 19 | **内容漂移**：用户删了 5 篇文章的 `## 相关条目`，线上还留着 |
| `button|切换表格换行|` | 17 | 调查中（表格换行切换按钮，线上渲染后到底有没有） |
| `button{}` 空 aria-label | 7 | 调查中（nukitashi 9/4、clarity 8/6、piece-hy1 5/2、example 88/89） |
| `/previews/bangumi-components` 标题与链接 | ~18 | **内容漂移 / 部署滞后**（该 `.md` 正在未部署清单里） |
| 标题 id 锚点 | 6 | **本轮已修**（§79.1） |
| `/previews/example` 的 `prosea` 链接与编码分布 | 4 | 调查中 |

**分类纪律重申**：后两类（部署滞后 / 内容漂移）的正确动作是**部署**，
绝不加进 `known` / `STYLE_ACCEPTED` / `ACCEPTED`——
那会把「内容还没部署」这个信号永久静音。
`.astro-compare/ui-parity-66p-offline.json` 里 `live:ui-parity` 报的那 7 条
「本地内容比线上多」同属此类。

### 79.9 一条容易忘的顺带结论

`article` 里的正文字符数，线上 SSR 与本地静态可以差 **10 倍**
（clannad：线上 1583 字 vs 本地 15328 字）。这不是缺陷，是 MDC 的 `Tab` 块在线上
由客户端渲染。任何「整篇剥文本逐字比」的探针都会在这里给出假结论——
**判据必须落在渲染后的 DOM，且要么只看两边都 SSR 的那段，要么显式排除这类块。**
`.replace(/<script[\s\S]*?<\/script>/g, '')` 也不能省：Astro 把组件的 `<script>`
渲染成组件根元素的**子节点**，不剔会把整段 JS 吸进文本。
### 79.10 metaSlots：整个侧栏 widget 是空白的（真缺陷）

**现象**。语义探针在 `/previews/example` 报出两条数量差：

```
a|/docs/files/markdown|   线上 2 / 本地 1
img|/favicon.ico|          线上 2 / 本地 1
```

**根因**（两条差异**同一个来源**）。`rehype-meta-slots` 在 Nuxt 侧把正文里的
`::meta-aside-xxx` 整块抽进 `file.data.slots`，存的是 **MDC AST 节点**，
`useWidgets()` 用 `h(ContentRenderer, { value: slotsTree })` **求值**渲染。
Astro 侧的 codemod 把同一块转成 **frontmatter 里的字符串**：

```yaml
metaSlots:
  aside-bar:
    content: <LinkCard title="MDC 基本语法（必读）" icon="…/favicon.ico" link="…/docs/files/markdown#mdc-syntax" />
```

而 `BlogWidget.astro` 原来用 `set:html={meta.content}` 注入
⇒ 字符串里的标签变成浏览器**不认识的未知元素**，widget 整个空白：

```
线上  <div class="widget-body"><a href="…/docs/files/markdown" class="link-card card">
本地  <div class="widget-body"><linkcard title="…" …></linkcard>
```

**页高看不见它**（空白也是合法盒子），**计算样式看不见它**（压根没有元素），
语义探针只报「数量差 1」，不指出根因。

**修法**。新增 `src/lib/meta-slot.ts`（解析）+ `src/components/blog/MetaSlotContent.astro`
（渲染成真实组件），`BlogWidget.astro` 改用它。产物核验：侧栏 0 个未知组件标签，
widget-body 里是真 `<a class="link-card card">`，`aside-foo` 里的 `<Blur>` 也成了
真的 `<span class="blur">`。

**判据：能解析什么、不能解析什么**。只支持 `content-components.ts` 里注册过的
组件 + 纯文本；小写标签、属性里的 `{…}` 表达式、组件嵌组件**一律抛错**让构建失败。
理由与 `content-components.ts` 的注释同一条：**静默渲染成空白是最坏的失败方式**。
真要支持小写标签（例如槽位里写 `[a](#x){icon=…}`，Nuxt 侧会走 `ProseA`）时，
正确做法是**显式加一条分支并补测试**，而不是把未知输入原样吐出去。

**这条「响亮失败」当场就救了一次**：解析器第一版的正则只匹配开标签、
不匹配 `</Blur>`，构建立刻炸在「`<Blur>` 没有闭合」。
报错方向是对的（栈顶确实没闭合），但根因在正则而不在数据——
若当初选了「宽松跳过」，这一版就会安静地渲染出一个缺 children 的 `<Blur>`。

**新门禁 `check-mdc-eval.mjs`**：扫 `dist` 全部 HTML，找形如 `<名字` 的**未知**元素，
名字取注册表里每个组件的 PascalCase / kebab-case / 全小写三种写法
（frontmatter 里是 PascalCase 的 `<LinkCard />`，经 `set:html` 落到产物里实测是小写的
`<linkcard>`——中间有一层把标签名压小写，只查一种写法会漏）。
这些名字与 HTML 原生标签**无一重名**（`time` `data` `output` `summary` 之类都不在注册表里），
所以「出现即未求值」是严格成立的，判据零歧义。
红绿双向已验：把 `BlogWidget` 改回 `set:html` 重建 → 精确报出
`<blur> ×1` 与 `<linkcard> ×1` → 恢复 → 绿。

### 79.11 MDX 手写的 `<a>` 绕过 `ProseA`（真缺陷，两层原因）

`example.mdx:124` 的 `[a](#链接-prosea){icon="tabler:color-swatch"}`
被 codemod 转成了**裸 JSX**（codemod 自己的报告第 8 条就预告了这个坑：
「`<a>` 会丢失原 `ProseA` 的行为……若要保留，Astro 侧需要 `ProseA` 组件」）。
实测产物：

```html
本地  <a href="#链接-prosea" icon="tabler:color-swatch">a</a>     ← 裸标签，且 icon 漏进 DOM
线上  <a href="#%E9%93%BE%E6%8E%A5-prosea" class="z-link"><span class="iconify i-tabler:color-swatch domain-icon"></span>a</a>
```

**根因是两层**，缺一层都修不掉：

1. **`prose.ts` 的 `tagOf()` 只把 MDX 元素里 `name === 'code'` 认出来**，
   于是 MDX 的 `<a>` 整条绕过 `buildLink`：没有 `z-link` 类、没有图标、
   `icon` 属性原样漏进 DOM。判据应该是「**这个标签在 Nuxt 侧有没有对应的
   `Prose*` 组件**」而不是「它是不是小写」——`ProseCode` 与 `ProseA` 都是
   markdown 会映射到的元素，而这两者恰好都会被 codemod 转成 JSX。
   已把 `tagOf` 扩到 `code` 与 `a` 两个；其余（`Tab` / `div` / `span` / `img` / `meta-*`）
   仍然不认，因为 Nuxt 那边手写组件不映射到 `Prose*`。
2. **`classList` / `addClass` 只写 `node.properties`**，而 MDX 元素的属性在
   `attributes` 数组里——**写 `properties` 是无声的空操作**。
   `getAttr` 早就同时读了两处（它是为 `<code lang="js" copy={true}>` 加的），
   但写的那一侧从来没补上。已补 `setAttr` / `dropAttr` / `mdxAttr` 三个助手。

顺带按 Nuxt 的 `ProseA.vue:9` 复刻了 `icon` prop 的语义：
`const icon = computed(() => props.icon ?? getDomainIcon(props.href))`——
显式 `icon` **覆盖**域名图标，两者都用 `domain-icon` 类渲染。
并且**必须把 `icon` 属性从输出里删掉**（它不是合法 HTML 属性）。
修完 `z-link` 链接数 **线上 32 / 本地 32**（修复前本地 31），全站 `icon` 属性残留 0。

**第二层里还埋着一个更阴的**：新增的 MDX 属性对象**必须带 `type: 'mdxJsxAttribute'`**。
第一版 push 的是裸 `{ name, value }`，结果 `icon` 属性成功被删掉（那是 splice，
不新建对象）而 `class="z-link"` 加了**没出现在产物里**——MDX 的 hast→estree
只认带 `type` 的属性节点，裸对象被静默丢弃。
症状极有欺骗性：图标渲染了、`icon` 也清掉了，唯独类名没有，
看起来像「`addClass` 没被调用」而不是「属性对象形状不对」。

`href` 的百分号编码（线上 `#%E9%93%BE…` vs 本地 `#链接-prosea`）**不修**：
它来自 vue-router 的 `router.resolve`，两边解析到同一个锚点，属于静态化的固有差异。
`data-tip` 本地有、线上没有，同理（线上是 `v-tip` 这个客户端指令，不产生属性；
Astro 侧静态写出再由 `prose-enhance.ts` 复刻浮层），已在 `prose.ts` 注释里记过。

### 79.12 剩下的差异：三类都归了档，一条都不许进豁免表

| 差异 | 定性 | 物证 |
|---|---|---|
| `/previews/bangumi-components` 全部 h2/h3/`a\|#…`（−461px 主因） | **部署滞后** | `git show HEAD:content/previews/bangumi-components.md` 解码（**UTF-16LE**，直接 grep 静默返回 0 命中）后是旧结构（`## 说明` / `::bgm-card` / `三次元`…）；工作区版已改成 `## 功能已移除` / `## 原组件清单` / `## 已知行为`（`--numstat` 16 增 98 删）。`.mdx` 与工作区 `.md` 逐字相同 ⇒ codemod 无 bug，**正确动作是部署内容** |
| `a\|/previews/example\|page\|` vs `a\|/previews/example\|` | **部署滞后 + 静态化固有** | 线上的 `aria-current="page"` 来自 **vue-router 的 NuxtLink 自动行为**（连带 `router-link-active router-link-exact-active` 两个类），**不是** `BlogSidebar.vue` 源码；`HEAD` 版 `BlogSidebar.vue` 确实无 `aria-current`（解码后 grep 0 命中）。静态站没有 router，`UtilLink.astro` 渲染裸 `<a>`，当前页标记整体丢失 |
| `a\|/\|true\|`、`a\|/games\|true\|` 等 ~79 行 | **部署滞后** | 同上：工作区版才有 `currentMark`（精确命中 → `page`，栏目命中 → `true`） |
| `h2\|相关条目` + `a\|#相关条目\|`（19 行） | **内容漂移** | 用户删了 5 篇文章的 `## 相关条目`，线上还留着 |
| `button\|切换表格换行\|`（17 行） | **渲染时机差异** | 线上按钮在 `Tooltip` 的 client-only 内容里（`ProseTable.vue:6-19`），vue-tippy 的 `.tippy-box` **show 时才创建**；Astro 侧构建期就产出。实测悬停后线上 `aria-expanded` 由 `false` 翻成 `true`、按钮数 0→1；**点击两边都把 `table.scroll` 从 4 变成 3** |
| `button\|\|` 空 aria-label（7 行） | **无缺陷** | 签名含义被我一开始读错：`SEM_RULES.button = ['aria-label','aria-expanded']`，而 `SEM_TEXT`（同文件 `:1146`）**不含 `button`**，所以 `button\|\|` 是「无 aria-label 且无 aria-expanded」而不是「无文字」。按 `aria-label \|\| innerText` 统计，**两侧所有 `button\|\|` 里的按钮都有 accessible name**——`aria-label` 缺失 ≠ 无 accessible name，文字本身就是 name |
| `tabs-button` 类名不一致 | 无 UI 影响 | 线上 `Tab.vue:89-93` 只写 `:class="{ active }`，类名靠父级样式上下文；Astro 侧 `Tab.astro` 显式加了 `tabs-button`。两边**数量相等**（example 页 64 = 64） |

**唯一一处仍无定论**：`/previews/example` 本地多 1 个 `button.mermaid-toggle`
（`Mermaid.astro:29`），根因未取到物证。它初始 `hidden`、图表渲染成功后才显示，
不影响页高（该页 d=−136 已由 tab 类名与内容漂移解释）。属低风险单按钮差异。

## §80 部署取证、NuxtLink 自动行为，以及我自己踩的三个解析器坑

时间线：2026-10-02 23:50 提交、23:52 推送、00:0x CI 绿。本节记录把「部署滞后漂移」
这一整类差异消掉的过程，以及**部署完立刻暴露出来的两处新缺陷**。

### 80.1 部署：证据链

| 环节 | 物证 |
|---|---|
| 提交 | `89136cb fix: 恢复侧栏导航标记、补回 Secret 链接并改写 Bangumi 预览页`，11 个文件 / +399 −193 |
| 暂存内容 | `git diff --cached --name-status` 恰好 11 行；`astro-site/` 等 untracked **未**被带入 |
| 推送 | `git push origin HEAD:main` → `8f37e4c..89136cb`；推送前后 `git rev-list --left-right --count origin/main...HEAD` 均为 `0 0`（本分支与 main 同步，推 HEAD:main 等价在 main 上提交） |
| CI | run `37029853527`，`Build and Deploy`，24 步全 success，含 `pnpm install --frozen-lockfile`（证明没有动依赖）与 `Deploy to GitHub Public` |
| 部署产物 | `blog-public` 提交 `91291045`（2026-10-02T15:52:14Z），`gh api .../git/trees/91291045?recursive=1` 共 967 项 |

**一个测量的仪器坑：`gh` 默认解析到了 upstream。**
`gh run list` 在仓库目录下返回的是 `L33Z22L11/blog-v3` 的记录——因为该仓库有
`upstream` remote，而 `gh` 优先用它。必须显式 `-R PaloMiku/blog-v4`。
差点据此得出「CI 从来没跑过」的结论。

### 80.2 部署生效：四项物证 + 一个 CDN 陷阱

按 §78.8 的纪律逐项验证，不看「CI 绿」就算数：

| 标记 | 部署前线上 | 部署后线上 | 期望 |
|---|---|---|---|
| `sidebar-nav-leaf` | 0 | 5 | 工作区 `BlogSidebar.vue` 的新标记 |
| `aria-current` | 0 | 1（文章页）/ 4（首页） | vue-router + 新 `currentMark` |
| `相关条目` + `::bgm-card` | 有 | 0 | 5 篇文章已删 |
| `secret-container` | 0 | 4（`/` 与 `/archive`） | `Secret.vue` 的死规则已修 |

**`Secret.vue` 不是死代码。** 我先 grep `<Secret` 零命中就判它没被引用，
实际上它以 `<ZSecret>` 全局注册，用在 `app/pages/index.vue:48` 与 `app/pages/archive.vue:51`。
判据应该是「组件名在全仓库的**实际使用形态**下出现过」，而不只是「作者写的那个标签名」。

**CDN 陷阱：`?cb=<时间戳>` 这种 cache-buster 反而拿到旧内容。**
第一次探测（带 `Cache-Control: no-cache` 请求头）读到 `sidebar-nav-leaf = 0`，
一度以为是产物不对；直接查 `blog-public` 的部署产物确认是 5，
再取一次普通 URL 已经是 5，**同一个 cache-buster URL 却还是 0**：

```
previews/example   plain: leaf=5 aria=2   busted: leaf=0 aria=0
```

⇒ EdgeOne 的分层缓存里，带 query 的是一个**独立的 cache key**，
它命中的是还没刷新的父层。**普通 URL（真实用户走的那条）才是新的。**
任何探针只要往 URL 上加 query 就会读到另一个站点——这条比它本身的差异危险得多。

### 80.3 `aria-current` 是 `NuxtLink` 的自动行为，Astro 侧只覆盖了 1/4

`NuxtLink` 会给**指向当前页**的链接自动加 `aria-current="page"`，作者不必写。
实测（部署后取线上 HTML）：

| 页面 | 指向 `/` 的链接 | 带 `aria-current="page"` 的 |
|---|---|---|
| `/` | 4（页首 logo、侧栏「文章」、侧栏页脚菜单、main 里的 h1 站名） | **4 / 4** |
| `/link` | 4 | 0 |
| `/2024/03/takagi` | 3 | 0 |

**正是「精确匹配当前页才标 page」这条语义。** 而 Astro 侧原本只有 `BlogSidebar`
自己算的 `currentMark`，于是首页 4 个里只有 1 个带标记。

**这不是「静态化固有做不到」**：每个页面独立构建，`Astro.url.pathname` 就是该页路径，
静态构建里完全可用（`layouts/Base.astro` 的 canonical、`BlogSidebar` 的 `currentMark`、
`BlogAside` 都在用）。已加 `currentPageHref()`（`src/lib/shared/link.ts`），
在 `UtilLink.astro` 与 `BlogHeader.astro` 两个**原语**里各接一次，所有调用点自动获得——
对应 §79.11 里「属性要接在正确的层」那条。

边界写死了三条：外链 / 页内锚点 / **带 query 或 hash** 的一律不标。
最后一条的理由是静态构建拿不到访问者运行时的 `location.search`（与坑位 23 记录过的
`searchParams` 恒空是同一件事），标了可能就是错的——**比不了就不猜**。

`router-link-active` / `router-link-exact-active` **不复刻**，理由见 §80.7。

### 80.4 新门禁 `check-aria-current`，以及它当场抓到的第二处缺陷

`compare-ui-parity.mjs:1134` 的 `SEM_RULES.a` 里本来就有 `aria-current`，
所以回归会被抓到——但它只跑受测清单里那 66 页、且要拉浏览器。
`check-aria-current.mjs` 扫**全部 68 个 HTML**、不碰浏览器、**195ms**，
直接断言不变式本身：`aria-current="page"` ⟺ 归一化 href 等于该页路径，两个方向都查。

**它第一次跑就抓到了第二处真缺陷（5 条，exit 1）：**

```
/about   指向当前页却缺 aria-current="page"  href="/about"
/archive 指向当前页却缺 aria-current="page"  href="/archive"
（/drive /games /link 同）
```

根因在 `BlogSidebar.astro` 的 `currentMark`：

```ts
if (path === item.url) return 'page'      // ← path 来自 Astro.url.pathname
```

`build.format: 'directory'` 让 `Astro.url.pathname` **带尾斜杠**：
`/link` 页上它是 `'/link/'` 而 `item.url` 是 `'/link'`，于是**精确命中恒不成立**，
退化成栏目的 `'true'`。首页之所以「看起来是对的」，只是因为 `item.url` 恰好也是 `/`——
**一个巧合掩盖了整整五页的缺陷**。已改走 `currentPageHref()`（内部归一化尾斜杠），
`inSection` 的栏目判定也一并归一化（逐个路由核对过，结论不变）。

红绿双向：
- **红（真实缺陷）**：首跑报出上述 5 条，exit 1。
- **红（注入）**：`currentPageHref` 里加 `if (true) return 'page'` 制造过度标记 →
  1401 条 `不指向当前页却带了`，exit 1，退出前重建 68 页。
- **绿**：恢复后 `OK: aria-current="page" —— 68 个 HTML / 1081 个根相对链接
  全部符合不变式，其中 10 个指向本页。`

已接进 `acceptance.ps1`（产品门禁 9 → **10 道**）。

### 80.5 手写标签解析器必踩的两个坑（我自己踩了，还踩了两次）

这次为了快速对比两侧 DOM，我手写了一个「只在引号外切属性」的解析器。它有两个坑：

**① 匹配标签头不能用 `<a\b([^>]*)>`。**
HTML5 **允许**双引号属性值里出现裸 `>`——禁的只有 `"` 和歧义的 `&`——
而 `content/posts/2025/11/riddle-joker` 的 `description` 里就有
`式部茉优 > 在原七海 > …`。`[^>]*` 会在第一个 `>` 处截断，
于是捕获到一个**引号未闭合**的属性串。正确写法是让引号内的 `>` 不参与终止：
`(?:[^>"]|"[^"]*")*`。

**② `indexOf` 会返回 -1，而 `-1 + 1 = 0`。**
未闭合时 `i = k + 1` 把指针**送回开头**，解析器无限循环。
实测把门禁卡了 **99 秒 CPU** 才被外层超时打断——
在这之前我以为是自己写的正则慢，还去给每个阶段计时，
计时结果 48ms + 9ms 全都正常，才想到是死循环。

**教训**：`indexOf` 这类「可能返回哨兵值」的 API，指针运算必须显式处理哨兵；
而且**解析器遇到不认识的形态要抛错，不能静默跳过**——
静默跳过就等于「这条没检查」，那比没有门禁更糟（坑位 20 的同一条原理）。
这个门禁现在两个方向都抛错，不是返回 `undefined` 蒙混过去。

### 80.6 属性值里的裸 `>` **不是**缺陷，而且三道几何门禁都看不见它

上面 ① 挖出来的现象单看很像 bug：线上是 `&gt;`，Astro 产物里是裸 `>`。
逐字对比：

```
本地  ... 按个人喜好排序为：式部茉优 > 在原七海 > … 发挥了作用。" href=…
线上  ... 按个人喜好排序为：式部茉优 &gt; 在原七海 &gt; … 发挥了作用。" data-v-…
```

**结论：不是缺陷。** HTML5 的「双引号属性值」状态只把 `"`、`<`、`&` 列为
unexpected-character，`>` 走「anything else」即**照常并入属性值**。
于是浏览器把 `>` 之后的内容继续读进同一个 `title`，
`getAttribute('title')` 拿到的字符串与线上**逐字相同**。

这解释了它为什么一直没被发现：**页高门禁与计算样式门禁都看不见它**
（几何完全一致），而 `check-text-literal.mjs` 判的是**正文**、不看属性值。
这与坑位 6 / 7 是同一族：**仪器没有这一维，不等于这一维没问题。**

### 80.7 `router-link-active` 不复刻的理由

Nuxt 侧当前页链接还带 `router-link-active router-link-exact-active` 两个类。
普查两侧 CSS：

```
.router-link-active        线上 0 条   本地 0 条
.router-link-exact-active  线上 0 条   本地 0 条
[aria-current]             线上 0 条   本地 0 条
```

**没有任何一条规则消费它们**，无障碍语义挂在 `aria-current` 上（现已对齐）。
所以这是 vue-router 的内部记账，不复刻：
在一个静态站里硬编码另一个框架的内部类名，换不来任何行为，
只会让 DOM 对比多一类噪声。今后若有样式要表达「当前栏目」，
应当用 `[aria-current]`——它现在存在且与线上一致。

### 80.8 本轮我的仪器错误（都记在这里）

1. **属性解析器正则扫进引号内的值**：把 `href="/2025/10/rust-waline-deploy"`
   切成 `g` / `n` / `tk` / `ln` 四个「属性」，报告里一片 `仅线上: [""]` 的假差异。
2. **用位置切片切侧栏**：`html.search(/sidebar-nav/i)` 命中的第一个是**内联 `<style>`**
   里的选择器文本（Nuxt 全量内联 CSS），往后切 40000 字符仍停在 CSS 块里，
   于是「线上 0 个侧栏链接」。这与坑位里「Astro 7 内联进 HTML 的 1431 段产物」同源。
3. **把内联 CSS 里的选择器文本算成元素**：`sidebar-nav-leaf` 线上数成 5、本地 4，
   差的那 1 个是 Nuxt 内联 CSS 里的 `.sidebar-nav-leaf[data-v-…]` **选择器**。
   剥掉 `<style>`/`<script>` 后两边都是 4，DOM 完全一致。
4. **猜 URL 形状**：用 `/posts/2024/03/takagi` 取文章，全部返回 26 字节。
   `hidePostPrefix` 开启后真实路径是 `/2024/03/takagi`——应以
   `scripts/lib/page-list.mjs` 为准（坑位 10 的「哪个文件/路由负责什么」是猜的，
   这次同一个错误又出现了一次）。

## §81 五个测量维度的最终结果，以及一个「门禁自己拒绝跑」的插曲

2026-10-03 00:07–01:27。在 `89136cb` 部署上线与两处 `aria-current` 修复之后重跑了整套测量。

### 81.1 五腿总表

| 腿 | 维度 | 一致 | 真差异 | KNOWN | ARTIF | UNST | 耗时 |
|---|---|---|---|---|---|---|---|
| 1 | 页高 · 1600×1000 · 浅色 | **61**/66 | 2 | 2 | 1 | 0 | 28.3 min |
| 2 | 页高 · 390×844 | **59**/66 | 2 | 2 | 2 | 1 | 33 min（补跑） |
| 3 | 样式 · 1600 · 浅色 | **63**/66 | — | — | — | 0 | 6.3 min |
| 4 | 样式 · 390 | **63**/66 | — | — | — | 0 | 6.3 min |
| 5 | 样式 · 1600 · 深色 | **63**/66 | — | — | — | 0 | 6.7 min |

**三个样式维度的差异集完全相同**（`clarity-resource-list` 2 处、`nukitashi-gv-end` 1 处、
`previews/example` 4 处），说明换视口、换配色都没有暴露新问题。

**两个页高维度的差异集**：

| 页面 | 1600 | 390 | 性质 |
|---|---|---|---|
| `/2025/10/clarity-resource-list` | KNOWN −465 | KNOWN −503 | 老站 MDC 解析器 bug，用户 10-02 决定不复刻 |
| `/2025/10/nukitashi-gv-end` | DIFF −484 | DIFF −437 | info-card 决定（5 张） |
| `/2025/11/piece-hy1` | KNOWN −178 | KNOWN −177 | info-card 决定（3 张） |
| `/previews/example` | DIFF −136 | DIFF −110 | `mermaid-toggle`，根因仍未取到物证 |
| `/2025/10/lemmy-fediverse-deploy` | ARTIF −19 | ARTIF −19 | 断网隔离假阳性，online 复核 0 |
| `/2025/05/clannad-zh-linux` | ok（真差异 −82） | **ARTIF +29** | 见 §81.3 |
| `/link` | ok | **UNST −3** | 线上洗牌，10 次装载跨度 44px（§78.4） |

**⇒ 390 视口没有暴露任何新的真差异。** 全部差异都能对上既有的、已归类的理由。

### 81.2 第二腿崩在工具的一处缺失保护上（已修）

原第一趟里 `--width=390` 那一腿跑 16.3 秒就死了：

```
preflight: 隔离生效（跨域 fetch -> BLOCKED）
preflight: 本地渲染正常（#blog-root 11 个子节点，高 3911px）
FAIL: fetch failed
```

**我一开始怀疑是内存压力**（当时空闲只剩 81MB），**查下来不是**。真因是
`scripts/lib/page-list.mjs` 里取 sitemap 的那一次请求：

```js
const xml = await (await fetch(`${remote}/sitemap.xml`)).text()
```

**没有超时、没有重试、没有错误上下文。** 顶层 `await allPaths(REMOTE)` 一旦被网络抖动
打中，就落到 `compare-ui-parity.mjs:377` 的 `unhandledRejection` 兜底，吐出一句
`FAIL: fetch failed`——**没有 URL、没有次数、没有原因**。28 分钟的测量当场作废，
而且这句话会把人引向完全错误的方向（去查代码，而代码没问题）。

这与 `compare-ui-parity.mjs:276-278` 记的那条是同一类：那次是 `stdio: 'ignore'`
把 preview 的报错整个丢掉了，只剩一句没线索的报错。
**一句没有线索的报错，比没有报错更难查。**

已修成 3 次重试（退避 800ms×n）+ 15s 单次超时 + 失败时把 URL / 重试次数 /
底层原因一起抛出。验证：

```
取 sitemap 失败（已重试 2 次，每次超时 800ms）：https://127.0.0.1:9/sitemap.xml
       最后一次的原因：bad port
```

正常路径仍是 66 条、三页 previews 都在。补跑那次**没有复现**——
但**不能据此断定是重试救了它**：重试只挡得住前 N 次抖动，落在重试窗口外的抖动照样会死。
所以这条只能记成「已知缺口已补，复现性未验证」，不能记成「已解决」。

### 81.3 同一处缺陷，在不同视口下会从「真差异」退化成「测不出来」

`/2025/05/clannad-zh-linux` 这是一个**新现象**，值得单独记：

| 视口 | 结果 |
|---|---|
| 1600×1000 | **DIFF −82px**（真差异） |
| 390×844 | **ARTIF +29px**（断网隔离造成的假阳性，online 复核落在容差内） |

同一处超长标题在窄屏换行后，`−82px` 的差被布局吸收掉，**差值本身不再超差**。
于是这一页在手机上看起来是「绿的」。

**⇒ 窄屏一致推不出桌面一致，反过来也一样。** 这与坑位 5
（「别把『在一个视口下量过』当成 UI 一致」）是同一条的两面：
那条讲的是「窄屏会暴露新问题」，这条讲的是「窄屏会**藏**起问题」。
两种情况都要求**多个视口都测**，而且**不能只取超差的那一个当下结论**。

### 81.4 门禁自己拒绝跑，比跑出一个假结论好

内存回到 1540MB 时起了交互门禁，跑到一半只剩 1474MB，它**自己停了**：

```
SKIPPED: insufficient free memory (1474MB of 15557MB, need >= 1500MB)
  This gate did NOT run. It needs ~700MB for headless Chrome; under that
  it reports click/typing assertions as failures while the site is fine.
  Free some memory and re-run -- do not "fix" the site in response to it.
```

这条行为值得单独表扬：**它宁可什么都不产出，也不产出「点击断言失败」。**
在那种状态下跑出来的红，会把人引向「去修点击功能」——而站点根本没坏。
这与 §80 里「解析器遇到不认识的形态要抛错」是同一条原则的两种落点：
**一个在信息不足时选择沉默并说清原因，好过在信息不足时给出一个看起来正式的结论。**

### 81.5 两个待拍板项的结论（2026-10-03 01:46）

**① 是否切换上线：暂不切。** 用户的决定是**先自己看一遍 Astro 站的实际效果**再定。
`.github/workflows/build-astro.yml` 保持**未启用**，线上继续跑 Nuxt 站
（`89136cb`）。理由记录在案：验收虽已全绿，但「全绿」与「用户看过」是两件事，
后者没有发生之前不推进对外变更。

看的方式：`%TEMP%\static-dist.cjs` 起的静态服务器（PID 7448，端口 4400）
本来就在服务 `astro-site/dist`，**不需要新起任何服务器**——
CLAUDE.md 约定 dev/预览服务器的启停由用户管理，所以这里刻意复用既有进程。

**② MDC 槽位缺失时的占位标题：保持与 Nuxt 一致，不复刻假标题。**
`BlogWidget` 的槽位（`metaSlots`）为空时仍渲染兜底文案。
这条**不需要改代码**——当前实现本来就是这样。记录下来是因为它曾是一个悬置项，
现在有明确答案了，将来不必重新讨论。

实测补充：这两页的槽位**都有实际内容**，占位文案从未真正显示过——
`/previews/example` 的 `aside-bar` 渲染成真的 `<a class="link-card card">`，
`aside-foo` 渲染成 `<span class="blur">`。所以这个决定不影响任何可测差异。

---

## §82 侧栏差异：三层仪器盲区，与一个把值报反的字段

2026-10-03 用户报「侧边栏与 Nuxt 版有较大差异，间距、下部组件都不大一致」。
这一节的全部内容都来自**追这一条用户反馈**，而它最终牵出的不是一处 CSS 缺陷，
而是三层叠在一起的**仪器盲区**——其中最外一层使前面所有 CSS 修复的验证都无效。

### §82.1 盲区一：测量清单里只有外框

`compare-ui-parity.mjs` 的 `STYLE_SELECTORS` 当时有 62 条，侧栏相关的只有两条：
`#blog-sidebar` 与 `.blog-footer`。侧栏内部的 16 个组件**一条都没有**。

物证（`probe-subtree.mjs --sel='.sidebar-nav'`，1600×1000）：

| 元素 | 线上 | Astro | 差 |
|---|---|---|---|
| `a.sidebar-nav-item` | 38.0 | 46.6 | **+8.64** |
| 6 项累积 | — | — | **+51.6** |
| `menu` | 218.6 | 261.7 | +43.1 |
| 搜索按钮 | 38.3 | 46.6 | +8.3 |

而同一时刻样式对比报的是 **63/66 全绿**。

根因是三层叠加的尺寸问题（细节见 `BlogSidebar.astro` 内的注释）：
线上 `span.iconify` **本身就是** `.sidebar-nav-item` 的直接子元素，被更高特异性的
`.sidebar-nav-item > .iconify{font-size:1.5em}` 覆盖；Astro 侧多一层 `<span class="nav-icon">` 包装，
字号挂在包装层上，内层 `svg.iconify` 又吃 `:where(.iconify){font-size:1.2em}` = 25.92px，
而包装层的 `inline-block` 行盒按 1.4em 撑成 30.24px。差值 30.24 − 21.6 = **8.64**，与实测逐位吻合。

结构差异同时存在：线上 `IconNavList.vue` 是 `<menu>`（**无 class**）→ `<a>` **直接子元素、无 `<li>`**；
Astro 曾多套一层 `<li>` 还加了 `icon-nav` 类，页脚因此高 20.5px。

修完后逐节点复量：导航项 38.34375 = 38.34375、图标盒 21.5938×21.5938 两侧逐位相同、
图标→文字间距 7.19 = 7.19、页脚 105.5 = 105.5。几何层面已归零。

### §82.2 盲区二：让「补选择器」这件事本身失效的那一层

上面那些修完只证明了**几何**对上了。补完 17 条选择器后重跑样式对比，仍然全绿——
**注入的缺陷根本没被报出来**。这次的根因比盲区一元凶得多：

`#blog-sidebar` 在 1600×1000 下**两侧都是 `visibility: hidden`**
（`BlogSidebar.vue:201` / `BlogSidebar.astro:363`，各自靠 `layoutStore.state === 'sidebar'`
决定要不要挂 `show` 类）。无头浏览器里没人移动鼠标、没人滚动，那个状态切换不会发生。

`styleProbe` 的 `visible()` 判 `visibility:hidden` 为不可见，于是
`#blog-sidebar` 及其**所有后代**都进不了可见集合，`nv.visible === 0` 直接 `continue`。

**⇒ 侧栏从来没有被样式对比比较过，在任何视口下都没有。**
补再多选择器也改变不了这一点：判据在「元素可见吗」这一层就出局了。

物证（`_probe-icon.mjs`，同一浏览器两侧对照）：

| 阶段 | 线上 | Astro |
|---|---|---|
| 加类前 `sidebarVis` | `hidden` | `hidden` |
| 加类前 `aVisibleByGate` | `false` | `false` |
| +100ms 后 | `visible` / `true` | `visible` / `true` |

修法：`styleOf()` 在导航完成后强制 `classList.add('show')` 并等 500ms
（盖过 `transition: visibility .2s`）。`show` 是**两侧同名**的真实状态，
所以这是「把页面摆到用户看到的样子」，不是放宽判据。

### §82.3 盲区三：补了 17 条，补的全是框

`show` 类修好后仍然全绿。第二次挖出来的原因是：
补进去的 17 条里，页脚只有 `.footer-nav` 与 `.footer-nav menu` 两个**外框**，
而真正的样式承载者——`<menu>` 里的那个 `<a>`——不在表里。
反向测试注入的 `padding: 0.7em` 正好写在那个 `<a>` 上。

**「量了外框」这件事可以连续错三次**：第一次只量外框（盲区一）、
第二次补了内部但漏了最里层（盲区三）、中间还隔着一次「元素压根不可见」（盲区二）。

修法：不再靠「读一遍组件结构」来列清单，改用 `_probe-side-dom.mjs`
遍历 `#blog-sidebar` 整棵子树、按 `tag.class` 汇总两侧签名，拿一张 53 行普查表当依据。
表里 22 行两侧同名、31 行单侧独有。清单里每一条都要能指着普查表说「这条两侧同名」。

⚠️ 普查表同时纠正了一个我自己的错误认知：`.footer-nav` 是**页面底部**
（`footer.blog-footer > nav.footer-nav`），**不在 `#blog-sidebar` 里**；
侧栏那个页脚是 `footer.sidebar-footer`。两者是不同的地方。

单侧独有的 31 行里，`span.nav-icon` / `svg.iconify` / `path` / `symbol` / `use` /
`g` / `script` 是 Astro 为补 attribute fallthrough 加的包装层与 svg 内部节点，
线上对应的是 `.iconify`，**类名不同不能进按名索骥的表**；
`a.router-link-active…` 是 Nuxt router 的活动类，Astro 没有。
这些按既有纪律处理：要么让两边同名，要么换仪器（`probe-subtree` 逐节点量）。

### §82.4 红绿双向：这次真的双向验过了

| 状态 | 结果 |
|---|---|
| 注入 `padding: 0.7em` | `DIFF 4`：`padding-top/right/bottom/left` `nuxt=6.4px×6 astro=8.96px×6`，**exit 1** |
| 撤掉恢复 `0.5em` | `ok`，**exit 0** |

`6.4 → 8.96` 正是 `0.2em × 12.8px × 2`（上下两边），6 是分布比对拿到的元素数。
选择器总数 62 → 79 → **87**。

同一趟还确认：87 个选择器在撤掉注入后**全绿**，
说明 §82.1 那批图标盒尺寸、页脚结构、导航间距的修复在**样式层面**也一并对齐了，
不只是几何层面。

### §82.5 `document.fonts.check()` 把两个值都报反了

普查表里 `span.split-char` 高 35（线上）/ 32（Astro），8 个元素全部可见、两侧同名。
第一轮深挖时我读了 `document.fonts.check('600 24px "LXGW WenKai Screen"', …)`，
拿到 **线上 `true` / 本地 `false`**，据此写下「本地字体没加载、回退到 Noto Sans SC」。
**这个结论是错的**，第二次取证直接翻转：

| | 线上 Nuxt | Astro |
|---|---|---|
| `<link>` 的 `media` **运行时实际值** | **停在 `print`** | **`all`**（`onload` 执行了） |
| `LXGW WenKai Screen` face | **一个都没有** | 数百个，其中 3 个 `loaded` |
| 网络 | CSS 200，随后 `ERR_BLOCKED_BY_ORB` | CSS 200，字体 200 |
| `document.fonts.check()` | **`true`** | **`false`** |

真实情况与第一轮的判断**正好相反**：**本地加载成功了，线上没有**。
线上的 `link` 停在 `media="print"`——那是「先以 print 媒体静默加载、`onload` 后切 `all`」
的非阻塞技巧，`onload` 没执行意味着样式表被下载了却**永不应用**，
字体静默回退，**不报任何错**。

`document.fonts.check()` 在这里把两个值都报反了。原因也清楚：
它判断的是「该文本能否用给定字体渲染而不发生回退」，会把整条 fallback 链算进去，
与「那个特定 face 到底 loaded 没有」是两件事。

**⇒ 判「某个 webfont 到底用上没有」只能看两样东西**：
`document.fonts` 里该 family 的 **face 列表与 status**，以及那条 `<link>` 的 **`media` 运行时实际值**。
`getComputedStyle().fontFamily` 会原样回显声明值，`fonts.check()` 会被 fallback 污染，
两者都不可用。

### §82.6 这 3px 差异怎么处理：不修

两侧的 CSS 逐字相同，`fontSize 24px` / `lineHeight 33.6px` / `fontWeight 400` /
`fontVariationSettings "BEVL" 100, "wght" 600` / `animation-play-state: paused` /
`--delay 0.10s` / 两个动画 `currentTime: 0` **全部一致**。
唯一差别是字形：LXGW WenKai 的行盒墨迹 35px，Noto 回退 32px。

差异来源是**线上站自己的字体被 ORB 拦掉**，不是 Astro 的迁移缺陷。
刻意复刻「字体加载失败」与 §80 追加的那条 `button{text-align}` 同一性质：
差异来自线上构建/网络环节，Astro 按源码如实应用，**故不改，也不进豁免列表**。

为什么五腿页高测量从来没报过它：容器高度由 `line-height: 1.4` 固定
（`.header-title` 两侧 33.59、`.blog-text` 两侧 50.39 完全一致），
只有 **inline 元素**的行盒会溢出 line-height 按真实字体度量算。
影响面只有标题里那 8 个 `span`。

**⚠️ 由此得到一条对测量本身的重要限定**：样式对比与页高对比都跑在**断网隔离**模式
（`preflight: 隔离生效`），此时 `s4.zstatic.net` 的字体样式表两侧都取不到、
两侧一同回退，**字体因此不是基线的干扰项**——但这是隔离带来的**巧合，不是设计**。
一旦切到 online 模式，线上取不到而本地取得到，同一批页面的行盒基线就会整体偏移。
届时必须重取基线，不能拿今天的数字直接比。

### §82.7 教训

1. **判据在「可见吗」这一层出局时，往下补多少选择器都没用**。
   「我把清单从 62 条补到 79 条」与「侧栏被比较过了」之间没有因果关系。
2. **量了外框可以连续错三次**：只量外框 → 补了内部漏了叶子 → 中间还隔着元素压根不可见。
   列测量清单的依据必须是**遍历出来的普查表**，不是读组件结构时的理解。
3. **同一个探针里两个字段互相打架时，要挑出哪个字段的定义与被测问题相符**，
   而不是挑那个先读到的、或者看起来更权威的。
4. **`X.check()` 这类便利谓词常常不是你以为的那个问题**。
   本例中它把「font-family 能否无回退渲染文本」误当成了「这个 face 加载了吗」，
   而且答案是反的。
5. **基线的成立条件要显式写下来**。「两侧字体环境一致」在这套门禁里成立，
   靠的是断网隔离而不是任何显式检查——这是运气，值得单独记一笔。

### §82.8 部署去笔误，以及追一条**追不回来**的假阳性

用户拍板「改 Nuxt 源去掉这两处笔误，重新部署」。这一节记的是那个部署的验证过程，
以及**部署后冒出来、又再也复现不出来**的 4 条差异——后者比前者更值得记。

#### §82.8.1 改法：删一个空格，不是删一行

线上 HTML 是这件事的唯一事实源：

```html
<!-- clarity-resource-list，部署前 -->
</ol>
<h1 id="tab2">tab2</h1>          ← # tab2 被 Markdown 吃成一级标题
<figure class="z-codeblock">      ← 「语法」tab 的内容掉到了 tab 组件外面
```

```
223: ::tab{:tabs='["组件","语法"]'}
224: #tab1                        ← 无空格 = 槽位，正常
243: ::
245: # tab2                       ← 有空格 = 不是槽位，是 h1
246: ```mdc wrap expand
```

**codemod 侧其实是对的。** `src/content-mdx/.../clarity-resource-list.mdx` 里是
`<div slot="tab2">`，「语法」tab 面板完整；而线上只渲染出一个面板。
findings:220 当初记的是「两种 slot 写法都要支持：`#tab1`（无空格）与 `# tab2`（带空格）」——
**那个决策与 Nuxt 的实际行为相反**，而它没被验证过（Nuxt 侧只解释了「都能解析」，
没说「解析成什么」）。

线上 HTML 提供了两个反证：`#tab1`（无空格）正常成了面板；`#title` / `#default`（都无空格）
在 `ProseQuote` / `Alert` 里都正常成了 `div.alert-title` 之类的具名槽位。
**⇒ 无空格才是槽位标记。**

所以修法是**只删那个空格**（`# icon` → `#icon`、`# tab2` → `#tab2`），
不是删掉整行。删整行会让「语法」tab 变成空面板，是把一个笔误换成另一个缺陷。
Astro 侧 `src/content-mdx/**` 一行都不用改——它的产物本来就是对的。

`git diff` 确认两处各只改一行、每处只少一个字符：

```diff
-# icon        +#icon
-# tab2        +#tab2
```

CI `37049109135` 全绿（1m21s），`blog-public` 部署提交 `551a90d8`。

#### §82.8.2 CDN 没刷新时，事实源在 `blog-public` 仓库里

部署后第一次抓线上，两次抓取**逐字节相同**（SHA256 一致），都还是旧内容。
CLAUDE.md 记的是「带 query 的 URL 是独立 cache key，普通 URL 已经是新的」——
**这次连普通 URL 都是旧的**，那条经验不足以覆盖。

正确做法是绕过 CDN 直接取部署产物：

```
gh api "repos/PaloMiku/blog-public/contents/2025/10/nukitashi-gv-end.html" --jq .content
```

⚠️ 三处踩坑：
1. **产物路径不是 `.../index.html`**。Nuxt `generate` 产的是 `2025/10/nukitashi-gv-end.html`，
   同名目录里**只有 `_payload.json`**，去 `contents/.../index.html` 会 404。
2. **PowerShell 传含引号的 JS 给 `node -e` 会被吃掉**（`id="icon"` 变成 `id=" icon\/`），
   直接语法错误。写成 `.mjs` 文件。
3. **字节数 ≠ 字符数**。`toString('utf8')` 给字符数，`Get-Item` 给字节数，
   中文 3 字节/字符。我拿 `114696` 字符和 `121637` 字节比，得出「差 7.7KB」，
   实际差 **788 字节**——正好是「一处 quote 结构变化 + payload 元数据变化」的量级。
   **「差了很多」这件事，得先确认两个数是同一种东西。**

CDN 约 15 分钟后才刷新。刷新后的取证：

| | 线上 | Astro |
|---|---|---|
| `.article h1`（页面内） | 1 | 0 → 部署前 0 |
| 旧 `id="icon"` 残留 | **0** | — |
| `id="tab2"` 残留 | **0** | — |
| `div.icon-line` 内容 | `<p>ヾ(•ω•`)o</p>` | 同 |

两页样式对比从 **DIFF 1 + DIFF 2 变成全部 ok**。

#### §82.8.3 追一条追不回来的假阳性

部署后第一次重跑两页，`clarity-resource-list` 冒出 4 条新差异：

```
DIFF 4  /2025/10/clarity-resource-list
      .article p [0].padding-right  nuxt=0px×1  astro=28.8px×1     ← 同样的行重复 4 次
```

`28.8px` 定位到 `&.has-quote-button{padding-inline-end:1.8em}`（引用整段到评论区的按钮）。

**这 4 条再也没能复现。** 依次排除的假设：

| 假设 | 怎么排除的 |
|---|---|
| 只有本地有这个类 | 探针量到两侧 `withQuoteBtn` 都是 6，分布 `28.8px×6 / 0px×4` **逐项相同** |
| 是 hydration 时机（按钮没挂满） | 当时临时加的 `--settle=0`（首次等待压到 0）重跑，仍然 ok（**该参数已随实验一起删除**，见 §82.8.4 前的代码注释） |
| 断网隔离导致 | 探针加上与门禁**逐字相同**的 `--host-resolver-rules` + 隔离自检，仍然逐项相同 |
| 视口不同 | headless 默认 800×600 是我的疏漏，补上 `1600x1000` 后仍然相同 |
| 元素身份错位 | 探针输出**按顺序**的「按钮身份 + padding + 前 22 字」序列，两侧逐项相同 |
| CDN 边缘节点不同步 | 5 次**独立导航**（普通 URL）全部一致 |

⚠️ 最后一次探针自己又犯了一次错：**用了 `?probe=<时间戳>`**。
带 query 是独立 cache key，等于每次都请求一个全新条目，**必然拿到最新内容**，
恰好测不到边缘节点差异。CLAUDE.md 那条经验的镜像：
**想观察缓存这一层时，cache-buster 会把你直接送到缓存之外。**

**结论只能写成「无法复现、机制未定」**，不能写成「已修复」。
事后看，最省事的判据是当时就有 `--debug-sel`——它把该选择器的
`count / visible / 每个样本的 sig 与取值 / 全量 dist` 整份打出来，
一眼就能看出「两侧的 6 个 sig 逐条相同」，而不是靠 `×1` 这个频率摘要去猜。

#### §82.8.4 顺带查清的两件事

**① `reportOne` 只写不读 `reported`，所以多重集路径不去重。**
`reported` 这个 Set 只在「全量分布比对」那一步被 `has()` 读。
逐元素/多重集路径里是 `reported.add()` 之后无条件 `pageDiffs.push()`，
于是**同一个 `(sel, prop)` 会按桶数报 N 次**。
这解释了两种报告形态：

- 侧栏那次 4 条**属性不同**（top/right/bottom/left）：6 个页脚链接文本签名相同
  ⇒ 落进同一个桶 ⇒ 多重集输出 `6.4px×6` ⇒ 每个 prop 报 1 次
- clarity 那次 4 条**完全相同**（都是 `padding-right`）：4 个不同文本桶各报 1 次

**不影响检出能力**（真差异仍会被报），只影响报告噪音与 `DIFF N` 的计数含义。
本轮没改：改它需要红绿双向验证，而它换不来检出能力。

**② 报告里的 `[0]` 不是「第 0 个元素」。**
多重集比较**不建立元素级配对**，`nth` 恒为 0（代码注释写明了），
下游打印成 `[0].prop` 只是占位。**看到 `[0]` 不要去数第几个元素**——
要看的是后面那两串取值。

#### §82.8.5 这一轮我自己踩的仪器坑（都是同一类）

| 坑 | 症状 | 真因 |
|---|---|---|
| `Get-Content` 默认编码 | `BlogHeader.astro` 的中文注释全成乱码 | PS 5.1 按 GBK 读无 BOM 的 UTF-8；文件 5364 B / 0 个 U+FFFD，**文件一直是好的** |
| 探针对象字面量 key 含连字符 | 两侧全返回 `undefined` | `{ 有has-quote-button: n }` 是语法错误，被读成「线上和本地都没这个按钮」 |
| 逐行比对两个文件 | 报 1417 行「内容不同」 | `--fix` 插入行导致行号整体错位；**该用 `git diff --no-index -w`** |
| 探针漏设视口 | 量出「两侧分布相同」 | headless 默认 800×600 ≠ 门禁的 1600×1000 |
| 探针加 `?probe=` | 6 次结果全同，误判「边缘节点一致」 | cache-buster 绕过了要观察的那一层 |
| 拿字符数比字节数 | 「差 7.7KB」 | 中文 3 字节/字符，实际差 788 字节 |

**这六条里五条的结论都是「仪器错了，而不是站点错了」。**
其中三条（乱码、连字符 key、行号错位）如果照着读，会直接得出「站点有严重缺陷」的错误结论。

### §82.9 「图标和字不是很对齐」：差 1.72px，而两台仪器都看不见它

2026-10-03 用户第二次报侧栏问题：「侧边栏图标和字不是很对齐」。
上一次修的是**间距**（每个导航项 +8.64px），这一次是**垂直对齐**，两者无关。

#### §82.9.1 先说被排除的：盒与字其实是对齐的

`probe-align` 量每个导航项里「图标承载盒」与「文字盒」的 `centerY` 差，
**两侧全部为 0**。盒高 21.59、文字高 20.16、盒在项内的偏移 8.19、文字中心 18.98，
两侧逐项相同。

⇒ 用户看到的偏移**不在盒与字之间**。继续往里一层才找到真凶：

| | 线上 | Astro（修前） |
|---|---|---|
| 图标承载盒 | `span.iconify` 高 21.59 | `span.nav-icon` 高 21.59 |
| 盒**内**有没有图形元素 | **没有**（`<span>` 用 CSS mask 铺满盒子） | **有**：`<svg width="1em" class="iconify">` |
| svg 在盒内的偏移 | — | **偏下 1.72px** |
| 承载盒 `line-height` | 30.24px（1.4em） | 21.6px（1em） |
| 承载盒 `vertical-align` | `sub` | `baseline` |

#### §82.9.2 根因：`inline` 级 svg 按基线对齐

线上的 `.iconify` 是个 `<span>`，**盒内没有 inline 内容**——图形是
`background-image` + `mask` 铺满整个盒子。所以它的 `line-height: 1.4em`
完全不参与定位，flex 的 `align-items: center` 直接把它放到文字中心上。

Astro 侧为了补 attribute fallthrough（坑位 1）多了一层包装：
`<span class="nav-icon">` 里套一个 `<svg class="iconify">`。
**svg 是 inline 级元素**，它的垂直位置由**父 span 的行盒**决定，
而父 span 恰恰写了 `line-height: 1`——那行是 §82 为了把盒高从
30.24px 压回 21.6px 加的。于是 svg 按 `vertical-align: baseline` 贴到基线上，
**实测内缩 −1.72px**。

两个条件叠加才出问题，缺一不可：**有内层 inline 元素** + **父级 `line-height: 1`**。
页脚一直是对的，因为它早就写了
`.sidebar-footer menu a .nav-icon .iconify { display: block }`；
搜索框也对，因为它的 `.nav-icon` 自己是 `display: flex`，内层作为 flex item 被居中。
**只有导航项这一处漏了。**

**修法：让 svg 脱离 inline 布局**，而不是去动 `line-height`——
动 `line-height` 会把盒高重新撑回 30.24px，那正是 §82 修掉的 +8.64px。

```css
.sidebar-nav-item-parent .nav-icon > .iconify,
.sidebar-nav-item > .nav-icon > .iconify { font-size: 1em; display: block; }
```

修复后实测：内层偏移 1.72 → **0**，而盒高 21.59、盒内偏上 8.19、
文字中心 18.98、盒字中心差 0 **全部不变**。只动定位，不动尺寸。

#### §82.9.3 为什么两台仪器结构上看不见它

| 仪器 | 为什么看不见 |
|---|---|
| `compare-ui-parity` 的 `STYLE_PROPS` | 装的是计算样式（color / padding / …），**没有几何偏移** |
| 给 `STYLE_SELECTORS` 补 `.nav-icon > .iconify` | **跨侧不匹配**：线上根本没有内层 svg，`.iconify` 自己就是 flex item。补进去只会得到「本地有、线上没有」的元素数量假差异——正是 §82.3 记过的「判据只能落在跨侧同名的东西上」 |
| 页高对比 | 图标是 `inline-block` / `block`，**总高不变**（svg 偏出盒外 1.72px，盒子尺寸不变） |

⇒ 两侧**没有同一个东西可以对**。这不是差异比对能覆盖的问题，
只能作为**单侧不变量**来判。

#### §82.9.4 新门禁 `check-icon-box.mjs`（红绿双向已验）

判据：`.nav-icon` 是显式 `1em × 1em` 的图标盒，盒内图形的合法摆法只有两种——
父级自己是 flex/grid（内层作为 flex item 自动居中），
或者父级是 block/inline-block 时**必须**另有规则把内层 `.iconify`
设成 block/flex/grid/absolute。`inline-block` 也在拒绝之列。

**第一步先确认被检查的结构还存在**：
`<span class="nav-icon">` 必须紧邻 `<svg class="iconify">`。
图标技术一旦换掉（比如改成 `<i>` / `<img>` / 内联 SVG 文本），
门禁**报错退出并说明判据已失效**，而不是静默变成一个永远绿的检查。

红绿双向：

| 状态 | 结果 |
|---|---|
| 注入 `display: inline`（退回修复前） | `FAIL: 2 条规则让内层 iconify 保持在 inline 级`，逐条点名是哪个文件、哪条选择器、为什么违规，**exit 1** |
| 恢复 `display: block` | `OK: icon-box —— 24 处结构、3 条内层保护规则、1 个父级 flex 上下文、0 违规`，**exit 0** |

已接进 `acceptance.ps1`，产品门禁 **10 → 11 道**（该文件仍 0 非 ASCII 字节、Parse OK）。

#### §82.9.5 与 §82 坑位 25 是同一个形态

§82 记的是「量了外框，没量框里的东西」；
这一次是「量了**盒**，没量盒**里面**的东西」。

两者的共同点是：**尺寸类指标全部正确，而位置类指标整条维度缺失**。
盒高 21.5938 两侧逐位相同、间距 7.19 = 7.19——**一个数字都没错**，
但它们回答的都是「多大」，没有一条回答「在哪」。

**⇒ 补测量维度时，除了「补选择器」还要问「补属性/位置类指标」。**
`STYLE_PROPS` 里一条几何偏移都没有，这个缺口在补选择器那一步是看不见的。
## §83 侧栏「构建信息」改 Astro 版 + 竖列带图标，以及两条新的仪器坑（2026-10-03 03:20 - 03:50）

### §83.1 这是**用户主动要求的偏离**，不是迁移缺陷

项目纪律是「与线上 Nuxt 站逐项对齐」，而这一条恰好相反：用户 2026-10-03 明确要求
「侧边栏构建信息修改为 Astro 版本，而不是现在的 Nuxt 信息，并且改为带图标的竖列版本」。

**因此两条纪律都照做，且都靠"先查再断言"而不是"先假设"：**

| 会不会被门禁抓到 | 结论 | 依据 |
|---|---|---|
| 页高对比 | **不会** | techstack 挂在 `<div class="expand-content" hidden>` 里，默认折叠，对页高贡献恒为 0。改它不改 docHeight |
| 语义探针 `SEM_RULES` | **不会** | 只测 `a / button / input / h1–h6 / summary / label`，**没有 `dt` / `dd`**。改文案改不到签名 |
| `STYLE_SELECTORS` 87 条 | **不会** | 里面没有 `.tech-stack` / `.tech-service` / `.dl-group`（grep 确认） |
| 切换按钮 | **不会** | 签名是 `button||false`（`aria-label` 空 + `aria-expanded`），两侧一致 |

⇒ **不需要给门禁登记任何豁免**。`ACCEPTED` / `STYLE_ACCEPTED` 只用于
「差异是真的但决定不复刻」的情形；这一条差异是**设计意图**，且在默认状态下不可见。
**先证明它抓不到，再决定要不要登记**——否则就会把一条本就不该红的门禁永久静音。

### §83.2 为什么「竖列」不能只靠加一段 CSS

`DlGroup` 原有三种尺寸都做不到「一行一项 + 图标在最左」：

| size | 实际布局 | 为什么不行 |
|---|---|---|
| `.small` | `flex-wrap: wrap` | **多项挤在一行**（现状就是它） |
| `.medium` | 两列 grid + `> div { display: contents }` | label 与 value **并排** |
| `large` | 无 CSS，默认 block 流 | **label 一行、value 再一行**（两行一项） |

想过用纯 CSS 解决：把 `dd` 设 `order: -1` 提到 `dt` 前面。**行不通**——
`dd` 里装的是「`.dl-icon` 元素 + 一段文本」，一旦对 `dd` 用 `display: contents`
让文本节点变成 flex item，**匿名 flex item 排不了 `order`**（`order` 只作用于元素 box），
结果图标跑到了最前、文字却留在最后。

⇒ 只能在模板里条件分支：stack 模式下把 `.dl-icon` **多渲染一份到 `dt` 之前**。
其余三种尺寸的 DOM 与 CSS 一字未动（`BlogStats` 用 `small`、`BlogLog` 用 `large`、
`BlogTech` 的 service 组用 `medium`，都零影响）。

### §83.3 实测几何（浅色 + 深色各跑一遍，1600×1000）

不靠推理，直接量渲染后的 DOM——§82.9 刚栽过「盒对上了、盒里面的东西没对上」。

```
8 行全部：  行高 25.9063  图标槽 x=1228.797 w=17.2656  内层 svg display=block
距行上沿 4.313   距行下沿 4.328   不对称 0.015px（亚像素）
svg 中心 vs dt 文字中心 −0.008px   svg 中心 vs dd 值中心 −0.008px
service 组（不该动）：display=grid  h=107.5  n=4
侧栏 aside：client=1000 scroll=1000，末个 widget 底沿 648.78 < 1000 → 无溢出
```

**深色逐位相同**（`grayscale(0.8)` 只改 filter，不改盒）。

### §83.4 仪器坑一：`.astro` 文件**根本不在 eslint 覆盖范围内**

改完顺手跑 `npx eslint .`，得到 **359 errors**。追下去发现是两层错位叠加：

1. `astro-site/` **没有自己的 eslint 配置**。唯一的配置在仓库根
   `eslint.config.mjs`（Nuxt 那份），`npx eslint .` 会**向上找到它并按它判 astro-site**。
2. 即便如此，`.astro` 文件也不在它的作用域里：
   ```
   npx eslint src/components/widget/BlogTech.astro
   → warning  File ignored because no matching configuration was supplied
   ```

⇒ **「eslint exit 0」对 `.astro` 是空判。** 359 个 error 全在
`scripts/*.mjs`、`src/**/*.ts`、`tsconfig.check.json`、`package.json` 等
**平时没人单独 lint 的文件**上（`jsonc/indent` 之类），而真正改动的两个
`.astro` 一个都没被检查。

**应用**：报告 lint 结果前必须先问「这条命令的**作用域**覆盖到我改的文件了吗」。
`exit 0` 和「没报错」不是一回事——**一个从不覆盖目标文件的检查，和没有检查是同一个东西**。
（另：根 `package.json` 的 `lint: "eslint"` 与 astro-site 无关；`acceptance.ps1` 里
**根本没有 lint 这一步**，别把它当成交付的一部分汇报。）

### §83.5 仪器坑二：我自己的判据把「居中」判成了「偏下」

第一版探针的判据是：

```js
if (Math.max(...topD) > 0.5) bad.push('内层 svg 距行上沿最大 …px')
```

跑出来 `topD = 4.313`，**报 FAIL**。差点照着它去"修"一个完全正确的布局。

问题在于我把**「到行沿的距离」当成了「偏移」**。行高 25.9063、图标 17.2656，
`(25.9063 − 17.2656) / 2 = 4.32` —— **上下都留 4.31px，正是居中**。
要判居中，判据得是**对称性**与**中心对中心**：

| 判据 | 含义 |
|---|---|
| `\|topD − botD\|` | 是否居中（相等即居中，两值都可以很大） |
| `svg 中心 − dt 中心` | 是否与文字对齐 |
| `svg 中心 − dd 中心` | 是否与值对齐 |

修正后：不对称 0.015px、两个中心差各 0.008px，全部通过。

**⇒ 「到边的距离」和「相对基准的偏移」是两个量。** 绝对距离大不等于偏，
**对称才是居中的判据**。这是 §27（仪器自己失败会被读成站点有缺陷）的新变体：
上一次是仪器返回 `undefined` 被读成「两边都没有」，这次是**仪器返回了一个
正确但含义被我读错的数**，于是要"修"一个没坏的东西。

### §83.6 一条琐碎但会浪费时间的：`tabler:brand-linux` 不存在

给 `OS` 行配平台图标时先按记忆写了 `tabler:brand-linux`。查 `icons.json`：
tabler 只有 `brand-ubuntu` / `brand-debian`，没有 `brand-linux`；
最终用 `simple-icons:linux`（simple-icons 3736 个图标里有）。

**⇒ 图标名一律查 `node_modules/@iconify-json/*/icons.json` 的 `icons` / `aliases`，
不靠记忆。** 记错的后果不是报错而是 `data-icon-missing` 静默降级成一个红框占位——
**构建照样绿、页高照样对、样式对比照样过**（§78.2 的形状：坏掉的东西不报任何错）。
## §84 主题与组件文档改 Astro MDX 版 + 每个组件加「真实源码」页签（2026-10-03 03:50 - 04:40）

### §84.1 需求与做法

用户要求：`/previews/example` 从 MDC 版改成 **Astro MDX 版**，且**每个组件同时有组件预览和源代码展示**
（问卷选定：**三个页签** 组件预览 / MDX 用法 / 真实实现源码）。

原状：30 个 `<Tab>`，每个是 `组件 / 语法` 两栏，「语法」栏里是**手写的 MDC 片段**
（`::alert{type="question"}`、`:badge[文字]{round}`、`` `code`{lang="js"} ``）。

### §84.2 「源码」栏怎么实现：remark 阶段填围栏，**不做组件**

先否掉了最直觉的做法——写一个 `<SourceCode file="…" />`。那要**复刻**一整套代码块 DOM：
`figure.z-codeblock` 外壳、figcaption 里的文件名/语言/两个操作按钮、shiki 的双主题 CSS 变量、
每行一个 `.line` 且带 `data-line`（行号列靠 `prose.css` 的 `attr(data-line)`）、
`--collapsed-rows` / `--tab-size`、超阈值的折叠按钮……

`main.css` 与 `prose.css` 里成百上千条规则是按 Nuxt 产物**逐字**写的
（`.shiki > .line`、`:where(.iconify)`、`button > .iconify:only-child`……），
复刻的每一处都是一处将来会悄悄失配的地方。

**实际做法**：新插件 `src/plugins/component-source.ts`（`remark` 阶段）
把 ```` ```astro [Alert.astro] source=components/content/Alert.astro expand ```` 这种
**空围栏**的 `code` 节点 `value` 换成磁盘上的文件内容。等于什么都没写：
下游还是 Astro 自己的 shiki → `transformerLineNumbers` 补 `data-line` →
`rehypeProseChrome` 套 `figure.z-codeblock` → `src/lib/prose-enhance.ts` 接上换行/复制/折叠。
**与页面上任何一个人工围栏走同一条路**，所以外观逐字一致、零新增 CSS、源码永不过期。

三个设计点：

- **文件名必须字面写在围栏 info string 里**。`plugins/prose.ts` 的 `scanFences()`
  是去**读源文件原文**扫 info string 的（meta 从 mdast 传不到 hast——Astro 的 shiki
  会重建 `<pre>` 只保留自己的属性），本插件改的是树，改不到那份扫描结果。
- **标记用 `source=<路径>`**。`parseFenceInfo()` 只认 `icon=` / `wrap` / `expand`
  三个 token，**其余 `key=value` 一律静默忽略**，所以不会和它打架。
- **路径必须仍在 `src/` 内**，否则抛错让构建失败。围栏是内容作者能写的东西，
  `source=../../../../Windows/System32/config/SAM` 这种必须在插件里挡住。

实测（1600×1000，浅色，Alert 段）：

```
页签 ["组件","用法","源码"]（3 个）
源码块：caption=Alert.astro  lang=astro  lines=108  chars=2154
        buttons=[自动换行, 复制]  hasDataLine=true  --shiki-light=#4c4f69
        首行 "---\nimport Icon from '../Icon.astro'\nimport { appConfig } fr"
```

产物侧：68 个 `figure.z-codeblock`、4632 个 `data-line=`、66 组 `data-cb-action`。

### §84.3 「用法」栏为什么取 tab1 自身，而不是把 MDC 翻成 MDX

手工把 23 份 MDC 片段翻成 MDX 是 23 次互不相干的翻译，**翻错一处不会让任何门禁变红**
（坏掉的只是文档本身，页高与计算样式都看不出来）。
而 tab1 **就是产出该预览的那份 MDX**，显示它等于「用法与预览同源」，不存在漂移。

**但有四段不能这么办**——它们是**围栏驱动**的，作者真正写的是围栏而不是 JSX：
`数学公式`（```math）、`乐谱渲染播放`（```music-abc）、`图表渲染`（```mermaid）、以及 `Tab` 自己
（tab1 里嵌了 4 个 `<Tab>` 演示）。这四段保留原 tab2，只加源码栏。
其中数学公式的「源码」指向 `src/plugins/math-code.ts`——那个 rehype 插件才是它的实现。

### §84.4 批量改写脚本的三个错，全都被「行数正常」掩盖

改写用一次性脚本处理 25 段。三个错**没有一个会被行数或标签总数看出来**：

| # | 错 | 后果 | 怎么发现的 |
|---|---|---|---|
| 1 | `slotRange` 只找区间内**第一个** `<div slot="tab2">` | `Tab` 段的 tab1 里嵌了 4 个 `<Tab>`，于是抓到的是**嵌套 Tab 的槽位**：外层真实 tab1 被删、4 个嵌套 Tab 变成孤儿漂在文档里 | 重新解析发现「3 个 `<Tab>` 变孤儿」 |
| 2 | 替换区间只到 `t2.close`（`</div>`），而 `newBlock` 自带一个 `</Tab>` | 凭空多出 **26 个** `</Tab>` | 写完数开闭：开 34 / 闭 60 |
| 3 | **只写了围栏开头，没写闭合围栏** | 每个 ` ```astro ` 被**后面某一节**的围栏错配吃掉，一路错位到文件末尾，最后一个未闭合的围栏把 `</div>` 吞进代码块 → MDX 报 `Expected a closing tag for <div>` | 跑构建（MDX 解析器兜住了） |

**根因是同一个**：验证只验了「我改的那一种结构」。
我验了 `<Tab>` 开闭配平（因为我在改 Tab），**没验围栏配平**（因为围栏是我新引入的）。
⇒ 改一种结构就要验那一种；**引入一种新结构就得给它配一条新断言**。

修法：脚本加「跳过嵌套 Tab 区域」「替换到真正的 `</Tab>`」，
并把**围栏配平**（CommonMark：同字符、长度 ≥、其后无内容）写进写盘前的断言，不通过就拒绝写盘。

### §84.5 词法门禁不认注释——同一条教训一天内犯了两次

`check-self-contained.mjs` 抓到两处，全是**我自己写的注释**：

1. `BlogTech.astro` 的常量说明里，我写了「不改成 `import pkg from '../../package.json'`」
   当反面例子 → 门禁报 `[missing] ../../package.json`
2. 修掉之后，`component-source.ts` 的注释里我又把 `mdast` / `unified` 的 import 语句
   原样写出来当反面例子 → 门禁再次报 `[undeclared]`

第二次还顺手修掉了一个真问题：`mdast` / `unified` 是 `@astrojs/markdown-remark` 带进来的
**transitive** 依赖，`package.json` 里没声明。改成**本地声明** `MdastNode` 接口，
插件因此**零第三方类型依赖**（只剩 `node:fs` / `node:url` / `node:path`）。

**⇒ 注释里不要出现任何可解析的 import 语句或相对路径**，哪怕是拿来说「不要这么写」的。

### §84.6 与线上 Nuxt 站的差异：有意为之，且**默认不可见**

`/previews/example` 在 `scripts/lib/page-list.mjs` 的 66 页清单里，所以这次改动**会**被
`live:ui-parity` 看到。它属于「用户主动要求的偏离」，不是迁移缺陷。

**但它对默认页高几乎不可见**：`Tab.astro` 给非活动面板写的是 `hidden={index + 1 !== initial}`，
所以新增的两个页签在默认状态下贡献 0 高度；只有用户点开「用法 / 源码」才展开。
真正改变默认高度的是那几段散文（引言、`metaSlots` 示例、ProseA / ProseCode 文案）。

### §84.7 顺带查清的既有红灯：`audit-dead-scope`

验收里 `audit-dead-scope` 报 4 处 scoped 规则够不到元素。逐个定位 cid 归属后确认
**与本轮改动无关**（我改的两个文件是 `DlGroup.astro` / `BlogTech.astro`，
4 条全在 `BlogSearch.astro`（`.blog-search`，1072 个元素）、`Tip.astro`（`.tip-icon`）、
post-collection（`.title`，该组件全站渲染 0 个元素）、post-footer（`.content`）里）：

| 规则 | 归属组件 | 产物里该 cid 的元素数 | 成因 |
|---|---|---|---|
| `.tip-icon[data-astro-cid-d23hdoea]` | `Tip.astro` | 128 | (a) class 传给了 `Icon` 子组件，元素带的是子组件 cid |
| `.active[data-astro-cid-66nxmncj]` | `BlogSearch.astro` | 1072 | (a) 同上 |
| `&>.title[data-astro-cid-hchfoe34]` | post-collection | **0** | (b) 该组件在当前内容集里从不渲染 |
| `.content[data-astro-cid-2z6spp2e]` | post-footer | 1319 | (a) 同上 |

工具自己就写明「成因有两种可能，本工具分不出来，请勿直接套用 `:global()`」，
所以**没有动它**。它是既有红灯：03:34 那次验收（只含 BlogTech 改动）已经报过同一条。

## §85 移除文章分享按钮（两侧同步）+ 一次门禁自检逮到的系统性问题（2026-10-03 04:29 - 05:10）

### §85.1 范围决定：两侧同步改源码，**暂不部署**

用户在被问到范围时选的是「两边同步改，但先只改源码不部署」。

**这个选择有一个必须提前说清的后果**：线上 Nuxt 站（blog.sotkg.com）仍然有分享按钮，
而 `live:ui-parity` 是拿 Astro 与**线上**逐页对比的。所以本轮之后，
**所有文章页都会出现一条真实的 parity 差异**（Astro 少一个 `button`）。

按既有三分法（迁移缺陷 / 部署滞后漂移 / 内容漂移），这一条是**部署滞后漂移**：
两侧源码已经一致，是线上还没发。**正确动作是部署，不是加豁免。**
⇒ 明确**不**写进 `ACCEPTED` / `STYLE_ACCEPTED` / `known`——那会把
「Nuxt 源码还没部署」这个信号永久静音（与 §78.8 同理）。

### §85.2 影响面：删一个组件牵出 11 处，其中 2 处是**门禁断言**

按「改一种结构就要验那一种」清点，删除面比组件本身大：

| 位置 | 内容 |
|---|---|
| `src/components/popover/ShareModal.astro` | 弹窗本体（11115 B，含全部 `.blog-share` / `.share-*` scoped CSS） |
| `src/components/ModalHost.astro` | `import` + `<ShareModal />` |
| `src/components/post/PostHeader.astro` | 唯一入口按钮 + 外层 `.operations` + 死 prop + 死计算 |
| `src/lib/modal.ts` | `MODAL_KEYS` 去掉 `'share'`；那段认 `data-share-trigger` 的兼容委托整段删 |
| `src/lib/app-config.ts` / `Button.astro` / `Blog.astro` / `LightboxModal.astro` | 注释里的过时引用 |
| `scripts/check-integration.ps1` | **3 条断言会变红** |
| `scripts/interaction-check.mjs` | **一整个交互测试会变红** |
| `package.json` + `pnpm-lock.yaml` | `qrcode` / `@types/qrcode` 成为孤儿依赖 |

好消息：`.blog-share` / `.share-card` / `.share-qr` / `.share-menu` / `.share-item` / `.share-icon`
的 CSS **全部 scoped 在 `ShareModal.astro` 内部**，全局 CSS 一条都不用动。删文件即删干净。

### §85.3 删掉按钮后连带死掉的东西：两个 prop 和一个计算

`PostHeader` 的 `description` / `path` 两个 prop **只为分享按钮存在**
（`path` 拼 `articleUrl`，`description` 进 `data-share-description`），Nuxt 侧同名的
`articleUrl` 计算与 `appConfig` 也一样。留着它们就是 CLAUDE.md 明令不许留的死代码，
所以 Astro 侧连 `Props` 声明和 `[...slug].astro` 的传参一起删，Nuxt 侧删 `const appConfig`
（否则 ESLint 报未使用变量）。

**`Button.astro` 的 `...rest` 透传必须留着**——查过调用方才知道它还有别的负载：
`Slide.astro` 传 `data-slide-prev` / `tabindex="-1"`，这些都没在显式 props 里。
只改它注释里「分享按钮的 data-share-*」那句举例。

### §85.4 `.post-nav` 只剩一个子元素了，`space-between` 为什么还要留着

删掉 `.operations` 后 `.post-nav` 只剩 `.post-info`。直觉上 `justify-content: space-between`
该跟着删，但**删了也不会有任何变化**：单子元素时 `space-between` 与 `flex-start` 等价，
而 `.post-info` 本来就在 flex-start。留着它 = 零风险；删它 = 零收益还要动一处 CSS。
⇒ 两侧都保留原样，并在组件注释里写清这个理由。

> ⚠️ **本节只覆盖了横向；「页高也不会变」这句是错的，实测 −10 ~ −11px。**
> 留着 `space-between` 这个决定本身仍然正确（横向确实零影响），
> 但我据此顺带断言了竖向也不变，那一步没有依据：`.operations` 里那个按钮约 29px 高，
> `.post-info` 只有约 19px，**是按钮在撑这一行的高度**。实测见 §85.9。
> **⇒ 「为一个改动找到了机制」不等于「这个机制覆盖了它的全部影响面」。**
> 我给横向给出了机制（`space-between` 的单子元素语义），就顺手把它当成了竖向的答案，
> 而竖向根本不是同一个问题。

### §85.5 门禁自检逮到的系统性问题：**12 道门禁里 8 道无法失败**

按纪律给新断言验红，我拿**当前 `dist/`（移除分享之前的旧产物）**当缺陷态跑
`check-integration.ps1`——它打印了 `RESULT: FAIL`，**而 `$LASTEXITCODE` 是 0**。

顺着查下去发现问题在调用链上：`acceptance.ps1:175` 用
`powershell -NoProfile -File <gate>` 起子进程，`Step()` 只取 `$LASTEXITCODE` 当结论。
而**打印 `RESULT: FAIL` 并不等于退出码非零**——PowerShell 脚本不调 `exit` 就返回 0。

普查 12 道静态门禁的 `exit` 语句：

| 有 exit（真的会红） | 无 exit（打印 FAIL 但记 0） |
|---|---|
| `check-anchor-classes`、`check-dead-css`、`check-assets`、`check-build-warnings`、`check-head-vs-live` | `check-integration`、`check-layout`、`compare-urls`、`compare-titles`、`check-content-preservation`、`check-dates`、`audit-deferred`、`audit-image-pipeline` |

**为什么这个发现能活这么久**：汇总表里 `Note` 一列是从输出文本里正则抓的
（`Step()` 第 70 行），所以屏幕上确实能看到 `RESULT: FAIL`——**看起来是红的**。
而历史上报出来的每一次失败（`audit-dead-scope` / `check-self-contained` /
`live:ui-parity` / `check-build-warnings`）恰好全是 `.mjs` 或带 `exit` 的 `.ps1`，
与「另外 8 道从来没红过」完全自洽。

**⇒ 这是 CLAUDE.md 那条「一个从不报错的门禁比没有门禁更糟」的加强版**：
不是不报错，是**报错了但记成通过**，比不报错更难发现。
**⇒ 应用：加任何一条新断言之前，先确认它所在的那个文件能返回非零退出码。**
本轮已修 `check-integration.ps1`（加 `exit 0` / `exit 1`），修完立刻用旧 dist 复验：
退出码 = 1。**其余 7 道未动**——因为一改就会翻出下面这些从未被处理的结果，
那是需要单独定性的工作，不该顺手塞进一次功能删除里。

### §85.6 修好退出码之后，8 道门禁里立刻翻出两个从未被处理的结果

既然它们一直在静默跑，就直接读了一遍它们的输出：

**`check-content-preservation`** — 报 `/drive/` 缺 1 段正文（83.3%，6 段缺 1）。

**`check-dates`** — 「40 个受检页面，**40 个全部 mismatch**」。
100% 的失败率本身就是信号：不是 40 个独立缺陷，是**比较口径本身不兼容**。
看实现：它把 Nuxt frontmatter 的裸字符串和产物里的 `datetime="..."` 做**字符串相等**比较
（`if ($outDate -ne $srcDate)`），而产物是 UTC ISO（`2024-03-07T11:24:26Z`）、
源是 `2024-03-07 19:24:26`。**只要带时分秒就永远不可能相等。**
抽样 10 条（脚本自己只印前 10 条，`Select-Object -First 10`）：**10/10 都是整 8 小时差、
日历日相同**，即 UTC+8 → UTC 的同一瞬间，不是错值。

**它还有第二层问题**：`$root = (Resolve-Path '..')` 是相对**进程 CWD** 解析的，
不是相对 `$PSScriptRoot`。`acceptance.ps1` 在 `astro-site` 下调用它，
于是 `$contentRoot` 指向的是 **`blog-v4/content`（Nuxt 树）**，
而不是 `astro-site/src/content-mdx`。`check-self-contained.mjs` 抓不到这个——
它是路径解析，不是 import，词法扫描看不见。
**⇒ 「自包含」只覆盖了 import 形式的外流，没覆盖运行时按 CWD 拼出来的路径。**

### §85.7 `.ps1` 的 ASCII-only 硬约束这次真的被触发了

给 `check-integration.ps1` 写了一段中文注释。按 CLAUDE.md 的约定直接检查：

```
acceptance.ps1          bom=False nonASCII=0   cjk=0
check-build-warnings.ps1 bom=False nonASCII=0  cjk=0
check-integration.ps1    bom=False nonASCII=133 cjk=120   <- 我刚写进去的
```

改成英文后归零，并用 PS 5.1 的 parser 复验 `PARSE OK`。
**⇒ 这条约定在别的文件上是「既有状态」，只有真的往 .ps1 里写中文才会被触发**，
所以它不像 CRLF / BOM 那样每次都撞上。写 .ps1 注释默认用英文，别等检查来告诉你。

### §85.8 `check-text-literal` 变红：门禁把**原因断言反了**，而真因是我自己的新插件

这轮验收 `check-text-literal` 是**新出现的红灯**（上一次验收没有它）。它的报错写死：

```
FAIL  产物里的 smartypants 字符比源 markdown 还多
        "…"  产物 97 个 / 源 83 个，多出 14 个（smartypants 会把 "..." 改成它）
  修法：astro.config.mjs 的 createProcessor() 里保持 `smartypants: false`
```

**而 `smartypants: false` 本来就设着**（`astro.config.mjs:63`，`createProcessor()` 里）。
那句「修法」等于叫你去确认一件已经成立的事——**门禁把一个假设写成了结论**。
按 CLAUDE.md 的分类，这就是「仪器错了而不是站点错了」。

我没有照着它去查，独立验了两条假设：

| 假设 | 判据 | 结果 |
|---|---|---|
| H1 smartypants 仍在生效 | 产物里的 `“ ”` 应当**成对**变多 | **不成立**：产物 `“`318 / `”`310，**都少于**源 390 / 382。开着的话必然多于源 |
| H2 有插件把源之外的内容注入了正文 | 超出量应恰好等于被注入文件的同字符数 | **成立**：25 个文件、92157 字符，注入 `…` 15 / `—` 40，对上超出量 +14 / +32 |

⚠️ **中间还踩了一次口径错**：我先数了整个 dist 的 `—` 得到 218，而门禁说 98。
门禁只数 `<article>` 内、剥掉标签之后的文本（`articleText()`），我数的是全页含页头页脚。
**两个数字本来就在量不同的东西，差点被我拿来互相解释。**
这与坑位「一个门禁自己的计数器不可信，它的结论就一条都不可信」是同一条，
只是这次的错在**我临时写的探针**上，不是门禁上。

**修法**：产物侧把 `<pre>` / `<code>` 的**整段内容**排除掉。
理由是代码块按构造就逐字——remark 把围栏与缩进代码解析成 `code` 节点，
smartypants 是文本转换器、不碰节点值，所以「产物字符多于源」在代码块上**永远不可能**
由 smartypants 造成。这与该文件原有的推理是同一件事的两面：
它的判据是 `产物 ≤ 源`，而它自己的注释已经承认「frontmatter 与代码块里的字符不进入正文」
——代码块字符在 src 与 dist 之间**两个方向**都可以合法不等，过去只考虑了「源多」那一半。

**「排除了什么」和「还抓不抓得住」必须分开验**，所以做了反向测试：

| 步骤 | 门禁结果 |
|---|---|
| 排除代码块后（`smartypants: false`） | exit **0** — `…` 80/83、`—` 52/66、`–` 8/99 |
| 把 `smartypants` 注回 `true` 重建 68 页 | exit **1** — `…` 96/83（+13）、`’` 6/2（+4） |
| 恢复 `false` 重建 | exit **0** |

关键在第二行：**它是在已经排除代码块的前提下抓到的**，所以那个排除没有让门禁变瞎。

顺带把报错文案改了：原来只陈述「smartypants 会把 X 改成它」，
现在只陈述量到的事实，并列出两种可能与**分辨它们的方法**
（看 `“ ”` 是否成对变多 → 是转换；拿超出量去对被注入文件的同字符数 → 是注入）。

### §85.9 删分享按钮的真实代价：**每篇文章页 −10 ~ −11px**，与线上无关

同一台机器、同一条件（1600×1000、offline、每侧 3 次采样）做的移除前后 A/B：

| 页面 | 移除前 astro | 移除后 astro | 差 | 移除前 d | 移除后 d | 线上 nuxt（两次相同） |
|---|---|---|---|---|---|---|
| `/2025/10/misskey-fediverse-deploy` | 10442 | **10431** | **−11** | 0 | −11 | 10442 |
| `/games/galgames/riddle-joker` | 2821 | **2811** | **−10** | 0 | −10 | 2821 |

**线上侧两次读数逐位相同**（10442 / 2821），所以这 −10/−11 全部来自移除本身，
不是线上漂移。每侧 3 次采样全相同 ⇒ 不是抖动。

逐区块定位（工具自带的 `--deep=4` 输出）精确到唯一一处：

```
/games/galgames/riddle-joker   总差 -10px
  ***  nuxt 542  astro 531  d  -11   div.post-header.has-cover
        nuxt 1000 astro 1000 d    0  aside#blog-sidebar
        nuxt 1493 astro 1493 d    0  article.article.md-tech
        nuxt  243  astro  243 d    0  footer.blog-footer
        nuxt   82  astro   82 d    0  section.z-comment
```

**语义探针也如实报了出来**：`button||` 线上 2 / 本地 1（riddle-joker）、
线上 42 / 本地 41（misskey）——每页正好少一个，就是那个分享按钮。

#### 顺带逮到仪器的第二个弱点：`ARTIF` 判据把真实差异当成了隔离噪声

两页同一个成因、**同样的 −10/−11**，却拿到了**两个不同的结论**：

| 页面 | offline d | online 复核 d | 工具判定 |
|---|---|---|---|
| misskey | −11 | **−11** | `隔离假阳性` → **ok**（放过） |
| riddle-joker | −10 | **−10** | 真差异 → **ok=false**（判红） |

原因在 `compare-ui-parity.mjs` 的 ARTIF 复核：断网超差后用 online 再量一遍，
**落在 ±40（本工具 online 模式一直以来的默认容差）内就判 `ARTIF` 单独列出**。
−11 在 ±40 内，于是被当成隔离噪声放过。

**但这个判据问错了问题。** 隔离噪声的定义是「断网与联网的**读数**不同」，
所以该比的是**两个模式之间的差值**：

| 页面 | offline d | online d | 两者之差 | 应判 |
|---|---|---|---|---|
| lemmy（§78.3 的已知真 ARTIF） | −19 | **0** | **19** | 隔离噪声 ✔ |
| misskey（本轮） | −11 | **−11** | **0** | **真实布局差异** ✘ |

lemmy 那一例的差值是 19（噪声），misskey 这一例的差值是 0（噪声根本没出现）。
**两个已知样本都指向同一条修正**：`offline_d ≈ online_d` ⇒ 真实差异，应当照报；
两者背离 ⇒ 隔离噪声。现在用的绝对窗口 ±40 比实际观测到的噪声幅度（19.03px）宽一倍，
于是把 10–11px 的真实差异一并吞掉。

**没有改**：这条会翻转若干页的判定结果（之前被判 `ok` 的会开始红），
属于门禁口径变更，该由用户拍板，不该夹在一次功能删除里顺手改掉。
