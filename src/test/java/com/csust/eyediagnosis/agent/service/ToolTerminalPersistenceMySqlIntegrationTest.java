package com.csust.eyediagnosis.agent.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.csust.eyediagnosis.agent.ToolStepContract;
import com.csust.eyediagnosis.agent.ToolStepSink;
import com.csust.eyediagnosis.agent.config.AgentConstants;
import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.mapper.AgentMessageMapper;
import com.csust.eyediagnosis.mapper.AgentSessionMapper;
import com.csust.eyediagnosis.mapper.AgentToolAuditMapper;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.utils.JsonUtils;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL, real mappers, Spring transaction proxy, queue, sink and history. Synthetic data only. */
class ToolTerminalPersistenceMySqlIntegrationTest {
    @Test
    void failedCommitIsVisibleAndHistoryRecoversTheOriginalTerminalAfterDisconnect() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "Set FLYWAY_TEST_URL for real terminal persistence gate");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        String schema = "diagnosis_ci_terminal_" + UUID.randomUUID().toString().replace("-", "");
        JdbcTemplate admin = new JdbcTemplate(new DriverManagerDataSource(url, username, password));
        admin.execute("CREATE DATABASE `" + schema + "`");
        SessionMessageQueue queue = new SessionMessageQueue(2);
        try {
            String databaseUrl = url.replaceFirst("(?<=/)[^/?]+(?=\\?|$)", schema);
            DriverManagerDataSource dataSource = new DriverManagerDataSource(databaseUrl, username, password);
            Flyway.configure().dataSource(dataSource).locations("classpath:db/migration", "classpath:db/callback")
                    .load().migrate();
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);
            MybatisConfiguration config = new MybatisConfiguration();
            config.setMapUnderscoreToCamelCase(false);
            config.addMapper(AgentSessionMapper.class);
            config.addMapper(AgentMessageMapper.class);
            config.addMapper(AgentToolAuditMapper.class);
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            factory.setConfiguration(config);
            SqlSessionTemplate mappers = new SqlSessionTemplate(factory.getObject());
            var sessions = mappers.getMapper(AgentSessionMapper.class);
            var messages = mappers.getMapper(AgentMessageMapper.class);
            ChatMessageWriter target = new ChatMessageWriter(sessions, messages, new AgentConstants());
            ProxyFactory proxy = new ProxyFactory(target);
            proxy.setProxyTargetClass(true);
            proxy.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(dataSource),
                    new AnnotationTransactionAttributeSource()));
            ChatMessageWriter writer = (ChatMessageWriter) proxy.getProxy();
            ChatHistoryService history = new ChatHistoryService(sessions, messages,
                    org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().build(), queue, writer);
            ToolAuditService audit = new ToolAuditService(mappers.getMapper(AgentToolAuditMapper.class), sessions);
            ReflectionTestUtils.setField(audit, "enabled", true);

            writer.claimOrValidateSession("failure", 42L, "synthetic");
            var frames = new ArrayList<MessageDTO>();
            AtomicReference<Throwable> streamError = new AtomicReference<>();
            ToolStepSink sink = sink("failure", history, audit);
            sink.events().asFlux().subscribe(frames::add, streamError::set);
            sink.started("call-failed", "searchDocuments", "digest", "query");
            jdbc.execute("CREATE TRIGGER fail_terminal BEFORE INSERT ON t_agent_message FOR EACH ROW "
                    + "BEGIN IF NEW.subType='tool-result' THEN SIGNAL SQLSTATE '45000' "
                    + "SET MESSAGE_TEXT='synthetic terminal write failure'; END IF; END");
            sink.finished("call-failed", "searchDocuments", false, ToolStepContract.ErrorCategory.TIMEOUT);
            assertNotNull(streamError.get(), "failed commit must reach SSE as an error");
            assertEquals(1, frames.size(), "only RUNNING, no uncommitted terminal frame");
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_agent_message", Integer.class));
            assertThrows(RuntimeException.class, () -> history.loadHistory("failure", null, 100),
                    "while recovery still fails, stale history must not be returned");
            assertEquals("TIMEOUT", jdbc.queryForObject("SELECT errorCategory FROM t_agent_tool_audit "
                    + "WHERE sessionId='failure' AND toolStatus='failed'", String.class));
            jdbc.execute("DROP TRIGGER fail_terminal");
            var recovered = history.loadHistory("failure", null, 100);
            assertEquals(1, recovered.getMessages().size());
            assertTrue(recovered.getMessages().getFirst().getContent().contains("TIMEOUT"));
            sink.finished("call-failed", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
            sink.closePending();
            assertEquals(1, history.loadHistory("failure", null, 100).getMessages().size(), "late success cannot replace TIMEOUT");

            for (ToolStepContract.ErrorCategory category : new ToolStepContract.ErrorCategory[]{
                    ToolStepContract.ErrorCategory.TIMEOUT, ToolStepContract.ErrorCategory.CANCELLED,
                    ToolStepContract.ErrorCategory.TOOL_EXCEPTION, ToolStepContract.ErrorCategory.INVALID_OUTPUT}) {
                String session = category.name();
                writer.claimOrValidateSession(session, 42L, "synthetic");
                ToolStepSink disconnected = sink(session, history, audit);
                disconnected.events().asFlux().subscribe().dispose();
                disconnected.started("disconnected", "searchDocuments", "digest", "query");
                disconnected.finished("disconnected", "searchDocuments", false, category);
                disconnected.closePending();
                var replay = history.loadHistory(session, null, 100).getMessages();
                assertEquals(1, replay.size());
                assertTrue(replay.getFirst().getContent().contains(category.name()));
            }
            writer.claimOrValidateSession("cancel", 42L, "synthetic");
            ToolStepSink cancelled = sink("cancel", history, audit);
            cancelled.events().asFlux().subscribe().dispose();
            cancelled.started("late", "searchDocuments", "digest", "query");
            cancelled.closePending();
            cancelled.finished("late", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
            assertTrue(history.loadHistory("cancel", null, 100).getMessages().getFirst().getContent().contains("cancelled"));
            writer.claimOrValidateSession("success", 42L, "synthetic");
            ToolStepSink success = sink("success", history, audit);
            var successfulFrames = new ArrayList<MessageDTO>();
            success.events().asFlux().subscribe(successfulFrames::add);
            success.started("positive", "searchDocuments", "digest", "query");
            success.finished("positive", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
            assertEquals("succeeded", successfulFrames.getLast().getToolStatus());
            assertTrue(history.loadHistory("success", null, 100).getMessages().getFirst().getContent().contains("succeeded"));

            writer.claimOrValidateSession("ack-loss", 42L, "synthetic");
            long stableId = com.baomidou.mybatisplus.core.toolkit.IdWorker.getId();
            AtomicInteger attempts = new AtomicInteger();
            assertThrows(IllegalStateException.class, () -> queue.submitRecoverableAndWait("ack-loss", "fixed", () -> {
                writer.writeAssistantMessage("ack-loss", "synthetic committed result", "tool-result", stableId);
                if (attempts.getAndIncrement() == 0) throw new IllegalStateException("synthetic acknowledgement loss");
                return null;
            }));
            assertEquals(1, history.loadHistory("ack-loss", null, 100).getMessages().size());
            assertEquals(1, jdbc.queryForObject("SELECT messageCount FROM t_agent_session WHERE sessionId='ack-loss'", Integer.class));
            assertEquals(2, attempts.get(), "one initial attempt and one explicit read recovery");

            verifyBudgetTurn(history, audit, writer, jdbc);
        } finally {
            queue.shutdown();
            admin.execute("DROP DATABASE `" + schema + "`");
        }
    }

    private static void verifyBudgetTurn(ChatHistoryService history, ToolAuditService audit,
                                         ChatMessageWriter writer, JdbcTemplate jdbc) {
        writer.claimOrValidateSession("budget-preamble", 42L, "synthetic");
        AtomicInteger calls = new AtomicInteger();
        org.springframework.ai.chat.model.ChatModel model = new org.springframework.ai.chat.model.ChatModel() {
            @Override public org.springframework.ai.chat.model.ChatResponse call(org.springframework.ai.chat.prompt.Prompt prompt) {
                throw new UnsupportedOperationException();
            }
            @Override public reactor.core.publisher.Flux<org.springframework.ai.chat.model.ChatResponse> stream(
                    org.springframework.ai.chat.prompt.Prompt prompt) {
                calls.incrementAndGet();
                var preamble = new org.springframework.ai.chat.messages.AssistantMessage("我先查询资料。");
                var toolCall = org.springframework.ai.chat.messages.AssistantMessage.builder().content("")
                        .toolCalls(java.util.List.of(new org.springframework.ai.chat.messages.AssistantMessage.ToolCall(
                                "budget-tool", "function", "searchDocuments", "{\"query\":\"synthetic\"}"))).build();
                return reactor.core.publisher.Flux.just(preamble, toolCall)
                        .map(message -> new org.springframework.ai.chat.model.ChatResponse(java.util.List.of(
                                new org.springframework.ai.chat.model.Generation(message))));
            }
        };
        var mcp = org.mockito.Mockito.mock(com.csust.eyediagnosis.agent.interceptor.TextMcpModelInterceptor.class);
        org.mockito.Mockito.when(mcp.resolveMcpCallbacks(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(new org.springframework.ai.tool.ToolCallback[0]);
        var documents = org.mockito.Mockito.mock(com.csust.eyediagnosis.agent.tools.DocumentSearchTool.class);
        org.mockito.Mockito.when(documents.searchDocuments(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn("[]");
        var constants = new AgentConstants();
        constants.setModelCallLimit(1);
        constants.setMaxIterations(10);
        var agent = new com.csust.eyediagnosis.agent.DiagnosisAgent();
        ReflectionTestUtils.setField(agent, "chatModel", model);
        ReflectionTestUtils.setField(agent, "chatHistoryService", history);
        ReflectionTestUtils.setField(agent, "toolAuditService", audit);
        ReflectionTestUtils.setField(agent, "textMcpModelInterceptor", mcp);
        ReflectionTestUtils.setField(agent, "agentConstants", constants);
        ReflectionTestUtils.setField(agent, "documentSearchTool", documents);
        ReflectionTestUtils.setField(agent, "eyeImageAnalyzerTool",
                org.mockito.Mockito.mock(com.csust.eyediagnosis.agent.tools.EyeImageAnalyzerTool.class));
        var events = agent.stream("synthetic", null, "budget-preamble", 42L, null, null)
                .collectList().block(java.time.Duration.ofSeconds(30));
        assertNotNull(events);
        assertEquals(1, calls.get());
        var terminal = events.stream().filter(event -> "MODEL_BUDGET_EXHAUSTED".equals(event.getFinishReason()))
                .findFirst().orElseThrow();
        var replay = history.loadHistory("budget-preamble", null, 100).getMessages();
        var notice = replay.stream().filter(message -> "turn-end".equals(message.getSubType())).findFirst().orElseThrow();
        assertEquals(terminal.getContent(), notice.getContent());
        assertEquals(terminal.getFinishReason(), notice.getFinishReason());
        assertTrue(replay.stream().anyMatch(message -> "我先查询资料。".equals(message.getContent())));
        assertTrue(jdbc.queryForObject("SELECT content FROM t_agent_message WHERE sessionId='budget-preamble' "
                + "AND subType='turn-end'", String.class).contains("MODEL_BUDGET_EXHAUSTED"));
    }

    private static ToolStepSink sink(String session, ChatHistoryService history, ToolAuditService audit) {
        return new ToolStepSink(session, 42L, audit::record, dto -> history.saveToolResultMessage(session, 42L,
                JsonUtils.toJson(Map.of("toolCallId", dto.getToolCallId(), "name", dto.getToolName(),
                        "status", dto.getToolStatus(), "errorCategory", dto.getErrorCategory(), "output", dto.getContent()))));
    }
}
