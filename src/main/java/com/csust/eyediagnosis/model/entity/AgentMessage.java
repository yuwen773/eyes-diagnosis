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
    /** 回答侧行所属的用户消息 id（旧数据为 null）。 */
    private Long replyToId;
    /** 同一次生成产生的一组行共用（旧数据为 null）。 */
    private String variantId;
    /** 仅用户行使用：当前显示哪一份回答（null 表示旧数据，只有一份）。 */
    private String selectedVariantId;
}