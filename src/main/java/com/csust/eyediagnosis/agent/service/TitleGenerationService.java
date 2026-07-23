package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class TitleGenerationService {

    private final AgentSessionMapper sessionMapper;
    private final AgentMessageMapper messageMapper;

    @Autowired
    public TitleGenerationService(AgentSessionMapper sessionMapper, AgentMessageMapper messageMapper) {
        this.sessionMapper = sessionMapper;
        this.messageMapper = messageMapper;
    }

    @Async("titleGenerationExecutor")
    public void generateTitleAsync(String sessionId, String firstMessage) {
        try {
            log.info("开始生成会话标题, sessionId={}", sessionId);

            // 调用 LLM 生成标题
            String title = generateTitleFromLLM(firstMessage);

            // 更新会话标题
            AgentSession session = sessionMapper.selectBySessionId(sessionId);
            if (session != null && (session.getTitle() == null || session.getTitle().length() < 5)) {
                sessionMapper.updateTitle(sessionId, title);
                log.info("会话标题已更新, sessionId={}, title={}", sessionId, title);
            }
        } catch (Exception e) {
            // 生成失败不影响主流程，记录日志
            log.warn("AI 生成标题失败, sessionId={}, error={}", sessionId, e.getMessage());
        }
    }

    private String generateTitleFromLLM(String firstMessage) {
        // TODO: 后续接入 DashScope 或其他 LLM API
        // 目前用截断策略作为临时实现
        String truncated = firstMessage;
        if (truncated.length() > 20) {
            truncated = truncated.substring(0, 20) + "...";
        }
        return "关于「" + truncated + "」的对话";
    }
}