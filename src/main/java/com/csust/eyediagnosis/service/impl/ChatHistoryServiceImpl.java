package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.model.dto.chat.ChatHistoryQueryRequest;
import com.csust.eyediagnosis.model.entity.ChatHistory;
import com.csust.eyediagnosis.model.entity.Chatsession;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.enums.ChatHistoryMessageTypeEnum;
import com.csust.eyediagnosis.service.ChatHistoryService;
import com.csust.eyediagnosis.mapper.ChatHistoryMapper;
import com.csust.eyediagnosis.service.ChatsessionService;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

import static com.csust.eyediagnosis.constant.OrderConstant.ASC;

/**
* @author 钰玟
* @description 针对表【t_chat_history(对话历史)】的数据库操作Service实现
* @createDate 2025-09-19 19:43:01
*/
@Service
@Slf4j
public class ChatHistoryServiceImpl extends ServiceImpl<ChatHistoryMapper, ChatHistory>
    implements ChatHistoryService{

    @Resource
    @Lazy
    private ChatsessionService chatsessionService;

    /**
     * 添加聊天消息
     * @param sessionId 会话id
     * @param message 消息内容
     * @param messageType 消息类型
     * @param userId 用户id
     * @return 是否添加成功
     */
    @Override
    public boolean addChatMessage(Long sessionId, String message, String messageType, Long userId) {
        ThrowUtils.throwIf(sessionId == null || sessionId <= 0, ErrorCode.PARAMS_ERROR, "会话ID不能为空");
        ThrowUtils.throwIf(StrUtil.isBlank(message), ErrorCode.PARAMS_ERROR, "消息内容不能为空");
        ThrowUtils.throwIf(StrUtil.isBlank(messageType), ErrorCode.PARAMS_ERROR, "消息类型不能为空");
        ThrowUtils.throwIf(userId == null || userId <= 0, ErrorCode.PARAMS_ERROR, "用户ID不能为空");
        // 验证消息类型是否有效
        ChatHistoryMessageTypeEnum messageTypeEnum = ChatHistoryMessageTypeEnum.getEnumByValue(messageType);
        ThrowUtils.throwIf(messageTypeEnum == null, ErrorCode.PARAMS_ERROR, "不支持的消息类型: " + messageType);
        ChatHistory chatHistory = ChatHistory.builder()
                .sessionId(sessionId)
                .message(message)
                .messageType(messageType)
                .userId(userId)
                .build();
        return this.save(chatHistory);
    }


    /**
     * 根据会话ID删除对话记录
     * @param sessionId 会话ID
     * @return 是否删除成功
     */
    @Override
    public boolean deleteByAppId(Long sessionId) {
        ThrowUtils.throwIf(sessionId == null || sessionId <= 0, ErrorCode.PARAMS_ERROR, "应用ID不能为空");
        QueryWrapper<ChatHistory> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("sessionId", sessionId);
        return this.remove(queryWrapper);
    }
    /**
     * 获取查询包装类
     *
     * @param chatHistoryQueryRequest 包装类
     * @return 查询包装类
     */
    @Override
    public QueryWrapper<ChatHistory> getQueryWrapper(ChatHistoryQueryRequest chatHistoryQueryRequest) {
        QueryWrapper<ChatHistory> queryWrapper = new QueryWrapper<>();
        if (chatHistoryQueryRequest == null) {
            return queryWrapper;
        }
        Long id = chatHistoryQueryRequest.getId();
        String message = chatHistoryQueryRequest.getMessage();
        String messageType = chatHistoryQueryRequest.getMessageType();
        Long sessionId = chatHistoryQueryRequest.getSessionId();
        Long userId = chatHistoryQueryRequest.getUserId();
        LocalDateTime lastCreateTime = chatHistoryQueryRequest.getLastCreateTime();
        String sortField = chatHistoryQueryRequest.getSortField();
        String sortOrder = chatHistoryQueryRequest.getSortOrder();
        // 拼接查询条件
        queryWrapper.eq(ObjUtil.isNotNull(id),"id", id)
                .like(StrUtil.isNotBlank(message),"message", message)
                .eq(StrUtil.isNotBlank(messageType),"messageType", messageType)
                .eq(ObjUtil.isNotNull(sessionId),"sessionId", sessionId)
                .eq(ObjUtil.isNotNull(userId),"userId", userId);
        // 游标查询逻辑 - 只使用 createTime 作为游标
        if (lastCreateTime != null) {
            queryWrapper.lt("createTime", lastCreateTime);
        }
        // 排序
        if (StrUtil.isNotBlank(sortField)) {
            queryWrapper.orderBy(StrUtil.isNotBlank(sortField), ASC.equals(sortOrder), sortField);
        } else {
            // 默认按创建时间降序排列
            queryWrapper.orderBy(true, false,"createTime");
        }
        return queryWrapper;
    }

    /**
     *  游标查询 获取分页对话记录
     * @param sessionId 会话ID
     * @param pageSize 页面大小
     * @param lastCreateTime 上次创建时间
     * @param loginUser 登录用户
     * @return 分页对话记录
     */
    @Override
    public Page<ChatHistory> listAppChatHistoryByPage(Long sessionId, int pageSize,
                                                      LocalDateTime lastCreateTime,
                                                      User loginUser) {
        ThrowUtils.throwIf(sessionId == null || sessionId <= 0, ErrorCode.PARAMS_ERROR, "会话ID不能为空");
        ThrowUtils.throwIf(pageSize <= 0 || pageSize > 50, ErrorCode.PARAMS_ERROR, "页面大小必须在1-50之间");
        ThrowUtils.throwIf(loginUser == null, ErrorCode.NOT_LOGIN_ERROR);
        // 验证权限：只有应用创建者和管理员可以查看
        Chatsession chatsession = chatsessionService.getById(sessionId);
        ThrowUtils.throwIf(chatsession == null, ErrorCode.NOT_FOUND_ERROR, "会话不存在");
        boolean isAdmin = AuthConstant.ADMIN_ROLE.equals(loginUser.getUserRole());
        boolean isCreator = chatsession.getUserId().equals(loginUser.getId());
        ThrowUtils.throwIf(!isAdmin && !isCreator, ErrorCode.NO_AUTH_ERROR, "无权查看该应用的对话历史");
        // 构建查询条件
        ChatHistoryQueryRequest queryRequest = new ChatHistoryQueryRequest();
        queryRequest.setSessionId(sessionId);
        queryRequest.setLastCreateTime(lastCreateTime);
        queryRequest.setUserId(loginUser.getId());
        QueryWrapper<ChatHistory> queryWrapper = this.getQueryWrapper(queryRequest);
        // 查询数据
        return this.page(Page.of(1, pageSize), queryWrapper);
    }

    /**
     * 加载对话历史到内存
     * @param sessionId 会话ID
     * @param chatMemory 聊天记忆
     * @param maxCount 最大加载数量
     * @return 加载数量
     */
    @Override
    public int loadChatHistoryToMemory(Long sessionId, MessageWindowChatMemory chatMemory, int maxCount) {
        try {
            // 直接构造查询条件，起始点为 1 而不是 0，用于排除最新的用户消息
            QueryWrapper<ChatHistory> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("sessionId", sessionId)
                    .orderBy(true, false,"CreateTime")
                    .last("LIMIT " + 1 + ", " + maxCount);
            List<ChatHistory> historyList = this.list(queryWrapper);
            if (CollUtil.isEmpty(historyList)) {
                return 0;
            }
            // 反转列表，确保按时间正序（老的在前，新的在后）
            historyList = historyList.reversed();
            // 按时间顺序添加到记忆中
            int loadedCount = 0;
            // 先清理历史缓存，防止重复加载
            chatMemory.clear();
            for (ChatHistory history : historyList) {
                if (ChatHistoryMessageTypeEnum.USER.getValue().equals(history.getMessageType())) {
                    chatMemory.add(UserMessage.from(history.getMessage()));
                    loadedCount++;
                } else if (ChatHistoryMessageTypeEnum.AI.getValue().equals(history.getMessageType())) {
                    chatMemory.add(AiMessage.from(history.getMessage()));
                    loadedCount++;
                }
            }
            log.info("成功为 sessionId: {} 加载了 {} 条历史对话", sessionId, loadedCount);
            return loadedCount;
        } catch (Exception e) {
            log.error("加载历史对话失败，appId: {}, error: {}", sessionId, e.getMessage(), e);
            // 加载失败不影响系统运行，只是没有历史上下文
            return 0;
        }
    }

}




