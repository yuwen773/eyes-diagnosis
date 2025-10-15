package com.csust.eyediagnosis.model.dto.chat;

import lombok.Data;

import java.io.Serial;
import java.io.Serializable;

@Data
public class ChatSessionAddRequest implements Serializable {

    /**
     * 应用初始化的 prompt
     */
    private String initPrompt;
    @Serial
    private static final long serialVersionUID = 1L;
}
