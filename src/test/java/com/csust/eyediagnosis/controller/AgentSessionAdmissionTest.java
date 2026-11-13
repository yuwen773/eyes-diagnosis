package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.mapper.*;
import com.csust.eyediagnosis.model.entity.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AgentSessionAdmissionTest {
    private MockMvc mvc;
    private final Map<String, AgentSession> sessions = new HashMap<>();
    private AgentMessageMapper messages;
    private SessionMessageQueue queue;
    private com.csust.eyediagnosis.agent.DiagnosisAgent model;

    @BeforeEach void setup() {
        var users = mock(com.csust.eyediagnosis.service.UserService.class);
        var user = new User(); user.setId(7L); when(users.getLoginUser(any())).thenReturn(user);
        var mapper = mock(AgentSessionMapper.class);
        when(mapper.selectBySessionId(any())).thenAnswer(call -> sessions.get(call.getArgument(0)));
        when(mapper.insert(any(AgentSession.class))).thenAnswer(call -> { AgentSession session = call.getArgument(0); sessions.put(session.getSessionId(), session); return 1; });
        messages = mock(AgentMessageMapper.class); queue = mock(SessionMessageQueue.class);
        var history = new ChatHistoryService(mapper, messages, new com.fasterxml.jackson.databind.ObjectMapper(), queue);
        history.setAgentConstants(new AgentConstants());
        model = mock(com.csust.eyediagnosis.agent.DiagnosisAgent.class);
        var controller = new AgentController();
        ReflectionTestUtils.setField(controller, "userService", users); ReflectionTestUtils.setField(controller, "chatHistoryService", history);
        ReflectionTestUtils.setField(controller, "diagnosisAgent", model);
        mvc = MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new com.csust.eyediagnosis.exception.GlobalExceptionHandler()).build();
    }
    @AfterEach void noModelOrMessageSideEffects() { verifyNoInteractions(model, messages, queue); }

    @Test void emptySessionCreationAndReplayNeverGenerateChatOrModelCalls() throws Exception {
        for (int i = 0; i < 2; i++) mvc.perform(post("/agent/sessions").contentType("application/json").content("{\"sessionId\":\"empty-thread\"}"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.sessionId").value("empty-thread"))
                .andExpect(jsonPath("$.data.messageCount").value(0)).andExpect(header().string("Cache-Control", "no-store"));
        org.junit.jupiter.api.Assertions.assertEquals(1, sessions.size());
    }
    @Test void anotherOwnerCannotClaimAnExistingThread() throws Exception {
        var other = new AgentSession(); other.setUserId(8L); other.setStatus(1); sessions.put("other", other);
        mvc.perform(post("/agent/sessions").contentType("application/json").content("{\"sessionId\":\"other\"}"))
                .andExpect(jsonPath("$.code").value(40101));
        org.junit.jupiter.api.Assertions.assertEquals(8L, sessions.get("other").getUserId());
    }
    @ParameterizedTest @ValueSource(strings = {"", "bad/path", "bad thread", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
    void invalidIdentifiersAreRejected(String id) throws Exception {
        mvc.perform(post("/agent/sessions").contentType("application/json").content("{\"sessionId\":\"" + id + "\"}"))
                .andExpect(jsonPath("$.code").value(40000));
        org.junit.jupiter.api.Assertions.assertTrue(sessions.isEmpty());
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void inactiveAndExpiredThreadsCannotBeRevived(boolean expired) throws Exception {
        var old = new AgentSession(); old.setUserId(7L); old.setStatus(expired ? 1 : 0);
        old.setExpiredTime(expired ? new Date(0) : null); sessions.put("old", old);
        mvc.perform(post("/agent/sessions").contentType("application/json").content("{\"sessionId\":\"old\"}"))
                .andExpect(jsonPath("$.code").value(40101));
    }
}
