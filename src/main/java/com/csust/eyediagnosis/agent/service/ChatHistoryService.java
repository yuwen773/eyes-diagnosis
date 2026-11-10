package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.dto.agent.ChatHistoryVO;
import com.csust.eyediagnosis.model.dto.agent.MessageVO;
import com.csust.eyediagnosis.model.dto.agent.SessionVO;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import com.csust.eyediagnosis.model.entity.AgentSession;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class ChatHistoryService {

    private final AgentSessionMapper sessionMapper;
    private final AgentMessageMapper messageMapper;
    private final ObjectMapper objectMapper;
    private final SessionMessageQueue messageQueue;
    private final ChatMessageWriter messageWriter;
    private TitleGenerationService titleGenerationService;

    @Autowired
    public ChatHistoryService(AgentSessionMapper sessionMapper, AgentMessageMapper messageMapper,
                              ObjectMapper objectMapper, SessionMessageQueue messageQueue,
                              ChatMessageWriter messageWriter) {
        this.sessionMapper = sessionMapper;
        this.messageMapper = messageMapper;
        this.objectMapper = objectMapper;
        this.messageQueue = messageQueue;
        this.messageWriter = messageWriter;
    }

    @Autowired
    public void setTitleGenerationService(TitleGenerationService titleGenerationService) {
        this.titleGenerationService = titleGenerationService;
    }

    public void saveUserMessage(String sessionId, Long userId, String content) {
        messageQueue.submit(sessionId, () -> {
            messageWriter.writeUserMessage(sessionId, userId, content);

            AgentSession session = sessionMapper.selectBySessionId(sessionId);
            if (session != null && session.getMessageCount() == 1) {
                titleGenerationService.generateTitleAsync(sessionId, content);
            }
            return null;
        });
    }

    public void saveAssistantMessage(String sessionId, Long userId, String content, String subType) {
        messageQueue.submit(sessionId, () -> {
            messageWriter.writeAssistantMessage(sessionId, content, subType);
            return null;
        });
    }

    public void saveReasoningMessage(String sessionId, Long userId, String content) {
        saveAssistantMessage(sessionId, userId, content, "reasoning");
    }

    public void saveToolCallMessage(String sessionId, Long userId, String content) {
        saveAssistantMessage(sessionId, userId, content, "tool-call");
    }

    public void saveToolResultMessage(String sessionId, Long userId, String content) {
        saveAssistantMessage(sessionId, userId, content, "tool-result");
    }

    public void saveToolConfirmMessage(String sessionId, Long userId, String content) {
        saveAssistantMessage(sessionId, userId, content, "mcp-confirm");
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

    public void updatePinStatus(String sessionId, Long userId, boolean pinned) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        sessionMapper.updatePinStatus(sessionId, pinned ? 1 : 0, pinned ? new Date() : null);
    }

    public void triggerTitleGeneration(String sessionId, Long userId, String firstMessage) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        titleGenerationService.generateTitleAsync(sessionId, firstMessage);
    }

    public String exportSession(String sessionId, Long userId, String format) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        List<AgentMessage> messages = messageMapper.selectBySessionIdOrderByTimeASC(sessionId, 1000);
        AgentSession session = sessionMapper.selectBySessionId(sessionId);

        try {
            if ("json".equalsIgnoreCase(format)) {
                return exportAsJson(session, messages);
            } else {
                return exportAsMarkdown(session, messages);
            }
        } catch (JsonProcessingException e) {
            log.error("导出会话失败, sessionId={}", sessionId, e);
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "导出失败");
        }
    }

    private String exportAsJson(AgentSession session, List<AgentMessage> messages) throws JsonProcessingException {
        Map<String, Object> result = new HashMap<>();
        result.put("sessionId", session.getSessionId());
        result.put("title", session.getTitle());
        result.put("createdAt", session.getCreatedTime());
        result.put("messages", messages.stream().map(m -> {
            Map<String, Object> msg = new HashMap<>();
            msg.put("role", m.getRole());
            msg.put("content", m.getContent());
            msg.put("time", m.getCreatedTime());
            return msg;
        }).toList());
        return this.objectMapper.writeValueAsString(result);
    }

    private String exportAsMarkdown(AgentSession session, List<AgentMessage> messages) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(session.getTitle()).append("\n\n");
        sb.append("会话 ID: ").append(session.getSessionId()).append("\n");
        sb.append("创建时间: ").append(session.getCreatedTime()).append("\n\n");
        sb.append("---\n\n");
        for (AgentMessage m : messages) {
            String role = "USER".equals(m.getRole()) ? "用户" : "AI";
            sb.append("## ").append(role).append("\n");
            sb.append(escapeMarkdown(m.getContent())).append("\n\n");
            sb.append("*").append(m.getCreatedTime()).append("*\n\n");
        }
        return sb.toString();
    }

    /**
     * 原子声明或校验会话所有权。事务边界在 {@link ChatMessageWriter} 上，
     * 经独立 bean 调用（而非同 bean 自调用），Spring AOP 代理才会生效。
     */
    public AgentSession claimOrValidateSession(String sessionId, Long userId, String firstMessage) {
        return messageWriter.claimOrValidateSession(sessionId, userId, firstMessage);
    }

    /**
     * 仅校验会话所有权：存在且属于 userId 则放行，否则抛 NO_AUTH_ERROR。
     */
    public void assertSessionOwner(String sessionId, Long userId) {
        if (sessionId == null || userId == null) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        ThrowUtils.throwIf(session == null || !userId.equals(session.getUserId()),
                ErrorCode.NO_AUTH_ERROR);
    }

    private String escapeMarkdown(String text) {
        if (text == null) return "";
        return text
            .replace("\\", "\\\\")
            .replace("#", "\\#")
            .replace("*", "\\*")
            .replace("`", "\\`")
            .replace(">", "\\>")
            .replace("-", "\\-");
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
