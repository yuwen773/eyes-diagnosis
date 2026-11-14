# Subagent delegation

Mechanical checks belong to scripts (`scripts/check_design_doc.py`,
`scripts/check_surefire_skips.py`, `scripts/check-eslint-baseline.cjs`). A
review subagent's job is the judgement calls no grep can make: whether three
recovery mechanisms are conflated, whether a table count is internally
consistent, whether a terminology boundary survived an edit.

## Brief

Give each subagent one task, one file scope, and an exact completion
criterion. The criterion must be checkable — a named verdict plus the
evidence that produces it, not "review it" or "make sure it is consistent".
State what is out of scope and which scripts already ran, so the agent does
not redo them.

## Bounds

Tell the agent to stop and report when it has its verdict, even if some
tangential lead remains open. A review that produces no verdict after its
first pass is a stuck review: report the partial findings and stop rather
than continuing to dig.

## Waiting

The harness notifies on completion. Wait for that notification. Do not poll
with repeated `ListAgents` / `SendMessage` / `Monitor` calls, and do not
spawn background waiters to watch an agent. If a subagent has produced no
output after a bounded interval, send one request to conclude, then stop it
and do the remaining checks directly.

## Evidence

A subagent report is not evidence by itself. Re-run the load-bearing checks
on the live file and say which were verified independently. A stuck or
killed subagent produced no review — say so plainly instead of treating its
last progress line as a verdict.
