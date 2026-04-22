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
}