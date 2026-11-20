package com.csust.eyediagnosis.model.dto.agent;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Date;
import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MessageVO {
    private String finishReason;
    private Long id;
    private String role;
    private String subType;
    private String content;
    private boolean isSummary;
    private Date createdTime;
    private List<String> images;

    public MessageVO(Long id, String role, String subType, String content, boolean isSummary, Date createdTime) {
        this(null, id, role, subType, content, isSummary, createdTime, null);
    }
}
