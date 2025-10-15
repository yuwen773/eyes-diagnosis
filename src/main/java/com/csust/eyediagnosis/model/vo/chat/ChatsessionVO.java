package com.csust.eyediagnosis.model.vo.chat;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * @ClassNameChatMessage
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/25 下午6:27
 * @Version 1.0
 **/
@Data
public class ChatsessionVO implements Serializable {
    /**
     * 会话id
     */
    private String id;
    /**
     * 会话标题
     */
    private String title;
    /**
     * 消息内容(json 数组)
     */
    private List<String> messages;
    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 修改时间
     */
    private Date updateTime;

    private static final long serialVersionUID = 1L;
}
