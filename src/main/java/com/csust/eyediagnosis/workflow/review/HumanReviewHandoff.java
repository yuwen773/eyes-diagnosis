package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;

import java.util.Optional;

/** Creates the review task row when a segment commit stops at a human boundary. */
public interface HumanReviewHandoff {
    /** Maps a resume segment to the human review type guarding it, if any. */
    static Optional<ReviewType> reviewTypeFor(SegmentCode nextSegment) {
        if (nextSegment == SegmentCode.QUALITY_REVIEW_RESUME) {
            return Optional.of(ReviewType.IMAGE_QUALITY_GATE);
        }
        if (nextSegment == SegmentCode.FINAL_CLINICAL_REVIEW_RESUME) {
            return Optional.of(ReviewType.FINAL_CLINICAL_REVIEW);
        }
        return Optional.empty();
    }

    /** Maps a review type back to the segment that resumes the graph after its decision. */
    static SegmentCode resumeSegmentFor(ReviewType reviewType) {
        return switch (reviewType) {
            case IMAGE_QUALITY_GATE -> SegmentCode.QUALITY_REVIEW_RESUME;
            case FINAL_CLINICAL_REVIEW -> SegmentCode.FINAL_CLINICAL_REVIEW_RESUME;
        };
    }

    /** Inserts one OPEN task for the next review round; returns its reviewTaskId. */
    String createHandoffTask(String workflowId, ReviewType reviewType, GraphRecoveryToken recoveryToken);
}
