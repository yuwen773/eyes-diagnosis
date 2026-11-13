package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.service.ChatMessageWriter;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.GlobalExceptionHandler;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AgentControllerHistoryTest {

    private AgentMessageMapper messageMapper;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        UserService userService = mock(UserService.class);
        User user = new User();
        user.setId(7L);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(user);

        AgentSessionMapper sessionMapper = mock(AgentSessionMapper.class);
        AgentSession session = new AgentSession();
        session.setSessionId("thread-a");
        session.setUserId(7L);
        when(sessionMapper.selectBySessionId("thread-a")).thenReturn(session);
        messageMapper = mock(AgentMessageMapper.class);
        ChatMessageWriter messageWriter = new ChatMessageWriter(sessionMapper, messageMapper,
                new AgentConstants());
        ChatHistoryService historyService = new ChatHistoryService(sessionMapper, messageMapper,
                new ObjectMapper(), mock(SessionMessageQueue.class), messageWriter);

        AgentController controller = new AgentController();
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "chatHistoryService", historyService);
        ReflectionTestUtils.setField(controller, "agentConstants", new AgentConstants());
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void historyRejectsNonpositivePageSizesWithoutQueryingMessages(int limit) throws Exception {
        mockMvc.perform(get("/agent/history/thread-a").param("limit", String.valueOf(limit)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.PARAMS_ERROR.getCode()));

        verifyNoInteractions(messageMapper);
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void sessionsRejectNonpositivePageSizes(int limit) throws Exception {
        mockMvc.perform(get("/agent/sessions").param("limit", String.valueOf(limit)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(ErrorCode.PARAMS_ERROR.getCode()));
    }

    @ParameterizedTest
    @CsvSource({"40,40", "200,100"})
    void historyKeepsValidPageSizesAndCapsLargeRequests(int requested, int effective) throws Exception {
        mockMvc.perform(get("/agent/history/thread-a").param("limit", String.valueOf(requested)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.messages").isEmpty())
                .andExpect(jsonPath("$.data.hasMore").value(false));

        verify(messageMapper).selectBySessionIdOrderByTimeASC("thread-a", effective);
    }
}
