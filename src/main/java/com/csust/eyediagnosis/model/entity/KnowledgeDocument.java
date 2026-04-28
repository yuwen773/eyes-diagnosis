package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_knowledge_document")
public class KnowledgeDocument {
    @TableId(type = IdType.AUTO)
    private Long id;
    @TableField("userId")
    private Long userId;
    @TableField("title")
    private String title;
    @TableField("fileName")
    private String fileName;
    @TableField("fileUrl")
    private String fileUrl;
    @TableField("fileSize")
    private Long fileSize;
    @TableField("fileType")
    private String fileType;
    @TableField("contentHash")
    private String contentHash;
    @TableField("chunkCount")
    private Integer chunkCount;
    @TableField("status")
    private Integer status; // 0=处理中, 1=已完成, 2=失败
    @TableField("createTime")
    private LocalDateTime createTime;
    @TableField("updateTime")
    private LocalDateTime updateTime;
    @TableLogic
    @TableField("isDelete")
    private Integer isDelete;
}
