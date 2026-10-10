# 手柄大屏模式设计

**日期：** 2026-10-11  
**状态：** 已获设计方向批准，待实现计划

## 目标

为博客增加类似 Steam 大屏模式的渐进增强体验：检测到手柄连接后不打断当前页面，用户第一次按下手柄按键后进入专属布局；在首页、文章、归档、游戏、友链和关于页面中提供连续的焦点导航、侧栏折叠、文章滚动与返回操作。

## 设计原则

- 普通鼠标、键盘和触摸用户继续使用现有页面与布局。
- 不新增 Vue 岛或第三方手柄库；交互继续使用 Astro 组件内原生脚本与现有布局状态单例。
- 手柄模式通过属性和 CSS 叠加在现有 DOM 上，避免维护第二套页面路由和内容渲染树。
- 所有可操作目标都保持语义 HTML、键盘可达和可读的 ARIA 状态。
- 模式状态与侧栏、搜索、灯箱状态分离，互不覆盖。

## 用户流程

1. 页面正常加载，手柄模式关闭。
2. 浏览器发出手柄连接事件时显示一次轻提示：“手柄已连接，按任意键进入大屏模式”。连接本身不切换布局。
3. 用户第一次按下有效按钮或方向输入后进入大屏模式。鼠标或键盘仍可使用。
4. 模式入口默认位于当前页面已有焦点附近；焦点切换到带 `data-gamepad-focus` 的元素。
5. A 确认当前焦点，B 关闭当前层级或返回，LB/RB 在区域或分页之间切换，右摇杆滚动当前滚动容器。
6. 断开手柄时保留当前大屏模式，防止短暂蓝牙抖动导致页面跳回；用户可用 B 返回或页面提供的退出入口关闭模式。
7. 页面跳转时清理页面级焦点和输入监听；若未来启用 Astro ClientRouter，`astro:before-swap` 负责复位。

## 运行时架构

### 模式与布局状态

现有 `src/lib/layout-state.ts` 继续负责互斥的侧栏、右栏、搜索和灯箱抽屉。大屏模式使用独立的 `src/lib/big-picture-state.ts`，避免把持久模式与抽屉枚举混在一起。

`big-picture-state.ts` 提供：

- `BigPictureState = 'inactive' | 'prompt' | 'active'`
- `getBigPictureState()`、`setBigPictureState()`、`enterBigPicture()`、`exitBigPicture()`
- `subscribeBigPicture()`：订阅者立即收到当前状态
- `bindBigPictureGlobals()`：幂等绑定 `astro:before-swap` 清理和退出事件委托

状态变化只负责同步 `document.documentElement[data-big-picture]`，组件样式与焦点层订阅该状态。模式不会写入 URL，也不默认写入 localStorage；退出后本页会话内不再因新的手柄输入自动进入，避免反复打扰用户。

### 手柄输入层

新增 `src/lib/gamepad.ts`，只在客户端脚本中导入。它负责：

- 监听 `gamepadconnected` / `gamepaddisconnected`；
- 保存当前可用手柄的 id，并在可见页面中用 `requestAnimationFrame` 读取状态；
- 将标准按钮和方向输入归一化为 `confirm`、`back`、`previous-region`、`next-region`、`up`、`down`、`left`、`right`、`scroll-up`、`scroll-down`；
- 为摇杆提供 0.25 死区、边沿触发和重复移动节流；
- 仅在收到第一条有效输入后调用 `enterBigPicture()`；
- 进入/退出页面和无可用手柄时停止轮询，避免空转。

输入模块不直接查询页面元素、不直接操作历史记录；它只发布语义输入事件，保证测试可以脱离 DOM 验证映射和节流。

### 焦点导航层

新增 `src/lib/gamepad-focus.ts`。每个页面通过属性声明焦点目标和区域：

- `data-gamepad-focus`：可被手柄选中的元素；
- `data-gamepad-region="sidebar|main|aside|footer|overlay"`：逻辑区域；
- `data-gamepad-scroll`：右摇杆默认滚动容器；
- `data-gamepad-initial-focus`：页面或区域进入时的首个焦点。

焦点管理器维护当前元素、当前区域和上一次有效元素。方向移动使用元素的 `getBoundingClientRect()` 计算候选项：先按方向过滤，再按主轴距离、交叉轴距离和区域顺序排序；不写死页面卡片数量。进入新区域时优先选择 `data-gamepad-initial-focus`，否则选择几何上最近的目标。

当前焦点设置 `tabindex="0"` 和 `.gamepad-focus`，其他注册目标设置 `tabindex="-1"`。鼠标 `focusin` 会同步当前手柄焦点，键盘用户不会被抢焦点。

### 按键语义

- A：调用当前元素的原生 `click()`，不绕过组件已有事件委托。
- B：按优先级关闭 modal、搜索、灯箱、抽屉；没有活动层级时返回历史页面。文章页回到来源列表，栏目页回到首页。
- LB/RB：在当前页面区域循环切换；列表页在存在分页时切上一页/下一页，否则切换区域。
- 方向键/左摇杆：移动焦点；连续输入经过节流后重复移动。
- 右摇杆：对当前区域的 `[data-gamepad-scroll]` 容器调用平滑滚动；文章页默认是正文，侧栏目录打开时优先滚动目录。

## 布局与视觉

新增 `src/styles/big-picture.css`，由 `src/styles/index.css` 最后引入，所有规则以 `:root[data-big-picture]` 为入口。

- `Blog.astro` 的 `#blog-root` 保持现有三栏 grid；大屏模式只调整列宽、间距、背景层次和焦点动画。
- 首页、归档和游戏入口使用“左导航 / 中间内容卡片 / 右侧信息”的大屏结构。
- 文章页和长内容页默认收起左、右栏，将正文放入居中的阅读列；目录仍可通过区域切换打开。
- 搜索、灯箱和标签页沿用现有 modal、tab 和 layout 状态，只增加手柄焦点标记与视觉状态。
- 焦点样式使用已有主题变量：边框、轻微上移和阴影，不依赖新颜色系统；`prefers-reduced-motion` 下关闭位移动画，仅保留边框。
- 非大屏模式不加载或命中这些选择器，避免改变现有几何与门禁基线。

## 页面接入点

### 首页

`src/pages/index.astro`：侧栏导航、搜索入口、精选 Slide、文章卡片、排序控件、分类控件和分页按钮加入焦点/区域属性。客户端列表重排后调用焦点管理器的 `refresh()`，保留当前文章 key。

### 文章页

`src/pages/[...slug].astro`：目录链接、PostSurround、系列文章、评论入口、正文中已有按钮/标签页/折叠组件加入属性。进入阅读态时选择正文首个可操作元素；B 键回到来源页面。

### 归档页

`src/pages/archive.astro`：年份切换、排序控件、归档条目和分页加入区域标记。列表变更后按条目路径恢复焦点。

### 游戏页

游戏内容由内容集合和 `LinkBanner` 组件组成；为 `/games`、`/games/galgames` 以及具体游戏页的入口卡片、系列导航和文章前后篇提供同一套属性。

### 友链页

`src/pages/link.astro`：友链卡片、Tab 按钮、申请表单控件和评论入口加入焦点标记；Tab 切换后焦点落到新面板首项。

### 关于页

关于页中的 `ProjectGroup`、外部链接和页内标题锚点加入区域标记。外部链接仍由现有 `UtilLink` 处理，不改变打开策略。

## 无障碍与错误处理

- 手柄模式不隐藏语义内容；侧栏折叠时同步 `aria-hidden`、`inert` 和 `tabindex`，防止焦点进入视觉上不可见的区域。
- 无标准映射、按钮数量不足或游戏板读取失败时只停用手柄增强，不影响页面和键盘操作。
- 输入事件不在输入框、文本域或可编辑区域上抢占键盘事件；手柄 A 仍可确认当前控件。
- `B` 的历史返回使用 `history.length` 与来源路径保护，避免在直接打开文章时返回到站外页面。
- 页面销毁和 ClientRouter swap 时取消 rAF、移除事件监听、清除焦点类和临时属性。

## 验证策略

新增纯逻辑测试：

- `tests/gamepad.test.mjs`：按钮归一化、摇杆死区、重复触发节流、断开清理和 B 键优先级；
- `tests/gamepad-focus.test.mjs`：空间候选排序、区域循环、初始焦点和列表重排后的 key 恢复。

扩展 `scripts/interaction-check.mjs` 的真实浏览器检查：

- 手柄模式标记可由测试注入后，六类页面都能找到焦点注册目标；
- 当前焦点只有一个，方向移动后焦点可观察地改变；
- A 触发链接/按钮，B 关闭搜索或恢复上一页面；
- 文章阅读态隐藏侧栏并保持正文可滚动；
- 普通模式下不存在 `data-big-picture`，现有交互断言继续通过。

实现完成后按仓库要求运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test`、`pnpm interaction-check`，最后运行 `pnpm accept`。

## 范围外

- 不实现平台专属手柄震动、陀螺仪、触摸板和语音输入。
- 不新增独立 `/big-picture` 路由或服务端手柄检测。
- 不改变文章数据、SEO、URL、搜索索引和现有普通模式视觉。
