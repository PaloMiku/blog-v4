# Gamepad Big Picture Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Steam-like controller mode to the Astro blog that enters after the first valid standard-mapped controller input, provides spatial focus navigation and scrolling across six core page groups, and leaves ordinary mouse/keyboard behavior unchanged.

**Architecture:** Keep the existing static DOM and three-column `Blog.astro` layout. Add a browser-only controller pipeline (`gamepad-input.ts` → `gamepad.ts` → `BigPictureShell.astro`), a pure geometry/navigation layer, and a separate big-picture session state beside the existing drawer state. Apply the visual mode through `data-big-picture` and a dedicated CSS file; page components only declare page scope and regions while the focus manager discovers semantic controls and explicit `data-gamepad-focus` overrides.

**Tech Stack:** Astro 7, TypeScript browser modules, native Gamepad API, native DOM focus/events, CSS nesting, Node test runner with `--experimental-transform-types`, existing CDP-based `scripts/interaction-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-11-gamepad-big-picture-design.md`

## Global Constraints

- Do not add Vue islands, controller libraries, or a new `/big-picture` route.
- Keep `src/lib/layout-state.ts` responsible for sidebar, aside, search, and lightbox drawers; big-picture mode is a separate state machine.
- Only standard-mapped controllers are supported in the first release; non-standard controllers show a readable unsupported message and leave normal browsing intact.
- The first valid button input enters big-picture mode and is consumed; the next press performs the action.
- B closes the highest active UI layer before navigating; never call `history.back()` solely from `history.length` or `document.referrer`.
- Hidden, disabled, inert, `aria-hidden`, closed-details, and invisible carousel targets cannot become controller focus.
- Ordinary mode must preserve current routes, SEO, DOM contracts, geometry, and existing interaction checks.
- Test commands are `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm interaction-check`, and `pnpm accept`.
- Do not stage or alter unrelated existing changes in `.gitignore`, `.vscode/`, or `.superpowers/`.

---

## File Map

Create the following focused modules:

- `src/lib/gamepad-input.ts`: pure standard mapping, dead-zone/hysteresis, edge detection, repeat timing, and right-stick scroll math.
- `src/lib/gamepad.ts`: browser lifecycle, `navigator.getGamepads()`, active-device selection, rAF loop, visibility handling, and semantic action callbacks.
- `src/lib/big-picture-session.ts`: serializable session keys and same-tab navigation/source bookkeeping.
- `src/lib/big-picture-state.ts`: active/inactive state, manual-exit suppression, session/local storage access, and subscriptions.
- `src/lib/gamepad-navigation.ts`: pure rectangle candidate selection and region ordering.
- `src/lib/gamepad-focus.ts`: DOM target discovery, roving focus, region scopes, mutation refresh, and focus restoration.
- `src/components/blog/BigPictureShell.astro`: prompt, connection/disconnection status, top actions, settings, bottom key hints, and runtime coordinator.
- `src/styles/big-picture.css`: only `:root[data-big-picture]` rules, responsive layout, focus treatment, and reduced-motion behavior.

Modify the following existing files:

- `src/layouts/Blog.astro`: accept a `bigPicturePage` prop, mark layout regions, and mount `BigPictureShell`.
- `src/styles/index.css`: import `big-picture.css` after existing shared layers.
- `src/lib/layout-state.ts`: export read-only state helpers used by B-action priority resolution.
- `src/pages/index.astro`, `src/pages/archive.astro`, `src/pages/link.astro`, `src/pages/[...slug].astro`: declare page scope and add explicit initial-focus/scroll hooks where semantic discovery is insufficient.
- `src/components/blog/BlogSidebar.astro`, `BlogAside.astro`, `BlogFooter.astro`, `BlogPanel.astro`: add region and visibility hooks without changing normal-mode markup semantics.
- `src/components/post/Article.astro`, `src/components/post/Slide.astro`, `src/components/post/PostSurround.astro`, `src/components/post/PostFooter.astro`, `src/components/post/Collection.astro`: expose stable focus keys for article and reading actions.
- `src/components/partial/Pagination.astro`, `src/components/post/OrderToggle.astro`, `src/components/content/Tab.astro`, `src/components/content/LinkBanner.astro`, `src/components/content/ProjectGroup.astro`, `src/components/widget/Toc.astro`: preserve existing event handlers while adding explicit focus/region attributes.
- `tests/gamepad.test.mjs`, `tests/gamepad-focus.test.mjs`, `tests/big-picture.test.mjs`: pure unit coverage.
- `scripts/interaction-check.mjs`: injected controller fixture and observable browser checks.

## Task 1: Define pure controller input semantics

**Files:**
- Create: `src/lib/gamepad-input.ts`
- Create: `tests/gamepad.test.mjs`

**Interfaces:**
- Produces `GamepadAction = 'confirm' | 'back' | 'previous-region' | 'next-region' | 'up' | 'down' | 'left' | 'right' | 'scroll-up' | 'scroll-down' | 'menu'`.
- Produces `StandardGamepadFrame` with `buttons: readonly boolean[]`, `axes: readonly number[]`, and `timestamp: number`.
- Produces `normalizeGamepadFrame(frame, previous, options): readonly GamepadAction[]`.
- Produces `getScrollDelta(axisValue, deltaMs, maxPixelsPerSecond = 900): number`.
- Produces `isStandardGamepad(gamepad): boolean`.

- [ ] **Step 1: Write failing mapping tests.** Cover standard button indices 0/1/4/5/9, d-pad 12–15, left-stick axes 0/1, right-stick vertical axis 3, button edge-only behavior, and simultaneous d-pad-over-stick priority.
- [ ] **Step 2: Write failing timing tests.** Assert stick threshold `0.55`, release hysteresis `0.35`, immediate first direction, repeat after 350ms, 120ms repeat interval, and no repeated confirm/back/shoulder/menu actions while held.
- [ ] **Step 3: Write failing scroll tests.** Assert values inside the 0.25 dead zone return zero, positive/negative direction is preserved, and the result is capped at 900 pixels per second.
- [ ] **Step 4: Implement pure functions.** Do not access `window`, `navigator`, `document`, or `Gamepad` at module scope; accept plain snapshots so Node can import the module.
- [ ] **Step 5: Run the focused test.** Run `pnpm exec node --test --experimental-transform-types --import ./tests/harness.mjs tests/gamepad.test.mjs`; expect PASS.
- [ ] **Step 6: Commit the isolated input contract.** `git add src/lib/gamepad-input.ts tests/gamepad.test.mjs && git commit -m "feat: define gamepad input semantics"`.

## Task 2: Add session and big-picture state

**Files:**
- Create: `src/lib/big-picture-session.ts`
- Create: `src/lib/big-picture-state.ts`
- Create: `tests/big-picture.test.mjs`
- Modify: `src/lib/layout-state.ts`

**Interfaces:**
- `big-picture-session.ts` exports `SESSION_KEY`, `AUTO_ENTRY_SUPPRESSED_KEY`, `SOURCE_KEY`, `readSessionMode(storage)`, `writeSessionMode(storage, active)`, `readAutoEntrySuppressed(storage)`, `writeAutoEntrySuppressed(storage, suppressed)`, `recordNavigationSource(storage, source)`, and `consumeNavigationSource(storage, currentPath)`.
- `big-picture-state.ts` exports `BigPictureMode`, `getBigPictureState()`, `setBigPictureState(mode)`, `enterBigPicture(reason)`, `exitBigPicture(reason)`, `subscribeBigPicture(fn)`, `setAutoEntrySuppressed(value)`, `isAutoEntrySuppressed()`, and `bindBigPictureGlobals()`.（访问器按 spec §运行时架构 用 `State` 拼写，不是 `Mode`；类型名仍是 `BigPictureMode`。）
- `layout-state.ts` adds `getLayoutState(): LayoutState` and `isLayoutOpen(key): boolean` without changing `setLayoutState` or `toggleLayout` behavior.

- [ ] **Step 1: Write failing storage tests.** Use an in-memory Storage double to cover missing storage, exceptions, active-mode round trips, suppression round trips, malformed source JSON, same-origin path validation, and one-shot source consumption.
- [ ] **Step 2: Write failing state tests.** Assert subscribers receive the initial value, entering writes `data-big-picture` and session state, exiting removes the attribute and sets suppression only for manual exit, and router cleanup is idempotent.
- [ ] **Step 3: Implement storage helpers.** Keep JSON payloads small: `{ path, key, page, timestamp }`; reject external origins and stale records older than 30 minutes.
- [ ] **Step 4: Implement the state singleton.** Guard all browser globals inside functions, use `try/catch` around session/local storage, and emit only on actual changes.
- [ ] **Step 5: Add layout read helpers.** Return current drawer state without exposing the mutable subscriber set.
- [ ] **Step 6: Run focused tests.** Run `pnpm exec node --test --experimental-transform-types --import ./tests/harness.mjs tests/big-picture.test.mjs`; expect PASS.
- [ ] **Step 7: Commit state/session behavior.** `git add src/lib/big-picture-session.ts src/lib/big-picture-state.ts src/lib/layout-state.ts tests/big-picture.test.mjs && git commit -m "feat: add big picture session state"`.

## Task 3: Implement browser Gamepad lifecycle

**Files:**
- Create: `src/lib/gamepad.ts`
- Modify: `src/lib/big-picture-state.ts` only if lifecycle hooks need a named cleanup export

**Interfaces:**
- `GamepadControllerOptions` contains `onConnection`, `onDisconnection`, and `onAction(action)` callbacks plus optional `now()` and `getGamepads()` test seams.
- `createGamepadController(options): { start(): void; stop(): void; refresh(): void; isRunning(): boolean }`.
- The controller owns one active standard-mapped device; it never calls DOM focus or history APIs.

- [ ] **Step 1: Add a fake-device test harness.** Provide sparse gamepad arrays, button/axis snapshots, visibility changes, and `performance.now()` control in a new test block inside `tests/gamepad.test.mjs`.
- [ ] **Step 2: Write failing lifecycle tests.** Cover connection callback, unsupported mapping callback, first valid input entering mode without forwarding the action, release-before-next-action, disconnect cleanup, second-device takeover, `visibilitychange`, and no rAF when stopped.
- [ ] **Step 3: Implement controller lifecycle.** Bind events once, refresh by index on each frame, stop on hidden/unload, reset pressed state after visibility/disconnect, and use `normalizeGamepadFrame` for every action.
- [ ] **Step 4: Add browser capability fallback.** If `navigator.getGamepads` or event APIs are absent, return a stopped controller and expose a readable unsupported status to the shell.
- [ ] **Step 5: Run all pure input tests.** Run `pnpm exec node --test --experimental-transform-types --import ./tests/harness.mjs tests/gamepad.test.mjs`; expect PASS.
- [ ] **Step 6: Commit lifecycle module.** `git add src/lib/gamepad.ts tests/gamepad.test.mjs && git commit -m "feat: add gamepad lifecycle controller"`.

## Task 4: Build pure spatial navigation and DOM focus manager

**Files:**
- Create: `src/lib/gamepad-navigation.ts`
- Create: `src/lib/gamepad-focus.ts`
- Create: `tests/gamepad-focus.test.mjs`

**Interfaces:**
- `FocusTarget` contains `key`, `region`, `rect`, `order`, and optional `initial`.
- `chooseNextFocus(current, candidates, direction): FocusTarget | undefined`.
- `chooseRegionTarget(region, targets, previousKey): FocusTarget | undefined`.
- `createGamepadFocusManager(root): { refresh(): void; focusInitial(region?): void; move(direction): boolean; activate(): void; setRegion(region): void; getCurrent(): HTMLElement | null; destroy(): void }`.

- [ ] **Step 1: Write failing geometry tests.** Cover half-plane filtering, cross-axis overlap preference, main-axis distance, DOM-order tie break, no-candidate retention, and region target restoration.
- [ ] **Step 2: Write failing DOM tests.** With a minimal document fixture, cover semantic discovery, explicit `data-gamepad-focus`, disabled/hidden/inert/aria-hidden filtering, `data-gamepad-initial-focus`, one visible `.gamepad-focus`, mutation refresh, and `data-list-key` restoration.
- [ ] **Step 3: Implement `gamepad-navigation.ts`.** Keep it DOM-free; use numeric rectangles and stable order only.
- [ ] **Step 4: Implement `gamepad-focus.ts`.** Discover `a[href]`, `button`, `summary`, `input`, `select`, `textarea`, `[tabindex]`, and explicit targets inside the active region; call real `focus({ preventScroll: true })`, then `scrollIntoView({ block: 'nearest' })` only after selecting a target.
- [ ] **Step 5: Add mutation and focus listeners.** Observe region child additions/removals and relevant `hidden`, `disabled`, `inert`, `aria-hidden`, and `open` attributes; debounce one refresh per microtask and ignore the manager’s own class changes.
- [ ] **Step 6: Run focused focus tests.** Run `pnpm exec node --test --experimental-transform-types --import ./tests/harness.mjs tests/gamepad-focus.test.mjs`; expect PASS.
- [ ] **Step 7: Commit navigation layer.** `git add src/lib/gamepad-navigation.ts src/lib/gamepad-focus.ts tests/gamepad-focus.test.mjs && git commit -m "feat: add controller spatial focus navigation"`.

## Task 5: Add the Big Picture shell and action coordinator

**Files:**
- Create: `src/components/blog/BigPictureShell.astro`
- Modify: `src/layouts/Blog.astro`
- Modify: `src/lib/modal.ts` only if a read-only top-entry helper is missing
- Modify: `src/lib/layout-state.ts` only if a close-current helper is needed

**Interfaces:**
- `BigPictureShell.astro` props: `page: 'home' | 'archive' | 'games' | 'links' | 'reading' | 'off'`.
- Shell markup exposes `data-big-picture-shell`, `data-big-picture-prompt`, `data-big-picture-status`, `data-big-picture-settings`, `data-big-picture-action="open-nav|open-aside|open-settings|exit"`, and `data-gamepad-region="overlay|footer"`.
- Shell action coordinator consumes `GamepadAction`, `createGamepadFocusManager`, `subscribeBigPicture`, `getLayoutState`, `getModalStack`, `closeModal`, `toggleLayout`, and `consumeNavigationSource`.

- [ ] **Step 1: Add a static shell fixture.** Render status, connection prompt, navigation/目录/settings/exit actions, bottom key hints, and a settings checkbox with no active-mode styling yet.
- [ ] **Step 2: Add failing coordinator tests.** Extend `tests/big-picture.test.mjs` with the action priority table: settings → top modal → dropdown/combobox → drawer → page return; confirm first input is consumed; same-origin source restoration is one-shot.
- [ ] **Step 3: Implement shell subscriptions.** Subscribe once on `DOMContentLoaded` and `astro:page-load`, update status text, and keep controls hidden from ordinary mode.
- [ ] **Step 4: Implement action dispatch.** A calls the focused element’s native click/focus behavior; B closes the highest layer and restores trigger focus; LB/RB switches regions and only pages when focus is in pagination; right-stick actions scroll the active scroll container or `document.scrollingElement`.
- [ ] **Step 5: Implement navigation source recording.** Add a delegated same-origin click listener that records source path, destination path, page type, and focus key before navigation; do not intercept modified clicks or external links.
- [ ] **Step 6: Run state and shell tests.** Run `pnpm exec node --test --experimental-transform-types --import ./tests/harness.mjs tests/big-picture.test.mjs`; expect PASS.
- [ ] **Step 7: Commit shell coordinator.** `git add src/components/blog/BigPictureShell.astro src/layouts/Blog.astro src/lib/big-picture-state.ts src/lib/layout-state.ts src/lib/modal.ts tests/big-picture.test.mjs && git commit -m "feat: add big picture shell actions"`.

## Task 6: Add mode styling and layout behavior

**Files:**
- Create: `src/styles/big-picture.css`
- Modify: `src/styles/index.css`
- Modify: `src/layouts/Blog.astro`
- Modify: `src/components/blog/BlogSidebar.astro`
- Modify: `src/components/blog/BlogAside.astro`
- Modify: `src/components/blog/BlogFooter.astro`
- Modify: `src/components/blog/BlogPanel.astro`

**Interfaces:**
- `#blog-root` exposes `data-gamepad-region="main"` through its existing children; sidebar/aside/footer/panel expose stable region hooks.
- CSS is rooted at `:root[data-big-picture]` and does not alter ordinary mode selectors.

- [ ] **Step 1: Capture the existing layout contract.** Record the current `#blog-root`, `#blog-sidebar`, `#blog-aside`, `#main-content`, and footer selectors with `rg`; keep the new rules scoped under `:root[data-big-picture]` so this baseline remains unchanged.
- [ ] **Step 2: Implement mode tokens.** Add `--bp-*` colors, spacing, focus ring, card lift, and overlay z-index values using current theme variables as fallbacks.
- [ ] **Step 3: Implement responsive grid.** Use >1080px three-column mode, 769–1080px two-column mode with aside drawer, and ≤768px single-column drawer mode; include 1280×800 spacing and `scroll-padding-block` for the shell bars.
- [ ] **Step 4: Implement reading layout.** For `page="reading"`, collapse sidebars visually and center the main content at 860px max width; keep navigation and directory buttons focusable and restore focus when drawers close.
- [ ] **Step 5: Implement visibility synchronization.** Reuse one helper for `aria-hidden`, `inert`, and `.show` on sidebar/aside so resize and layout-state changes cannot disagree.
- [ ] **Step 6: Add reduced-motion rules.** Disable lift and smooth scrolling under `prefers-reduced-motion: reduce`; retain the 3px focus outline.
- [ ] **Step 7: Run `pnpm lint` and `pnpm typecheck`.** Fix scoped CSS and Astro prop errors before continuing.
- [ ] **Step 8: Commit styling/layout.** `git add src/styles/big-picture.css src/styles/index.css src/layouts/Blog.astro src/components/blog/BlogSidebar.astro src/components/blog/BlogAside.astro src/components/blog/BlogFooter.astro src/components/blog/BlogPanel.astro && git commit -m "feat: style big picture layout"`.

## Task 7: Integrate page scopes and stable focus hooks

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `src/pages/archive.astro`
- Modify: `src/pages/link.astro`
- Modify: `src/pages/[...slug].astro`
- Modify: `src/components/post/Article.astro`
- Modify: `src/components/post/Slide.astro`
- Modify: `src/components/post/PostSurround.astro`
- Modify: `src/components/post/PostFooter.astro`
- Modify: `src/components/post/Collection.astro`
- Modify: `src/components/partial/Pagination.astro`
- Modify: `src/components/post/OrderToggle.astro`
- Modify: `src/components/content/Tab.astro`
- Modify: `src/components/content/LinkBanner.astro`
- Modify: `src/components/content/ProjectGroup.astro`
- Modify: `src/components/widget/Toc.astro`

**Interfaces:**
- `Blog.astro` receives `bigPicturePage` and passes it to `BigPictureShell`.
- Components add only explicit `data-gamepad-focus`, `data-gamepad-region`, `data-gamepad-initial-focus`, `data-gamepad-scroll`, and stable `data-gamepad-key` attributes; existing event delegation and class names remain intact.

- [ ] **Step 1: Add page scope props.** Pass `home`, `archive`, and `links` from their pages. In `[...slug].astro`, classify `entry.data.isPost` as `reading`, game entries as `games`, the about entry as `reading`, and unsupported pages as `off`; use data/config identity instead of URL prefixes.
- [ ] **Step 2: Mark home regions.** Add explicit region boundaries around sidebar, Slide, post menu, OrderToggle, and Pagination; set the first visible article card as `data-gamepad-initial-focus` and preserve `data-list-key`.
- [ ] **Step 3: Mark archive regions.** Mark year navigation, sort/category controls, and archive entries; keep the current archive structure and do not introduce a new pagination control.
- [ ] **Step 4: Mark reading regions.** Mark Toc links, post actions, visible collection/surround links, existing content controls, and a non-invasive reading anchor with a stable key; set article body as the default scroll target.
- [ ] **Step 5: Mark games, links, and about content.** Add explicit focus keys to `LinkBanner`, feed cards, tabs, project groups, and external links; keep existing `UtilLink` target/rel behavior.
- [ ] **Step 6: Mark dynamic controls.** Ensure `Pagination.astro` and list reorder scripts add focus metadata to newly created buttons; ensure `Tab.astro` keeps metadata when panels are swapped; ensure `Slide.astro` updates focus after changing the visible item.
- [ ] **Step 7: Run the existing tests and typecheck.** Run `pnpm test` and `pnpm typecheck`; expect no route, content, or DOM-contract regressions.
- [ ] **Step 8: Commit page integration.** `git add src/pages src/components/post src/components/partial/Pagination.astro src/components/content/Tab.astro src/components/content/LinkBanner.astro src/components/content/ProjectGroup.astro src/components/widget/Toc.astro && git commit -m "feat: mark core pages for controller navigation"`.

## Task 8: Add injected browser interaction coverage

**Files:**
- Modify: `scripts/interaction-check.mjs`
- Modify: `package.json` only if a named test command is needed; prefer the existing `pnpm interaction-check` entry.

**Interfaces:**
- The check script injects a controller fixture before page scripts run, replacing `navigator.getGamepads` and dispatching `gamepadconnected`/`gamepaddisconnected` events inside the test browser only.
- The fixture exposes `press(button)`, `release(button)`, `axis(index, value)`, `tick(ms)`, and `disconnect()` helpers.

- [ ] **Step 1: Add fixture injection.** Use the existing CDP setup and `Page.addScriptToEvaluateOnNewDocument` path; never add a production debug query parameter or global test endpoint.
- [ ] **Step 2: Add connection assertions.** Visit a normal page, assert connection prompt without `data-big-picture`, press A once and assert mode activation with no navigation, release, press A again and assert the focused target activates.
- [ ] **Step 3: Add navigation assertions.** On home, move between card targets; on an actual article, open/close the directory drawer and scroll the document; on archive, links, games, and about, assert at least one focus target and a working A action.
- [ ] **Step 4: Add modal/drawer priority assertions.** Open search, press B to close it and preserve focus, open sidebar/aside, press B to close it, then press B again and assert the page-level return fallback.
- [ ] **Step 5: Add lifecycle assertions.** Test disconnect status, visibility pause/resume, manual exit suppression, refresh/session continuation, browser back, and no hidden target receiving focus.
- [ ] **Step 6: Add viewport matrix.** Run core assertions at 1600×1000, 1280×800, 800×600, and 390×844; include reduced-motion and increased-font-size checks where the existing CDP helpers allow.
- [ ] **Step 7: Run the browser check alone.** Run `pnpm interaction-check`; record whether a real controller was unavailable—the injected fixture covers behavior, while the final report must still state that physical hardware was not tested.
- [ ] **Step 8: Commit interaction coverage.** `git add scripts/interaction-check.mjs && git commit -m "test: cover controller big picture interactions"`.

## Task 9: Full verification and delivery review

**Files:**
- Modify only files required by failures found in the previous tasks.
- Do not change the approved spec unless a user-approved design decision changes.

- [ ] **Step 1: Run pure tests.** `pnpm test`; expected result is all existing tests plus the three new controller/state/focus suites passing.
- [ ] **Step 2: Run static checks.** `pnpm typecheck` and `pnpm lint`; expected result is no Astro prop, browser-global SSR, scoped CSS, or formatting errors.
- [ ] **Step 3: Build the site.** `pnpm build`; inspect that normal-mode routes and the six page groups still generate and that no new route conflicts appear.
- [ ] **Step 4: Run interaction checks.** `pnpm interaction-check`; verify the injected fixture results and keep any memory/resource skip explicit.
- [ ] **Step 5: Run acceptance gates.** `pnpm accept`; do not substitute a successful build for the acceptance profile.
- [ ] **Step 6: Inspect the final diff.** Confirm no `.superpowers/` mockup, generated build output, `.gitignore`, or `.vscode/` user changes are staged.
- [ ] **Step 7: Record hardware coverage.** Test one standard-mapped controller if available and record browser, OS, connection method, and any unsupported behavior. If unavailable, report the injected-fixture result separately from physical-device coverage.
- [ ] **Step 8: Commit verification fixes only.** Use a focused conventional commit such as `fix: preserve focus after list updates` when a real regression is found; otherwise leave the implementation commits unchanged.

## Execution Order and Checkpoints

Run Tasks 1–3 before touching page markup so input and session semantics are testable without a browser. Run Task 4 before the shell action coordinator so all geometry decisions are pure and reviewable. Run Tasks 5–7 in order because the shell needs the state and focus APIs, and pages need the shell’s region contract. Run Task 8 after the six page groups are wired. Task 9 is the completion gate.

Each task ends with a focused test and a small commit. If a task reveals a conflict with the approved spec, stop at that checkpoint, describe the concrete conflict, and revise the spec before continuing.
