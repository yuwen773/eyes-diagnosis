package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import com.csust.eyediagnosis.model.entity.AgentSession;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;

/**
 * 会话消息的持久写入 module。
 *
 * <p>「会话声明 + 消息写入 + 消息计数」原来散在 {@link ChatHistoryService} 的队列
 * lambda 里，且 {@code @Transactional} 因同 bean 自调用被 AOP 绕过。这里收成
 * 一个独立 bean：队列线程调用它时走 Spring 代理，三件事落在同一个事务里。
 *
 * <p>原事务性 Outbox（{@code t_agent_message_outbox}）已退役：它与消息表同库，
 * 没有跨系统边界可跨，属于只有一个 adapter 的假 seam。历史行仍保留在表中，
 * 但不再有任何 Java 写入方或 dispatcher，避免重放。
 */
@Service
@RequiredArgsConstructor
public class ChatMessageWriter {

    private final AgentSessionMapper sessionMapper;
    private final AgentMessageMapper messageMapper;
    private final AgentConstants agentConstants;

    /**
     * 原子声明或校验会话所有权：
     * 1) 会话不存在 → 创建并绑定当前 userId；
     * 2) 会话存在但 owner 与 userId 不符 → 抛 NO_AUTH_ERROR；
     * 3) 并发创建冲突时再次读取并校验 owner。
     */
    @Transactional
    public AgentSession claimOrValidateSession(String sessionId, Long userId, String firstMessage) {
        if (sessionId == null || userId == null) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "会话标识或用户为空");
        }
        AgentSession existing = sessionMapper.selectBySessionId(sessionId);
        if (existing != null) {
            ThrowUtils.throwIf(!userId.equals(existing.getUserId()),
                    ErrorCode.NO_AUTH_ERROR, "无权限访问该会话");
            return existing;
        }
        AgentSession created = new AgentSession();
        created.setSessionId(sessionId);
        created.setUserId(userId);
        created.setTitle(truncate(firstMessage));
        created.setStatus(1);
        created.setMessageCount(0);
        created.setLastMessage("");
        created.setCreatedTime(new Date());
        created.setUpdatedTime(new Date());
        try {
            sessionMapper.insert(created);
            return created;
        } catch (DuplicateKeyException exception) {
            AgentSession raced = sessionMapper.selectBySessionId(sessionId);
            ThrowUtils.throwIf(raced == null || !userId.equals(raced.getUserId()),
                    ErrorCode.NO_AUTH_ERROR, "无权限访问该会话");
            return raced;
        }
    }

    @Transactional
    public void writeUserMessage(String sessionId, Long userId, String content) {
        writeUserMessage(sessionId, userId, content, null);
    }

    @Transactional
    public void writeUserMessage(String sessionId, Long userId, String content, String subType) {
        writeUserMessage(sessionId, userId, content, subType, null);
    }

    @Transactional
    public void writeUserMessage(String sessionId, Long userId, String content, String subType, Long messageId) {
        claimOrValidateSession(sessionId, userId, content);
        AgentMessage message = buildMessage(sessionId, "USER", subType, content);
        if (messageId != null) message.setId(messageId);
        if (alreadyCommitted(message)) return;
        messageMapper.insert(message);
        sessionMapper.updateMessageCount(sessionId, truncate(content));
    }

    @Transactional
    public void writeAssistantMessage(String sessionId, String content, String subType) {
        writeAssistantMessage(sessionId, content, subType, null);
    }

    @Transactional
    public void writeAssistantMessage(String sessionId, String content, String subType, Long messageId) {
        writeAssistantMessage(sessionId, content, subType, messageId, null, null);
    }

    /**
     * 带版本信息的回答侧写入。
     *
     * @param replyToId 本回合的用户消息 id；旧调用方传 null
     * @param variantId 本次生成的版本组；同一组 reasoning/tool/text 必须一致
     */
    @Transactional
    public void writeAssistantMessage(String sessionId, String content, String subType, Long messageId,
                                      Long replyToId, String variantId) {
        AgentMessage message = buildMessage(sessionId, "ASSISTANT", subType, content);
        if (messageId != null) message.setId(messageId);
        message.setReplyToId(replyToId);
        message.setVariantId(variantId);
        if (alreadyCommitted(message)) return;
        messageMapper.insert(message);
        sessionMapper.updateMessageCount(sessionId, truncate(content));
    }

    /** 切换某一轮显示的回答版本；只能落在这些版本真实存在的组合上由调用方校验。 */
    @Transactional
    public void selectVariant(String sessionId, Long userMessageId, String variantId) {
        messageMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<AgentMessage>()
                .eq(AgentMessage::getSessionId, sessionId)
                .eq(AgentMessage::getId, userMessageId)
                .set(AgentMessage::getSelectedVariantId, variantId));
        // 每写一行都 +1（含之后被隐藏的未选中版本）。切换是唯一一次「哪些行
        // 算数」发生变化的时刻，在这里按可见口径重算，会话列表与历史保持一致。
        String lastVisible = messageMapper.selectLastVisibleContent(sessionId);
        sessionMapper.setVisibleMessageStats(sessionId,
                messageMapper.countVisibleMessages(sessionId),
                lastVisible == null ? null : truncate(lastVisible));
    }

    private AgentMessage buildMessage(String sessionId, String role, String subType, String content) {
        AgentMessage message = new AgentMessage();
        message.setId(com.baomidou.mybatisplus.core.toolkit.IdWorker.getId());
        message.setSessionId(sessionId);
        message.setRole(role);
        message.setSubType(subType);
        message.setContent(content);
        message.setCreatedTime(new Date());
        return message;
    }

    private boolean alreadyCommitted(AgentMessage message) {
        AgentMessage existing = messageMapper.selectById(message.getId());
        if (existing == null) return false;
        if (!java.util.Objects.equals(message.getSessionId(), existing.getSessionId())
                || !java.util.Objects.equals(message.getRole(), existing.getRole())
                || !java.util.Objects.equals(message.getSubType(), existing.getSubType())
                || !java.util.Objects.equals(message.getContent(), existing.getContent())) {
            throw new IllegalStateException("Message identity conflict");
        }
        return true;
    }

    private String truncate(String content) {
        if (content == null) return "";
        int maxLength = agentConstants.getHistoryTruncateLength();
        int reserveLength = agentConstants.getHistoryTruncateReserve();
        return content.length() > maxLength ? content.substring(0, reserveLength) + "..." : content;
    }
}
