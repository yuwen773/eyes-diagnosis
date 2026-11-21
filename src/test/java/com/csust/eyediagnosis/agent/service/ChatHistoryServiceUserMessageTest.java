package com.csust.eyediagnosis.agent.service;

import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.concurrent.Callable;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 用户消息落库的信封约定：带附件时写 {@code {"text":…,"images":[…]}}，
 * 不带附件时仍是纯文本——历史回放要能凭这条记录把上传影像恢复出来，
 * 否则刷新之后资源栏就空了。
 */
@ExtendWith(MockitoExtension.class)
class ChatHistoryServiceUserMessageTest {

    private static final String SESSION = "thread-1";
    private static final long USER = 1L;

    @Mock
    private AgentSessionMapper sessionMapper;
    @Mock
    private AgentMessageMapper messageMapper;
    @Mock
    private TitleGenerationService titleGenerationService;
    @Mock
    private SessionMessageQueue queue;
    @Mock
    private ChatMessageWriter writer;
    @Mock
    private AgentImageUploadService images;

    private ChatHistoryService service() {
        ChatHistoryService service = new ChatHistoryService(
                sessionMapper, messageMapper, new ObjectMapper(), queue, writer);
        service.setTitleGenerationService(titleGenerationService);
        service.setImageUploadService(images);
        return service;
    }

    /** 取出提交给会话队列的写库任务并执行，返回真正写进库的内容。 */
    @SuppressWarnings("unchecked")
    private String runQueuedWrite() throws Exception {
        ArgumentCaptor<Callable<Void>> task = ArgumentCaptor.forClass(Callable.class);
        verify(queue).submitRecoverableAndWait(eq(SESSION), anyString(), task.capture());
        task.getValue().call();

        ArgumentCaptor<String> content = ArgumentCaptor.forClass(String.class);
        var writes = org.mockito.Mockito.mockingDetails(writer).getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("writeUserMessage")).toList();
        assertEquals(1, writes.size());
        return writes.get(0).getArgument(2);
    }

    @Test
    void imagesArePersistedInACanonicalEnvelope() throws Exception {
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        when(images.authorizedViewUrl("https://cos.example.com/a.jpg", USER)).thenReturn("/api/agent/image/view/a.jpg");
        when(images.authorizedViewUrl("https://cos.example.com/b.jpg", USER)).thenReturn("/api/agent/image/view/b.jpg");
        service().saveUserMessage(SESSION, USER, "帮我看看这张图",
                List.of("https://cos.example.com/a.jpg", "https://cos.example.com/b.jpg"));

        JsonNode stored = new ObjectMapper().readTree(runQueuedWrite());
        assertEquals("帮我看看这张图", stored.get("text").asText());
        assertEquals(2, stored.get("images").size());
        assertEquals("/api/agent/image/view/a.jpg", stored.get("images").get(0).asText());
    }

    @Test
    void attachmentIdentityUsesIndependentServerSubtype() throws Exception {
        // P1-03：附件身份放在服务端可控的 subType 列，正文里的公开 kind 字符串不再授予身份。
        // 旧信封即使被用户原样打出，也只是普通正文。
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        when(images.authorizedViewUrl("https://cos.example.com/a.jpg", USER)).thenReturn("/api/agent/image/view/a.jpg");
        service().saveUserMessage(SESSION, USER, "看图", List.of("https://cos.example.com/a.jpg"));

        JsonNode stored = new ObjectMapper().readTree(runQueuedWrite());
        assertTrue(!stored.has("kind"));
        verify(writer).writeUserMessage(eq(SESSION), eq(USER), anyString(),
                eq("user-attachments-v1"), anyLong());
    }

    @Test
    void messageWithoutImagesStaysPlainText() throws Exception {
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        service().saveUserMessage(SESSION, USER, "普通提问", List.of());

        assertEquals("普通提问", runQueuedWrite());
    }

    @Test
    void emptyImageListAlsoStaysPlainText() throws Exception {
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        service().saveUserMessage(SESSION, USER, "普通提问", null);

        assertEquals("普通提问", runQueuedWrite());
    }

    @Test
    void userMessageNeverCarriesImageDataInline() throws Exception {
        // 只登记地址：库里不存图片本身，避免把患者影像写进会话表。
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        service().saveUserMessage(SESSION, USER, "图", List.of("https://cos.example.com/a.jpg"));

        String stored = runQueuedWrite();
        assertTrue(stored.length() < 200, "信封不应内联图片数据: " + stored.length());
        verifyNoInteractions(messageMapper);
    }
}
