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

    private ChatHistoryService service() {
        ChatHistoryService service = new ChatHistoryService(
                sessionMapper, messageMapper, new ObjectMapper(), queue, writer);
        service.setTitleGenerationService(titleGenerationService);
        return service;
    }

    /** 取出提交给会话队列的写库任务并执行，返回真正写进库的内容。 */
    @SuppressWarnings("unchecked")
    private String runQueuedWrite() throws Exception {
        ArgumentCaptor<Callable<Object>> task = ArgumentCaptor.forClass(Callable.class);
        verify(queue).submit(eq(SESSION), task.capture());
        task.getValue().call();

        ArgumentCaptor<String> content = ArgumentCaptor.forClass(String.class);
        verify(writer).writeUserMessage(eq(SESSION), eq(USER), content.capture());
        return content.getValue();
    }

    @Test
    void imagesArePersistedInACanonicalEnvelope() throws Exception {
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        service().saveUserMessage(SESSION, USER, "帮我看看这张图",
                List.of("https://cos.example.com/a.jpg", "https://cos.example.com/b.jpg"));

        JsonNode stored = new ObjectMapper().readTree(runQueuedWrite());
        assertEquals("帮我看看这张图", stored.get("text").asText());
        assertEquals(2, stored.get("images").size());
        assertEquals("https://cos.example.com/a.jpg", stored.get("images").get(0).asText());
    }

    @Test
    void envelopeCarriesTheServerMarker() throws Exception {
        // P1-03：前端只认带标记的信封为服务端验证过的附件。标记字面量是跨语言契约，
        // 与 web/src/lib/agentStream.ts 的 USER_MESSAGE_ENVELOPE_KIND 必须逐字一致。
        when(sessionMapper.selectBySessionId(SESSION)).thenReturn(null);
        service().saveUserMessage(SESSION, USER, "看图", List.of("https://cos.example.com/a.jpg"));

        JsonNode stored = new ObjectMapper().readTree(runQueuedWrite());
        assertEquals("iris.user-message.v1", stored.get("kind").asText(),
                "没有标记，前端无法把服务端信封与用户打出的同形 JSON 区分开");
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
