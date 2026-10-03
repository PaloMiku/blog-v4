# MIGRATION-BRIEF —— Nuxt 4 → Astro 7 迁移交接

> 这份文档是给**读代码的人**用的：迁移期有十几个子任务并行，每个子任务都需要知道
> 对方的决策与踩过的坑。2026-10-03 Astro 接管仓库根时它和源码一起从 `astro-site/`
> 搬到了根目录，文件本身一度丢失（它当时是 untracked），导致 9 个组件里 10 处
> `见 MIGRATION-BRIEF …` 的注释全部指向空。现在它回来了，并且 12 个组件的注释
> 都能在这份文档里找到落点。
>
> 实测记录（85 节）已随 2026-10-03 的 docs/ 清理移出工作树，需要时
> `git show a4603b0^:docs/astro-phase1-findings.md` 取回；本文只写**约定与陷阱**。
>
> ✅ **`a4603b0` 已由 tag `archive/astro-migration-2026` 锚定**（2026-10-03 收尾时打）。
> 本文与 `CLAUDE.md` 共 4 处 `git show a4603b0^:docs/…` 引用全靠它，而它原本只存在于
> 本地分支 `feat/migrate-astro`（远端没有该分支）。tag 随 `git push --tags` 上传，
> 新 clone 同样取得到；分支已删，引用不再悬空。

---

## §1 目标与不变量

**目标**：产物与线上 Nuxt 站逐项对齐——页高、计算样式、DOM 语义、内容文本。
「构建通过」不是目标，「门禁全绿」也不是；目标是**没有未解释的差异**。

三条不变量：

1. 产物只依赖仓库内的文件与 `package.json` 里声明的依赖（`check-self-contained` 守着）。
2. 内容只有一份，`src/content/**/*.mdx`（`content-mdx/` 已在接管时改名）。
3. 每一处偏离基线的差异，都必须能归到「迁移缺陷 / 部署滞后漂移 / 内容漂移」三类之一。
   **第四类「懒得查」不存在**——它表现为把差异加进豁免列表，那等于永久静音信号。

## §2 目录

| 路径 | 是什么 |
| --- | --- |
| `src/content/` | 内容唯一真相源，`.mdx`，由 `src/content.config.ts` 的 glob loader 读 |
| `src/components/` | 自研 UI 组件（`blog/` `content/` `post/` `partial/` `popup/` `util/` `widget/`） |
| `src/pages/` | 文件路由；`build.format: 'directory'` ⇒ `Astro.url.pathname` **带尾斜杠** |
| `src/plugins/` | rehype/remark 管线（heading-ids / math-code / prose / component-fence） |
| `src/styles/` | 唯一的 `.css` 入口，token 在这 |
| `src/lib/` | 框架无关的共享层（`app-config.ts` / `content.ts` / `img.ts` / `shared/*`） |
| `scripts/` | 门禁 + 工具，`acceptance.ps1` 是单一验收入口 |
| `baseline/nuxt/` | **冻结的 Nuxt 产物**（未入库），离线门禁的锚点，见该目录 `BASELINE.md` |
| git 历史 `a4603b0^:docs/astro-phase1-findings.md` | 85 节实测记录（2026-10-03 移出工作树，读它前先读 §3 的压缩版） |

## §3 作用域与样式陷阱

这五条是迁移期最高频的缺陷来源，逐条实测案例在 git 历史的
`docs/astro-phase1-findings.md`（取回命令见 §2）。

### 陷阱 1：Astro 不做 attribute fallthrough

`<Icon class="x" />` 里的 `class` 会被**静默丢弃**——不报错、不警告、产物里就是没有。
必须显式声明 prop 再合并：

```astro
---
const { class: className, ...rest } = Astro.props
---
<Icon {...rest} class={[className, 'my-class'].filter(Boolean).join(' ')} />
```

**推论一**：合并 class 之后还要确认它**落在哪一层**。`Icon.astro` 合并得很好，
但 astro-icon 的 `<Icon>` 组件自己又包了一层 `<span>`，于是 `class` 落在外层 span、
`.iconify` 落在内层 svg。`main.css` 的 `:where(.iconify) { font-size: 1.2em }` 特异性是 0，
线上因为两个类在**同一个元素**上而输给组件的 `5rem`，Astro 拆成两层就赢了（96×112），
整块内容被顶偏一个 `gap: 2rem`。

**推论二**：凡是调用方给图标包装元素显式设了 `font-size` 的地方都要重量盒子。
`Tip.astro` 的 `.tip-icon` 就漏过一次：class 传给 `<Icon>` 之后落在子组件的根上，
本组件的 scoped `.tip-icon` 永不匹配，`audit-dead-scope` 报「1 条规则够不到任何元素」，
而**页高与计算样式两道门禁都看不见**（只差一个 `vertical-align`）。

### 陷阱 2：子组件的根元素只带**子组件自己的** scope id

Vue 的 `<style scoped>` 编译成 `.x[data-v-hash]`，对任意嵌套深度都生效。
Astro 侧写 `.x .y` 会要求 Astro 的 scope id 落在**子组件**的根元素上——它带的是
子组件自己的 id，规则永不匹配。凡是「主体由子组件渲染」的规则都要整体 `:global()`。

同一错误的另一形态是**顶层 `:deep(X)`**：Vue 把它编译成 `[data-v-hash] X`，
那个属性选择器**要求祖先里有本组件的元素**。所以顶层 `:deep(X)` 搬到 Astro
必须写成 `.本组件根 :global(X)`，不能写成裸 `:global(X)`——锚点没了，规则会跑到组件外去。
`check-scope-anchors.mjs` 盯这一类。

### 陷阱 3：`:global()` 只作用于紧邻的选择器，不向嵌套传播

```css
/* 陷阱：:global 只包住第一层，内层仍带本组件 scope，匹配不到 */
:global(.tippy-box) {
	> .tippy-arrow { color: red }
}
/* 正确：每层都要单独写 */
:global(.tippy-box) > :global(.tippy-arrow) { color: red }
```

`Pagination.astro` 的两条 `::view-transition-*` 规则因此是分开写的，不是嵌套。

### 陷阱 4：判据要用**集合**，不要枚举

Vue 的「组件根元素」不能翻译成「枚举父元素」——`ProseCode.vue` 的 `code { }`
编译成 `code[data-v-N]`，对任意嵌套深度生效；写成 `article p > code, li > code, …`
就会漏掉 `<p><strong><code>` 那一处（26 个行内代码漏了 1 个）。判据应该是
`code:not(pre code):not(.copy):not(.domain)` 这种带排除项的集合，
而且**每个排除项都要有普查依据**。

### 陷阱 5：顶层裸 `:global()` 是需要论证的

`src/` 里目前有 33 条顶层裸 `:global()`，全部由 `check-scope-anchors.mjs` 按完整选择器
钉在 `UNREVIEWED` 清单里。**新增一条会红**，必须论证「主体是不是真的加不了锚点」，
然后要么给它加回锚点，要么补进 `UNREVIEWED`（钉住待复核）或者带 DOM 不变式补进
`KNOWN`（已复核）。别把 33 条现状当成「已批准」。

条数是**棘轮**：门禁会把清单全量打出来，改动前后自己数一遍，别让文档里的数字
和 `UNREVIEWED` 清单悄悄分叉（2026-10-03 发现文档写 32、实际 33）。

## §4 基础设施

### Icon 封装

`src/components/Icon.astro` 包了 astro-icon，**只接受 `name` / `class` / `style`**。
（早期版本这份文档写的是「`name` / `size` / `class` / `style`」——`size` 早就不存在了，
留着会正好踩中下面这句警告：传一个未声明的 prop 过去**不会报错**，`size` 会被静默
丢弃，图标尺寸退回 `main.css` 的 `:where(.iconify){font-size:1.2em}`。）

`class` 必须在 `Icon.astro` 里显式声明并与内置的 `iconify` 合并，调用方写在
`<Icon class="x" />` 上的 `class` 才会落到根元素；`error.vue` 那条 `class="error-icon"`
就是这么丢的，所以调用方在外面又套了一层 `.error-icon` 承载样式。加新 prop 同理——
先在 `Icon.astro` 里显式声明，否则它会静默消失。

### prose 层

`src/plugins/prose.ts` 负责把 MDX 产出的裸标签换成线上那套类名
（`z-link` / `z-codeblock` / `prose-paragraph` / `md-table` …），
`check-dead-css.ps1` 逐条断言它们真的落进了产物。
`rehypeMathCode` 必须排在 `rehypeKatex` 之前（它要把 `<a>` 换掉），
`rehypeNuxtHeadingIds` 排最前。

### 组件映射表

MDX 里免 import 使用组件，靠 `src/lib/content-components.ts` 的 26 项注册表。
注册表里的名字**没有一个与 HTML 原生标签重名**——这不是巧合，`check-mdc-eval.mjs`
的整个判据就建立在「产物里出现 `<linkcard` 严格等价于未求值」这条零歧义性质上。
**往注册表加名字之前先确认它不是 HTML 标签**，否则那道门禁立刻失去判别力。

MDC → MDX 的 codemod（`mdc-to-mdx.ts`）在接管时退役：`.mdx` 已是一手内容源，
`content/` 原文树已删除，codemod 的「原文是事实源、产物可重跑」前提不存在。
转换报告留在 git 历史：`git show a4603b0^:docs/mdc-to-mdx-report.md`。

## §5 主题

三处必须同时改，缺一处就是「看起来切了其实没切」：

1. `localStorage` 键 **`nuxt-color-mode`**（@nuxtjs/color-mode 的默认 key），
   值 `light` / `system` / `dark`。这个键名不能改——线上用户的偏好存在里面。
2. `<html data-theme="...">` —— Astro 侧的做法。
3. `<html class="dark">` —— 线上 `color.css` 的选择器是 `:root, .dark`。

`compare-ui-parity.mjs --theme=dark` 的 preflight 里有一条守卫：
`--theme=dark` 时 `<html>` 必须真的带 `.dark`，否则报错退出。
**没被注入缺陷验过会红的仪器，等于没有仪器。**

## §6 硬约束

- **Windows PowerShell 5.1 下 `.ps1` 必须是 ASCII-only**（无 BOM 的 `.ps1` 会被按 ANSI 读，
  非 ASCII 字节可能吞掉换行，让后面几行静默失效）。同理不要用
  `Set-Content -Encoding UTF8` 回写源码，它会写 BOM。
- **`.ps1` 里的路径一律从 `$PSScriptRoot` 解析**，不要用相对路径交给 `Resolve-Path`
  —— 它跟的是**进程 CWD**，不是脚本位置，于是同一份脚本换个调用方就读到别的目录。
- **部署验证一律用普通 URL。** 站点在 EdgeOne CDN 后面，带 query 的 URL 是独立
  cache key，`?cb=<时间戳>` 这种 cache-buster 会命中尚未刷新的父层拿到**旧内容**。
- **`gh` 在本仓库会优先解析 `upstream` remote**（L33Z22L11/blog-v3），
  所有 `gh run list` / `gh workflow list` 必须显式 `-R PaloMiku/blog-v4`。
- **别把整目录哈希当「代码变了」的判据**——它会把构建时间戳（atom.xml 的 `<updated>`、
  OPML 的 `dateModified`、BlogStats 的「构建于 …」）误报成语义变化。查产物差异要
  逐文件 + 定位到首个不同字符。
