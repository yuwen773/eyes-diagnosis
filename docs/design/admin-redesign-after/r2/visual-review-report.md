# Independent Visual Review — Admin Console Redesign (`feat/admin-visual-redesign`)

Reviewed read-only from `D:\Work\code\eye-diagnosis\.worktrees\admin-redesign`.
Review date 2026-11-14. Evidence round: `r2/` → `r3/` (the implementation kept
iterating while this review ran; see "Evidence timeline" below).

## Verdict

**READY FOR HUMAN REVIEW** — with two residual P2 items and one evidence gap.

All P1-class defects that existed when this review opened have been fixed by the
implementation and **verified fixed in pixels** by this reviewer (details below).
What remains are two consistency/honesty P2s whose fixes are present in code but
**not yet re-captured**, plus one screenshot/code mismatch I could not reconcile.
This verdict is a review gate, not the user's final visual approval: automated
screenshots passing does not equal human visual acceptance.

## Evidence timeline (matters for reading the findings)

1. `r2/` — post-functional-fix capture (my input round opened here).
2. `94a3e071` (03:56) — "视觉评审整改——窄屏折叠/暗色对比/弹性列零宽三组修复"
   + `r3/` capture 03:51–03:53 (closeups 04:01–04:02).
3. This review found the 390px sticky-column defect still live in that capture
   (see Closed-P1), plus two P2s.
4. `1c0ed04c` (04:30) — "390px sticky 操作列行内宽度压过媒体查询——收窄
   !important"; implementer re-captured `r3/w390|dark-w390` at 04:27–04:29 and
   `r3/w390/dashboard|data-analysis|news|users|news-edit` + several 1440 shots.
5. Uncommitted working-tree edits at review time: `DataTable.tsx` pager
   three-state fix, batch-delete → `admin-btn--danger` on all four ledgers,
   `admin.css` `.admin-btn { white-space: nowrap }`, stale-comment fix in
   `AdminDiagnosisPage.tsx`.

So: anything measured before 04:27 refers to the old capture; the P1 re-check and
the 390 sweep refer to the 04:27–04:29 files. The closeups still date from
04:01–04:02, i.e. **before** the P2 fixes — they are cited as evidence of the
defect, not of the fix.

## Scope, method

- All 7 admin pages across `r3/`: light 1440, dark 1440, w390, w768, w1280,
  w1920, plus `dark-w390/`, `dark-w768/` and six interaction closeups
  (row menu, batch bar, drawer, delete dialog, skeleton, error).
- Pixel-level measurement: bounding boxes, column boundaries, hard-cut detection,
  sampled-colour contrast (computed from token hex, confirmed against screenshot
  pixels), md5 comparison r2↔r3, CSS cascade trace, TSX render-path cross-check.
- Not re-done: functional review (`../r1/functional-review-report.md`, context
  only); no test/typecheck/build run by this reviewer; no live browser session
  (no admin credentials), so root causes are established from pixels + cascade,
  not computed-style readouts.

## Findings (residual, open)

### P2-1 — Batch delete vs row delete: two visual weights for the same destructive verb (fix in code, not yet re-captured)

**Evidence** `r3/closeups/r3-batchbar-news.png` (04:01): the batch bar renders
批量发布 (filled purple), 批量下架 (neutral outline) and **批量删除 (neutral
outline)** — the bulk delete looks *safer* than the unpublish next to it.
`r3/closeups/r3-dialog-delete-news.png` (04:02): the single-row confirm uses the
red `--risk-critical` danger style.

**Why it matters.** Destructive affordances must be recognisable across the same
page; here the higher-blast-radius action is the visually safer one, and the
convention is inconsistent between the two delete paths (axis 8).

**Fix status.** Working tree now sets `admin-btn--danger` on 批量删除 in
`AdminNewsPage.tsx`, `AdminUsersPage.tsx`, `AdminDiagnosisPage.tsx`,
`AdminKnowledgePage.tsx`. Not yet visible in any capture.

**Exit check.** Re-capture the news batch bar + dialog; confirm bulk and row
delete share the danger treatment and 批量下架 stays neutral.

### P2-2 — Pager prints "共 0 条 · 第 1 / 1 页" on error/loading, contradicting the error body

**Evidence** `r3/closeups/r3-error-news.png` (04:02): body says "连不上服务，
请检查网络后再试一次。" while the footer directly below reads "共 0 条 ·
第 1 / 1 页". The page head was correctly moved to "资讯数读取中…", so the
pager is the remaining fabricated-zero path.

**Why it matters.** Axis 5: a failed request publishes a false empty dataset,
which changes what the operator concludes (records lost vs. service down).

**Fix status.** `DataTable.tsx:366-376` now renders `共 — 条 · 第 — / — 页`
when `error || isLoading`. Not yet captured.

**Exit check.** Re-capture the error closeup; pager must show "—" in that state.

### P2-3 (evidence gap) — Filter toggle renders two-line in the delivered 390 capture, but committed CSS says nowrap

**Evidence** `r3/w390/diagnosis.png` (04:28) and `r3/w390/users.png`: the
"展开筛选" button's label wraps ("展开筛" / "选") inside a ~90px box, yet
`admin.css:362-364` sets `white-space: nowrap` on `.admin-btn` (present since
`521f2983`), and the 1440 captures show single-line toggles. I could not
reconcile the screenshot with HEAD; most likely a capture/build-time mismatch
(e.g. capture run against a server without the latest CSS), but I am reporting
it as a gap, not dismissing it.

**Exit check.** One fresh 390 capture per ledger page; if the wrap persists,
find the rule that wins the cascade (or a max-width on the toggle) and fix it.

## Closed during this review (verified fixed, not re-reported as open)

- **P1 — 390px result/document columns sliced by the sticky action column**
  (light + dark, diagnosis and knowledge). Root cause confirmed by cascade
  trace: inline `width` from the column defs (190px / 176px) beat the ≤640px
  96px class, so the sticky cell stayed wide and covered the data column.
  Fixed by `1c0ed04c` (`!important` on the 96px action-column rule) + re-capture.
  Verified in pixels: `r3/w390/diagnosis.png` header runs now 影像 86-106 /
  判读结果 161-204 / 操作 217-220; chip bg x 160-233 y 653-675 with the full
  "AI 拒识" label; action controls at x 284-295 with no collision. Same for
  `r3/dark-w390/diagnosis.png` and `r3/w390/knowledge.png` (full filenames,
  meta line, eye + ⋯ buttons).
- **Dark-mode contrast** (my earlier r2 suspicion): does not reproduce. Dark
  axis text measures 6.97:1 (`#a69fbf` on `#1a1727`), admin body 14.86:1,
  faint 5.39:1, dark checkbox mark 7.92:1 (code-derived; the checked state is
  not present in any capture — see Limits). Dark hero is a dark purple panel,
  no pink wash-out, no light-theme leftovers in `r3/dark*`.
- **Editor placeholders**: title/body/note measure 5.81:1 (`#69617e` on white).
  The earlier low-contrast concern is closed.
- **Bento 1024-1280 break** (functional P1-3): `r3/w1280/dashboard.png` stacks
  correctly; `r3/w1920/*` proportionate; `r3/w768/*` tables scroll with pinned
  action column; `r3/w390/*` pages stack with no horizontal overflow
  (right-most ink ≤ x 369/390, remainder is intentional full-width hairlines).

## Verified good (evidence-based)

- **No fabricated KPIs** — zeros carry "上期与本期均为 0" / "占窗口内判读
  0.0%", absent data renders "—", "已清空" only on real zeros; empty chart
  panels are explanatory with next-step CTAs (`r3/dashboard.png`,
  `r3/data-analysis.png`).
- **Severity stays in `--risk-*`** — sampled pills exactly `#a83226` /
  `#96690f` / `#2f7d55` (6.67 / 4.86 / 5.02:1 on white); purple only for
  management identity/current state; no signal-orange CTA; the feature card is
  the single intentional large purple fill.
- **Typography** — KPI digits and all counts/timestamps mono + tabular (uniform
  advance); page heads Manrope 600 per `DESIGN.md`'s explicit admin exemption;
  no mixed-font figures.
- **Task differentiation** — Bento dashboard vs filter+table ledgers vs writing
  workspace editor with right rail; no two pages share a skeleton.
- **States** — error copy plain and actionable; skeleton rows non-interactive;
  delete dialog Base UI-rendered with named target and "删除后不可恢复";
  batch bar shows live "已选 N 项".
- **Weekday bar chart at 390** — seven labels 周一…周日 at 32px pitch, fully
  legible, single Friday bar with value label (`r3/w390/data-analysis.png`).

## Non-blocking

- Stale comment "表格 min-width 780" at `AdminDiagnosisPage.tsx:481` fixed in
  the working tree (now 992).
- `admin.css` vs `admin-redesign.css` duplicate class blocks (r1 housekeeping
  note) still present; second-wins by import order. Not visual debt today, but
  a hazard for the next change.

## Limits

- Checked-checkbox and disabled-primary states do not appear in any capture;
  their r3 claims are code-verified only.
- The closeups predate the P2 fixes by ~25 minutes; P2-1/P2-2 are cited as
  defects of that capture and as not-yet-verified fixes.
- P2-3 could not be reconciled without driving a live browser; flagged as an
  evidence gap rather than a defect.
- Automated screenshots passing does not equal human visual approval. This
  report is a review gate; final sign-off remains with the user.

## Exit criteria for human review

1. Re-capture the news batch bar + delete dialog; confirm 批量删除 shares the
   dialog's danger treatment (P2-1).
2. Re-capture the news error state; pager must read "共 — 条 · 第 — / — 页"
   (P2-2).
3. One fresh 390 capture per ledger page to settle the toggle-wrap question
   (P2-3).
