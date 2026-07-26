package com.csust.eyediagnosis.workflow.persistence.entity;
import com.baomidou.mybatisplus.annotation.*; import lombok.Data; import java.time.LocalDateTime;
@Data @TableName("t_diagnosis_citation") public class DiagnosisCitationEntity {
 @TableId(type=IdType.INPUT) private String citationId; private String workflowId; private Long retrievalEpoch; private String sourceDocumentId; private String sourceRevision; private String visibilitySnapshot; private String reviewStatusSnapshot; private String diseaseCodesSnapshot; private String topicCodesSnapshot; private String quotedSpan; private String quotedSpanDigest; private LocalDateTime retrievedAt; private LocalDateTime withdrawnAt; private LocalDateTime createdAt;
}
