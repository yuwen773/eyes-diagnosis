package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.dto.agent.ChatHistoryVO;
import com.csust.eyediagnosis.model.dto.agent.MessageVO;
import com.csust.eyediagnosis.model.dto.agent.SessionVO;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import com.csust.eyediagnosis.model.entity.AgentSession;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

@Slf4j
@Service
public class ChatHistoryService {

    private final AgentSessionMapper sessionMapper;
    private final AgentMessageMapper messageMapper;
    private AgentConstants agentConstants;

    @Autowired
    public ChatHistoryService(AgentSessionMapper sessionMapper, AgentMessageMapper messageMapper) {
        this.sessionMapper = sessionMapper;
        this.messageMapper = messageMapper;
    }

    @Resource
    public void setAgentConstants(AgentConstants agentConstants) {
        this.agentConstants = agentConstants;
    }

    @Async("agentAsyncExecutor")
    public void saveUserMessage(String sessionId, Long userId, String content) {
        ensureSessionExists(sessionId, userId, content);
        AgentMessage message = buildMessage(sessionId, "USER", null, content);
        messageMapper.insert(message);
        sessionMapper.updateMessageCount(sessionId, truncate(content));
    }

    @Async("agentAsyncExecutor")
    public void saveAssistantMessage(String sessionId, String content, String subType) {
        AgentMessage message = buildMessage(sessionId, "ASSISTANT", subType, content);
        messageMapper.insert(message);
        sessionMapper.updateMessageCount(sessionId, truncate(content));
    }

    @Async("agentAsyncExecutor")
    public void saveReasoningMessage(String sessionId, String content) {
        AgentMessage message = buildMessage(sessionId, "ASSISTANT", "reasoning", content);
        messageMapper.insert(message);
    }

    @Async("agentAsyncExecutor")
    public void saveToolCallMessage(String sessionId, String content) {
        AgentMessage message = buildMessage(sessionId, "ASSISTANT", "tool-call", content);
        messageMapper.insert(message);
    }

    @Async("agentAsyncExecutor")
    public void saveToolResultMessage(String sessionId, String content) {
        AgentMessage message = buildMessage(sessionId, "ASSISTANT", "tool-result", content);
        messageMapper.insert(message);
    }

    @Async("agentAsyncExecutor")
    public void saveToolConfirmMessage(String sessionId, String content) {
        AgentMessage message = buildMessage(sessionId, "ASSISTANT", "mcp-confirm", content);
        messageMapper.insert(message);
    }

    public ChatHistoryVO loadHistory(String sessionId, Long beforeId, int limit) {
        List<AgentMessage> entities;
        if (beforeId == null) {
            entities = messageMapper.selectBySessionIdOrderByTimeASC(sessionId, limit);
        } else {
            entities = messageMapper.selectByCursor(sessionId, beforeId, limit);
        }

        boolean hasMore = entities.size() == limit;
        Long nextCursor = hasMore ? entities.get(entities.size() - 1).getId() : null;

        List<MessageVO> vos = entities.stream()
                .map(this::toMessageVO)
                .toList();

        return new ChatHistoryVO(vos, hasMore, nextCursor);
    }

    public List<SessionVO> getUserSessions(Long userId, Long beforeId, int limit) {
        List<AgentSession> sessions =
                sessionMapper.selectByUserIdCursor(userId, beforeId, limit);

        return sessions.stream()
                .map(this::toSessionVO)
                .toList();
    }

    public boolean isSessionOwner(String sessionId, Long userId) {
        if (sessionId == null || userId == null) {
            return false;
        }
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        return session != null && userId.equals(session.getUserId());
    }

    public void deleteSession(String sessionId, Long userId) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        sessionMapper.softDeleteBySessionId(sessionId);
    }

    public int batchDeleteSessions(List<String> sessionIds, Long userId) {
        // 校验用户拥有所有会话
        for (String sessionId : sessionIds) {
            if (!isSessionOwner(sessionId, userId)) {
                throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权限删除会话: " + sessionId);
            }
        }
        return sessionMapper.batchSoftDelete(sessionIds);
    }

    public void updateSessionTitle(String sessionId, Long userId, String title) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        // 标题长度限制
        if (title == null || title.isBlank() || title.length() > 50) {
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "标题不能为空且不能超过50字");
        }
        sessionMapper.updateTitle(sessionId, title);
    }

    private void ensureSessionExists(String sessionId, Long userId, String firstMessage) {
        AgentSession existing = sessionMapper.selectBySessionId(sessionId);
        if (existing != null) {
            return;
        }
        try {
            AgentSession session = new AgentSession();
            session.setSessionId(sessionId);
            session.setUserId(userId);
            session.setTitle(truncate(firstMessage));
            session.setStatus(1);
            session.setMessageCount(0);
            session.setLastMessage("");
            session.setCreatedTime(new Date());
            session.setUpdatedTime(new Date());
            sessionMapper.insert(session);
            log.info("自动创建 AgentSession, sessionId={}, userId={}", sessionId, userId);
        } catch (DuplicateKeyException e) {
            log.debug("Session 已存在（并发创建）, sessionId={}", sessionId);
        }
    }

    private String truncate(String content) {
        if (content == null) return "";
        int maxLength = agentConstants.getHistoryTruncateLength();
        int reserveLength = agentConstants.getHistoryTruncateReserve();
        return content.length() > maxLength ? content.substring(0, reserveLength) + "..." : content;
    }

    private AgentMessage buildMessage(String sessionId, String role,
                                       String subType, String content) {
        AgentMessage message = new AgentMessage();
        message.setSessionId(sessionId);
        message.setRole(role);
        message.setSubType(subType);
        message.setContent(content);
        message.setCreatedTime(new Date());
        return message;
    }

    private MessageVO toMessageVO(AgentMessage entity) {
        MessageVO messageVO = new MessageVO();
        BeanUtils.copyProperties(entity, messageVO);
        return messageVO;
    }

    private SessionVO toSessionVO(AgentSession entity) {
        SessionVO sessionVO = new SessionVO();
        BeanUtils.copyProperties(entity, sessionVO);
        return sessionVO;
    }
}