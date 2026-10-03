# 纸鹿摸鱼处

[![框架](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro)](https://astro.build/)
[![部署平台](https://img.shields.io/badge/GitHub%20Pages-222?logo=github)](https://blog.sotkg.com/)
[![代码风格](https://img.shields.io/badge/ESLint-4B32C3?logo=eslint)](https://eslint.org/)

我的第三代个人博客，于 2024 年 8 月 11 日上线。

> **2026-10-03 起本站从 Nuxt 4 迁移到 Astro 7**（迁移提交 `00c4401`）。本文的「目录结构 /
> 快速开始 / 部署指南」按 Astro 现实改写；耻辱柱、友链清单、特性等主题内容继承自上游
> Clarity 主题（[L33Z22L11/blog-v3](https://github.com/L33Z22L11/blog-v3)）。
> Nuxt 时代的 `MIGRATION.md` 已删除，历史工程决策见 `CLAUDE.md` 与 `MIGRATION-BRIEF.md`。

## 耻辱柱 / Hall of Shame

> [!CAUTION]
> - 部署前必须完成项目个性化配置与内容修改，不得将我的信息用于你的网站图标/名称，严禁将项目内我的文章以你的名义重新发布至公开环境。
> - 部署前必须完成项目个性化配置与内容修改，不得将我的信息用于你的网站图标/名称，严禁将项目内我的文章以你的名义重新发布至公开环境。
> - 部署前必须完成项目个性化配置与内容修改，不得将我的信息用于你的网站图标/名称，严禁将项目内我的文章以你的名义重新发布至公开环境。

近期 Fork 项目后将我的文章部署在互联网且不遵守 CC 协议的行为增加，追查耗费了我大量精力，因此我将直接将侵权网站列在此标题，希望能减少此类现象的发生。

<!-- 1. 2025-12-05 [钟神秀](https://github.com/zsxcoder/Nuxt-blog-v3)：blog.zsxcoder.top《我们的设备被拿来做了什么：软件的背景行为》 -->
<!-- 2. 2025-12-28 [Axel Beta](https://github.com/ErenAxel/blog-v3)：sc.axel.xin《我们的设备被拿来做了什么：软件的背景行为》《深色模式开发的最佳实践》《寻不回手工油糕》 -->

-

## 使用本主题的博客

> [!WARNING]
>
> 修改本项目需要具备**前端开发**和**项目部署**能力。由于这是个人博客，代码经过深度定制，且可能会进行较大幅度的更新，建议您 Fork 后安心使用自己分支的版本；若需引入上游（本仓库）的新功能，建议重新 Fork 最新代码，以避免同步冲突。
>
> 如果需要协助或有问题咨询，欢迎加入 QQ 群 169994096 讨论/闲聊，我会在空闲时尽力解答。

> 主题吸收了 [Stellar](https://github.com/xaoxuu/hexo-theme-stellar) 的设计风格，命名为 **Clarity**，寓意清楚的阅读体验和清晰的观点表达。限于下游越来越多，未来将会有选择地收录。

版本以站点公开信息为准（2026-09-06）。

| 博客名称                                     | 作者            | 线上版本    | 特色                           |
| -------------------------------------------- | --------------- | ----------- | ------------------------------ |
| **[纸鹿摸鱼处](https://blog.zhilu.site/)**   | **L33Z22L11**   | v3.7.1      | 上游                           |
| [希乐博客](https://blog.xlenco.top/)         | Xlenco          | 未公开      | 最新评论、更新日志             |
| [Mugzx's Blog](https://blog.mugzx.top/)      | Mugzx           | v3.7.1      | 精简导航、Umami 统计           |
| [喵洛阁](https://blog-v3.kemeow.top/)        | Kemeow815       | 未公开      | 番剧、影视、书房、游戏页       |
| [钟神秀](https://blog.zsxcoder.top/)         | mcyzsx          | v3.6.0      | 朋友圈、即刻、装备、追番       |
| [梦爱吃鱼](https://blog.bsgun.cn/)           | JLinmr          | v3.6.0      | 鱼塘、瞬间、最新评论           |
| [Mikuの极光星](https://blog.sotkg.com/)      | PaloMiku        | v3.7.0      | Linux 与 Galgame 长文、游戏页  |
| [BiuXin-s Blog](https://blog.biuxin.de/)     | damizai         | 未公开      | 鱼塘、说说、最新评论           |
| [液泡部落格](https://blog.vacu.top/)         | VacuolePaoo     | v3.7.1      | 开发工具配置、技术与思考       |
| [闻絮语](https://www.wxuyu.top/)             | wxuyu           | v3.6.5      | 友链轮播、追更历史、音乐控制   |
| [落憾](https://blog.luoh.org/)               | LuoH-AN         | v3.7.1      | 原创诗词、闲言、今日诗词       |
| [fishcpy的小破站](https://blog.fis.ink/)     | fishcpy         | v3.4.8      | 鱼塘、时间盒、监控美化         |
| [六月墨语](https://blog.june.ink/)           | Akuma-real      | v3.6.3      | 说说、访客卡片、音乐播放器     |
| [Cталин博客](https://blog.jiclub.site/)     | StalinDev54     | v3.4.8      | 生活长文、动态、关于页         |
| [栖童の小站](https://blog.linux-qitong.top/) | Linux-qitong    | v3.4.9      | 标签、友圈、Linux 实践         |
| [鹊楠の小窝](https://quenan.cn/)             | QNquenan         | v3.4.9      | 建站教程、公告、更新日志       |
| [KingKangBlog](https://blog.kingkang.xyz/)   | KingStoning     | v3.4.9      | 标签筛选、大学随笔             |
| [Axel's BLOG](https://blog.axelx.cn/)         | AxelEwan        | v3.7.0-rc.0 | 演唱会图文、动态、音乐         |
| [AirTouchの小站](https://www.xsl.im/)         | AirTouch666     | v3.6.0      | 自部署教程、鱼塘、说说         |
| [Olinl Blog](https://blog.olinl.com/)        | olinll         | v3.7.1      | 部署与容器教程、主题改造笔记   |
| [古怪杂记本](https://blog.guuguai.site/)       | GuuGuai        | v3.6.3      | 考研复盘、Minecraft 长文       |
| [敖苛记](https://blog.kayro.cn/)              | jeoor          | v3.7.1      | 相册、标签云、时间进度         |
| [灯火不休时](https://blog.dhbxs.top/)          | dhbxs          | v3.7.0-rc.0 | Java 与大数据实践、碎碎念      |
| [郭雨博](https://blog.guoyubo.cn/)             | guojiahaous-alt | v3.7.0-rc.0 | CTF 复盘、折叠好友、音乐播放器 |

### 社区移植

| 框架    | 项目                                                                    | 版本 / 状态 | 特色                                                                             |
| ------- | ----------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| Hugo    | [it985/hugo-theme-clarity](https://github.com/it985/hugo-theme-clarity) | 开发中      | Pagefind、相册、说说                                                             |
| Halo    | [acanyo/theme-clarity](https://github.com/acanyo/theme-clarity)         | v1.6.6      | 可配置小组件、分享海报；[应用市场](https://www.halo.run/store/app/app-jglhpodw) |
| Typecho | [jkjoy/theme-clarity](https://github.com/jkjoy/theme-clarity)           | v1.1.9      | 基于 Halo 版移植，图库、瞬间、追番                                               |

## 特性

[主题特性](https://blog.zhilu.site/theme) · [组件示例](https://blog.zhilu.site/previews/example)

## 目录结构

Astro 7 项目结构（站点根即仓库根）：

```sh
.
├── src # 站点源码
│   ├── components # UI 组件
│   │   ├── blog # 博客布局组件
│   │   ├── content # MDX 组件（MDC 注册表）
│   │   ├── partial # 微型组件
│   │   ├── popover # 弹窗组件
│   │   ├── post # 文章组件
│   │   ├── util # 功能组件
│   │   └── widget # 侧栏小组件
│   ├── config # blog.ts（内容/分类/友链）★
│   ├── content # 文章与页面内容（.mdx）
│   │   ├── posts # 正式文章
│   │   ├── previews # 草稿文章，仅可被站内搜索
│   │   └── games # 游戏页
│   ├── lib # 框架无关共享层（app-config.ts 导航/页脚/交互默认值）
│   ├── loaders # 内容加载器
│   ├── pages # 文件路由与端点（atom.xml / llms.txt / search-index / raw/*.md）
│   ├── plugins # remark/rehype 管线（component-fence / heading-ids / math-code / prose）
│   ├── styles # CSS 令牌与主题
│   └── layouts # 页面骨架
├── public # 静态资源，生成在站点根目录
│   ├── assets # 资源文件
│   └── fonts # 字体
├── scripts # 门禁与工具（acceptance.ps1 是单一验收入口）
├── baseline # 冻结的 Nuxt 产物（未入库，离线门禁锚点，见 CLAUDE.md）
├── astro.config.mjs # Astro 配置
├── edgeone.json # EdgeOne 控制台配置（自媒体生效，不被流水线消费）
├── CLAUDE.md # 工程决策与验收规则★
├── MIGRATION-BRIEF.md # Nuxt → Astro 迁移交接
└── package.json # pnpm 12，版本经 pnpm-workspace.yaml 的 catalogs 集中管理
```

## 快速开始

### 安装依赖

需要 Node.js 22.19+（22.x）、24.11+（24.x）或 26+，推荐使用满足要求的最新 LTS 版本。

```sh
pnpm i
```

### 初始配置

三层配置分工：内容/分类/友链改 `src/config/blog.ts`；导航/页脚/交互默认值改
`src/lib/app-config.ts`；内容 schema 与 loader 改 `src/content.config.ts`。

文章 URL 可在 frontmatter 用 `permalink` 自定义；`hidePostPrefix` 开启时 `/posts/xxx`
显示为 `/xxx`。建站流程与门禁规则以 `CLAUDE.md` 为准。

### 创建文章

```sh
pnpm new
```

### 运行开发环境

```sh
pnpm dev
```

### 构建生产环境

```sh
pnpm build   # 产物在 dist/（SSG）
pnpm preview # 本地预览产物
```

### 部署指南

本仓库的部署：GitHub Actions（`.github/workflows/build.yml`，push main 触发）跑
typecheck + build + 9 道无浏览器门禁，随后把 `dist/` 推送到 `PaloMiku/blog-public`
（GitHub Pages），站点经 EdgeOne CDN 对外服务。构建命令 `pnpm build`，输出目录 `dist`。

换成其他平台时：构建命令同样是 `pnpm build`、输出目录 `dist`；若托管在 EdgeOne，
`/api/*` 与 `*.opml` 的 MIME 由 `edgeone.json` 描述，改 API 路径需同步改它（该文件不被
仓库内任何流水线消费，只在 EdgeOne 控制台侧生效）。

#### 疑难解答

- 验证部署一律用普通 URL：站点在 EdgeOne 后面，带 query 的 URL 是独立 cache key，
  `?cb=<时间戳>` 会命中尚未刷新的父层拿到旧内容；要绕过 CDN 就查 `blog-public` 的部署产物。
- 订阅源需要绝对地址：自托管时把 `src/config/site-meta.ts` 的站点地址设为实际访问地址，
  协议、主机保持一致。
- `pnpm accept` 是唯一验收入口（`scripts/acceptance.ps1`），默认跑**基础档** 36 步：
  只读 `dist/` 与 `src/`，零网络零浏览器，约 30 s。其中需要 Nuxt 冻结基线的门禁只能在
  本地跑，干净 CI 里不成立，CI 只跑其无浏览器子集（10 道）。
- `pnpm accept:full` 在基础档之上加 `preview-guard-selftest` 与三道打线上站的
  `live:*` 门禁，**约 20–25 分钟**（大头是 `live:ui-parity`，63 页 × 两侧）。
  切换上线前与发布前各跑一次；日常改动不必跑。
- 运行、部署项目时 Node.js 版本需遵照 `package.json` 的 engines 限制。

## 贡献

欢迎参与项目：如果有具体问题或功能建议，可以发起 Issue；如果愿意在已确定的方向上增加功能或修复问题，可以提交 Pull Request。

## 许可证

- 项目本体：[MIT](LICENSE)
- 博客文章：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)
- 希望你在页脚保留此项目链接，助力开源传播。
