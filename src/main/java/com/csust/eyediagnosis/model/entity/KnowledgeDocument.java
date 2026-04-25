package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_knowledge_document")
public class KnowledgeDocument {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String title;
    private String fileName;
    private String fileUrl;
    private Long fileSize;
    private String fileType;
    private String contentHash;
    private Integer chunkCount;
    private Integer status; // 0=处理中, 1=已完成, 2=失败
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    @TableLogic
    private Integer isDelete;
}
