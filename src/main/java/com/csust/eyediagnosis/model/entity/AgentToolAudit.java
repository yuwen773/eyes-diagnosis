package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.io.Serializable;
import java.util.Date;

/**
 * Structured, owner-scoped audit row for one tool-call state transition.
 * Deliberately separate from {@link AgentMessage}: history is user-visible,
 * this table is a security audit record. No raw arguments / prompts here.
 */
@Data
@TableName("t_agent_tool_audit")
public class AgentToolAudit implements Serializable {
    @TableId(type = IdType.AUTO)
    private Long auditId;
    private String sessionId;
    private Long userId;
    private String toolCallId;
    private String toolName;
    private String toolStatus;
    private String errorCategory;
    private String argsDigest;
    private String argsKeyNames;
    private Date startedAt;
    private Date finishedAt;
}
