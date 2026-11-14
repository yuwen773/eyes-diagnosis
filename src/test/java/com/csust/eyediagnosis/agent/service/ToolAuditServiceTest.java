package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.ToolStepContract;
import com.csust.eyediagnosis.agent.ToolStepSink;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.mapper.AgentToolAuditMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.csust.eyediagnosis.model.entity.AgentToolAudit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** A2: structured audit is owner-scoped, default-off, and never stores raw payloads. */
class ToolAuditServiceTest {

    private final AgentToolAuditMapper auditMapper = mock(AgentToolAuditMapper.class);
    private final AgentSessionMapper sessionMapper = mock(AgentSessionMapper.class);
    private final ToolAuditService service = new ToolAuditService(auditMapper, sessionMapper);

    private static ToolStepSink.ToolAuditRecord start(String session, Long user, String id, String name,
                                                       String digest, String keys) {
        return new ToolStepSink.ToolAuditRecord(session, user, id, name,
                ToolStepContract.Status.RUNNING, ToolStepContract.ErrorCategory.NONE,
                System.currentTimeMillis(), digest, keys);
    }

    @Test
    void disabledByDefaultWritesNothing() {
        // @Value defaults are not applied outside Spring; false is the primitive default.
        assertFalse(service.isEnabled());
        service.record(start("s1", 7L, "call-1", "searchDocuments", "digest", "query"));
        verify(auditMapper, never()).insert(any(AgentToolAudit.class));
    }

    @Test
    void enabledWritesStructuredRowWithoutSensitivePayload() {
        ReflectionTestUtils.setField(service, "enabled", true);
        service.record(start("s1", 7L, "call-1", "searchDocuments", "hmac-value", "query,userId"));

        ArgumentCaptor<AgentToolAudit> captor = ArgumentCaptor.forClass(AgentToolAudit.class);
        verify(auditMapper).insert(captor.capture());
        AgentToolAudit row = captor.getValue();
        assertEquals("s1", row.getSessionId());
        assertEquals(7L, row.getUserId());
        assertEquals("call-1", row.getToolCallId());
        assertEquals("searchDocuments", row.getToolName());
        assertEquals(ToolStepContract.Status.RUNNING.wire(), row.getToolStatus());
        assertEquals("NONE", row.getErrorCategory());
        assertEquals("hmac-value", row.getArgsDigest());
        assertEquals("query,userId", row.getArgsKeyNames());
        assertNotNull(row.getStartedAt());
        assertNull(row.getFinishedAt(), "RUNNING is not terminal");
        String serialized = String.valueOf(row);
        assertFalse(serialized.contains("patient"));
        assertFalse(serialized.contains("apiKey"));
    }

    @Test
    void terminalRowHasFinishedAtAndErrorCategory() {
        ReflectionTestUtils.setField(service, "enabled", true);
        service.record(new ToolStepSink.ToolAuditRecord("s1", 7L, "call-2", "analyzeEyeImage",
                ToolStepContract.Status.FAILED, ToolStepContract.ErrorCategory.TIMEOUT,
                System.currentTimeMillis(), null, null));

        ArgumentCaptor<AgentToolAudit> captor = ArgumentCaptor.forClass(AgentToolAudit.class);
        verify(auditMapper).insert(captor.capture());
        assertEquals(ToolStepContract.Status.FAILED.wire(), captor.getValue().getToolStatus());
        assertEquals("TIMEOUT", captor.getValue().getErrorCategory());
        assertNotNull(captor.getValue().getFinishedAt());
    }

    @Test
    void crossUserListAndSummaryAreRejected() {
        AgentSession ownedByOther = new AgentSession();
        ownedByOther.setSessionId("s1");
        ownedByOther.setUserId(99L);
        when(sessionMapper.selectBySessionId("s1")).thenReturn(ownedByOther);

        assertThrows(BusinessException.class, () -> service.listOwned("s1", 7L, 100));
        assertThrows(BusinessException.class, () -> service.summarizeOwned("s1", 7L));
        verify(auditMapper, never()).selectOwned(any(), any(), anyInt());
        verify(auditMapper, never()).summarizeOwned(any(), any());
    }

    @Test
    void missingSessionNullIdsAndUnknownUserAreRejected() {
        when(sessionMapper.selectBySessionId("missing")).thenReturn(null);
        assertThrows(BusinessException.class, () -> service.listOwned("missing", 7L, 10));
        assertThrows(BusinessException.class, () -> service.listOwned(null, 7L, 10));
        assertThrows(BusinessException.class, () -> service.listOwned("s1", null, 10));
    }

    @Test
    void ownerQueryIsBoundedAndOwnerScoped() {
        AgentSession owned = new AgentSession();
        owned.setSessionId("s1");
        owned.setUserId(7L);
        when(sessionMapper.selectBySessionId("s1")).thenReturn(owned);
        when(auditMapper.selectOwned("s1", 7L, 500)).thenReturn(List.of());

        assertTrue(service.listOwned("s1", 7L, 99999).isEmpty());
        verify(auditMapper).selectOwned(eq("s1"), eq(7L), eq(500));
    }

    @Test
    void ownerSummaryReturnsAggregates() {
        AgentSession owned = new AgentSession();
        owned.setSessionId("s1");
        owned.setUserId(7L);
        when(sessionMapper.selectBySessionId("s1")).thenReturn(owned);
        when(auditMapper.summarizeOwned("s1", 7L))
                .thenReturn(List.of(Map.of("toolName", "searchDocuments", "toolStatus", "succeeded", "cnt", 3L)));

        List<Map<String, Object>> rows = service.summarizeOwned("s1", 7L);
        assertEquals(1, rows.size());
        assertEquals("searchDocuments", rows.get(0).get("toolName"));
    }

    @Test
    void persistenceFailureNeverPropagatesIntoTheChatStream() {
        ReflectionTestUtils.setField(service, "enabled", true);
        when(auditMapper.insert(any(AgentToolAudit.class)))
                .thenThrow(new RuntimeException("DB down, row contains patient text"));
        // The interceptor calls this synchronously; an escaping exception would
        // abort the tool call and the whole SSE stream.
        assertDoesNotThrow(() -> service.record(
                start("s1", 7L, "call-1", "searchDocuments", "hmac", "query")));
    }

    @Test
    void digestKeyIsNeverNullEvenWhenPropertyIsMissing() {
        // The configured key must only be exposed as bytes to the HMAC interceptor.
        byte[] key = service.digestKey();
        assertNotNull(key);
        assertTrue(key.length > 0);
        // Still non-empty after explicitly clearing the property.
        ReflectionTestUtils.setField(service, "digestKey", null);
        assertTrue(service.digestKey().length > 0);
    }
}
