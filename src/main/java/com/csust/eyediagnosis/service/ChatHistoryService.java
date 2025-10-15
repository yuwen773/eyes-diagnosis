package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.model.dto.chat.ChatHistoryQueryRequest;
import com.csust.eyediagnosis.model.entity.ChatHistory;
import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.entity.User;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;

import java.time.LocalDateTime;

/**
* @ author 钰玟
* @ description 针对表【t_chat_history(对话历史)】的数据库操作Service
* @ createDate 2025-09-19 19:43:01
*/
public interface ChatHistoryService extends IService<ChatHistory> {
    /**
     * 添加聊天消息
     * @param sessionId 会话id
     * @param message 消息内容
     * @param messageType 消息类型
     * @param userId 用户id
     * @return 是否添加成功
     */
    boolean addChatMessage(Long sessionId, String message, String messageType, Long userId);
    /**
     * 根据会话ID删除对话记录
     * @param sessionId 会话ID
     * @return 是否删除成功
     */
    boolean deleteByAppId(Long sessionId);
    /**
     * 获取查询包装类
     *
     * @param chatHistoryQueryRequest 包装类
     * @return 查询包装类
     */
    QueryWrapper<ChatHistory> getQueryWrapper(ChatHistoryQueryRequest chatHistoryQueryRequest);

    Page<ChatHistory> listAppChatHistoryByPage(Long sessionId, int pageSize,
                                               LocalDateTime lastCreateTime,
                                               User loginUser);

    int loadChatHistoryToMemory(Long sessionId, MessageWindowChatMemory chatMemory, int maxCount);
}
