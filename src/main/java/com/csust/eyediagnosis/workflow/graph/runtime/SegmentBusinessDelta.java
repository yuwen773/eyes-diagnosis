package com.csust.eyediagnosis.workflow.graph.runtime;

public sealed interface SegmentBusinessDelta permits NoBusinessDelta, InferenceEnvelopeDelta, EvidenceCitationDelta, ExplanationSnapshotDelta {
}
