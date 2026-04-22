package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.io.Serializable;
import java.util.Date;

@Data
@TableName("t_agent_message")
public class AgentMessage implements Serializable {
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private String sessionId;
    private String role;
    private String subType;
    private String content;
    private Integer tokenCount;
    private Integer isSummary;
    private Date createdTime;
}