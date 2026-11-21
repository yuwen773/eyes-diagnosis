package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.agent.DiagnosisAgent;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import reactor.core.publisher.Flux;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 重新生成的准入：登录、会话标识、按历史原文重跑，以及版本归属的前置处理。
 *
 * <p>这条路径会代替用户「再问一次」，所以错用比失败更糟：未登录必须拒绝，
 * 缺会话标识必须拒绝，重跑用的原文必须来自历史而不是一次新的输入。
 */
class AgentControllerRegenerateTest {

    private static final long USER_ID = 42L;

    private static MockMvc mvc(UserService userService, ChatHistoryService history, DiagnosisAgent agent) {
        AgentController controller = new AgentController();
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "chatHistoryService", history);
        ReflectionTestUtils.setField(controller, "agentConstants", new AgentConstants());
        ReflectionTestUtils.setField(controller, "diagnosisAgent", agent);
        return MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private static UserService loggedIn() {
        UserService userService = mock(UserService.class);
        User user = new User();
        user.setId(USER_ID);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user);
        return userService;
    }

    @Test
    void unauthenticatedRegenerationIsRejectedBeforeTouchingHistory() throws Exception {
        UserService anonymous = mock(UserService.class);
        ChatHistoryService history = mock(ChatHistoryService.class);
        DiagnosisAgent agent = mock(DiagnosisAgent.class);

        mvc(anonymous, history, agent).perform(post("/agent/chat/regenerate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"threadId\":\"t-1\",\"userMessageId\":7}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.NOT_LOGIN_ERROR.getCode()));

        verify(history, never()).loadUserTurn(anyString(), anyLong(), any());
        verify(agent, never()).stream(anyString(), any(), anyString(), any(), any(), any(), any());
    }

    @Test
    void missingThreadIdIsRejected() throws Exception {
        ChatHistoryService history = mock(ChatHistoryService.class);
        DiagnosisAgent agent = mock(DiagnosisAgent.class);

        mvc(loggedIn(), history, agent).perform(post("/agent/chat/regenerate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userMessageId\":7}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.PARAMS_ERROR.getCode()));

        verify(history, never()).loadUserTurn(anyString(), anyLong(), any());
    }

    @Test
    void regenerationReplaysTheStoredTextAndAdoptsLegacyAnswersFirst() throws Exception {
        ChatHistoryService history = mock(ChatHistoryService.class);
        DiagnosisAgent agent = mock(DiagnosisAgent.class);
        when(history.loadUserTurn("t-1", USER_ID, 7L))
                .thenReturn(new ChatHistoryService.UserTurn(7L, "历史里的原文", List.of()));
        when(agent.stream(anyString(), any(), anyString(), any(), any(), any(), any()))
                .thenReturn(Flux.empty());

        mvc(loggedIn(), history, agent).perform(post("/agent/chat/regenerate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"threadId\":\"t-1\",\"userMessageId\":7}"))
                .andExpect(status().isOk());

        verify(history).adoptLegacyAnswers("t-1", USER_ID, 7L);
        // 原文来自历史；图片、MCP 选择都按请求返回的口径透传（这里未带）。
        verify(agent).stream(eq("历史里的原文"), isNull(), eq("t-1"), eq(USER_ID),
                isNull(), isNull(), any(DiagnosisAgent.TurnStamp.class));
    }

    @Test
    void mcpSelectionFromTheCallerIsForwardedNotSilentlyDropped() throws Exception {
        ChatHistoryService history = mock(ChatHistoryService.class);
        DiagnosisAgent agent = mock(DiagnosisAgent.class);
        when(history.loadUserTurn("t-1", USER_ID, 7L))
                .thenReturn(new ChatHistoryService.UserTurn(7L, "原文", List.of()));
        when(agent.stream(anyString(), any(), anyString(), any(), any(), any(), any()))
                .thenReturn(Flux.empty());

        mvc(loggedIn(), history, agent).perform(post("/agent/chat/regenerate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"threadId\":\"t-1\",\"userMessageId\":7,"
                                + "\"enabledMcpServers\":[\"srv-a\"],\"disableMcpDefault\":true}"))
                .andExpect(status().isOk());

        verify(agent).stream(eq("原文"), isNull(), eq("t-1"), eq(USER_ID),
                eq(List.of("srv-a")), eq(Boolean.TRUE), any(DiagnosisAgent.TurnStamp.class));
    }
}
