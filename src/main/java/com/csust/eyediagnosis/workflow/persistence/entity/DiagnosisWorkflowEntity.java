package com.csust.eyediagnosis.workflow.persistence.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

@Data @TableName("t_diagnosis_workflow")
public class DiagnosisWorkflowEntity {
    @TableId(type = IdType.INPUT) private String workflowId;
    private Long ownerUserId; private String creationIdempotencyKey; private String status; private String currentSegmentCode;
    private String graphDefinitionVersion; private String graphDefinitionHash; private String actionVersion;
    private Long workflowVersion; private Long inferenceEpoch; private String inferenceEnvelopeId;
    private String explanationPublicationStatus; private String predictionExposureStatus; private String stopReasonCode;
    private String limitationReasonCode; private String questionText; private LocalDateTime createdAt; private LocalDateTime updatedAt;
}
