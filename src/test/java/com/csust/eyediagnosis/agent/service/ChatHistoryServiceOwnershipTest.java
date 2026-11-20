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

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
        ChatHistoryService service = service();
        AgentSession existing = new AgentSession();
        existing.setSessionId("thread-a");
        existing.setUserId(2L);
        when(agentSessionMapper.selectBySessionId("thread-a")).thenReturn(existing);

        assertThrows(BusinessException.class,
                () -> service.claimOrValidateSession("thread-a", 1L, "hello"));
    }

    @Test
    void exportRejectsCrossUserAccessAndUnknownFormatsWithoutReadingMessages() {
        ChatHistoryService service = service();
        AgentSession existing = new AgentSession();
        existing.setSessionId("thread-a");
        existing.setUserId(2L);
        when(agentSessionMapper.selectBySessionId("thread-a")).thenReturn(existing);

        assertThrows(BusinessException.class,
                () -> service.exportSession("thread-a", 1L, "markdown"));
        verify(agentMessageMapper, never()).selectBySessionIdOrderByTimeASC(anyString(), anyInt());

        existing.setUserId(1L);
        assertThrows(BusinessException.class,
                () -> service.exportSession("thread-a", 1L, "pdf"));
        verify(agentMessageMapper, never()).selectBySessionIdOrderByTimeASC(anyString(), anyInt());
    }

    @Test
    void exportAcceptsOnlyMarkdownAndJsonForTheOwner() {
        ChatHistoryService service = service();
        AgentSession owned = new AgentSession();
        owned.setSessionId("thread-a");
        owned.setUserId(1L);
        owned.setTitle("Synthetic title");
        when(agentSessionMapper.selectBySessionId("thread-a")).thenReturn(owned);
        when(agentMessageMapper.selectBySessionIdOrderByTimeASC("thread-a", 1000))
                .thenReturn(List.of());

        String markdown = service.exportSession("thread-a", 1L, "MARKDOWN");
        String json = service.exportSession("thread-a", 1L, "json");

        assertTrue(markdown.startsWith("# Synthetic title"));
        assertTrue(json.contains("\"sessionId\":\"thread-a\""));
        assertEquals(2, org.mockito.Mockito.mockingDetails(agentMessageMapper)
                .getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("selectBySessionIdOrderByTimeASC"))
                .count());
    }

    private ChatHistoryService service() {
        ChatMessageWriter messageWriter = new ChatMessageWriter(
                agentSessionMapper, agentMessageMapper, new com.csust.eyediagnosis.agent.config.AgentConstants());
        ChatHistoryService service = new ChatHistoryService(
                agentSessionMapper, agentMessageMapper, new ObjectMapper(),
                sessionMessageQueue, messageWriter);
        service.setTitleGenerationService(titleGenerationService);
        return service;
    }
}
