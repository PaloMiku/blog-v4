# Mikuの极光星

[![站点](https://img.shields.io/badge/站点-blog.sotkg.com-00DC82)](https://blog.sotkg.com/)
[![框架](https://img.shields.io/badge/框架-Nuxt-00DC82?logo=Nuxt.js)](https://nuxt.com/)
[![CMS](https://img.shields.io/badge/CMS-Nuxt%20Content-00DC82?logo=Nuxt.js)](https://content.nuxt.com/)
[![访问统计](https://img.shields.io/badge/访问统计-Umami-000000?logo=Umami)](https://github.com/umami-software/umami)
[![代码风格](https://img.shields.io/badge/代码风格-ESLint-4B32C3?logo=ESLint)](https://eslint.org/)

Mikuの鬆的个人博客，2022 年 9 月上线。Linux、Galgame 长文与游戏条目页、网盘、友链。

> [!NOTE]
>
> 本仓库是上游主题 **[Clarity](https://github.com/L33Z22L11/blog-v3)** 的个人 Fork，
> 面向**我自己**使用，不是通用主题分发仓库。上游更新请走
> `upstream` remote 手动挑选同步，不要整体 merge。
> 致谢与上游说明见文末 [上游与致谢](#上游与致谢)。

## 当前状态

| 项 | 状态 |
| --- | --- |
| 框架 / 构建 | Nuxt 4.2 + Nuxt Content v3，纯静态生成（SSG） |
| 部署 | push `main` → GitHub Actions → `PaloMiku/blog-public` → EdgeOne CDN |
| 统计 | 自建 Umami（`umami.sotkg.com`）+ Cloudflare Insights |
| 评论 | **暂时关闭**（2026-10-03 起，见下） |
| 文章分享按钮 | 已移除（原头部「分享文章」按钮与分享弹窗整体删除） |
| 站内评论引用 | 随评论区一并关闭 |

### 评论区为什么是「暂时关闭」

`blog.config.ts` 顶部有一个总开关：

```ts
const commentEnabled = false
```

把它改成 `true`，或直接删掉这一行，评论区即恢复。三处读它：

- `blog.config.ts` 的 `twikoo.enabled`
- `app/pages/[...slug].vue` 与 `app/pages/link.vue` 的 `<PostComment v-if="commentEnabled">`
- `app/components/widget/Toc.vue` 里那个 `href="#twikoo"` 的「跳到评论区」入口

判据是 **opt-out**（未显式为 `false` 即视为开启），所以这个键被整个删掉时
行为回到改动前，而不是静默变成永久关闭。

关掉之后 `Comment.vue`、自建的 Twikoo 服务地址都原样留在仓库里，
只是既不渲染也不往 `<head>` 注入 CDN 上的 `twikoo.min.js`。

> 正文段落的「引用整段到评论区」按钮是另一套机制：它在 `onMounted` 里用
> `querySelector('#twikoo')` 做运行时检测，`#twikoo` 不存在就自动不渲染，
> 不受这个开关影响——那正是它当初没跟着一起留死链的原因。

## 特性

- 三栏布局：文章 / 侧栏目录 / 侧栏小组件，窄屏逐级收起
- MDC 组件体系：Alert、Card、Series、Project、Blur、Timeline、Music、Mermaid 等
- 代码块：行号、复制、换行折叠、Shiki 双主题色（`catppuccin-latta` / `one-dark-prose`）
- 深色 / 浅色 / 跟随系统三态，主题偏好存 `nuxt-color-mode`
- 站内搜索（MiniSearch 索引，`/search-index.json`）
- 订阅源：Atom（`/atom.xml`）与 OPML 聚合（`/subscriptions.opml`）
- 文章：归档、分类、标签、字数统计、阅读时长、上一篇/下一篇、上下篇
- 独立页面：归档、友链、网盘、关于、游戏库
- 25 个 MDC 组件 + 站内组件示例页 `/previews/example`

## 目录结构

项目使用 [Nuxt 4 项目目录结构](https://nuxt.com/docs/4.x/guide/directory-structure/app/app)。

```sh
.
├── app # 前端
│   ├── assets # 资源文件
│   ├── components # 组件
│   │   ├── blog # 博客布局组件
│   │   ├── content # MDC 组件
│   │   ├── partial # 微型组件
│   │   ├── popover # 弹窗组件
│   │   ├── post # 文章组件
│   │   ├── util # 功能组件
│   │   └── widget # 侧栏小组件
│   ├── composables # Vue 组合式函数
│   ├── layouts # 布局
│   ├── pages # 页面
│   │   ├── [...slug].vue # 正文、404 页面
│   │   ├── archive.vue # 归档
│   │   ├── link.vue # 友链
│   │   ├── index.vue # 首页
│   │   └── preview.vue # 预览的文章
│   ├── plugins # Nuxt / Vue 插件
│   ├── stores # Pinia 状态管理
│   ├── types # 类型定义
│   ├── utils # 工具函数
│   ├── app.config.ts # 前端响应式配置★
│   ├── app.vue # 基本布局
│   ├── collections.ts # 集合查询封装
│   ├── error.vue # 意外错误页
│   ├── feeds.ts # 友链列表★
│   └── shiki.config.ts # 代码高亮主题
├── content # 文章
│   ├── posts # 正式文章
│   ├── previews # 草稿文章，仅可被站内搜索
│   ├── games # Galgame 条目
│   ├── about.md
│   ├── drive.md
│   └── link.md # 友链要求
├── modules # Nuxt 模块
│   └── anti-mirror # 恶意反代跳转
├── patches # npm 包补丁
├── public # 静态资源，生成在站点根目录
│   ├── assets # 订阅源 XSLT 模板
│   └── fonts # 字体
├── remark-plugins # Unified 生态插件
├── scripts # npm 脚本
├── server # 服务端
│   ├── api # 接口
│   │   └── stats.get.ts # 博客静态统计
│   └── routes # 根路由
│       ├── atom.xml.get.ts # Atom 订阅源
│       └── subscriptions.opml.get.ts # OPML 订阅源聚合
├── shared # 前后端共用工具
│   └── utils # icon / link / str / time
├── blog.config.ts # 博客静态公共配置★
├── content.config.ts # Nuxt Content 配置
├── edgeone.json # EdgeOne 配置
├── nuxt.config.ts # Nuxt 配置
└── redirects.json # 旧站点重定向配置
```

★ = 改配置时优先看这两个文件。三层配置分工：`blog.config.ts` 放内容/分类/评论等
静态项，`app/app.config.ts` 放导航/页脚/主题等可运行时改的项，
`nuxt.config.ts` 放构建与模块。

## 开发

需要 Node.js `^22.19 || ^24.11 || >=26`（仓库用 `.nvmrc` 锁定 24）与 pnpm ≥ 10
（版本由 `package.json` 的 `packageManager` 字段锁定）。

```sh
pnpm i         # 安装依赖
pnpm dev       # 开发服务器
pnpm lint      # ESLint
pnpm lint:fix  # ESLint --fix
pnpm generate  # 静态构建，产物在 .output/public
pnpm preview   # 预览构建产物
pnpm new       # 新建文章
```

内存吃紧时用 `pnpm dev:lowmem`（限制 V8 堆到 2 GB）。

### ⚠️ 关于 `pnpm init-project`

```sh
pnpm init-project
```

**这个命令会删除整个 `content` 目录**，把文章重置成示例内容，并清空
`app/feeds.ts`、导航与统计/评论配置。它是给「拿这个仓库当模板新建站点」的人用的。

在**本仓库**里不要跑它——本站内容就是 `content/` 下的那些文件。
个性化配置直接改下面这几个地方即可：

- `blog.config.ts`：站点信息、Umami 站点 ID、Cloudflare Insights、Twikoo 评论区开关
- `app/app.config.ts`：页脚导航、出生年份（`birthYear: 0` 隐藏年龄）
- `content/link.md`：友链申请方式；`app/feeds.ts`：友链列表

文章 URL 若与旧站不同，在 `redirects.json` 里补重定向。

### 疑难解答

- `generate` 报 `Exiting due to prerender errors`：在完整日志里搜 `[404]` 和
  `Linked from`，通常是正文里链到了已删除的文章。
- 友链页的 `absolute-site-urls` 警告**是正常的**：它表示站点把自己也列进了友链
  （`app/feeds.ts` 里的自建条目用了绝对 URL），不是 IP 或配置错误。
- 文章页 404：文章 URL 末尾不应带 `/`。
- 改了 API 路径且用 EdgeOne Makers 部署时，同步改 `edgeone.json`。

### 检测友链状态

```sh
pnpm check:feed     # 检测某个友链 / 任意 URL 的托管商及可访问性
pnpm check:feed/all # 检测所有友链可访问性并生成报告
```

## 部署

`main` 分支的每次 push 会触发 `.github/workflows/build.yml`：

1. `ubuntu-latest`，Node 24，pnpm 版本从 `package.json` 的 `packageManager` 读取
2. `pnpm install --frozen-lockfile --prefer-offline`
3. `pnpm generate --no-clear`，产物在 `.output/public`
4. 通过 `DEPLOY_KEY` 把产物推到 `PaloMiku/blog-public` 的 `main` 分支
5. EdgeOne CDN 从该仓库取静态文件对外提供

也就是说**部署由 `blog-public` 那个仓库承载**，本仓库只负责构建。

若要改用别的静态托管，构建命令 `pnpm generate`、输出目录 `.output/public`、
安装命令 `pnpm i` 即可。直接用平台自带的「Nuxt」预设会变成 SSR 模式，
每次访问都等服务端重新渲染，不建议。

## 贡献

这是个人博客仓库，不接受功能增强类 PR。发现问题或想讨论具体改动，欢迎开 Issue。

同步上游时建议：加 `upstream` remote 后**按批次挑选文件**，
不要整体 merge——本站对布局、组件与内容都做了较大幅度定制。

## 上游与致谢

- 主题基于 **[L33Z22L11/blog-v3](https://github.com/L33Z22L11/blog-v3)**（Clarity），
  版权归原作者所有，本站遵循上游的个性化要求，不作为通用主题再分发。
- 主题吸收了 [xaoxuu/hexo-theme-stellar](https://github.com/xaoxuu/hexo-theme-stellar)
  的设计风格。
- 3.8.0 起改为纯 CSS（SCSS → CSS），下游更新前请读上游的
  [迁移说明](https://github.com/L33Z22L11/blog-v3/blob/main/MIGRATION.md)。
- 贡献者与社区移植版本列表见上游仓库。

## 许可证

- 项目本体：[MIT](LICENSE)
- 博客文章：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)
