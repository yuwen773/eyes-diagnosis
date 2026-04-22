package com.csust.eyediagnosis.model.dto.agent;

import lombok.AllArgsConstructor;
import lombok.Data;
import java.util.List;

@Data
@AllArgsConstructor
public class ChatHistoryVO {
    private List<MessageVO> messages;
    private boolean hasMore;
    private Long nextCursor;
}