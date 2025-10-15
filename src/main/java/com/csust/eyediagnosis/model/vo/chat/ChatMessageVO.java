package com.csust.eyediagnosis.model.vo.chat;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * @ClassNameChatMessage
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/25 下午6:27
 * @Version 1.0
 **/
@Data
public class ChatMessageVO implements Serializable {
    /**
     * 消息id
     */
    private String id;
    /**
     * 消息内容
     */
    private String content;
    /**
     * 是否为 用户
     */
    private Boolean isUser;
    /**
     * 当前时间
     */
    private Date timestamp;
}
