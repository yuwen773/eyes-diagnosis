package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.ToolStepContract;
import com.csust.eyediagnosis.agent.ToolStepSink;
import com.csust.eyediagnosis.mapper.AgentToolAuditMapper;
import com.csust.eyediagnosis.model.entity.AgentToolAudit;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * Security-audit persistence for ordinary-chat tool calls. This is NOT chat history:
 * {@code t_agent_message} stays the user-visible record; this service writes a
 * separate, owner-scoped table that never contains raw arguments.
 *
 * <p>Default off ({@code agent.tool-audit.enabled=false}): status events still flow
 * to the browser, but nothing is persisted. Enabling it requires the V28 table.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ToolAuditService {

    private final AgentToolAuditMapper auditMapper;
    private final AgentSessionMapper sessionMapper;

    @Value("${agent.tool-audit.enabled:false}")
    private boolean enabled;

    /** HMAC key for argument-key digests. Never log or expose it. */
    @Value("${agent.tool-audit.digest-key:iris-tool-audit-dev-only-key}")
    private String digestKey;

    private static final byte[] FALLBACK_DIGEST_KEY =
            "iris-tool-audit-dev-only-key".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    public boolean isEnabled() { return enabled; }

    /**
     * Never returns an empty/null key: a missing property would otherwise NPE inside
     * every chat stream. Production MUST override this with a server-side secret.
     */
    public byte[] digestKey() {
        if (digestKey == null || digestKey.isBlank()) return FALLBACK_DIGEST_KEY.clone();
        return digestKey.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    /**
     * Best-effort audit sink: a persistence failure must never abort a chat stream
     * or change a tool's real result. Called from the graph's tool interceptor,
     * so the exception is contained here (and only the error CLASS is logged —
     * DB exceptions can embed row values, which may include patient text).
     */
    public void record(ToolStepSink.ToolAuditRecord record) {
        if (!enabled || record == null || record.toolCallId() == null) return;
        try {
            AgentToolAudit row = new AgentToolAudit();
            row.setSessionId(record.sessionId());
            row.setUserId(record.userId());
            row.setToolCallId(record.toolCallId());
            row.setToolName(record.toolName());
            row.setToolStatus(record.status().wire());
            row.setErrorCategory(record.errorCategory() == null
                    ? ToolStepContract.ErrorCategory.NONE.name() : record.errorCategory().name());
            row.setArgsDigest(record.argsDigest());
            row.setArgsKeyNames(record.argsKeyNames());
            row.setStartedAt(new Date(record.atMillis()));
            if (record.status().terminal()) row.setFinishedAt(new Date(record.atMillis()));
            auditMapper.insert(row);
        } catch (RuntimeException e) {
            log.warn("Tool audit insert failed (chat continues), errorType={}",
                    e.getClass().getSimpleName());
        }
    }

    /** Cross-user isolation: a session owned by someone else must be rejected. */
    public List<AgentToolAudit> listOwned(String sessionId, Long userId, int limit) {
        assertOwner(sessionId, userId);
        return auditMapper.selectOwned(sessionId, userId, Math.max(1, Math.min(limit, 500)));
    }

    public List<Map<String, Object>> summarizeOwned(String sessionId, Long userId) {
        assertOwner(sessionId, userId);
        return auditMapper.summarizeOwned(sessionId, userId);
    }

    private void assertOwner(String sessionId, Long userId) {
        if (sessionId == null || userId == null) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
        }
        AgentSession session = sessionMapper.selectBySessionId(sessionId);
        if (session == null || !userId.equals(session.getUserId())) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权限访问该会话");
        }
    }
}
