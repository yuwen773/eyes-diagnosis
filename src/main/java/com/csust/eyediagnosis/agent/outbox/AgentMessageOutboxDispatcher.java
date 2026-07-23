package com.csust.eyediagnosis.agent.outbox;

import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentMessageOutboxMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Date;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class AgentMessageOutboxDispatcher {

    private static final int MAX_RETRIES = 5;

    private final AgentMessageOutboxMapper outboxMapper;
    private final AgentMessageMapper messageMapper;

    @Scheduled(fixedDelay = 500)
    public void dispatch() {
        List<AgentMessageOutboxEntity> pending = outboxMapper.selectPending(100);
        for (AgentMessageOutboxEntity entry : pending) {
            try {
                AgentMessage message = new AgentMessage();
                message.setSessionId(entry.getSessionId());
                message.setRole(entry.getRole());
                message.setSubType(entry.getSubType());
                message.setContent(entry.getContent());
                message.setTokenCount(0);
                message.setIsSummary(0);
                message.setCreatedTime(entry.getCreatedTime() != null ? entry.getCreatedTime() : new Date());
                messageMapper.insert(message);
                outboxMapper.markDelivered(entry.getId());
            } catch (Exception e) {
                int retries = entry.getRetryCount() == null ? 0 : entry.getRetryCount();
                if (retries < MAX_RETRIES) {
                    outboxMapper.markRetry(entry.getId(), e.getMessage());
                } else {
                    outboxMapper.markDead(entry.getId(), e.getMessage());
                }
            }
        }
    }
}
