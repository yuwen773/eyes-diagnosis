package com.csust.eyediagnosis.controller;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.csust.eyediagnosis.agent.DiagnosisAgent;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.model.dto.agent.AgentChatRequest;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import reactor.core.publisher.Flux;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 评审 P1-04：症状/病史原文与未筛选 reasoning 不得进入日志或患者可见消息。 */
class AgentChatPrivacyTest {

    private static final String SENSITIVE = "我有青光眼病史，眼压长期偏高";
    private ListAppender<ILoggingEvent> appender;
    private Logger logger;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        UserService userService = mock(UserService.class);
        User user = new User();
        user.setId(42L);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user);

        DiagnosisAgent agent = mock(DiagnosisAgent.class);
        when(agent.stream(ArgumentMatchers.anyString(), ArgumentMatchers.any(),
                ArgumentMatchers.anyString(), ArgumentMatchers.any(), ArgumentMatchers.any(),
                ArgumentMatchers.any())).thenReturn(Flux.empty());

        AgentController controller = new AgentController();
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "chatHistoryService", mock(ChatHistoryService.class));
        ReflectionTestUtils.setField(controller, "agentConstants", new AgentConstants());
        ReflectionTestUtils.setField(controller, "diagnosisAgent", agent);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        logger = (Logger) LoggerFactory.getLogger(AgentController.class);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
    }

    private String events() {
        StringBuilder sb = new StringBuilder();
        for (ILoggingEvent event : appender.list) sb.append(event.getFormattedMessage()).append('\n');
        return sb.toString();
    }

    @Test
    void chatStreamLogsNeverContainPlaintextMessageOrRawUserId() throws Exception {
        mockMvc.perform(post("/agent/chat/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"threadId\":\"t-privacy\",\"message\":\"" + SENSITIVE + "\"}"))
                .andExpect(status().isOk());

        String logs = events();
        assertFalse(logs.contains(SENSITIVE), "用户原文不得进入日志");
        assertFalse(logs.contains("userId=42"), "日志不得携带原始用户 ID");
        assertTrue(logs.contains("messageLength=" + SENSITIVE.length()), "应记录长度而非原文");
        assertTrue(logs.contains("userIdHash="), "应记录不可逆短哈希");
    }

    @Test
    void chatStreamErrorLogKeepsOnlyClassification() throws Exception {
        DiagnosisAgent failing = mock(DiagnosisAgent.class);
        when(failing.stream(ArgumentMatchers.anyString(), ArgumentMatchers.any(),
                ArgumentMatchers.anyString(), ArgumentMatchers.any(), ArgumentMatchers.any(),
                ArgumentMatchers.any())).thenReturn(Flux.error(new IllegalStateException(SENSITIVE)));
        AgentController controller = new AgentController();
        ReflectionTestUtils.setField(controller, "userService", userServiceForUser42());
        ReflectionTestUtils.setField(controller, "chatHistoryService", mock(ChatHistoryService.class));
        ReflectionTestUtils.setField(controller, "agentConstants", new AgentConstants());
        ReflectionTestUtils.setField(controller, "diagnosisAgent", failing);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/agent/chat/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"threadId\":\"t-privacy\",\"message\":\"" + SENSITIVE + "\"}"))
                .andExpect(status().isOk());

        String logs = events();
        assertFalse(logs.contains(SENSITIVE), "异常详情（可能含请求内容）不得进入 INFO/WARN 日志");
        assertTrue(logs.contains("errorType=IllegalStateException"), "应只记录错误分类");
    }

    private UserService userServiceForUser42() {
        UserService userService = mock(UserService.class);
        User user = new User();
        user.setId(42L);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user);
        return userService;
    }

    @Test
    void agentChatRequestDefaultsKeepReasoningHidden() {
        AgentChatRequest request = new AgentChatRequest();
        assertFalse(new AgentConstants().isExposeReasoning(), "reasoning 默认必须关闭");
    }
}
