# Independent Functional Code Review — `feat/admin-visual-redesign`

Reviewed read-only from `D:\Work\code\eye-diagnosis\.worktrees\admin-redesign`, frontend root `web/`.
Scope: full working-tree diff vs the branch base, plus untracked new files.

## Verdict

**REQUEST CHANGES (functional code only).**

No P0. Three P1 findings: two silent content-loss paths in the new news editor and one deterministic responsive layout break. No backend API / DB schema / medical-rule / auth files changed, and no fabricated backend capability was introduced.

## Commands run (from `web/`)

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc -b`) | PASS — exit 0, no diagnostics |
| `npm run lint` (`eslint .`) | PASS — exit 0, no output |
| `npm run test` (`vitest run`) | PASS — 43 files / 353 tests, 14.45s |
| `npm run build` (extra check) | PASS — built in 1.11s; warning: `AdminNewsEditPage` chunk **1,088.61 kB** (gzip 367.56 kB) |

E2E was intentionally not run (known environmental failures, per instruction).

## P1 findings

### P1-1 — “插入正文” is silently discarded on save for every existing article

`D:/Work/code/eye-diagnosis/.worktrees/admin-redesign/web/src/pages/admin/AdminNewsEditPage.tsx:355` (function), `:580` (button), `:280` (save decision), `:470` (only `setContentDirty` call).

`insertCoverIntoContent()` calls `patch({ content: ... })`, which sets `dirty` but **not** `contentDirty`. `onSubmit` sends:

```ts
const content = legacyHtml && !contentDirty ? legacyHtml : renderNewsHtml(form.content)
```

Every article saved by this editor posts `renderNewsHtml(...)` (HTML), so on reload `initial.content` is HTML and `legacyHtml` is non-null for **all** existing articles, not only pre-Markdown ones. Repro: open any saved article with a cover → click 插入正文 → click 保存 → reload. The inserted `![封面](...)` is gone while the UI said 已保存. Typing in the body masks the bug because `MDEditor.onChange` sets `contentDirty`.

Fix: mark content dirty on this path (cleanest: in `patch`, if `next.content !== undefined`, call `setContentDirty(true)`), and add a regression test on the legacy-HTML save branch.

### P1-2 — `dirty` is cleared unconditionally after async success, masking unrelated/ongoing edits

Same file: `:333-335` (cover upload), `:300` (save).

- Edit title/content, then upload a cover → `setDirty(false)` erases the pre-existing dirty state. “返回列表” or any sidebar link then navigates with **no confirm**, losing those edits.
- Edits typed while the save/upload request is in flight are also marked clean on response and reported “已保存”; the submitted snapshot did not include them.

Fix: in the cover callback use `setForm(prev => ({ ...prev, coverImage: url }))` and leave `dirty` untouched (the cover is already persisted, but unrelated edits are not). For save/upload, capture a form revision counter in `patch`, snapshot it before the request, and clear `dirty` only if the revision is unchanged on success.

### P1-3 — Bento grid breaks between 901px and 1280px (dashboard)

`D:/Work/code/eye-diagnosis/.worktrees/admin-redesign/web/src/styles/admin.css:3094-3100`; used by `AdminDashboardPage.tsx` (`span-4` + `span-8` pairs).

In the `@media (max-width: 1280px)` block, `.span-4` becomes `span 6`, but `.span-8` remains `span 8`. Each pair is 6 + 8 = 14 columns in a 12-column grid, so the trend/share panel always wraps to its own row occupying 8/12 and leaves 4 empty columns; the next `span-4` cannot fill the gap. At 1024/1152/1280 the dashboard becomes six ragged rows.

Fix: add `.admin-bento > .span-8 { grid-column: span 12 }` to the ≤1280 block (or make the pairs 6 + 6), and verify 1024/1280 screenshots.

## P2 findings

### P2-1 — Unsaved-leave guard false negatives/positives

`.../web/src/pages/admin/AdminNewsEditPage.tsx:207-232`.

Browser Back/Forward and any programmatic history navigation are not intercepted (only `beforeunload` + anchor clicks); edits are lost without a prompt — the code comment acknowledges BrowserRouter lacks `useBlocker`. Also Ctrl/Cmd/Shift-click on an internal link prompts and is prevented (new-tab intent blocked), and clicking a link to the current route prompts.

Fix: use a data router with `useBlocker`, or add a `popstate` guard; skip the confirm for modifier clicks and same-URL links.

### P2-2 — UI claims “0 / 已清空” whenever data is absent, including load and error

`.../web/src/pages/admin/AdminDashboardPage.tsx:266, 285, 304`; `.../AdminDataAnalysisPage.tsx:227, 240`; list totals `AdminNewsPage.tsx:288`, `AdminUsersPage.tsx:425`, `AdminKnowledgePage.tsx:436`, `AdminDiagnosisPage.tsx:588`.

`statsLoading = !stats && !statsFault`, so on a failed stats request the dashboard/data-analysis still render “已清空”, “占窗口内判读 0.0%”, “当前没有等待人工复核…积压已清空” next to the FaultNote. List page heads show “共 0 条 / 0 个账号” during initial loading (and on error), while value labels elsewhere correctly use “—”. This contradicts the “还没读到 ≠ 读到是零” rule stated in the same files.

Fix: derive zero-state copy from `stats != null` / `data != null`, and render “—” or “读取中…” otherwise.

### P2-3 — “正文字符 / 摘要长度” disagrees with the backend summary rule

`.../web/src/pages/admin/AdminNewsEditPage.tsx:61-70, 243, 603-608`; backend rule `src/main/java/com/csust/eyediagnosis/controller/NewsController.java:286-292`.

`visibleLength` deletes fenced code blocks, inline code, and link text. The backend strips HTML only, so code content and link text **do** count toward the 30-character summary. A body consisting of a 40-character code block displays “正文字符 0 / 摘要长度 0 字” while the backend generates a 30-character summary; link-heavy bodies undercount. It also displays a “摘要长度” for bodies the backend will reject (<30 visible chars).

Fix: compute from the same rendered-HTML pipeline (strip tags/entities/whitespace) or label the value as an estimate.

### P2-4 — Editor save state contradicts itself after save + edit

`.../web/src/pages/admin/AdminNewsEditPage.tsx:234-237, 244-252, 439-445`.

`patch` never clears `success`. After saving, the page shows the green “已保存” FaultNote and, once the user types, “有未保存的修改 / 未保存” simultaneously.

Fix: `setSuccess(null)` in `patch` (or when dirty flips true).

### P2-5 — Accessibility regressions in new sidebar/menu

`.../web/src/components/admin/AdminLayout.tsx:154`; delete menu item `AdminUsersPage.tsx:382-398`.

`aria-label` on a role-less `<span>` (`admin-side__foot-status`) is not exposed to assistive tech; the green dot is the only cue and statically claims “当前会话有效” with no actual session probe. The then-disabled delete button’s `title="无法操作管理员账号"` was dropped when the action moved into `RowMenu`, so a disabled “删除用户” no longer explains why.

Fix: use `role="status"` + visually hidden text (or remove the claim); include the reason in the disabled item’s label/description.

## Positive verifications

- **No prohibited files changed**: `git diff --name-only` outside `web/` is only `DESIGN.md`; no backend, Flyway, auth, or medical-rule files.
- **Stack constraints**: only `@uiw/react-md-editor` added; TanStack Query/Table, Base UI, Recharts retained. Build confirms the editor is route-lazy (separate chunk).
- **XSS**: preview uses `renderNewsHtml` = markdown-it `html:false` + DOMPurify whitelist (`sanitize.ts`); `MDEditor` runs with `preview="edit"`, so its own renderer never sees content. No unsanitized `dangerouslySetInnerHTML` added.
- **Snowflake IDs** stay strings: no `Number(id)`/`parseInt(id)` introduced; row keys and delete payloads remain strings.
- **Admin-delete rules preserved**: `canDeleteUser` guards the menu item, `openDelete`, and `isRowSelectable`; admin rows remain excluded from bulk actions.
- **Query invalidation**: mutations still invalidate the same domain prefixes (`newsAll` covers `newsDetail`, `statsAll`); no stale-list regression introduced.
- **DataTable**: page/size/sort changes still reset selection; loading > error > empty > rows precedence is intact; skeleton rows are non-interactive; `emptyContent` only renders for a genuine empty result; `pageWindow` is correct.
- **WeekBars fix is correct**: explicit domain from `average` (not `total`) fixes the Recharts 3 “0→4 axis for an 0.8 average” bug.
- **No false dirty on editor mount**: verified in `@uiw/react-md-editor` source that `onChange` fires only from textarea input; toolbar commands dispatch a bubbling `input` event, so `contentDirty` is set for those.

## Not verified / environment limits

- Browser-level behavior of Base UI Menu → Dialog focus handoff (`RowMenu` delete → `Modal`) could not be exercised without running the app; not claimed as a finding.
- No rendered-pixel check was performed; P1-3 is verified by CSS math, not rendered screenshots.
- E2E intentionally not run.

## Housekeeping (non-blocking)

- Untracked dev artifacts (`web/scripts/capture-admin.mjs`, `capture-one.mjs`, `check-contrast*.mjs`, `inspect-dom.mjs`) and the referenced evidence trees `docs/design/admin-redesign-{before,after}/`: decide explicitly whether to commit evidence and delete/gitignore the one-off scripts.
- `web/src/styles/admin.css` (appended block) and `web/src/styles/admin-redesign.css` both define `.admin-bento`, `.panel`, `.feature-card`, `.admin-filter`, `.admin-chip`, `.admin-empty` with different values; the second wins by import order — a single-source-of-truth hazard.
- Pre-existing (not introduced): the editor preview’s `.markdown-body` typography lives only in `agent.css`, which is loaded with the lazy `/agent` route, so a direct deep link to `/admin/news/:id/edit` renders the preview without that typography. The new design leans harder on preview.
- Cosmetic: `KpiCard` wraps `foot` in a span that is already `admin-metric-card__foot` (`AdminDashboardPage.tsx:283`, `AdminDataAnalysisPage.tsx:225`).
