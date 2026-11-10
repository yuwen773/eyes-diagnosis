package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyediagnosis.agent.config.AgentConstants;
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
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private AgentConstants agentConstants;
    private TitleGenerationService titleGenerationService;

    @Autowired
    public ChatHistoryService(AgentSessionMapper sessionMapper, AgentMessageMapper messageMapper,
                              ObjectMapper objectMapper, SessionMessageQueue messageQueue) {
        this.sessionMapper = sessionMapper;
        this.messageMapper = messageMapper;
        this.objectMapper = objectMapper;
        this.messageQueue = messageQueue;
    }

    @Autowired
    public void setTitleGenerationService(TitleGenerationService titleGenerationService) {
        this.titleGenerationService = titleGenerationService;
    }

    @Resource
    public void setAgentConstants(AgentConstants agentConstants) {
        this.agentConstants = agentConstants;
    }

    public void saveUserMessage(String sessionId, Long userId, String content) {
        messageQueue.submit(sessionId, () -> {
            claimOrValidateSession(sessionId, userId, content);
            AgentMessage message = buildMessage(sessionId, "USER", null, content);
            messageMapper.insert(message);
            sessionMapper.updateMessageCount(sessionId, truncate(content));

            AgentSession session = sessionMapper.selectBySessionId(sessionId);
            if (session != null && session.getMessageCount() == 1) {
                titleGenerationService.generateTitleAsync(sessionId, content);
            }
            return null;
        });
    }

    public void saveAssistantMessage(String sessionId, Long userId, String content, String subType) {
        messageQueue.submit(sessionId, () -> {
            AgentMessage message = buildMessage(sessionId, "ASSISTANT", subType, content);
            messageMapper.insert(message);
            sessionMapper.updateMessageCount(sessionId, truncate(content));
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
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        if (session == null || !userId.equals(session.getUserId())) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        // 置顶是元数据操作，不该改写「最近活动时间」：显式回写原值压掉 updatedTime
        // 的 ON UPDATE CURRENT_TIMESTAMP。否则一置顶会话就被挪进「今天」分组，
        // 取消置顶后也回不到它原本所在的日期分组。
        sessionMapper.updatePinStatus(sessionId, pinned ? 1 : 0, pinned ? new Date() : null,
                session.getUpdatedTime());
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
        // 实体的 pinned 是 0/1 的 Integer，VO 对前端是布尔；空值一律按未置顶处理
        sessionVO.setIsPinned(entity.getPinned() != null && entity.getPinned() == 1);
        return sessionVO;
    }
}
