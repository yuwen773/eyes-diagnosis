# #24 Agent collaboration evaluation

Evidence: **SCRIPTED_REPLAY**.

Hand-authored model-response scripts executed in a test-only reference workflow, not a model or the production coordinator. Differences are seeded fixture behavior; no empirical model or clinical effectiveness claim.
All six conditions use the same inputs, response scripts and gold annotations. Each ablation removes one role from execution; shared safety gates remain enabled. Full contexts, outputs and executed role traces are retained. Production role permissions and gates are unchanged.
Scoring covers internal candidate claims, not released patient results. Exact gold text/support annotations are synthetic arithmetic checks, not medical semantic adjudication.

Source commit: `6072339fa351e7cdb698245e7fd680716737702a`. Corpus SHA-256: `1a21a71cc46b1a5809d6d31a3407933c847c3db1b9f75dde62dbf2741246ea47`.

| Condition | N | Correct citations | Traceable quotes | Unsupported claims | Omissions | Ready recall | False ready | Status correct | Offline workflow ms | Scoring ms | Provider USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| single_agent | 8 | 9/10 | 10/10 | 1/10 | 3/12 | 4/4 | 0/4 | 8/8 | 0.175 | 0.110 | 0 |
| four_agent | 8 | 12/12 | 12/12 | 0/12 | 0/12 | 4/4 | 0/4 | 8/8 | 0.421 | 0.062 | 0 |
| without_vision | 8 | 11/11 | 11/11 | 0/11 | 1/12 | 4/4 | 0/4 | 8/8 | 0.350 | 0.056 | 0 |
| without_evidence | 8 | N/A (0/0) | N/A (0/0) | N/A (0/0) | 12/12 | 0/4 | 0/4 | 4/8 | 0.055 | 0.038 | 0 |
| without_explanation | 8 | N/A (0/0) | N/A (0/0) | N/A (0/0) | 12/12 | 0/4 | 0/4 | 4/8 | 0.104 | 0.037 | 0 |
| without_critic | 8 | 10/11 | 11/11 | 1/11 | 2/12 | 4/4 | 0/4 | 8/8 | 0.340 | 0.059 | 0 |

Counts are micro-aggregated. Correct citation = eligible source + exact nonempty quote + exact gold text + annotated support. Unsupported = no such supporting reference. Omission = required gold fact without a supported claim; duplicates never improve coverage.
A zero denominator is N/A. Ready recall exposes all-abstain variants. False ready uses only restricted samples. Timing separates local scripted workflow and scoring, including trace capture; provider cost is zero because no provider is called. Real model latency, tokens and cost: NOT_RUN.

## Failure examples (all cells)

- `single_agent/vision_limitation`: [{"kind": "omission", "facts": ["limitation"]}]
- `single_agent/critic_unsupported`: [{"kind": "incorrect_citation", "claim": 0, "reference": {"sourceId": "ref-1", "quote": "label G is not a diagnosis"}}, {"kind": "unsupported_claim", "claim": 0, "text": "Synthetic label G proves a definitive diagnosis."}, {"kind": "omission", "facts": ["finding"]}]
- `single_agent/critic_omission`: [{"kind": "omission", "facts": ["next_step"]}]
- `without_vision/vision_limitation`: [{"kind": "omission", "facts": ["limitation"]}]
- `without_evidence/complete`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_evidence/vision_limitation`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_evidence/critic_unsupported`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_evidence/critic_omission`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_explanation/complete`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_explanation/vision_limitation`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_explanation/critic_unsupported`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_explanation/critic_omission`: [{"kind": "omission", "facts": ["finding", "limitation", "next_step"]}, {"kind": "wrong_status", "expected": "REVIEW_READY", "actual": "RESTRICTED"}]
- `without_critic/critic_unsupported`: [{"kind": "incorrect_citation", "claim": 0, "reference": {"sourceId": "ref-1", "quote": "label G is not a diagnosis"}}, {"kind": "unsupported_claim", "claim": 0, "text": "Synthetic label G proves a definitive diagnosis."}, {"kind": "omission", "facts": ["finding"]}]
- `without_critic/critic_omission`: [{"kind": "omission", "facts": ["next_step"]}]

## Current reliability evidence

Status: **PASS**. Actual Java coordinator and HTTP + isolated MySQL; synthetic model, identities and references. No real model service.
Total: 64/64 actual test cases (not patients).

| Behavior | Passed / denominator |
|---|---:|
| insufficient_evidence | 1/1 |
| tool_privilege | 1/1 |
| crash_recovery | 1/1 |
| restricted_state | 3/3 |
| patient_ownership | 5/5 |
| late_output | 1/1 |
| withdrawal | 1/1 |

Reliability failures/skips: none in this supplied run.

## Evidence boundaries

| Layer | Status |
|---|---|
| real_model_service | NOT_RUN |
| real_python_inference | NOT_RUN |
| browser | NOT_RUN |
| domain_review | NOT_RUN |
| clinical | NOT_RUN |
| production | NOT_RUN |
| offline_scripted_replay | RUN |
| java_mysql_http | PASS |

No conclusion of clinical validity or production acceptance. Full observations, case-level denominators, test names and artifact hashes are in results.json and corpus.json.
