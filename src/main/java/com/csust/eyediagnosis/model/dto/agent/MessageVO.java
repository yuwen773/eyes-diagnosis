package com.csust.eyediagnosis.model.dto.agent;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Date;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MessageVO {
    private Long id;
    private String role;
    private String subType;
    private String content;
    private boolean isSummary;
    private Date createdTime;
}