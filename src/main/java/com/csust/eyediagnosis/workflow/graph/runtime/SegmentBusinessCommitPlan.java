package com.csust.eyediagnosis.workflow.graph.runtime;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.domain.PredictionExposureStatus;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;

public record SegmentBusinessCommitPlan(WorkflowStatus targetWorkflowStatus, SegmentCode persistedCurrentSegment,
                                        ExplanationPublicationStatus publicationStatus,
                                        PredictionExposureStatus exposureStatus, String stopReasonCode,
                                        String limitationReasonCode, SegmentBusinessDelta businessDelta,
                                        WorkflowEventDraft event) {
    public SegmentBusinessCommitPlan {
        if (targetWorkflowStatus == null || persistedCurrentSegment == null || publicationStatus == null
                || exposureStatus == null || businessDelta == null || event == null) {
            throw new IllegalArgumentException("segment business commit plan must be complete");
        }
    }
}
