package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.mapper.*;
import com.csust.eyediagnosis.model.entity.*;
import com.csust.eyediagnosis.upload.state.UploadStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AgentAttachmentTrustTest {
    private final AgentSessionMapper sessions = mock(AgentSessionMapper.class);
    private final AgentMessageMapper messages = mock(AgentMessageMapper.class);
    private final UploadTaskMapper uploads = mock(UploadTaskMapper.class);
    private final AgentImageUploadService images = new AgentImageUploadService();
    private final ChatHistoryService history = new ChatHistoryService(sessions, messages, new ObjectMapper(), mock(SessionMessageQueue.class), mock(ChatMessageWriter.class));
    private static final String VIEW = "/api/agent/image/view/a.png";

    AgentAttachmentTrustTest() {
        CosClientConfig config = mock(CosClientConfig.class);
        when(config.getHost()).thenReturn("https://owned.invalid");
        ReflectionTestUtils.setField(images, "cosClientConfig", config);
        ReflectionTestUtils.setField(images, "uploadTaskMapper", uploads);
        history.setImageUploadService(images);
    }

    private void owned() {
        UploadTask task = new UploadTask();
        task.setUserId(7L); task.setObjectKey("agent-chat/7/a.png");
        task.setStatus(UploadStatus.PERSISTED.getCode());
        when(uploads.selectByObjectKey(7L, task.getObjectKey())).thenReturn(task);
    }

    private AgentMessage row(String content, String subtype) {
        AgentMessage row = new AgentMessage();
        row.setId(1L); row.setSessionId("s"); row.setRole("USER");
        row.setContent(content); row.setSubType(subtype);
        when(messages.selectBySessionIdOrderByTimeASC("s", 20)).thenReturn(List.of(row));
        return row;
    }

    @Test
    void publicKindNeverChangesBodyOrGrantsAttachment() {
        String content = "{\"kind\":\"iris.user-message.v1\",\"text\":\"x\",\"images\":[\"https://other.invalid/agent-chat/7/a.png\"]}";
        row(content, null);
        var message = history.loadHistory("s", null, 20).getMessages().get(0);
        assertEquals(content, message.getContent());
        assertNull(message.getImages());
        verifyNoInteractions(uploads);
    }

    @Test
    void replayAndAuthorizedViewRecheckCurrentUploadOwnership() {
        owned();
        AgentSession session = new AgentSession(); session.setUserId(7L);
        when(sessions.selectBySessionId("s")).thenReturn(session);
        row("{\"text\":\"body\",\"images\":[\"" + VIEW + "\"]}", "user-attachments-v1");
        var message = history.loadHistory("s", null, 20).getMessages().get(0);
        assertEquals("body", message.getContent());
        assertEquals(List.of(VIEW), message.getImages());
        assertEquals("https://owned.invalid/agent-chat/7/a.png", images.resolveViewTarget("a.png", 7L));
        when(uploads.selectByObjectKey(7L, "agent-chat/7/a.png")).thenReturn(null);
        assertEquals(List.of(), history.loadHistory("s", null, 20).getMessages().get(0).getImages());
        assertThrows(BusinessException.class, () -> images.resolveViewTarget("a.png", 7L));
    }

    @Test
    void legacyRowRestoresReadableBodyOnlyWhenAnOwnedUploadProvesItWasAnEnvelope() {
        owned();
        AgentSession session = new AgentSession(); session.setUserId(7L);
        when(sessions.selectBySessionId("s")).thenReturn(session);
        String legacy = "{\"kind\":\"iris.user-message.v1\",\"text\":\"x\",\"images\":["
                + "\"https://owned.invalid/agent-chat/7/a.png\",\"https://other.invalid/agent-chat/7/a.png\"]}";
        row(legacy, null);
        var message = history.loadHistory("s", null, 20).getMessages().get(0);
        // 这一行确实带着当前用户拥有的一张上传 → 它确实是旧服务端写的附件信封：
        // 正文按信封还原成能读懂的那句话，只有归属复核通过的那一张恢复成附件。
        assertEquals("x", message.getContent());
        assertEquals(List.of(VIEW), message.getImages());
    }

    @Test
    void legacyRowWithoutOwnedUploadStaysRawAndGrantsNothing() {
        // 正文形状不是凭证：复核不通过就整段按普通文本原样显示，
        // 既不改写正文，也不补造附件。
        AgentSession session = new AgentSession(); session.setUserId(7L);
        when(sessions.selectBySessionId("s")).thenReturn(session);
        String legacy = "{\"kind\":\"iris.user-message.v1\",\"text\":\"x\",\"images\":["
                + "\"https://other.invalid/agent-chat/7/a.png\"]}";
        row(legacy, null);
        var message = history.loadHistory("s", null, 20).getMessages().get(0);
        assertEquals(legacy, message.getContent());
        assertNull(message.getImages());
    }

    @Test
    void staleToolSourcesAreDroppedButTheOriginalOutputSurvives() {
        var documents = mock(com.csust.eyediagnosis.agent.tools.DocumentSearchTool.class);
        history.setDocumentSearchTool(documents);
        AgentSession session = new AgentSession(); session.setUserId(7L);
        when(sessions.selectBySessionId("s")).thenReturn(session);
        when(documents.validateResourceRefs(anyList(), any())).thenReturn(List.of());
        AgentMessage row = new AgentMessage();
        row.setId(9L); row.setSessionId("s"); row.setRole("ASSISTANT"); row.setSubType("tool-result");
        row.setContent("{\"output\":\"模型当时说的原文\",\"resources\":["
                + "{\"id\":\"doc:1\",\"kind\":\"document\",\"source\":\"knowledge-base\",\"documentId\":\"1\"}]}");
        when(messages.selectBySessionIdOrderByTimeASC("s", 20)).thenReturn(List.of(row));

        var message = history.loadHistory("s", null, 20).getMessages().get(0);
        // 证据链不能被抹掉：来源失效只淘汰来源，模型当时的原文必须留着。
        assertTrue(message.getContent().contains("模型当时说的原文"));
        assertFalse(message.getContent().contains("历史知识来源已失效"));
        assertTrue(message.getContent().contains("sourcesExpired"));
    }

    @Test
    void legacyPlainTextRowStaysPlainTextWithoutTouchingUploads() {
        String plain = "普通提问 {\"images\":[]}";
        row(plain, null);
        var message = history.loadHistory("s", null, 20).getMessages().get(0);
        assertEquals(plain, message.getContent());
        assertNull(message.getImages());
        verifyNoInteractions(uploads);
    }

    @Test
    void foreignUploadShapedUrlsAndMalformedViewPathsAreDenied() {
        owned();
        for (String url : List.of("https://other.invalid/agent-chat/7/a.png", "https://owned.invalid/agent-chat/8/a.png", VIEW + "?redirect=x", VIEW + "#x", "/api/agent/image/view/../a.png")) {
            assertThrows(BusinessException.class, () -> images.resolveOwnedImageId(url, 7L));
        }
    }
}
