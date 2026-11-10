package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.dto.agent.SessionVO;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 置顶状态必须随会话列表一起下发：
 * 前端按 isPinned 划分「置顶」分组并决定菜单显示「置顶」还是「取消置顶」，
 * 字段缺失时置顶的会话会落回日期分组（且因 updatedTime 被顶到当下而跑进「今天」）。
 */
@ExtendWith(MockitoExtension.class)
class SessionPinExposureTest {

    @Mock
    private AgentSessionMapper agentSessionMapper;
    @Mock
    private AgentMessageMapper agentMessageMapper;
    @Mock
    private TitleGenerationService titleGenerationService;
    @Mock
    private SessionMessageQueue sessionMessageQueue;

    private ChatHistoryService newService() {
        ChatMessageWriter messageWriter = new ChatMessageWriter(
                agentSessionMapper, agentMessageMapper, new AgentConstants());
        ChatHistoryService service = new ChatHistoryService(
                agentSessionMapper, agentMessageMapper, new ObjectMapper(),
                sessionMessageQueue, messageWriter);
        service.setTitleGenerationService(titleGenerationService);
        return service;
    }

    private AgentSession session(String sessionId, Integer pinned, Date updatedTime) {
        AgentSession entity = new AgentSession();
        entity.setSessionId(sessionId);
        entity.setUserId(1L);
        entity.setTitle("标题");
        entity.setPinned(pinned);
        entity.setUpdatedTime(updatedTime);
        return entity;
    }

    @Test
    void pinnedSessionIsExposedAsIsPinnedTrue() throws Exception {
        Date updated = new Date(1_700_000_000_000L);
        when(agentSessionMapper.selectByUserIdCursor(eq(1L), any(), anyInt()))
                .thenReturn(List.of(session("s-pinned", 1, updated)));

        List<SessionVO> vos = newService().getUserSessions(1L, null, 20);

        assertEquals(1, vos.size());
        assertTrue(vos.get(0).getIsPinned());
        // 序列化后的键名必须是前端约定的 isPinned
        String json = new ObjectMapper().writeValueAsString(vos.get(0));
        assertTrue(json.contains("\"isPinned\":true"), json);
    }

    @Test
    void unpinnedSessionIsExposedAsIsPinnedFalse() {
        when(agentSessionMapper.selectByUserIdCursor(eq(1L), any(), anyInt()))
                .thenReturn(List.of(session("s-plain", 0, new Date(1_700_000_000_000L))));

        List<SessionVO> vos = newService().getUserSessions(1L, null, 20);

        assertEquals(1, vos.size());
        assertFalse(vos.get(0).getIsPinned());
    }

    @Test
    void sessionWithoutPinnedColumnValueCountsAsUnpinned() {
        when(agentSessionMapper.selectByUserIdCursor(eq(1L), any(), anyInt()))
                .thenReturn(List.of(session("s-null", null, new Date(1_700_000_000_000L))));

        List<SessionVO> vos = newService().getUserSessions(1L, null, 20);

        assertFalse(vos.get(0).getIsPinned());
    }

    @Test
    void pinningKeepsLastActivityTime() {
        Date updated = new Date(1_700_000_000_000L);
        when(agentSessionMapper.selectBySessionId("s-1")).thenReturn(session("s-1", 0, updated));

        newService().updatePinStatus("s-1", 1L, true);

        ArgumentCaptor<Date> updatedTime = ArgumentCaptor.forClass(Date.class);
        verify(agentSessionMapper).updatePinStatus(eq("s-1"), eq(1), any(), updatedTime.capture());
        // 置顶是元数据操作：显式回写原值，压掉 updatedTime 的 ON UPDATE CURRENT_TIMESTAMP
        assertEquals(updated, updatedTime.getValue());
    }

    @Test
    void unpinningKeepsLastActivityTimeAndClearsPinTime() {
        Date updated = new Date(1_700_000_000_000L);
        when(agentSessionMapper.selectBySessionId("s-2")).thenReturn(session("s-2", 1, updated));

        newService().updatePinStatus("s-2", 1L, false);

        ArgumentCaptor<Date> pinTime = ArgumentCaptor.forClass(Date.class);
        ArgumentCaptor<Date> updatedTime = ArgumentCaptor.forClass(Date.class);
        verify(agentSessionMapper).updatePinStatus(eq("s-2"), eq(0), pinTime.capture(), updatedTime.capture());
        assertNull(pinTime.getValue());
        assertEquals(updated, updatedTime.getValue());
    }
}
