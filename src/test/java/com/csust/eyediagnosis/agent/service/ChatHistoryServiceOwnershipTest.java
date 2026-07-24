package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ChatHistoryServiceOwnershipTest {

    @Mock
    private AgentSessionMapper agentSessionMapper;
    @Mock
    private AgentMessageMapper agentMessageMapper;
    @Mock
    private TitleGenerationService titleGenerationService;
    @Mock
    private SessionMessageQueue sessionMessageQueue;

    @Test
    void existingSessionOwnedByAnotherUserIsRejected() {
        ChatHistoryService service = new ChatHistoryService(
                agentSessionMapper, agentMessageMapper, new ObjectMapper(),
                sessionMessageQueue);
        service.setTitleGenerationService(titleGenerationService);

        AgentSession existing = new AgentSession();
        existing.setSessionId("thread-a");
        existing.setUserId(2L);
        when(agentSessionMapper.selectBySessionId("thread-a")).thenReturn(existing);

        assertThrows(BusinessException.class,
                () -> service.claimOrValidateSession("thread-a", 1L, "hello"));
    }
}
