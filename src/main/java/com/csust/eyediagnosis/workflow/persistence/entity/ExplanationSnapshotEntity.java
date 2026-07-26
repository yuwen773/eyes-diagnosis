package com.csust.eyediagnosis.workflow.persistence.entity;
import com.baomidou.mybatisplus.annotation.*; import lombok.Data; import java.time.LocalDateTime;
@Data @TableName("t_explanation_snapshot") public class ExplanationSnapshotEntity {
 @TableId(type=IdType.INPUT) private String explanationSnapshotId; private String workflowId; private Long revision; private String publicationStatus; private String contentSnapshot; private String claimValidationResult; private String citationSetDigest; private String limitationTextCode; private String withheldReasonCode; private LocalDateTime createdAt; private LocalDateTime validatedAt; private LocalDateTime publishedAt;
}
