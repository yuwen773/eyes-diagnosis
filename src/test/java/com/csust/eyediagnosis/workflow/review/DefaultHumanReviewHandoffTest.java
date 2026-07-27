package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.HumanReviewTaskRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class DefaultHumanReviewHandoffTest {
    private final HumanReviewTaskRepository repository = mock(HumanReviewTaskRepository.class);
    private final DefaultHumanReviewHandoff handoff = new DefaultHumanReviewHandoff(repository);

    @Test
    void mapsOnlyHumanBoundarySegmentsToReviewTypes() {
        assertEquals(Optional.of(ReviewType.IMAGE_QUALITY_GATE), HumanReviewHandoff.reviewTypeFor(SegmentCode.QUALITY_REVIEW_RESUME));
        assertEquals(Optional.of(ReviewType.FINAL_CLINICAL_REVIEW), HumanReviewHandoff.reviewTypeFor(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME));
        assertEquals(Optional.empty(), HumanReviewHandoff.reviewTypeFor(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION));
        assertEquals(Optional.empty(), HumanReviewHandoff.reviewTypeFor(SegmentCode.INTAKE_INFERENCE_QUALITY));
    }

    @Test
    void firstHandoffOpensRoundOneWithTheRecoveryToken() {
        when(repository.findActiveByWorkflowAndType("wf", "FINAL_CLINICAL_REVIEW")).thenReturn(Optional.empty());
        when(repository.insert(any(HumanReviewTaskEntity.class))).thenReturn(1);

        String taskId = handoff.createHandoffTask("wf", ReviewType.FINAL_CLINICAL_REVIEW, new GraphRecoveryToken("thread", "checkpoint"));

        ArgumentCaptor<HumanReviewTaskEntity> captor = ArgumentCaptor.forClass(HumanReviewTaskEntity.class);
        verify(repository).insert(captor.capture());
        HumanReviewTaskEntity task = captor.getValue();
        assertEquals(taskId, task.getReviewTaskId());
        assertEquals("wf", task.getWorkflowId());
        assertEquals("FINAL_CLINICAL_REVIEW", task.getReviewType());
        assertEquals(1, task.getReviewRound());
        assertEquals("OPEN", task.getStatus());
        assertEquals(0L, task.getTaskVersion());
        assertEquals("thread", task.getGraphThreadId());
        assertEquals("checkpoint", task.getGraphCheckpointId());
    }

    @Test
    void activeTaskOfTheSameTypeBlocksASecondHandoff() {
        HumanReviewTaskEntity open = new HumanReviewTaskEntity();
        open.setReviewRound(1);
        open.setStatus("OPEN");
        when(repository.findActiveByWorkflowAndType("wf", "IMAGE_QUALITY_GATE")).thenReturn(Optional.of(open));

        assertThrows(ReviewTaskConflictException.class, () -> handoff.createHandoffTask("wf",
                ReviewType.IMAGE_QUALITY_GATE, new GraphRecoveryToken("thread", "checkpoint")));
        verify(repository, never()).insert(any());
    }

    @Test
    void resubmittedWorkflowOpensTheNextReviewRound() {
        HumanReviewTaskEntity submitted = new HumanReviewTaskEntity();
        submitted.setReviewRound(2);
        submitted.setStatus("SUBMITTED");
        when(repository.findActiveByWorkflowAndType(anyString(), anyString())).thenReturn(Optional.of(submitted));
        when(repository.insert(any(HumanReviewTaskEntity.class))).thenReturn(1);

        handoff.createHandoffTask("wf", ReviewType.IMAGE_QUALITY_GATE, new GraphRecoveryToken("t2", "c2"));

        ArgumentCaptor<HumanReviewTaskEntity> captor = ArgumentCaptor.forClass(HumanReviewTaskEntity.class);
        verify(repository).insert(captor.capture());
        assertEquals(3, captor.getValue().getReviewRound());
    }
}
