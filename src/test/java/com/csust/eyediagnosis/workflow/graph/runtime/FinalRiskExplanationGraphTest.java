package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.BaseCheckpointSaver;
import com.alibaba.cloud.ai.graph.checkpoint.Checkpoint;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.MemorySaver;
import com.alibaba.cloud.ai.graph.state.StateSnapshot;
import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.ImageQualityDecision;
import com.csust.eyediagnosis.workflow.domain.InferenceOutcomeType;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiencyReasonCode;
import com.csust.eyediagnosis.workflow.explanation.ClinicalRiskFinalAction;
import com.csust.eyediagnosis.workflow.explanation.ExplanationClaim;
import com.csust.eyediagnosis.workflow.explanation.ExplanationClaimType;
import com.csust.eyediagnosis.workflow.explanation.ExplanationClaimValidationAction;
import com.csust.eyediagnosis.workflow.explanation.ExplanationClaimValidationResult;
import com.csust.eyediagnosis.workflow.explanation.ExplanationClaimValidator;
import com.csust.eyediagnosis.workflow.explanation.ExplanationDraft;
import com.csust.eyediagnosis.workflow.explanation.ExplanationDraftAction;
import com.csust.eyediagnosis.workflow.explanation.ExplanationDraftRequest;
import com.csust.eyediagnosis.workflow.explanation.ExplanationGenerationOutcome;
import com.csust.eyediagnosis.workflow.explanation.ExplanationInvocationCoordinator;
import com.csust.eyediagnosis.workflow.explanation.ExplanationModelClient;
import com.csust.eyediagnosis.workflow.explanation.ExplanationModelResult;
import com.csust.eyediagnosis.workflow.explanation.ExplanationPublicationDecision;
import com.csust.eyediagnosis.workflow.explanation.ExplanationPublicationDecisionAction;
import com.csust.eyediagnosis.workflow.explanation.ExplanationPublicationGuard;
import com.csust.eyediagnosis.workflow.explanation.ExplanationValidationStatus;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinition;
import com.csust.eyediagnosis.workflow.graph.definition.DiagnosisGraphDefinitionFactory;
import com.csust.eyediagnosis.workflow.graph.definition.GraphConditionalEdgeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionManifest;
import com.csust.eyediagnosis.workflow.graph.definition.GraphEdgeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphNodeSpec;
import com.csust.eyediagnosis.workflow.graph.definition.GraphSegmentSpec;
import com.csust.eyediagnosis.workflow.graph.definition.Sha256GraphDefinitionHasher;
import com.csust.eyediagnosis.workflow.graph.registry.InMemoryGraphDefinitionRegistry;
import com.csust.eyediagnosis.workflow.job.LeasedJobFence;
import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.ExplanationSnapshotRepository;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskFinalInput;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskFinalResult;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskPolicy;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskPrecheckInput;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskPrecheckResult;
import com.csust.eyediagnosis.workflow.risk.PublicationRiskDisposition;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Synthetic Segment D proves routing through the public Graph runtime seam. */
class FinalRiskExplanationGraphTest {
    private static final String RISK_KEY = "segmentD.risk";
    private static final String DRAFT_KEY = "segmentD.draft";
    private static final String VALIDATION_KEY = "segmentD.validation";
    private static final String DECISION_KEY = "segmentD.decision";
    private static final String STATUS_KEY = "segmentD.explanationStatus";

    @Test
    void autoPublicationShouldReachEndWithoutResume() {
        Fixture fixture = new Fixture(Scenario.autoPublication());

        SegmentExecutionResult result = fixture.start();

        assertCompletedAtEnd(fixture, result);
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(1, fixture.modelCalls.get());
        assertEquals(1, fixture.draftCalls.get());
        assertEquals(1, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(0, fixture.finalReviewRuns.get());
        assertEquals(ExplanationPublicationDecision.PUBLISH, fixture.decision.get());
        assertNoSensitivePublicState(fixture.snapshot());
    }

    @Test
    void limitedEvidenceShouldCompleteWithoutGeneratingDraft() {
        Fixture fixture = new Fixture(Scenario.limitedEvidence());

        SegmentExecutionResult result = fixture.start();

        assertCompletedAtEnd(fixture, result);
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(0, fixture.modelCalls.get());
        assertEquals(0, fixture.draftCalls.get());
        assertEquals(0, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(0, fixture.finalReviewRuns.get());
        assertEquals(ExplanationPublicationDecision.COMPLETE_LIMITED, fixture.decision.get());
        assertFalse(fixture.snapshot().state().data().containsKey(DRAFT_KEY));
        assertNoSensitivePublicState(fixture.snapshot());
    }

    @Test
    void rejectedValidationShouldNeverPublish() {
        Fixture fixture = new Fixture(Scenario.rejectedValidation());

        SegmentExecutionResult result = fixture.start();

        assertCompletedAtEnd(fixture, result);
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(1, fixture.modelCalls.get());
        assertEquals(1, fixture.draftCalls.get());
        assertEquals(1, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(0, fixture.finalReviewRuns.get());
        assertEquals(ExplanationPublicationDecision.WITHHOLD, fixture.decision.get());
        assertFalse(String.valueOf(fixture.snapshot().state().data().get(STATUS_KEY))
                .contains(ExplanationPublicationStatus.PUBLISHED.name()));
        assertNoSensitivePublicState(fixture.snapshot());
    }

    @Test
    void finalReviewInterruptDoesNotRepeatDraftOnPublicRecoveryAttempt() {
        Fixture fixture = new Fixture(Scenario.finalReview());

        SegmentExecutionResult interrupted = fixture.start();

        assertEquals(GraphRuntimeDisposition.INTERRUPTED, interrupted.disposition());
        assertEquals("finalClinicalReview", interrupted.publicNextNode());
        assertEquals(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME, interrupted.nextSegment());
        assertNotNull(interrupted.recoveryToken());
        assertFalse(interrupted.recoveryToken().threadId().isBlank());
        assertFalse(interrupted.recoveryToken().checkpointId().isBlank());
        assertEquals("finalClinicalReview", fixture.snapshot().next());
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(1, fixture.modelCalls.get());
        assertEquals(1, fixture.draftCalls.get());
        assertEquals(1, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(0, fixture.finalReviewRuns.get());

        assertThrows(GraphRuntimeExecutionException.class, () -> fixture.resume(interrupted.recoveryToken()));
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(1, fixture.modelCalls.get());
        assertEquals(1, fixture.draftCalls.get());
        assertEquals(1, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(1, fixture.finalReviewRuns.get());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("safetyAbstentionScenarios")
    void safetyAbstentionShouldNeverGenerateDiseaseExplanation(String name, PredictionExposureStatus exposureStatus) {
        Fixture fixture = new Fixture(Scenario.safetyAbstention(exposureStatus));

        SegmentExecutionResult result = fixture.start();

        assertCompletedAtEnd(fixture, result);
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(0, fixture.modelCalls.get());
        assertEquals(0, fixture.draftCalls.get());
        assertEquals(0, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(0, fixture.finalReviewRuns.get());
        assertEquals(ExplanationPublicationDecision.COMPLETE_LIMITED, fixture.decision.get());
        assertFalse(fixture.snapshot().state().data().containsKey(DRAFT_KEY));
        assertNoSensitivePublicState(fixture.snapshot());
    }

    @Test
    void technicalFailureShouldNotEnterExplanationOrHumanReview() {
        Fixture fixture = new Fixture(Scenario.technicalFailure());

        SegmentExecutionResult result = fixture.start();

        assertCompletedAtEnd(fixture, result);
        assertEquals(1, fixture.riskCalls.get());
        assertEquals(0, fixture.modelCalls.get());
        assertEquals(0, fixture.draftCalls.get());
        assertEquals(0, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(0, fixture.finalReviewRuns.get());
        assertEquals(ExplanationPublicationDecision.WITHHOLD, fixture.decision.get());
        assertFalse(fixture.snapshot().state().data().containsKey(DRAFT_KEY));
        assertNoSensitivePublicState(fixture.snapshot());
    }

    @Test
    void publishedDecisionWithoutValidatedDraftShouldFailClosed() {
        Fixture fixture = new Fixture(Scenario.illegalPublishedDecision());

        assertThrows(GraphRuntimeExecutionException.class, fixture::start);

        assertEquals(1, fixture.riskCalls.get());
        assertEquals(1, fixture.modelCalls.get());
        assertEquals(1, fixture.draftCalls.get());
        assertEquals(1, fixture.validationCalls.get());
        assertEquals(1, fixture.publicationCalls.get());
        assertEquals(ExplanationPublicationDecision.WITHHOLD, fixture.decision.get());
        assertEquals(0, fixture.finalReviewRuns.get());
    }

    private static Stream<Arguments> safetyAbstentionScenarios() {
        return Stream.of(
                Arguments.of("LOW_CONFIDENCE", PredictionExposureStatus.WITHHELD_BY_ABSTENTION),
                Arguments.of("OOD", PredictionExposureStatus.WITHHELD_BY_OOD),
                Arguments.of("MODEL_POLICY_REJECTED", PredictionExposureStatus.WITHHELD_BY_ABSTENTION));
    }

    private static void assertCompletedAtEnd(Fixture fixture, SegmentExecutionResult result) {
        assertEquals(GraphRuntimeDisposition.COMPLETED, result.disposition());
        assertEquals(StateGraph.END, result.publicNextNode());
        assertNull(result.nextSegment());
        assertNull(result.recoveryToken());
        assertEquals(StateGraph.END, fixture.snapshot().next());
    }

    private static void assertNoSensitivePublicState(StateSnapshot snapshot) {
        Set<String> forbidden = Set.of("patientQuestion", "hiddenTopK", "rawProbabilities", "chainOfThought", "hiddenReasoning", "internalReasoning");
        assertTrue(snapshot.state().data().keySet().stream().noneMatch(forbidden::contains));
    }

    private static final class Fixture {
        private final Scenario scenario;
        private final AtomicInteger riskCalls = new AtomicInteger();
        private final AtomicInteger modelCalls = new AtomicInteger();
        private final AtomicInteger draftCalls = new AtomicInteger();
        private final AtomicInteger validationCalls = new AtomicInteger();
        private final AtomicInteger publicationCalls = new AtomicInteger();
        private final AtomicInteger finalReviewRuns = new AtomicInteger();
        private final AtomicReference<ExplanationPublicationDecision> decision = new AtomicReference<>();
        private final AtomicReference<CompiledGraph> compiledGraph = new AtomicReference<>();
        private final RecordingMemorySaver saver = new RecordingMemorySaver();
        private final GraphDefinitionHasher hasher = new Sha256GraphDefinitionHasher();
        private final DiagnosisGraphDefinition definition = definition(hasher);
        private final GraphDefinitionBinding binding = new GraphDefinitionBinding(
                definition.definitionVersion(), definition.definitionHash(), definition.actionVersion());
        private final DefaultGraphSegmentRuntimeAdapter adapter;
        private final ExplanationDraft generatedDraft = new ExplanationDraft("summary",
                List.of(new ExplanationClaim("claim-1", ExplanationClaimType.GENERAL_DISEASE_INFORMATION,
                        "disease code: glaucoma", Set.of("citation-1"))), "notice", "model-v1", "prompt-v1", "policy-v1");
        private final List<DiagnosisCitationSnapshot> citations = List.of(new DiagnosisCitationSnapshot("wf", 0,
                "source", "revision", "chunk", "title", "quoted", "digest", Set.of("GLAUCOMA"), Set.of("DISEASE"),
                .9, "retrieval-v1", "catalog-v1"));
        private final PatientPredictionProjection prediction = new PatientPredictionProjection("GLAUCOMA", .8);

        private Fixture(Scenario scenario) {
            this.scenario = scenario;
            InMemoryGraphDefinitionRegistry manifests = new InMemoryGraphDefinitionRegistry(List.of(definition), hasher);
            adapter = new DefaultGraphSegmentRuntimeAdapter(manifests,
                    new InMemoryExecutableGraphDefinitionRegistry(manifests, List.of(executable())), () -> saver,
                    new ManifestGraphSegmentBoundaryResolver());
        }

        private SegmentExecutionResult start() {
            return adapter.execute(new StartGraphSegmentRequest("wf", 0, new LeasedJobFence("job-1", "worker", "token-1", 1, 1),
                    binding, SegmentCode.FINAL_RISK_EXPLANATION, 0, new EmptySegmentInput()));
        }

        private SegmentExecutionResult resume(GraphRecoveryToken token) {
            return adapter.execute(new ResumeGraphSegmentRequest("wf", 1, new LeasedJobFence("job-2", "worker", "token-2", 1, 1),
                    binding, SegmentCode.FINAL_CLINICAL_REVIEW_RESUME, 0, token, new EmptySegmentInput()));
        }

        private StateSnapshot snapshot() {
            String threadId = saver.lastThreadId.get();
            assertNotNull(threadId, "MemorySaver must receive the Graph checkpoint thread id");
            return compiledGraph.get().getState(RunnableConfig.builder().threadId(threadId).build());
        }

        private ExecutableDiagnosisGraphDefinition executable() {
            ClinicalRiskFinalAction riskAction = new ClinicalRiskFinalAction(new ClinicalRiskPolicy() {
                @Override public ClinicalRiskPrecheckResult precheck(ClinicalRiskPrecheckInput input) { throw new UnsupportedOperationException(); }
                @Override public ClinicalRiskFinalResult finalAssess(ClinicalRiskFinalInput input) {
                    return new ClinicalRiskFinalResult(scenario.riskDisposition(), "synthetic-policy-v1");
                }
                @Override public String policyVersion() { return "synthetic-policy-v1"; }
            });
            ExplanationDraftAction draftAction = new ExplanationDraftAction(coordinator());
            ExplanationClaimValidationAction validationAction = new ExplanationClaimValidationAction(configuredValidator());
            ExplanationPublicationDecisionAction publicationAction = new ExplanationPublicationDecisionAction(new ExplanationPublicationGuard());

            return new ExecutableDiagnosisGraphDefinition() {
                @Override public GraphDefinitionBinding binding() { return Fixture.this.binding; }

                @Override public CompiledGraph compile(BaseCheckpointSaver checkpointSaver) throws Exception {
                    CompiledGraph graph = new StateGraph(KeyStrategy.builder()
                            .addStrategy(DefaultGraphSegmentRuntimeAdapter.BUSINESS_COMMIT_PLAN_KEY).build())
                            .addNode("clinicalRiskFinal", state -> {
                                riskCalls.incrementAndGet();
                                ClinicalRiskFinalResult result = riskAction.execute(scenario.riskInput());
                                return CompletableFuture.completedFuture(Map.of(RISK_KEY, result,
                                        DefaultGraphSegmentRuntimeAdapter.BUSINESS_COMMIT_PLAN_KEY, plan()));
                            })
                            .addNode("explanationDraft", state -> {
                                draftCalls.incrementAndGet();
                                ExplanationGenerationOutcome outcome = draftAction.execute(
                                        state.value(RISK_KEY, ClinicalRiskFinalResult.class).orElseThrow(), draftRequest(), "segment-d", "draft-v1");
                                if (outcome.status() == ExplanationGenerationOutcome.Status.WITHHELD) {
                                    throw new IllegalStateException("eligible explanation draft unexpectedly withheld");
                                }
                                return CompletableFuture.completedFuture(Map.of(DRAFT_KEY, generatedDraft,
                                        STATUS_KEY, ExplanationPublicationStatus.DRAFT));
                            })
                            .addNode("explanationClaimValidation", state -> {
                                validationCalls.incrementAndGet();
                                ExplanationClaimValidationResult validation = validationAction.execute(
                                        state.value(DRAFT_KEY, ExplanationDraft.class).orElseThrow(), citations, prediction);
                                return CompletableFuture.completedFuture(Map.of(VALIDATION_KEY, validation,
                                        STATUS_KEY, validation.status() == ExplanationValidationStatus.VALIDATED
                                                ? ExplanationPublicationStatus.VALIDATED : ExplanationPublicationStatus.REJECTED));
                            })
                            .addNode("explanationPublicationDecision", state -> {
                                publicationCalls.incrementAndGet();
                                ClinicalRiskFinalResult risk = state.value(RISK_KEY, ClinicalRiskFinalResult.class).orElseThrow();
                                ExplanationClaimValidationResult validation = state.value(VALIDATION_KEY, ExplanationClaimValidationResult.class)
                                        .orElse(new ExplanationClaimValidationResult(ExplanationValidationStatus.WITHHELD, List.of(), "not-run"));
                                ExplanationPublicationStatus status = state.value(STATUS_KEY, ExplanationPublicationStatus.class)
                                        .orElse(ExplanationPublicationStatus.NONE);
                                ExplanationPublicationDecision outcome = publicationAction.execute(risk, status, validation,
                                        scenario.evidenceSufficiency().sufficient());
                                decision.set(outcome);
                                if (scenario.requestedPublication() == ExplanationPublicationDecision.PUBLISH
                                        && outcome != ExplanationPublicationDecision.PUBLISH) {
                                    throw new IllegalStateException("publication guard rejected an unvalidated publish request");
                                }
                                return CompletableFuture.completedFuture(Map.of(DECISION_KEY, outcome,
                                        STATUS_KEY, outcome == ExplanationPublicationDecision.PUBLISH
                                                ? ExplanationPublicationStatus.PUBLISHED : status));
                            })
                            .addNode("finalClinicalReview", state -> {
                                finalReviewRuns.incrementAndGet();
                                return CompletableFuture.failedFuture(new UnsupportedOperationException(
                                        "Segment E doctor decision is deliberately outside PR-08B"));
                            })
                            .addEdge(StateGraph.START, "clinicalRiskFinal")
                            .addConditionalEdges("clinicalRiskFinal", state -> CompletableFuture.completedFuture(
                                    state.value(RISK_KEY, ClinicalRiskFinalResult.class).orElseThrow().disposition().name()),
                                    Map.of(PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE.name(), "explanationDraft",
                                            PublicationRiskDisposition.FINAL_REVIEW_REQUIRED.name(), "explanationDraft",
                                            PublicationRiskDisposition.LIMITED_EVIDENCE.name(), "explanationPublicationDecision",
                                            PublicationRiskDisposition.WITHHOLD_UNSAFE.name(), "explanationPublicationDecision"))
                            .addEdge("explanationDraft", "explanationClaimValidation")
                            .addEdge("explanationClaimValidation", "explanationPublicationDecision")
                            .addConditionalEdges("explanationPublicationDecision", state -> CompletableFuture.completedFuture(
                                    state.value(DECISION_KEY, ExplanationPublicationDecision.class).orElseThrow().name()),
                                    Map.of(ExplanationPublicationDecision.PUBLISH.name(), StateGraph.END,
                                            ExplanationPublicationDecision.COMPLETE_LIMITED.name(), StateGraph.END,
                                            ExplanationPublicationDecision.WITHHOLD.name(), StateGraph.END,
                                            ExplanationPublicationDecision.FINAL_REVIEW_REQUIRED.name(), "finalClinicalReview"))
                            .addEdge("finalClinicalReview", StateGraph.END)
                            .compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(checkpointSaver).build())
                                    .interruptBefore("finalClinicalReview").build());
                    compiledGraph.set(graph);
                    return graph;
                }
            };
        }

        private ExplanationInvocationCoordinator coordinator() {
            ExplanationSnapshotRepository snapshots = mock(ExplanationSnapshotRepository.class);
            NodeExecutionRepository executions = mock(NodeExecutionRepository.class);
            when(snapshots.findByWorkflowIdAndRevision("wf", 1)).thenReturn(Optional.empty());
            when(executions.findByIdempotencyKey(any())).thenReturn(Optional.empty());
            when(executions.insertIfAbsent(any())).thenReturn(1);
            when(snapshots.insert(any(ExplanationSnapshotEntity.class))).thenReturn(1);
            when(executions.complete(any(WorkflowNodeExecutionEntity.class))).thenReturn(1);
            ExplanationModelClient model = ignored -> {
                modelCalls.incrementAndGet();
                return new ExplanationModelResult(generatedDraft);
            };
            return new ExplanationInvocationCoordinator(snapshots, executions, model, new ObjectMapper());
        }

        private ExplanationClaimValidator configuredValidator() {
            return (draft, acceptedCitations, patientPrediction) -> scenario.validation();
        }

        private ExplanationDraftRequest draftRequest() {
            return new ExplanationDraftRequest("wf", 0, 1, prediction, citations, Scenario.SUFFICIENT_EVIDENCE, "policy-v1", "prompt-v1");
        }

        private SegmentBusinessCommitPlan plan() {
            return new SegmentBusinessCommitPlan(WorkflowStatus.RUNNING, SegmentCode.FINAL_RISK_EXPLANATION,
                    ExplanationPublicationStatus.NONE, scenario.exposureStatus(), null, null, new NoBusinessDelta(),
                    new WorkflowEventDraft("SEGMENT_D", "SYSTEM", "test", null, null));
        }
    }

    private static final class RecordingMemorySaver extends MemorySaver {
        private final AtomicReference<String> lastThreadId = new AtomicReference<>();

        @Override
        protected void insertedCheckpoint(RunnableConfig config, LinkedList<Checkpoint> checkpoints, Checkpoint checkpoint) throws Exception {
            super.insertedCheckpoint(config, checkpoints, checkpoint);
            lastThreadId.set(config.threadId().orElseThrow());
        }
    }

    private record Scenario(InferenceOutcomeType outcomeType, PredictionExposureStatus exposureStatus,
                            PublicationRiskDisposition riskDisposition, EvidenceSufficiency evidenceSufficiency,
                            ExplanationClaimValidationResult validation, ExplanationPublicationDecision requestedPublication) {
        private static final EvidenceSufficiency SUFFICIENT_EVIDENCE = new EvidenceSufficiency(1, Set.of("GLAUCOMA"), Set.of("DISEASE"),
                true, EvidenceSufficiencyReasonCode.SUFFICIENT);
        private static final EvidenceSufficiency INSUFFICIENT_EVIDENCE = new EvidenceSufficiency(0, Set.of(), Set.of(),
                false, EvidenceSufficiencyReasonCode.REWRITE_EXHAUSTED);
        private static final ExplanationClaimValidationResult VALIDATED = new ExplanationClaimValidationResult(
                ExplanationValidationStatus.VALIDATED, List.of(), "validator-v1");
        private static final ExplanationClaimValidationResult REJECTED = new ExplanationClaimValidationResult(
                ExplanationValidationStatus.REJECTED, List.of(), "validator-v1");

        private static Scenario autoPublication() {
            return new Scenario(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE,
                    PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, SUFFICIENT_EVIDENCE, VALIDATED, null);
        }

        private static Scenario limitedEvidence() {
            return new Scenario(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE,
                    PublicationRiskDisposition.LIMITED_EVIDENCE, INSUFFICIENT_EVIDENCE, VALIDATED, null);
        }

        private static Scenario rejectedValidation() {
            return new Scenario(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE,
                    PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, SUFFICIENT_EVIDENCE, REJECTED, null);
        }

        private static Scenario finalReview() {
            return new Scenario(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE,
                    PublicationRiskDisposition.FINAL_REVIEW_REQUIRED, SUFFICIENT_EVIDENCE, VALIDATED, null);
        }

        private static Scenario safetyAbstention(PredictionExposureStatus exposureStatus) {
            return new Scenario(InferenceOutcomeType.SAFETY_ABSTENTION, exposureStatus,
                    PublicationRiskDisposition.LIMITED_EVIDENCE, INSUFFICIENT_EVIDENCE, VALIDATED, null);
        }

        private static Scenario technicalFailure() {
            return new Scenario(InferenceOutcomeType.TECHNICAL_FAILURE, PredictionExposureStatus.NOT_AVAILABLE,
                    PublicationRiskDisposition.WITHHOLD_UNSAFE, INSUFFICIENT_EVIDENCE, VALIDATED, null);
        }

        private static Scenario illegalPublishedDecision() {
            return new Scenario(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE,
                    PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, SUFFICIENT_EVIDENCE, REJECTED,
                    ExplanationPublicationDecision.PUBLISH);
        }

        private ClinicalRiskFinalInput riskInput() {
            return new ClinicalRiskFinalInput(outcomeType, exposureStatus, ImageQualityDecision.PASS, evidenceSufficiency, true, false);
        }
    }

    private static DiagnosisGraphDefinition definition(GraphDefinitionHasher hasher) {
        return DiagnosisGraphDefinitionFactory.create(new GraphDefinitionManifest("segment-d", "segment-d-v1", "actions-v1",
                List.of(new GraphNodeSpec("START", "BOUNDARY"), new GraphNodeSpec("clinicalRiskFinal", "ACTION"),
                        new GraphNodeSpec("explanationDraft", "ACTION"), new GraphNodeSpec("explanationClaimValidation", "ACTION"),
                        new GraphNodeSpec("explanationPublicationDecision", "ACTION"), new GraphNodeSpec("finalClinicalReview", "HUMAN_REVIEW"),
                        new GraphNodeSpec("END", "BOUNDARY")),
                List.of(new GraphEdgeSpec("START", "clinicalRiskFinal"), new GraphEdgeSpec("explanationDraft", "explanationClaimValidation"),
                        new GraphEdgeSpec("explanationClaimValidation", "explanationPublicationDecision"),
                        new GraphEdgeSpec("finalClinicalReview", "END")),
                List.of(new GraphConditionalEdgeSpec("clinicalRiskFinal", PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE.name(), "explanationDraft"),
                        new GraphConditionalEdgeSpec("clinicalRiskFinal", PublicationRiskDisposition.FINAL_REVIEW_REQUIRED.name(), "explanationDraft"),
                        new GraphConditionalEdgeSpec("clinicalRiskFinal", PublicationRiskDisposition.LIMITED_EVIDENCE.name(), "explanationPublicationDecision"),
                        new GraphConditionalEdgeSpec("clinicalRiskFinal", PublicationRiskDisposition.WITHHOLD_UNSAFE.name(), "explanationPublicationDecision"),
                        new GraphConditionalEdgeSpec("explanationPublicationDecision", ExplanationPublicationDecision.PUBLISH.name(), "END"),
                        new GraphConditionalEdgeSpec("explanationPublicationDecision", ExplanationPublicationDecision.COMPLETE_LIMITED.name(), "END"),
                        new GraphConditionalEdgeSpec("explanationPublicationDecision", ExplanationPublicationDecision.WITHHOLD.name(), "END"),
                        new GraphConditionalEdgeSpec("explanationPublicationDecision", ExplanationPublicationDecision.FINAL_REVIEW_REQUIRED.name(), "finalClinicalReview")),
                List.of(new GraphSegmentSpec(SegmentCode.FINAL_RISK_EXPLANATION, "START", "finalClinicalReview"),
                        new GraphSegmentSpec(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME, "finalClinicalReview", "END")),
                List.of("finalClinicalReview"), List.of()), hasher);
    }
}
