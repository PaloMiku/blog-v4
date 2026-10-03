<!-- 2026-10-03：MDC -> MDX codemod 随接管退役（src/content-mdx 已成为唯一内容源 src/content，原文 content/ 已删除，codemod 的「原文是事实源」前提不再成立）。scripts/mdc-to-mdx.ts 与 scripts/golden/ 一并移除；本文件作为转换契约与当时 19 条待复核点的存档保留。 -->

# MDC → MDX 转换报告

> 本文件由 `node scripts/mdc-to-mdx.ts` 生成，**不要手工编辑**（重跑会覆盖）。

- 运行参数：`--all --check`
- 处理文件：**63**（全库 63 个 `.md`）
- 异常文件：**0**
- MDX 编译校验：**63 成功 / 0 失败**（用 `@mdx-js/mdx` + `remark-math` + `rehype-katex`，与 `astro.config.mjs` 同插件集）
- 产物目录：`D:\Projects\blog-v4\astro-site\src\content-mdx`
- `content/` 下的 `.md` 全程只读，未做任何修改

## 0. 转换契约与需要人工复核的点

### 0.1 Tab 的确切形态

MDC 的 `#tab1..#tabN` 动态 slot → **静态具名 slot**，slot 名与原 Vue 实现一致（N 从 1 开始）：

```mdx
<Tab tabs={["A", "B", "C"]} active={2}>

<div slot="tab1">

内容A

</div>

<div slot="tab2">

内容B

</div>

<div slot="tab3">

内容C

</div>

</Tab>
```

- props（`tabs`/`active`/`center`/`combobox`/`border`）形态与原 Vue 版一致，**没有** `panels` 字段。
- panel 数量优先取 `tabs` 数组长度；某个 panel 在源文件里为空时输出自闭合 `<div slot="tabN" />`，**不用** `{null}` 占位。
- panel 内容保持原样 Markdown，可含嵌套组件。
- JSX 子元素之间（含开标签与首个子节点、末个子节点与闭标签）都强制插入空行——MDX 的硬性要求。
- 已与 `src/components/content/Tab.astro` 对齐：它按 `tabs.length` 静态调用 `Astro.slots.render('tab' + i)`。

### 0.2 ⚠️ Chat / Timeline 的 items 形状与现有组件实现冲突（需你决策）

产物按简报契约生成分组形状：

```mdx
<Chat items={[
	{ caption: "2024-11-09 23:39:30", control: ":", body: "" },
	{ caption: "", control: ".", body: "也许" },
	{ caption: "用户1", body: "有趣\n我学到了。" }
]} />
```

但现有的 `src/components/content/Chat.astro` / `Timeline.astro` 消费的是**扁平交替**形状：

```astro
{items.map(item => item.caption
	? <dt class="chat-caption" class:list={{ [controlClass(item.control)]: true }}>{item.caption}</dt>
	: <dd class="chat-body">{item.body}</dd>)}
```

即「`caption` 真值就渲染 `<dt>`，否则渲染 `<dd>`」。**两者不兼容，后果：**

1. `{ caption: "用户1", body: "有趣…", control: undefined }` 在现有组件下只渲染 `<dt>用户1</dt>`，**`body` 被整段丢弃**。
2. `control` 只在 caption 分支被读取，所以 `{.纸鹿}`（`caption` 为空、`control: "."`）拿不到 `chat-myself` 右对齐样式。

**二选一，需要你定：**

- **A（改组件，推荐）**：让 `Chat.astro`/`Timeline.astro` 按分组形状渲染——一次 `map` 同时输出 `<dt>` + `<dd>`，并把 `control` 挂到对应的 `<dd>` 上。产物不用动。
- **B（改产物）**：codemod 改成扁平交替（`{caption}` 与 `{body}` 各占一项），组件不用动。我可以加一个开关实现。

我按简报契约选了分组形状（默认 A），**没有**擅自改你的组件文件。

### 0.3 其它需要复核的点

| # | 事项 | 说明 / 建议 |
| --- | --- | --- |
| 1 | `metaSlots` 键名 | 键是去掉 `meta-` 前缀的 `aside-foo`/`aside-bar`/`copyright`（与原 `rehype-meta-slots` 的 `file.data.slots` 一致）。但 `example.md` frontmatter 的 `aside: [toc, meta-aside-foo, meta-aside-bar]` **仍带前缀**，消费侧需要去掉 `meta-` 再查表。 |
| 2 | `meta-*` 的 content 是字符串 | 原插件存的是 minimark 树（结构化数组），现在是**已转换的 MDX 片段字符串**。`aside-bar` 的 content 是 `<LinkCard … />`，消费侧需要把它当 MDX 渲染。 |
| 3 | `<Fragment slot>` vs `<div slot>` | Tab 用 `<div>`（你的组件用 `set:html`，需要真实元素锚点）。其余组件（Alert 的 `title`、Folding 的 `title`、Quote 的 `icon`、Pic 的 `caption`）用的是 `<Fragment slot>`，因为现有 `Alert.astro` 等走标准 `<slot name>`。**如果这些组件之后也改用 `set:html`，需要把 `<Fragment>` 换成 `<div>`**——告诉我一声即可切换。 |
| 4 | `bgm-*` 16 处 | 保留 MDC 原文（未转换、未删除），仅统计。块内**子内容**仍按 MDC 规则转换（原语料里 bgm 块只有 YAML props，无子内容）。这些块在 MDX 产物里仍是 `::bgm-*` 文本，需要你决定：删除 / 换成占位组件 / 保留。 |
| 5 | `music` 的 prop 名不一致 | 真实文章用 `name`，`example.md` 的文档示例用 `title`。我**原样透传**，没有改名。组件侧需同时接受 `name` 与 `title`，或回头修文档。 |
| 6 | `class` → `className` | 语料里只有 `LinkCard` 用到 `class`（2 处），但我做了**通用**映射（任何组件的 `class` 都转 `className`），MDX 本来就要求这样。 |
| 7 | YAML 空值 | `misskey-fediverse-deploy.md:21` 的 `description:` 是空值 → `description={null}`。请确认 `LinkBanner` 能容忍 `null`（原 Vue 版是 `undefined`）。 |
| 8 | MDC markdown 属性语法（12 处） | `[x]{.cls}` / `[x](u){.cls}` / `![x](u){.cls}` / `\`x\`{lang="js"}` 在 MDX 里必然编译失败，已改写成 `<span>`/`<a>`/`<img>`/`<code>`。**注意 `<a>` 会丢失原 `ProseA` 的行为**（站外新标签页、域名图标、favicon）。若要保留，Astro 侧需要 `ProseA` 组件并把 `<a>` 换成它。 |
| 9 | 82 处裸 `<br>` | markdown 允许、MDX JSX 要求自闭合，已转 `<br />`。全部在 `clannad/index.md`(25)、`clannad/secret/name.md`(7) 等表格单元格里。 |
| 10 | 1 处 HTML 注释 | `link.md:1` 的 `<!-- … -->` MDX 不支持，已转 MDX 花括号注释（两者都会从产物剥掉，无损）。 |
| 11 | `example.md` 源文件既有 bug | 文件末尾的 `::tab`（源 1340 行）**缺少闭合 `::`**。我按「到文件末尾」补全并转换（`#tab2` 里正好是同内容的 `\`\`\`mdc\`\`\` 围栏，印证了只是漏写）。产物可编译，但源文件建议补上。 |
| 12 | `clarity-resource-list.md` 含裸 Vue SFC | 前 93 行是**没有代码围栏**的 `<script setup>`/`<template>` 源码，MDX 会当 JSX 解析并报 `Icon` 等未定义。需要手工加代码围栏，或引入对应组件。**本次转换未改动它**。 |
| 13 | Astro 侧缺失组件（12 个） | 产物引用但 `src/components/content/` 里还没有：`Copy` `EmojiClock` `InfoCard` `Key` `Mermaid` `Music` `MusicScore` `Pic` `ProjectGroup` `ResourceList` `SeriesGroup` `BlogHeader`。已存在 16 个（含 `Tab`/`Alert`/`Folding`/`Quote`/`Chat`/`Timeline` 等）。 |
| 14 | `Mermaid` / `MusicScore` | 代码块已按 `remark-code-component` 的行为转成 `<Mermaid code={`…`} />`、`<MusicScore abc={`…`} />`（反引号与 `${}` 已转义）。代码内容**未补尾部换行**，与原插件的 `node.value` 行为一致；若你的组件需要，告诉我。 |
| 15 | 常规代码块 | 一律原样保留，未做任何改写（`ProsePre` 的 `code` prop 依赖交给 Astro/Shiki）。 |
| 16 | `# tab2` / `# icon` 带空格形式 | 已支持（`clarity-resource-list.md:245`、`nukitashi-gv-end.md:194`）。插槽名走白名单（`default`/`title`/`icon`/`caption`/`tabN`），避免把 markdown 标题 `# xxx` 误判成插槽。 |
| 17 | camelCase prop | `extractPassword`/`downloadPassword`/`singleTitle`/`tipOptions` 等一律原样保留，无 kebab→camel 转换需求。 |
| 18 | 数字/字符串类型 | YAML parser 保类型：`id: '7339041157571169546'` 保持字符串，`count: 3`/`active: 2` 保持 number，`tabs`/`cover`/`items` 保持数组。行内属性只有明确以 `[`/`{` 开头且能 JSON.parse 时才当表达式，`"123"` 仍是字符串。 |
| 19 | 未闭合块的冒号计数 | 闭合标记的冒号数必须与栈顶**严格相等**（`::`/`:::`/`::::` 各自配对），slot 归属完全由「计数 + slot 栈」决定，不看缩进。全量 63 个文件**零** `colon-mismatch`，证明语料里没有混用。 |

## 1. 组件转换次数

| 组件 | 次数 |
| --- | ---: |
| `tip` | 125 |
| `html:void-selfclosed` | 82 |
| `alert` | 53 |
| `folding` | 46 |
| `tab` | 38 |
| `pic` | 38 |
| `key` | 27 |
| `link-card` | 23 |
| `link-banner` | 22 |
| `badge` | 21 |
| `video-embed` | 16 |
| `card-list` | 11 |
| `blur` | 10 |
| `copy` | 9 |
| `music` | 8 |
| `info-card` | 8 |
| `project-group` | 7 |
| `quote` | 6 |
| `md-attr:span` | 5 |
| `md-attr:code` | 4 |
| `emoji-clock` | 3 |
| `resource-list` | 2 |
| `chat` | 2 |
| `md-attr:link` | 2 |
| `code:music-abc` | 2 |
| `timeline` | 2 |
| `html-comment` | 1 |
| `md-attr:image` | 1 |
| `code:mermaid` | 1 |
| `blog-header` | 1 |
| `poetry` | 1 |
| `series-group` | 1 |

## 2. 跳过项（保留 MDC 原文，未转换未删除）

| 组件 | 次数 |
| --- | ---: |
| （无） | 0 |

## 3. Chat / Timeline 生成的 item 数

| 组件 | items |
| --- | ---: |
| `tab` | 93 |
| `chat` | 15 |
| `timeline` | 6 |

## 4. 告警明细

### `html-void-selfclosed` (82)

- `games/galgames/clannad/index.md:157` — <br>
- `games/galgames/clannad/index.md:182` — <br>
- `games/galgames/clannad/index.md:183` — <br>
- `games/galgames/clannad/index.md:183` — <br>
- `games/galgames/clannad/index.md:365` — <br>
- `games/galgames/clannad/index.md:390` — <br>
- `games/galgames/clannad/index.md:509` — <br>
- `games/galgames/clannad/index.md:511` — <br>
- `games/galgames/clannad/index.md:516` — <br>
- `games/galgames/clannad/index.md:519` — <br>
- `games/galgames/clannad/index.md:533` — <br>
- `games/galgames/clannad/index.md:536` — <br>
- `games/galgames/clannad/index.md:539` — <br>
- `games/galgames/clannad/index.md:541` — <br>
- `games/galgames/clannad/index.md:546` — <br>
- `games/galgames/clannad/index.md:605` — <br>
- `games/galgames/clannad/index.md:634` — <br>
- `games/galgames/clannad/index.md:673` — <br>
- `games/galgames/clannad/index.md:702` — <br>
- `games/galgames/clannad/index.md:704` — <br>
- `games/galgames/clannad/index.md:903` — <br>
- `games/galgames/clannad/index.md:903` — <br>
- `games/galgames/clannad/index.md:929` — <br>
- `games/galgames/clannad/index.md:929` — <br>
- `games/galgames/clannad/index.md:939` — <br>
- `games/galgames/clannad/index.md:939` — <br>
- `games/galgames/clannad/index.md:967` — <br>
- `games/galgames/clannad/index.md:967` — <br>
- `games/galgames/clannad/index.md:982` — <br>
- `games/galgames/clannad/index.md:982` — <br>

_另有 52 条同类告警，见 --json 输出_

### `md-attr-rewritten` (12)

- `previews/example.md:24` — [就像**这样**——]{.example-info #just-like-this style="color: #00
- `previews/example.md:48` — `type: story`{lang="yaml"}
- `previews/example.md:55` — ![图片](https://picsum.photos/100/100){.icon}
- `previews/example.md:56` — `type: story`{lang="yaml"}
- `previews/example.md:56` — [只在 <code lang="yaml">type: story</code> 时🀄]{.title-like}
- `previews/example.md:57` — [故事感。]{.text-story}
- `previews/example.md:58` — [阴 影 回 声]{.text-repeat}
- `previews/example.md:59` — [变大变高]{.text-zoom}
- `previews/example.md:92` — [a](#链接-prosea){icon="tabler:color-swatch"}
- `previews/example.md:109` — `const a = 1`{lang="js"}
- `previews/example.md:111` — `pnpm dev`{lang="sh" copy}
- `previews/example.md:304` — [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/

### `unclosed-block` (1)

- `previews/example.md:1340` — tab（源文件缺少闭合标记，已按到文件末尾处理）

## 5. 需要人工复核的文件

- `previews/example.md`

## 6. 产物清单

- `about.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\about.mdx`
- `drive.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\drive.mdx`
- `games/galgames/aokana-ex1.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\aokana-ex1.mdx`
- `games/galgames/aokana.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\aokana.mdx`
- `games/galgames/clannad/index.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\index.mdx`
- `games/galgames/clannad/secret/64hits.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\64hits.mdx`
- `games/galgames/clannad/secret/fuuko-appear.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\fuuko-appear.mdx`
- `games/galgames/clannad/secret/fuuko-master.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\fuuko-master.mdx`
- `games/galgames/clannad/secret/gun.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\gun.mdx`
- `games/galgames/clannad/secret/index.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\index.mdx`
- `games/galgames/clannad/secret/misae.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\misae.mdx`
- `games/galgames/clannad/secret/name.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\name.mdx`
- `games/galgames/clannad/secret/sunoharaface.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\sunoharaface.mdx`
- `games/galgames/clannad/secret/yukine.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\clannad\secret\yukine.mdx`
- `games/galgames/index.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\index.mdx`
- `games/galgames/koichoco.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\koichoco.mdx`
- `games/galgames/maitetsu.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\maitetsu.mdx`
- `games/galgames/nukitashi.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\nukitashi.mdx`
- `games/galgames/riddle-joker.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\riddle-joker.mdx`
- `games/galgames/sothewitch.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\sothewitch.mdx`
- `games/galgames/sprb.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\galgames\sprb.mdx`
- `games/index.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\games\index.mdx`
- `link.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\link.mdx`
- `posts/2024/03/takagi.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\03\takagi.mdx`
- `posts/2024/08/docker-deploy-outline.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\08\docker-deploy-outline.mdx`
- `posts/2024/09/1panel-appstore-refused.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\09\1panel-appstore-refused.mdx`
- `posts/2024/10/shiroi-docker-deployment.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\10\shiroi-docker-deployment.mdx`
- `posts/2024/10/write-1panel-app.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\10\write-1panel-app.mdx`
- `posts/2024/12/break-change-2024.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\12\break-change-2024.mdx`
- `posts/2024/12/oyiso-tianligpt.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2024\12\oyiso-tianligpt.mdx`
- `posts/2025/01/arch-aur-kazumi.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\01\arch-aur-kazumi.mdx`
- `posts/2025/05/clannad-zh-linux.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\clannad-zh-linux.mdx`
- `posts/2025/05/fediverse.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\fediverse.mdx`
- `posts/2025/05/gal-up.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\gal-up.mdx`
- `posts/2025/05/koichoco-psp.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\koichoco-psp.mdx`
- `posts/2025/05/lxgw-wenkai-web.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\lxgw-wenkai-web.mdx`
- `posts/2025/05/maitetsu-video-fix.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\maitetsu-video-fix.mdx`
- `posts/2025/05/misskey-sidebar.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\misskey-sidebar.mdx`
- `posts/2025/05/shr-misskey.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\05\shr-misskey.mdx`
- `posts/2025/06/decky-loader.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\06\decky-loader.mdx`
- `posts/2025/06/self-fediverse-prepare.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\06\self-fediverse-prepare.mdx`
- `posts/2025/06/sickly-days-linux-run.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\06\sickly-days-linux-run.mdx`
- `posts/2025/08/kde-customization.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\08\kde-customization.mdx`
- `posts/2025/10/affine-deploy.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\affine-deploy.mdx`
- `posts/2025/10/clarity-resource-list.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\clarity-resource-list.mdx`
- `posts/2025/10/fnos-vps-started.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\fnos-vps-started.mdx`
- `posts/2025/10/lemmy-fediverse-deploy.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\lemmy-fediverse-deploy.mdx`
- `posts/2025/10/misskey-fediverse-deploy.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\misskey-fediverse-deploy.mdx`
- `posts/2025/10/nukitashi-gv-end.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\nukitashi-gv-end.mdx`
- `posts/2025/10/otterwiki-deploy.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\otterwiki-deploy.mdx`
- `posts/2025/10/rust-waline-deploy.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\10\rust-waline-deploy.mdx`
- `posts/2025/11/blog-1th-note.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\11\blog-1th-note.mdx`
- `posts/2025/11/cachyos-handheld-chinese-input.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\11\cachyos-handheld-chinese-input.mdx`
- `posts/2025/11/fedora-cosmic-beta.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\11\fedora-cosmic-beta.mdx`
- `posts/2025/11/piece-hy1.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\11\piece-hy1.mdx`
- `posts/2025/11/riddle-joker.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\11\riddle-joker.mdx`
- `posts/2025/12/fedora-silverblue-install-and-immutable-future.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\12\fedora-silverblue-install-and-immutable-future.mdx`
- `posts/2025/12/love-love-school-linux-chinese.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\12\love-love-school-linux-chinese.mdx`
- `posts/2025/12/oss-prepare-list.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2025\12\oss-prepare-list.mdx`
- `posts/2026/03/honorx16-ryzen-linux.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2026\03\honorx16-ryzen-linux.mdx`
- `posts/2026/03/noctalia-plugin-process-reporter.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\posts\2026\03\noctalia-plugin-process-reporter.mdx`
- `previews/bangumi-components.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\previews\bangumi-components.mdx`
- `previews/example.md` → `D:\Projects\blog-v4\astro-site\src\content-mdx\previews\example.mdx`
