package com.csust.eyediagnosis.agent.outbox;

import com.csust.eyediagnosis.mapper.AgentMessageOutboxMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Date;

@Slf4j
@Service
@RequiredArgsConstructor
public class AgentMessageOutboxService {

    private final AgentMessageOutboxMapper outboxMapper;

    public Long append(String sessionId, Long userId, String role, String subType, String content) {
        AgentMessageOutboxEntity entry = new AgentMessageOutboxEntity();
        entry.setSessionId(sessionId);
        entry.setUserId(userId);
        entry.setRole(role);
        entry.setSubType(subType);
        entry.setContent(content);
        entry.setStatus(0);
        entry.setRetryCount(0);
        entry.setCreatedTime(new Date());
        outboxMapper.insert(entry);
        return entry.getId();
    }
}
