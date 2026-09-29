# CLAUDE.md

个人博客「Mikuの极光星」（https://blog.sotkg.com），基于上游 L33Z22L11/blog-v3（Clarity 主题）深度定制的 Nuxt 4 纯静态站。upstream 仅做选择性批次同步，不直接 merge。

## 常用命令

```sh
pnpm dev        # 开发
pnpm generate   # SSG 构建，产物在 .output/public（新版工具链不再生成根目录 dist）
pnpm preview    # 预览构建产物
pnpm lint       # ESLint + Stylelint（本机 pnpm 可能 EBUSY，可改用 npx eslint / npx stylelint）
pnpm new        # 新建文章
```

## 技术栈与结构

- Nuxt 4（app/ 目录）+ Vue 3.5 + @nuxt/content v3（sqlite native）；pnpm 11 + catalogs 集中管版本（package.json 全是 `catalog:` 引用，加依赖改 pnpm-workspace.yaml）
- 样式纯 SCSS、无 Tailwind：令牌在 `app/assets/css/_variable.scss` / `color.scss`，经 vite additionalData 注入每个 style 块
- UI 组件全自研（app/components 下 blog/content/post/partial/popup/util/widget），第三方仅 vue-tippy、embla-carousel、@bikariya/*
- 三层配置分工：内容/分类/友链 → `blog.config.ts`；导航/页脚/交互默认值 → `app/app.config.ts`；构建/module → `nuxt.config.ts`
- 内容在 content/（posts 正式文章、previews 草稿、games 游戏库）；server/ 仅 3 个预渲染端点（/api/stats、/atom.xml、/subscriptions.opml）

## 约定

- ESLint（@antfu）+ Stylelint 均为 tab 缩进、无 Prettier；带 `// @keep-sorted` 标记的配置数组必须保持排序
- 文章可用 frontmatter `permalink` 自定义 URL；`hidePostPrefix` 开启时 /posts/xxx 显示为 /xxx

## 部署

GitHub Actions（push main 触发）：`pnpm generate` 后把 `.output/public` 推送到 PaloMiku/blog-public（GitHub Pages），站点经 EdgeOne CDN 对外服务（edgeone.json 只管 /api 与 OPML 的 Content-Type）。CI 是否绿是部署是否成功的唯一事实源。

## 当前状态（2026-09-29）

- 包版本 3.7.0，已同步上游 v3.7.1 批次 1-7
- 已知问题：`app/pages/bangumi.vue` 引用的 `BgmBangumiPage` 组件不存在（bangumi-clarity 模块未安装，模块源码在仓库外 D:/Projects/Bangumi-Clarity）；页面未进导航，仅直链可达，待决定恢复依赖或下线页面
- 分支 `feat/sync-upstream-v3.7.1` 已完全合并进 main，可删
