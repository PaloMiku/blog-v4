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

## 部署

GitHub Actions（push main 触发）：`pnpm generate` 后把 `.output/public` 推送到 PaloMiku/blog-public（GitHub Pages），站点经 EdgeOne CDN 对外服务（edgeone.json 只管 /api 与 OPML 的 Content-Type）。CI 是否绿是部署是否成功的唯一事实源。

## 当前状态（2026-09-30）

- 包版本 3.8.0，已完全同步上游 v3.8.0；已完成 SCSS→纯 CSS 迁移
- Bangumi 功能已于 2026-09-30 移除：bangumi-clarity 模块暂不引入（源码在仓库外 D:/Projects/Bangumi-Clarity）；`app/pages/bangumi.vue` 与无引用的 `HomeHeroBar.vue` 已删、可从 git 历史找回；自包含的 `InfoCard.vue` 与 `content/previews/bangumi-components.md` 保留，作为恢复时的展示资产
- 分支 `feat/sync-upstream-v3.7.1` 已完全合并进 main，可删
