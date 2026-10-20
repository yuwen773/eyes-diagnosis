# Test and legacy-code audit — 2026-10-19

Scope: the current `master` checkout at audit-start HEAD `d74784ea`. Java, gRPC, MCP, Vue, and P1/P2 research tooling remain active in this checkout. Retirement in a separate Python migration worktree is not evidence for deleting them here. Three subagents independently examined Java, frontend, and Python entry points, test behavior, configuration, and references.

## Removal evidence

Reference checks included tracked production code, tests, resources/configuration, frontend imports/templates/routes, and documentation. Historical documentation and generated declarations were distinguished from executable callers. Absence of direct calls alone did not justify deleting Spring components, mapper interfaces, scheduled jobs, CLI entry points, or compatibility APIs.

| Removed assets | Evidence and retained replacement |
| --- | --- |
| `model/dto/diagnosis/DiagnosisDTO.java` | No Java/test/configuration consumers. The diagnosis controller accepts multipart image input and calls the active gRPC service. The earlier gRPC redesign explicitly replaced this URL DTO. A stale generated TypeScript declaration is not a runtime caller. |
| `model/dto/chat/{ChatHistoryQueryRequest,ChatSessionAddRequest}.java`, `model/vo/chat/ChatMessageVO.java` | No production/test/configuration/reflection references. Active controllers use `AgentChatRequest`, `ChatHistoryVO`, and `SessionVO`; current services use `AgentSession` and `AgentMessage`. Old generated request declarations have no consuming API signatures. |
| `model/entity/{ChatHistory,Chatsession,Attachment}.java` and corresponding three `resources/mapper/*Mapper.xml` files | Each entity was referenced only by its own orphan XML result map. Those XML namespaces have no Java mapper interfaces, executable SQL statements, or referenced SQL fragments. Remove each pair together. Existing database tables, schema, migration SQL, and historical data are retained. |
| `ChatHistoryService.ensureSessionExists` | Private declaration with no callers. Active `claimOrValidateSession` preserves ownership checks and concurrent-create validation. |
| `DocumentSearchTool.serialize` and its now-orphaned Jackson field/imports | Private declaration with no callers. Active retrieval returns formatted documents through `formatDocuments` / `rerankAndFormat`. |
| `eye_diagnosis.ood.build_default_detector` and its zero-valued default reference arrays | Definition-only references. Active gRPC explicitly rejects this unevaluated placeholder as a gate and returns `NOT_EVALUATED`. The real `OODDetector`, `OodDecision`, and both statistical contract tests remain. |
| `components/user/{StatCard,NotificationPanel}.vue` | No imports, template tags, route entries, or automatic component registration. Active profile statistics and the routed `NotificationCenter` with `NotificationStats` / `NotificationItem` provide the current UI. Both files were clean before deletion. |
| `styles/design-system/{base,components}.css` | Neither stylesheet is imported or linked. `main.ts` → `assets/main.css` imports `variables.css`, `claude-tokens.css`, and **`assets/base.css`**, which remain. The earlier cleanup design also identifies these two orphan styles. Both files were clean before deletion. |
| `FlywayBaselineTest.java` | Obsolete H2 placeholder: no H2 dependency, no `flyway` profile configuration or CI invocation, and only a nonempty migration-count assertion. The real MySQL migration gate still checks all nine migrations; `EyeDiagnosisApplicationTests` retains Spring startup coverage. Those integration gates were preserved, not claimed as executed here. |

Java paths above are relative to `src/main/java/com/csust/eyediagnosis/`; frontend paths are relative to `frontend/src/`. The deleted H2 test was under `src/test/java/com/csust/eyediagnosis/db/`.

## Bugs fixed and coverage made meaningful

| Behavior | Observed failing evidence → correction |
| --- | --- |
| RAG paragraph overflow duplicated text | `TextChunkerServiceTest` failed with an extra `KLMNOP` paragraph. Remove the duplicate append; assert exact two-chunk text, suffix overlap, and metadata through public `chunk()`. |
| Nonpositive chat page sizes | MockMvc → real history service reproduced application error `50000` for `limit=0`; four invalid history/session cases failed. Reject nonpositive sizes with parameter error `40000`; preserve valid sizes and upper caps. |
| Successful chat deleted uploaded images | Real SSE client plus mocked HTTP transport observed a DELETE after success. Retain images after terminal `event: done`; delete on failure/abort. Five transport tests cover success, HTTP error, cancellation, named SSE error, and premature EOF. |
| SSE error/EOF falsely reported success | Named `event: error` and EOF without `done` previously resolved successfully. Propagate those failures and perform failed-request cleanup. |
| Sparse-class AUROC used the wrong probability column | Labels `{0,2}` produced class-2 AUROC `0.0` instead of `1.0`. Select probabilities by class ID rather than position within the observed-class list. |
| Frozen evaluator called nonexistent `predict_batch` | Public evaluation raised `AttributeError`. Use the actual `predict` API, explicitly order probabilities by numeric class, and retain real registry/hash provenance assertions. Replace the old JSON-library-only test. |
| Evaluation script treated a wrapper as `nn.Module` | Real wrapper raised `AttributeError` for `load_state_dict`. Use its weight-loading API and evaluate its underlying module. A CLI regression also exposed 224×224 preprocessing; align with the B4 380×380 input. Tests load real temporary state dictionaries and images on CPU with a tiny external backbone. |
| MCP served an untrained or partially loaded model | Six new loader tests failed: missing/empty/directory/corrupt weights were accepted, explicit bad configuration fell back, or a failed model remained published. Validate nonempty weight files before construction, honor explicit paths, disable pretrained downloads, and publish only a successfully loaded model. |
| Decimal reliability thresholds misclassified boundaries | `0.6 - 0.4` scored 65 instead of 75; `0.7 - 0.2` scored 85 instead of 95. Round subtraction noise to 12 decimal places; a below-threshold control remains below the threshold. This preserves the existing heuristic and does not establish clinical calibration. |
| Offline facade smoke unnecessarily required live tools | Existing dry-run test failed with `jq not installed`. Dry-run now bypasses live prerequisites; an empty-PATH regression proves it needs no GitHub tools or authentication. No remote repository action was performed. |

Additional coverage corrections:

- Two RAG evaluation methods previously passed silently because JUnit never injected their `VectorStore`. They are now real opt-in Spring integration tests gated by `RUN_RAG_EVALUATION_TESTS=true`, with required injection and corrected distinct-keyword recall. The nonasserting overlap example was replaced by the deterministic chunker regression. Their default **SKIPPED** result is explicit missing evidence.
- Profile-update coverage now submits forged identity/role fields and inspects the actual bound update request instead of `assertNull(null)`.
- Document-search coverage now inspects the captured filter and requires `ownerUserId == 42`.
- Calibration coverage now exercises `apply_temperature` against independent numeric expectations instead of merely serializing a test-created JSON object.
- CI now includes `mcp_server/tests`, installs `pytest-asyncio`, and actually runs Vitest before the frontend build. Existing P1, watchdog, MySQL, and startup gates remain.

## Verification

| Gate | Result |
| --- | --- |
| JDK 21, `mvn -o clean '-Dtest=*,!EyeDiagnosisApplicationTests,!FlywayMySqlIntegrationTest' test` | **49 passed, 3 skipped**, 0 failures/errors. A clean rebuild regenerated protobuf bindings and compiled production/test sources; removed XML/classes cannot survive as stale `target` artifacts. Skips: two provider RAG methods and one opt-in Chroma method. |
| From `algorithm/`: `python -m pytest eye_diagnosis/tests tests mcp_server/tests -q -ra` | **52 passed**, 5 expected sklearn undefined-metric warnings from deliberately absent/predicted classes. No real model downloads, provider calls, or clinical claims. |
| From `algorithm/`: `python -m pytest eye_diagnosis_p1/tests/test_p2_02a_watchdog_unit.py eye_diagnosis_p1/tests/test_p2_02a_watchdog_integration.py -q -ra` | **25 passed, 3 skipped**. Skips require POSIX process-group / signal semantics; no Linux/WSL gate was substituted. |
| From `frontend/`: `npm run test -- --run` | **17 passed** across four files. All original 12 frontend tests remain. |
| From `frontend/`: `npm run build` | **PASS**, type checking and Vite production build. Existing large-chunk warning remains. |
| `bash scripts/tests/test-setup-github-facade.sh` and Bash syntax checks | **PASS**, all four smoke cases, no network operations. |
| `git diff --check` | **PASS**. |
| Existing work preservation | Audit-start tracked changes compared against the saved original diff: unchanged. Historical SQL, P1 code/config/fixtures, checkpoints, and unrelated untracked refactor scripts were not modified. |

## Remaining blockers and gaps

1. **Full P1 suite is not verified.** Collection failed in `test_manifest.py` and `test_training_freeze_folds.py` because the selected environment lacks `pyarrow` and `iterstrat`. Both are already declared in `requirements-p1.txt`; offline dependency resolution could not supply them. No tests were deleted, ignored, or made optional to conceal this. Use a complete environment to run the unchanged full P1 gate.
2. **Real services remain unverified.** Application startup and the MySQL migration gate were excluded from the isolated run. Chroma/provider RAG gates explicitly skipped. Managed CI, a physical browser/COS round trip, real model quality, and clinical acceptance were not executed.
3. **Existing chat-page defects remain.** `AgentChatPage.vue` restores an empty saved thread ID over its generated initial ID, and checks `messages.length === 0` only after pushing a user message, preventing title generation. This page already contains unrelated redesign edits; it was left intact. These are open bugs, not obsolete functionality.
4. **Partial upload failure needs an ownership design.** `useAgentUpload` records cleanup URLs only after the entire batch succeeds. A later file failure can leak earlier uploads. Its module-level in-flight deduplication can share a URL between batches, so blindly deleting partial results could delete another successful request's attachment. No speculative shared-ownership redesign was introduced.
5. **Frozen-evaluation contract remains incomplete.** Its docstring claims timestamp/duplicate-ID guards, but the existing manifest and registry schemas define neither training timestamps nor sample IDs. This audit repaired the broken evaluator without inventing a new frozen-data protocol.
6. **Some tests still overstate coverage.** The metadata example in `DocumentSearchToolOwnershipTest` constructs its own result instead of invoking `DocumentProcessingService.processDocument`. The first three `InferenceCacheTest` cases exercise test-created objects/mocks or JDK hashing rather than `DiagnosisServiceImpl.doDiagnosis`. `McpToolCallbackProviderTest` checks wrapper type rather than owner/status/code predicates. The Chroma gate prints retrieval results without asserting them. These are recorded coverage gaps, not evidence for deleting active implementations.

Retained deliberately: configurable/scheduled outbox code, `validate_oof_with_sets` required by the P2 repair compatibility contract, generated API declarations pending controlled regeneration, and `GridDistortion.vue` / dirty MCP selector code whose apparent unused status depends on pre-existing uncommitted edits.

No commit, push, deployment, business database operation, or migration to the separate Python worktree was performed.
