package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.dto.agent.ChatHistoryVO;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 消息版本（重新生成）在服务层的口径：
 * 版本列表按生成顺序、切换只认真实存在的版本、历史只给用户行补版本信息。
 */
class ChatHistoryVariantsTest {

    private static final long USER_ID = 42L;
    private static final String SESSION = "session-1";
    private static final long TURN = 1001L;

    private AgentSessionMapper sessionMapper;
    private AgentMessageMapper messageMapper;
    private ChatMessageWriter writer;
    private ChatHistoryService history;

    @BeforeEach
    void setUp() {
        sessionMapper = mock(AgentSessionMapper.class);
        messageMapper = mock(AgentMessageMapper.class);
        writer = mock(ChatMessageWriter.class);
        SessionMessageQueue queue = mock(SessionMessageQueue.class);
        history = new ChatHistoryService(sessionMapper, messageMapper, new ObjectMapper(), queue, writer);

        AgentSession session = new AgentSession();
        session.setSessionId(SESSION);
        session.setUserId(USER_ID);
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(session);
    }

    private static Map<String, Object> variantRow(long replyToId, String variantId, long firstId) {
        Map<String, Object> row = new HashMap<>();
        row.put("replyToId", replyToId);
        row.put("variantId", variantId);
        row.put("firstId", firstId);
        return row;
    }

    private static AgentMessage userMessage(long id, String selectedVariantId) {
        AgentMessage message = new AgentMessage();
        message.setId(id);
        message.setSessionId(SESSION);
        message.setRole("USER");
        message.setContent("问题");
        message.setSelectedVariantId(selectedVariantId);
        return message;
    }

    @Test
    void variantsKeepGenerationOrder() {
        when(messageMapper.selectVariants(SESSION, List.of(TURN))).thenReturn(List.of(
                variantRow(TURN, "v2", 20L),
                variantRow(TURN, "v1", 10L)));
        when(messageMapper.selectById(TURN)).thenReturn(userMessage(TURN, "v2"));

        ChatHistoryService.TurnVariants variants = history.variants(SESSION, USER_ID, TURN);

        assertEquals(List.of("v2", "v1"), variants.variantIds(), "顺序来自 SQL 的 MIN(id)");
        assertEquals("v2", variants.selectedVariantId());
    }

    @Test
    void selectingAVersionThatDoesNotExistIsRejected() {
        when(messageMapper.selectVariants(SESSION, List.of(TURN))).thenReturn(List.of(variantRow(TURN, "v1", 10L)));

        BusinessException error = assertThrows(BusinessException.class,
                () -> history.selectVariant(SESSION, USER_ID, TURN, "v9"));

        assertTrue(error.getMessage().contains("不存在"));
        verify(writer, never()).selectVariant(SESSION, TURN, "v9");
    }

    @Test
    void selectingARealVersionIsPersisted() {
        when(messageMapper.selectVariants(SESSION, List.of(TURN))).thenReturn(List.of(
                variantRow(TURN, "v1", 10L), variantRow(TURN, "v2", 20L)));

        history.selectVariant(SESSION, USER_ID, TURN, "v1");

        verify(writer).selectVariant(SESSION, TURN, "v1");
    }

    @Test
    void historyAnnotatesUserRowsWithTheirVariants() {
        when(messageMapper.selectBySessionIdOrderByTimeASC(SESSION, 40))
                .thenReturn(List.of(userMessage(TURN, "v1")));
        when(messageMapper.selectVariants(SESSION, List.of(TURN))).thenReturn(List.of(
                variantRow(TURN, "v1", 10L), variantRow(TURN, "v2", 20L)));

        ChatHistoryVO page = history.loadHistory(SESSION, null, 40);

        assertEquals(1, page.getMessages().size());
        assertEquals(List.of("v1", "v2"), page.getMessages().getFirst().getVariantIds());
        assertEquals("v1", page.getMessages().getFirst().getSelectedVariantId());
    }

    @Test
    void historyWithoutVariantsStillLoads() {
        when(messageMapper.selectBySessionIdOrderByTimeASC(SESSION, 40))
                .thenReturn(List.of(userMessage(TURN, null)));
        when(messageMapper.selectVariants(SESSION, List.of(TURN))).thenReturn(List.of());

        ChatHistoryVO page = history.loadHistory(SESSION, null, 40);

        assertEquals(1, page.getMessages().size());
        assertTrue(page.getMessages().getFirst().getVariantIds().isEmpty(),
                "旧数据没有版本：切换器不出现，历史照常可读");
    }

    @Test
    void loadUserTurnRefusesForeignOrNonUserRows() {
        AgentMessage assistant = new AgentMessage();
        assistant.setId(TURN);
        assistant.setSessionId(SESSION);
        assistant.setRole("ASSISTANT");
        when(messageMapper.selectById(TURN)).thenReturn(assistant);

        assertThrows(BusinessException.class, () -> history.loadUserTurn(SESSION, USER_ID, TURN));
    }

    @Test
    void loadUserTurnReturnsTheStoredText() {
        when(messageMapper.selectById(TURN)).thenReturn(userMessage(TURN, null));

        ChatHistoryService.UserTurn turn = history.loadUserTurn(SESSION, USER_ID, TURN);

        assertEquals("问题", turn.text());
        assertEquals(TURN, turn.messageId());
        assertFalse(turn.text().isBlank());
    }

    @Test
    void legacyAnswersAreAdoptedIntoOneVersionBeforeRegeneration() {
        when(messageMapper.selectNextUserMessageId(SESSION, TURN)).thenReturn(2000L);
        when(messageMapper.countLegacyAnswers(SESSION, TURN, 2000L)).thenReturn(3);

        String variantId = history.adoptLegacyAnswers(SESSION, USER_ID, TURN);

        assertEquals("legacy-" + TURN, variantId, "版本 id 由用户消息派生，重复调用不会越跑越多");
        verify(messageMapper).adoptLegacyAnswers(SESSION, TURN, "legacy-" + TURN, TURN, 2000L);
    }

    @Test
    void lastTurnAdoptsUpToTheEndOfTheSession() {
        when(messageMapper.selectNextUserMessageId(SESSION, TURN)).thenReturn(null);
        when(messageMapper.countLegacyAnswers(SESSION, TURN, Long.MAX_VALUE)).thenReturn(1);

        assertEquals("legacy-" + TURN, history.adoptLegacyAnswers(SESSION, USER_ID, TURN));

        verify(messageMapper).adoptLegacyAnswers(SESSION, TURN, "legacy-" + TURN, TURN, Long.MAX_VALUE);
    }

    @Test
    void turnsWithoutLegacyAnswersAreLeftAlone() {
        when(messageMapper.selectNextUserMessageId(SESSION, TURN)).thenReturn(null);
        when(messageMapper.countLegacyAnswers(SESSION, TURN, Long.MAX_VALUE)).thenReturn(0);

        assertEquals(null, history.adoptLegacyAnswers(SESSION, USER_ID, TURN));
        verify(messageMapper, never()).adoptLegacyAnswers(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong());
    }
}
