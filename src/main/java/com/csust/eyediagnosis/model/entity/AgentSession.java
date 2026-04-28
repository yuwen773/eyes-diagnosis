package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.util.Date;

@Data
@TableName("t_agent_session")
public class AgentSession {
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;
    private String sessionId;
    private Long userId;
    private String title;
    private String modelName;
    private Integer status;
    private String lastMessage;
    private Integer messageCount;
    private String summaryContent;
    private Date summaryAt;
    private byte[] checkpointData;
    private Date createdTime;
    private Date updatedTime;
    private Date expiredTime;
    @TableLogic
    private Integer isDelete;
    private Integer pinned;  // 默认 0，是否置顶
    private Date pinTime;    // 置顶时间
}