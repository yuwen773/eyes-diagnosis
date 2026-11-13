# Independent Visual Review — Admin Console Redesign (`feat/admin-visual-redesign`)

Reviewed read-only from `D:\Work\code\eye-diagnosis\.worktrees\admin-redesign`, branch
`feat/admin-visual-redesign` (base `ui`). Review date 2026-11-14.

## Verdict

**REQUEST CHANGES.**

No P0. One P1 remains visible in the delivered evidence: at 390px the diagnosis
"判读结果" and knowledge "文档" columns are still sliced by the sticky action
column (light **and** dark), so "AI 拒识" renders as a red dot plus a single "A".
Two P2 consistency/honesty findings follow. This is a review gate, not the
user's final visual sign-off — automated screenshots passing does not equal human
visual approval.

## Scope, evidence and method

- **Evidence base.** The review round opened on `r2/`; while it was running the
  implementation committed `94a3e071 fix(web): 视觉评审整改——窄屏折叠/暗色对比/弹性列零宽三组修复`
  and re-captured `r3/`. Findings are therefore verified against **`r3/`**
  (the post-remediation evidence), with `r2/` used only to locate the original
  defect. `r3/` contains 7 pages × {light 1440, dark 1440, w390, w768, w1280,
  w1920} plus `dark-w390/`, `dark-w768/` and six interaction closeups.
- **Method.** Full-page screenshots inspected visually and measured at pixel
  level (bounding boxes, column boundaries, hard-cut detection, sampled colour
  contrast, md5 comparison between `r2/` and `r3/`), cross-checked against the
  CSS cascade and the TSX render path. Contrast ratios were computed from the
  token hex values and confirmed against sampled screenshot pixels.
- **Not re-done.** Functional/behavioural review is `../r1/functional-review-report.md`;
  it is context only. No test suite, typecheck or build was run by this review;
  no application server was driven (no admin credentials were available to this
  reviewer), so all conclusions are screenshot + source based.

## Findings

### P1-1 — 390px ledgers still truncate the result/document column; the sticky action column covers it (light and dark)

**Evidence**
- `r3/w390/diagnosis.png` (390×1552): the "AI 拒识" pill occupies **x 149–174,
  y 653–676** and is cut by a perfectly vertical hard edge at **x 175**; pixels
  x 175–190 are pure white and the action controls start at **x 191**. The
  header cell "判读结果" is likewise clipped, its ink ending at **x 174**.
- `r3/dark-w390/diagnosis.png` (390×1552): identical geometry, same cut.
- `r3/w390/knowledge.png` (390×1568): the document name is cut at **≈x 170**
  while the "操作" header is already visible at **≈x 205** — the same overlay.

**Observation.** The "弹性列零宽" fix did give the result column a 156px floor
(and knowledge a 172px floor), and the geometry confirms the chip would fit.
The visible cut is not the column boundary: it is the **sticky action column**
painted on top. The ≤640px rule shrinks it to 96px, but each column definition
also writes an inline `width` onto the `<th>` — 190px for diagnosis
(`AdminDiagnosisPage.tsx:540`), 176px for knowledge
(`AdminKnowledgePage.tsx:396`) — applied at `DataTable.tsx:325`
(`style={{ width: column.width }}`). Inline styles beat the class, so the sticky
cell stays 190px/176px wide, is pinned to the scrollport's right edge and covers
everything from x≈175 rightwards with an opaque `--admin-surface` background.
That is precisely where the chip is sliced.

**Why it matters.** The flagship narrow-screen fix still shows a broken reading:
the severity-tagged "AI 拒识" chip is unreadable and the column header is
mutilated at the width the fix was specifically written for. The same defect
repeats in dark mode, so the "双主题" claim does not hold at 390.

**Status of the fix.** The working tree now contains an **uncommitted** change to
`web/src/styles/admin-redesign.css` adding `!important` to the ≤640px
`.admin-dt__cell--action { width/min-width: 96px }` rule, with a comment naming
exactly this inline-style override. It is not in `94a3e071`, and no `r4`
re-capture exists, so the delivered evidence still shows the defect.

**Suggested fix.** Keep the working-tree `!important` (or, cleaner, stop writing
the action column's inline width below 640px — e.g. omit `style.width` for the
last column when it is the action column, or set the width through a CSS custom
property). Then re-capture **`w390` and `dark-w390` for diagnosis and knowledge**
and confirm: full "AI 拒识" pill, full "判读结果" header, no control collision
inside the 96px cell (two 30px icon buttons + gap + 32px padding is ≈94–100px —
verify it does not bleed).

### P2-1 — The same destructive verb has two visual weights: row delete is red, batch delete is neutral

**Evidence**
- `r3/closeups/r3-batchbar-news.png`: the batch bar renders 批量发布 (filled
  purple), 批量下架 (neutral outline) and **批量删除 (neutral outline)** —
  visually identical to the non-destructive unpublish action.
- `r3/closeups/r3-dialog-delete-news.png`: the single-row confirmation renders
  **确认删除 in the red `--risk-critical` danger style**.

**Observation.** `AdminNewsPage.tsx:434-438` gives the batch delete
`admin-btn--ghost`; the dialog at `AdminNewsPage.tsx:493` uses
`admin-btn--danger`, which the stylesheet deliberately defines in
`--risk-critical` ("危险动作保持医学语义色"). The batch action — the one with
the larger blast radius — therefore looks the *safer* of the two.

**Why it matters.** Destructive affordances must be recognisable across the same
page; here the bulk path is easier to mis-click than the single-row path. It also
breaks component consistency across the seven pages (axis 8).

**Suggested fix.** Use `admin-btn--danger` for 批量删除 (keeping the existing
confirmation), or drop the red from the dialog and rely on the confirm copy —
but pick one convention. 批量下架 stays neutral.

### P2-2 — On error the pager still prints "共 0 条 · 第 1 / 1 页", contradicting the error body

**Evidence**
- `r3/closeups/r3-error-news.png`: the table body says "连不上服务，请检查网络后再试一次。"
  while the pager immediately below reads **"共 0 条 · 第 1 / 1 页"** with
  disabled 上一页/下一页.

**Observation.** The page head was correctly moved to a three-state treatment
("资讯数读取中…" instead of a fake count), but `DataTable.tsx:367-370` always
renders `共 {page.total} 条`, and the pages pass `total = data?.total ?? 0`.
A failed or in-flight request therefore publishes a fabricated zero in the
footer — the exact "还没读到 ≠ 读到是零" rule the redesign states elsewhere.

**Why it matters.** Axis 5 (honest empty/loading/error states): a user reading
the pager concludes the dataset is empty rather than unread, which changes what
they do next (e.g. concluding records were lost).

**Suggested fix.** When `error` is set or rows are still loading, render "—"
for the count (or hide the pager, as `hidePager` already supports), and restore
the real total only when a successful response has been read.

## Verified good (evidence-based)

- **No fabricated KPIs.** `r3/dashboard.png`, `r3/data-analysis.png`: zeros are
  accompanied by "上期与本期均为 0 " / "占窗口内判读 0.0%", absent data renders
  "—", and "已清空" appears only on cards that read a real zero. Empty chart
  panels are explanatory ("窗口内还没有可统计的判读" + next-step CTA), never
  fake series.
- **Severity stays in the risk palette.** Sampled pills are exactly
  `#a83226` / `#96690f` / `#2f7d55` (6.67 / 4.86 / 5.02:1 on white). Purple is
  used only for management identity/current state; the primary CTA is purple, not
  signal orange. The feature card is the single intentional large purple fill.
- **Typography.** KPI digits and all counts/timestamps are mono with uniform
  advance (tabular); page heads use Manrope 600, which `DESIGN.md` explicitly
  sanctions for admin (not a serif-weight violation). No mixed-font figures found.
- **Dark mode.** Canvas measured `(26,23,39)` as documented; the hero card is now
  a dark purple panel (no pink wash-out); chart axis text measures **6.97:1**
  (`#a69fbf` on `#1a1727`); admin body text 14.86:1, faint text 5.39:1. The dark
  checkbox mark override exists in code (`stroke='%23171322'`, code-derived
  **7.92:1** on `#b39dfb`). No light-theme leftovers spotted in `r3/dark/*`,
  `r3/dark-w390/*`, `r3/dark-w768/*`.
- **Responsive structure.** w768 ledgers scroll horizontally with the action
  column pinned (header runs spread across 992px, e.g. 时间 at x 554–574);
  w1280 dashboard bento stacks cleanly (the former 6+8=14-col break is gone);
  w1920 keeps the same 16px gaps without over-stretching; w390 page heads and
  cards stack with no horizontal page overflow (right-most ink ≤ x 369/390,
  the remainder being intentional full-width hairlines).
- **States and interactions.** Error copy is plain and actionable; skeleton rows
  are non-interactive; the delete dialog is Base UI-rendered with named target
  and "删除后不可恢复" copy; the batch bar shows a live "已选 N 项".
- **Editor typography/contrast.** Title/body/note placeholders measure **5.81:1**
  (`#69617e` on white) — the earlier low-contrast placeholder concern does not
  reproduce in `r3`.
- **Task differentiation.** Dashboard is Bento KPIs/trends/tasks/distribution;
  the four ledgers are filter + dense table + pager; the news editor is a writing
  workspace with a right settings rail. No page is a copy of another.

## Non-blocking notes

- `AdminDiagnosisPage.tsx:481` still says "表格 min-width 780" while the CSS now
  sets 992px — stale comment, no visual effect.
- The r3 `w390` filter toggle renders "展开筛选" on two lines
  (`r3/w390/diagnosis.png`, x 42–133, y 492–527), yet committed CSS sets
  `white-space: nowrap` on `.admin-btn` (`admin.css:363`). I could not reconcile
  the screenshot with HEAD; it is most likely a capture/build-time mismatch, so
  this is reported as an **evidence gap, not a defect**. A fresh 390 capture will
  settle it.

## Limits

- No admin credentials were available to this reviewer, so the live DOM was not
  driven; the P1 root cause is established from pixel geometry + the cascade, not
  from a computed-style readout.
- Checked-checkbox and disabled-primary-button states do not appear in the
  captured screenshots; those r3 claims are **code-verified only**, not
  pixel-verified.
- The `r3` evidence was captured 03:51–03:53, before the 03:56 commit; the
  uncommitted CSS fix means HEAD and the working tree differ. Re-capture after
  committing is required before this can be called verified.
- **Automated screenshots passing does not equal human visual approval.** This
  verdict is a review gate; final sign-off remains with the user.

## Exit criteria for READY FOR HUMAN REVIEW

1. Commit the sticky-action-column width fix; re-capture `w390` + `dark-w390`
   for **diagnosis** and **knowledge** and show the full "AI 拒识" chip and
   "判读结果" header (P1-1).
2. Align 批量删除 with the dialog's danger treatment (or state the convention)
   (P2-1).
3. Render "—"/hide the pager during load/error (P2-2).
4. Re-run any affected capture so `r4` and HEAD agree (evidence gap above).
