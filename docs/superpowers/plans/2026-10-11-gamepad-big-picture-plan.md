# Gamepad Big Picture Mode — 实施记录

**Goal:** Steam 类手柄模式。首次有效标准映射输入后进入，为六类页面提供空间焦点导航与滚动，
普通鼠标/键盘行为不变。

**Spec（契约权威）：** `docs/superpowers/specs/2026-10-11-gamepad-big-picture-design.md`

> ⚠️ **2026-10-13：本文已从施工单精简为实施记录。**
> 原文档的 9 个 Task、65 个 checkbox 已全部删除——它们是执行期的施工单，
> 任务 1~6 已完成并提交，步骤复述只会产生第二份可能过期的真相。
> **完整施工步骤见 git 历史**：`git log -p -- docs/superpowers/plans/`。
>
> **进度真相看两处：**
> 1. `.superpowers/sdd/2026-10-11-gamepad-big-picture-plan/progress.md` — SDD 台账，
>    逐任务 review 结论、fix 轮次与**裁决记录**（本文与 spec 冲突时改了什么、代价是什么）。
> 2. `git log --oneline 0969180..HEAD`。
>
> **已知未完成：物理手柄实机测试从未接入。** 所有结论均来自注入夹具。
> Task 9（完成闸门）在实机测过之前不应判为 done。

## 状态

| Task | 内容 | 状态 |
| --- | --- | --- |
| 1 | 纯手柄输入语义（映射/死区/边沿/重复/滚动） | ✅ `a354397`..`48d4f75`，review clean |
| 2 | 会话与大屏状态 | ✅ `034fd55`..`faf8a51`，review clean |
| 3 | 浏览器 Gamepad 生命周期 | ✅ `9fe956c`..`13a514a`，review clean |
| 4 | 纯空间导航 + DOM 焦点管理器 | ✅ `32941ed`..`f3cc7ad`，review clean |
| 5 | BigPictureShell 与动作协调器 | ✅ `b6f9306`..`43b06ac`，review clean（2 轮 fix） |
| 6 | 模式样式与布局行为 | ✅ `6a7e6f6`..`6089a9f` |
| 7 | 页面作用域与稳定焦点钩子 | ⚠️ 已实现，**未提交**（工作树 15 个文件） |
| 8 | 注入式浏览器交互覆盖 | ⚠️ 已实现，**未提交**（`interaction-check.mjs` +919 行） |
| 9 | 全量验证与交付复核 | ❌ 未跑。**实机手柄测试缺失是硬阻塞** |

**依赖顺序（保留，因为它解释了为什么是这个顺序）：** 1–3 先于页面标记（无浏览器即可测输入与
会话语义）；4 先于 5（几何决策保持纯函数、可 review）；5–7 顺序执行（Shell 需要 state 与 focus API，
页面需要 Shell 的 region 契约）；8 在六类页面接通后；9 是完成闸门。

## 模块地图（当前实现）

**新建：**

| 模块 | 职责 |
| --- | --- |
| `src/lib/gamepad-input.ts` | 纯标准映射、死区/滞回、边沿检测、重复节流、右摇杆滚动数学 |
| `src/lib/gamepad.ts` | 浏览器生命周期、`navigator.getGamepads()`、设备选择、rAF 循环、可见性处理、语义动作回调 |
| `src/lib/big-picture-session.ts` | 会话键与同标签页导航/来源记账 |
| `src/lib/big-picture-state.ts` | 活动状态、手动退出抑制、session/local storage、订阅、**动作优先级纯函数** |
| `src/lib/gamepad-navigation.ts` | 纯矩形候选选择与区域排序 |
| `src/lib/gamepad-focus.ts` | DOM 目标发现、roving focus、区域作用域、mutation 刷新、焦点恢复 |
| `src/components/blog/BigPictureShell.astro` | 提示、连接状态、顶部动作、设置、底部按键提示、运行时协调器 |
| `src/styles/big-picture.css` | 仅 `:root[data-big-picture]` 规则、响应式布局、焦点样式、reduced-motion |

**改动：** `src/layouts/Blog.astro`（`bigPicturePage` prop）、`src/styles/index.css`（导入顺序）、
`src/lib/layout-state.ts`（导出只读状态供 B 键优先级用）、四个页面（页型作用域 + 初始焦点/滚动钩子）、
六个组件（region 与可见性钩子）、八个组件（稳定 focus key）、三个测试文件、`scripts/interaction-check.mjs`。

## 全局约束（仍然生效）

- 不加 Vue 岛、不加手柄库、不加 `/big-picture` 路由。
- `layout-state.ts` 只管侧栏/边栏/搜索/灯箱；大屏是**独立状态机**。
- 只支持标准映射手柄；非标设备给出可读的提示，**普通浏览不受影响**。
- 首次有效按键进入模式**并被消费**；下一次按才执行动作。
- **B 键先关最高层 UI，再考虑导航**；绝不单凭 `history.length` 或 `document.referrer` 调
  `history.back()`。
- hidden / disabled / inert / `aria-hidden` / 闭合 details / 不可见轮播项**不得**成为手柄焦点。
- 普通模式必须保持现有路由、SEO、DOM 契约、几何与既有交互检查。
- 验收命令：`pnpm test` / `typecheck` / `lint` / `build` / `interaction-check` / `accept`。
  **交互门禁单跑，不进 accept 流水线。**

## 实现中偏离本文的地方

原文与 spec 有过冲突，**一律以 spec 为准**，具体改动记在 SDD 台账。三处值得记住：

1. **轮询门禁用 `(modeActive || autoEntryAllowed)` 而非 spec 字面的「抑制即停轮」** ——
   spec 那句约束的是*自动*进入；手动进入必须继续轮询，否则用户被抑制后**再也进不去模式**。
   代价：spec 字面与实现不一致，靠代码注释与台账裁决记录承载。
2. **`MIN_STANDARD_BUTTONS` 保留**（Task 1 当时零消费者）—— Task 3 的控制器需要它区分
   「不支持的手柄」与「标准手柄」两种提示。
3. **`MODAL_DEFAULT_DURATION` 从 `modal.ts` 导出**（2 行、零行为变化）—— 设置面板改读自身
   `transition-duration`，无 CSS 时回落到该常量。代价：Task 6 不必在 JS 与 CSS 之间同步时长。

## 完成闸门（Task 9）

```sh
pnpm test && pnpm typecheck && pnpm lint && pnpm build
pnpm interaction-check        # 单跑
pnpm accept                  # 不得用「构建过了」替代
```

**硬阻塞：** 实机手柄测试。从未测过一款真实设备。
若仍无实机，交付报告**必须分开写**「注入夹具覆盖」与「物理设备覆盖」两项，
不因标准映射模拟通过就声明全部兼容。
