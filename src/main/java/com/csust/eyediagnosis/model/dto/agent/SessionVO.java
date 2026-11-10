package com.csust.eyediagnosis.model.dto.agent;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Date;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SessionVO {
    private String sessionId;
    private String title;
    private String lastMessage;
    private Integer messageCount;
    private String summaryContent;
    private Date createdTime;
    private Date updatedTime;
    /**
     * 是否置顶。实体是 0/1 的 tinyint，这里对前端统一成布尔：
     * 前端按它划分「置顶」分组、并决定菜单显示「置顶」还是「取消置顶」，
     * 字段缺失会让置顶的会话落回日期分组且无法取消。
     */
    private Boolean isPinned;
}