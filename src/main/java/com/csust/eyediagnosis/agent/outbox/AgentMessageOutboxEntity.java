package com.csust.eyediagnosis.agent.outbox;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_agent_message_outbox")
public class AgentMessageOutboxEntity {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private String sessionId;

    private Long userId;

    private String role;

    private String subType;

    private String content;

    private Integer status;

    private Integer retryCount;

    private String lastError;

    private Date createdTime;

    private Date deliveredTime;
}
