package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import com.csust.eyediagnosis.model.entity.AgentSession;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 会话消息写入 module：一次用户消息把「会话声明 + 消息 + 计数」收在一个事务里，
 * 且不再经过已退役的 Outbox。
 */
class ChatMessageWriterTest {

    private final AgentSessionMapper sessionMapper = mock(AgentSessionMapper.class);
    private final AgentMessageMapper messageMapper = mock(AgentMessageMapper.class);
    private final ChatMessageWriter writer = new ChatMessageWriter(
            sessionMapper, messageMapper, new AgentConstants());

    @Test
    void newSessionIsClaimedAndMessageAndCountAreWrittenTogether() {
        when(sessionMapper.selectBySessionId("thread-a")).thenReturn(null);

        writer.writeUserMessage("thread-a", 7L, "hello");

        ArgumentCaptor<AgentSession> sessionCaptor = ArgumentCaptor.forClass(AgentSession.class);
        verify(sessionMapper).insert(sessionCaptor.capture());
        assertEquals("thread-a", sessionCaptor.getValue().getSessionId());
        assertEquals(7L, sessionCaptor.getValue().getUserId());
        assertEquals("hello", sessionCaptor.getValue().getTitle());

        ArgumentCaptor<AgentMessage> messageCaptor = ArgumentCaptor.forClass(AgentMessage.class);
        verify(messageMapper).insert(messageCaptor.capture());
        assertEquals("USER", messageCaptor.getValue().getRole());
        assertEquals("hello", messageCaptor.getValue().getContent());
        verify(sessionMapper).updateMessageCount("thread-a", "hello");
    }

    @Test
    void existingSessionIsNotRecreated() {
        AgentSession existing = new AgentSession();
        existing.setSessionId("thread-a");
        existing.setUserId(7L);
        when(sessionMapper.selectBySessionId("thread-a")).thenReturn(existing);

        writer.writeAssistantMessage("thread-a", "reply", "text");

        verify(sessionMapper, never()).insert(any(AgentSession.class));
        verify(messageMapper).insert(any(AgentMessage.class));
        verify(sessionMapper).updateMessageCount("thread-a", "reply");
    }

    @Test
    void longContentIsTruncatedUsingAgentConstants() {
        when(sessionMapper.selectBySessionId("thread-a")).thenReturn(null);
        String content = "x".repeat(600);

        writer.writeUserMessage("thread-a", 7L, content);

        ArgumentCaptor<AgentSession> captor = ArgumentCaptor.forClass(AgentSession.class);
        verify(sessionMapper).insert(captor.capture());
        assertEquals("x".repeat(200) + "...", captor.getValue().getTitle());
        verify(sessionMapper).updateMessageCount("thread-a", "x".repeat(200) + "...");
    }
}
