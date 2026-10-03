# Nuxt 生产基线（2026-10-01 冻结）

本文件是 Astro 7 迁移的**唯一对比锚点**。迁移过程中每一步都用这里的数字做回归。
数据采集自分支 `feat/migrate-astro` 的 `pnpm generate`（含当时未提交的 `BlogSidebar.vue` / `animation.css` WIP）。

## 1. 构建耗时

| 阶段 | 耗时 |
| --- | --- |
| 内容处理（63 files，全部命中缓存） | 0.06 s |
| 客户端构建 | 18.48 s |
| └ 其中 `vite-plugin-nuxt-component-meta`（nuxt-studio） | **8.50 s（占 46%）** |
| 服务端构建 | 5.32 s |
| 预渲染（206 routes） | 15.54 s |
| **合计** | **约 40 s** |

其他固定开销：
- `@nuxt/content` 组件元数据解析：8.48 s
- 构建期图标超时告警 4 次（`material-symbols:h-mobiledata-badge`、`uim:vuejs`、`devicon:qt`、`devicon:rust`，各等满 1500 ms）
- `nuxt-studio` 生产模式认证告警

## 2. 产物规模

**总计 38.35 MB / 852 个文件**

| 目录 / 文件 | 文件数 | 体积 | 说明 |
| --- | ---: | ---: | --- |
| `_studio-app/` | 359 | **22.97 MB** | nuxt-studio 整套编辑器，**占产物 60%**，开发工具，不应进生产 |
| `_nuxt/` | 284 | 6.86 MB | 站点 JS/CSS/wasm |
| HTML 页面 | 69 | 6.57 MB | 含各页 `_payload.json` |
| `raw/` | 63 | 0.61 MB | **63 篇原始 markdown 全文公开可下载** |
| `previews/` | 4 | 0.40 MB | 草稿页 |
| `__nuxt_content/` | 1 | 0.29 MB | **`sql_dump.txt` 整个内容数据库公开** |
| 其他目录 + 根文件 | — | ~0.7 MB | |
| `index.html`（首页） | 1 | 132.6 KB | |
| `sitemap.xml` | 1 | 53.7 KB | |
| `atom.xml` | 1 | 60.8 KB | |
| `llms.txt` | 1 | 23.2 KB | |
| `_payload.json`（根） | 1 | 34.6 KB | |

### `_studio-app/` 最大文件

| KB | 文件 |
| ---: | --- |
| 3334.5 | `1.7.0/main-CcK4joxm.js` |
| 3331.6 | `1.7.0/main-DewE7jXn.js` |
| 3327.8 | `1.7.0/main--bmh2jAc.js` |
| 3204.2 | `1.7.0/main-FA4YNL2I.js` |
| 761.6 | `1.7.0/emacs-lisp-C4732ieo.js` |
| 611.9 | `1.7.0/cpp-DogXcJ7O.js` |
| 607.7 | `1.7.0/wasm--yL7jHw-.js` |
| 256.2 | `1.7.0/wolfram-1xJNnwe2.js` |

### `_nuxt/` 最大文件

| KB | GzKB | 文件 | 归属 |
| ---: | ---: | --- | --- |
| 844.5 | 405.6 | `sqlite3.BVKGSWc-.wasm` | `@nuxt/content` 客户端 sqlite（懒加载，不在预加载列表） |
| 713.0 | 196.0 | `6UNCNtG5.js` | **单页面最大 JS 块** |
| 646.6 | 143.2 | `CoA4358r.js` | |
| 509.3 | 149.3 | `F2cGOVLj.js` | |
| 424.7 | 137.8 | `c2aL46s-.js` | |
| 252.6 | 77.4 | `ZlcWpGUi.js` | |
| 210.7 | — | `sqlite3-worker1-CMgeqElg.js` | |
| 99.5 | 10.1 | `manifest.json` | 驱动下面的全量预加载 |

## 3. 访客实际负担（最关键指标）

文章页 `/2025/11/riddle-joker/`：

| 项 | 值 |
| --- | --- |
| **预加载资源数** | **87**（1 个 entry script + 74 个 modulepreload + 12 个 CSS） |
| **JS+CSS 原始体积** | **1,561.9 KB** |
| **JS+CSS gzip 后** | **517.6 KB** |
| HTML 自身 | 108.6 KB |
| 引用 sqlite3 | 否（懒加载） |
| 引用 `_studio-app` | 否 |

各页面横向对比（modulepreload 数量 / gzip 前 KB）：

| 页面 | 预加载 | 资源数 | KB |
| --- | ---: | ---: | ---: |
| `/` | 76 | 76 | 1532.8 |
| `/archive` | 66 | 66 | 1492.3 |
| `/link` | 64 | 64 | 1522.0 |
| `/2025/11/riddle-joker` | 87 | 87 | 1561.9 |
| `/2025/05/gal-up` | 90 | 90 | 1560.5 |
| `/games/galgames/clannad` | 94 | 94 | 1564.9 |
| `/about` | 91 | 91 | 1562.2 |

**每个页面都在预加载 64–94 个 chunk，体积几乎恒定在 1.5 MB。** 这是 Nuxt 的 `manifest.json` 驱动的激进 modulepreload 策略导致的，与页面内容无关。

### HTML 体积分布（67 个页面）

| 指标 | 值 |
| --- | --- |
| 最小 | 0.1 KB（`favicon.ico` 被当作 html 计入） |
| 中位 | 95.1 KB |
| 最大 | 230.2 KB |
| 合计 | 6.57 MB |

## 4. URL 清单

67 个页面，完整清单见 `baseline-urls.txt`。形态：

- 首页 `/`
- 文章 `/2024/03/takagi/` ~ `/2026/03/honorx16-ryzen-linux/`（年份/月/标题，`hidePostPrefix` 生效，无 `/posts` 前缀）
- 游戏库 `/games/galgames/...`（含多层嵌套）
- 固定页 `/archive/` `/link/` `/about/` `/drive/` `/preview/` `/previews/...`
- 非页面端点：`/atom.xml` `/subscriptions.opml` `/api/stats` `/llms.txt` `/sitemap.xml` `/robots.txt`

## 5. 组件分诊（85 个 Vue 组件 / ~9.6k 行）

分诊依据：硬信号（`ref` / `watch` / 生命周期 / 浏览器 API / Nuxt 或 app composable / 异步数据 / 模态系统）计 1 分，≥2 分为 C，1 分为 B，仅有 DOM 事件或双向绑定为 B，无信号为 A。

| 层级 | 数量 | 行数 | 处理方式 |
| --- | ---: | ---: | --- |
| **A-STATIC** | 39 | 3,000 | 重写为 `.astro`，零客户端 JS |
| **B-HYBRID** | 21 | 2,375 | 视情况：`.astro` + 内联脚本，或小 Vue 岛 |
| **C-ISLAND** | 25 | 4,246 | 保留 Vue 岛 |

已人工复核确认 A 分类无误的样本：`Music.vue`（232 行，实为带图标的链接卡片）、`PostFooter.vue`（278 行，纯展示页脚）、`ProjectGroup.vue`（232 行）。

### A-STATIC 完整清单（39）

`app.vue`、`layouts/default.vue`、`blog/BlogFooter`、`blog/BlogHeader.global`、`blog/BlogWidget`、`blog/SkipToContent`、`content/Alert`、`content/Badge`、`content/Blur`、`content/CardList`、`content/Chat`、`content/Folding`、`content/LinkBanner`、`content/LinkCard`、`content/MdTitle`、`content/Music`、`content/Poetry`、`content/ProjectGroup`、`content/ProseA`、`content/Quote`、`content/ResourceList`、`content/Timeline`、`partial/Button`、`partial/DlGroup`、`partial/Dropdown`、`partial/Error`、`partial/IconNavList`、`partial/Secret`、`popover/SearchItem`、`post/Archive`、`post/Article`、`post/PostFooter`、`util/Date`、`util/Img`、`util/Link`、`widget/BlogLog`、`widget/BlogStats`、`widget/CommGroup`、`widget/Empty`

### B-HYBRID 完整清单（21）

`blog/BlogPanel`、`blog/Mask`、`blog/ThemeToggle`、`content/EmojiClock`、`content/InfoCard`、`content/MusicScore`、`content/ProseTable`、`content/SeriesGroup`、`content/Tip`、`content/VideoEmbed`、`partial/Expand`、`partial/Pagination`、`partial/RadioGroup`、`partial/Slider`、`partial/Toggle`、`popover/Lightbox`、`post/OrderToggle`、`post/Slide`、`widget/BlogTech`、`widget/Toc`、`error.vue`

### C-ISLAND 完整清单（25）

`blog/BlogAside`、`blog/BlogSidebar`、`content/Copy`、`content/FeedCard`、`content/FeedGroup`、`content/Key`、`content/Mermaid`、`content/Pic`、`content/ProseCode`、`content/ProseP`、`content/ProsePre`、`content/Tab`、`popover/Search`、`popover/Share`、`post/Collection`、`post/Comment`、`post/Excerpt`、`post/PostHeader`、`post/PostSurround`、`util/ListTransition`、`pages/index`、`pages/archive`、`pages/link`、`pages/preview`、`pages/[...slug]`

## 6. 迁移可直接消灭的产物

| 项 | 体积 | 消灭方式 |
| --- | ---: | --- |
| `_studio-app/` | 22.97 MB | 移除 `nuxt-studio` 依赖（已决策） |
| `raw/*.md`（63 篇原文） | 0.61 MB | Astro 无对应产物；如需保留 raw 端点需显式实现 |
| `__nuxt_content/content/sql_dump.txt` | 0.29 MB | Astro 内容层为构建期数据，不产生数据库转储 |
| `_nuxt/sqlite3*.{wasm,js}` | 1.07 MB | 同上，客户端不再需要 sqlite |
| 每页 64–94 个 modulepreload | 1.5 MB → 按需 | Astro 只投递页面实际用到的 island 脚本 |
| HTML 中位 95.1 KB | → 大幅下降 | Astro 输出纯 HTML，不内联 payload |

## 7. 与迁移计划的关系

本基线**上调了迁移的价值判断**。原计划 §5 认为收益「主要在客户端 JS 体积和依赖维护成本」，实测后需修正为：

1. 访客侧收益比预期更直接：每页 **517.6 KB gzip** 的固定 JS 负担，迁移后可望降至 100 KB 以内（仅保留约 25 个交互岛）。
2. 产物侧 **60% 是开发工具**（`_studio-app`），且存在两处不应公开的内容：`raw/` 全文与 `sql_dump.txt`。这既是体积问题也是**暴露面问题**，即使不迁移 Nuxt 也应当处理。
3. 构建侧 46% 的客户端构建时间消耗在 `nuxt-studio` 的组件元数据解析上。

## 8. 复现方式

```powershell
pnpm generate                                              # 重建产物
powershell -File scripts/baseline-analyze.ps1              # 重新采集本文件中的指标
```

`scripts/baseline-analyze.ps1` 输出：各代表页面的预加载资源数与体积、gzip 估算、HTML 体积分布、sqlite/studio 引用检查。
