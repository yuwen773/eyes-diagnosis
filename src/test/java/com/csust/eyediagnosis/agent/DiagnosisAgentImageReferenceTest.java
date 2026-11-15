package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor;
import com.csust.eyediagnosis.agent.service.*;
import com.csust.eyediagnosis.agent.tools.*;
import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.mapper.UploadTaskMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import com.csust.eyediagnosis.upload.state.UploadStateMachine;
import org.junit.jupiter.api.*;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Flux;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Duration;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DiagnosisAgentImageReferenceTest {
    private final CosManager storage = mock(CosManager.class);
    private final UploadTaskMapper uploads = mock(UploadTaskMapper.class);
    private final AgentImageUploadService images = new AgentImageUploadService();
    private final DiagnosisAgent agent = new DiagnosisAgent();
    private final List<String> modelInputs = new ArrayList<>();
    private final Map<String, UploadTask> registered = new HashMap<>();
    private String url;

    @BeforeEach void fixture() throws Exception {
        var config = new CosClientConfig();
        ReflectionTestUtils.setField(config, "host", "https://fixture.invalid");
        ReflectionTestUtils.setField(images, "cosManager", storage);
        ReflectionTestUtils.setField(images, "cosClientConfig", config);
        ReflectionTestUtils.setField(images, "uploadTaskMapper", uploads);
        ReflectionTestUtils.setField(images, "uploadStateMachine", mock(UploadStateMachine.class));
        doAnswer(call -> { UploadTask task = call.getArgument(0); registered.put(task.getObjectKey(), task); return null; }).when(uploads).insertPending(any());
        when(uploads.selectByObjectKey(eq(42L), anyString())).thenAnswer(call -> registered.get(call.getArgument(1)));
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", bytes);
        url = images.uploadImage(new MockMultipartFile("file", "fixture.png", "image/png", bytes.toByteArray()), 42L);
        var model = new ChatModel() {
            public ChatResponse call(Prompt prompt) { return response(prompt); }
            public Flux<ChatResponse> stream(Prompt prompt) { return Flux.just(response(prompt)); }
            private ChatResponse response(Prompt prompt) {
                modelInputs.add(prompt.getUserMessage().getText());
                return new ChatResponse(List.of(new Generation(new AssistantMessage("Synthetic response"))));
            }
        };
        ReflectionTestUtils.setField(agent, "chatModel", model);
        ReflectionTestUtils.setField(agent, "chatHistoryService", mock(ChatHistoryService.class));
        ReflectionTestUtils.setField(agent, "agentConstants", new AgentConstants());
        ReflectionTestUtils.setField(agent, "textMcpModelInterceptor", mock(TextMcpModelInterceptor.class));
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool", new EyeImageAnalyzerTool(storage, uploads));
        ReflectionTestUtils.setField(agent, "documentSearchTool", mock(DocumentSearchTool.class));
        var audit = mock(ToolAuditService.class); when(audit.digestKey()).thenReturn(new byte[32]);
        ReflectionTestUtils.setField(agent, "toolAuditService", audit);
        ReflectionTestUtils.setField(agent, "agentImageUploadService", images);
    }

    private void chat(String reference) {
        agent.stream("analyze", List.of(reference), "thread-42", 42L, List.of(), true).blockLast(Duration.ofSeconds(5));
    }

    @Test void actualUploadUrlBecomesRegisteredObjectIdBeforeModelAndToolBoundary() {
        chat(url);
        String key = registered.keySet().iterator().next();
        assertFalse(modelInputs.isEmpty());
        assertTrue(modelInputs.getFirst().contains("<image-analysis>" + key + "</image-analysis>"), modelInputs.toString());
        assertFalse(modelInputs.getFirst().contains("https://"));
        // Exercise the real user-bound tool ownership gate with the converted ID.
        // Empty storage is rejected before inference, proving this exact key reached COS.
        assertThrows(BusinessException.class, () -> new UserBoundEyeImageAnalyzerTool(new EyeImageAnalyzerTool(storage, uploads), 42L).analyzeEyeImage(key));
        verify(storage).getObject(key);
    }

    @Test void untrustedCrossUserMissingAndDeletedReferencesNeverReachModelOrStorageRead() {
        String key = registered.keySet().iterator().next();
        for (String reference : List.of("https://attacker.invalid/" + key, "https://fixture.invalid/agent-chat/43/other.png",
                "https://fixture.invalid/agent-chat/42/missing.png", url + "?signature=untrusted", url.replace("https://", "https://user@"), url.replace("fixture.invalid", "fixture.invalid:444"))) {
            assertThrows(BusinessException.class, () -> chat(reference), reference);
        }
        registered.get(key).setStatus(5);
        assertThrows(BusinessException.class, () -> chat(url));
        assertTrue(modelInputs.isEmpty());
        verify(storage, never()).getObject(anyString());
    }
}
