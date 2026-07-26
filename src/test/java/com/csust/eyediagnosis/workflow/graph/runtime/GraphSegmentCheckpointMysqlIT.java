package com.csust.eyediagnosis.workflow.graph.runtime;

import com.alibaba.cloud.ai.graph.CompiledGraph;
import com.alibaba.cloud.ai.graph.CompileConfig;
import com.alibaba.cloud.ai.graph.KeyStrategy;
import com.alibaba.cloud.ai.graph.RunnableConfig;
import com.alibaba.cloud.ai.graph.StateGraph;
import com.alibaba.cloud.ai.graph.checkpoint.config.SaverConfig;
import com.alibaba.cloud.ai.graph.checkpoint.savers.mysql.CreateOption;
import com.alibaba.cloud.ai.graph.checkpoint.savers.mysql.MysqlSaver;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Verifies that the public snapshot/resume contract survives a fresh MysqlSaver and compiled graph. */
class GraphSegmentCheckpointMysqlIT {
    private static final String SCHEMA = "eye_diagnosis_graph_runtime_it";
    private String url;
    private String username;
    private String password;
    private Flyway flyway;
    private DriverManagerDataSource dataSource;
    private JdbcTemplate jdbc;

    @BeforeEach
    void prepareSchema() throws Exception {
        url = System.getenv("WORKFLOW_IT_MYSQL_URL"); username = System.getenv("WORKFLOW_IT_MYSQL_USERNAME"); password = System.getenv("WORKFLOW_IT_MYSQL_PASSWORD");
        Assumptions.assumeTrue(present(url) && present(username) && present(password), "Set all WORKFLOW_IT_MYSQL_* variables");
        try (Connection connection = DriverManager.getConnection(url, username, password); Statement statement = connection.createStatement()) {
            Assumptions.assumeTrue(SCHEMA.equals(connection.getCatalog()), "WORKFLOW_IT_MYSQL_URL must target " + SCHEMA);
            try (ResultSet version = statement.executeQuery("SELECT VERSION()")) { assertTrue(version.next()); assertTrue(version.getString(1).startsWith("8.")); }
        }
        flyway = Flyway.configure().dataSource(url, username, password).cleanDisabled(false).locations("classpath:db/migration", "classpath:db/callback").load();
        flyway.clean(); flyway.migrate();
        dataSource = new DriverManagerDataSource(url, username, password); jdbc = new JdbcTemplate(dataSource);
    }

    @AfterEach void cleanSchema() { if (flyway != null) { flyway.clean(); } }

    @Test
    void passResumesAcrossNewMysqlSaverAndCompiledGraphWithoutRepeatingPrefix() throws Exception {
        AtomicInteger inference = new AtomicInteger(); AtomicInteger risk = new AtomicInteger(); AtomicInteger evidence = new AtomicInteger();
        MysqlSaver saverA = saver(CreateOption.CREATE_OR_REPLACE);
        CompiledGraph graphA = passGraph(saverA, inference, risk, evidence);
        RunnableConfig start = RunnableConfig.builder().threadId("pass-thread").build();
        graphA.invokeAndGetOutput(Map.of(), start);
        var snapshot = graphA.getState(RunnableConfig.builder().threadId("pass-thread").build());

        MysqlSaver saverB = saver(CreateOption.CREATE_NONE);
        CompiledGraph graphB = passGraph(saverB, inference, risk, evidence);
        graphB.invokeAndGetOutput(Map.of(), snapshot.config().withResume());

        assertEquals(1, inference.get()); assertEquals(1, risk.get()); assertEquals(1, evidence.get());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM GRAPH_THREAD", Integer.class));
        assertTrue(jdbc.queryForObject("SELECT COUNT(*) FROM GRAPH_CHECKPOINT", Integer.class) >= 1);
    }

    @Test
    void reviewResumeLetsTheGraphChooseApproveSuccessorExactlyOnce() throws Exception {
        AtomicInteger inference = new AtomicInteger(); AtomicInteger review = new AtomicInteger(); AtomicInteger successor = new AtomicInteger();
        MysqlSaver saverA = saver(CreateOption.CREATE_OR_REPLACE);
        CompiledGraph graphA = reviewGraph(saverA, inference, review, successor);
        graphA.invokeAndGetOutput(Map.of("decision", "APPROVE_CONTINUE"), RunnableConfig.builder().threadId("review-thread").build());
        var snapshot = graphA.getState(RunnableConfig.builder().threadId("review-thread").build());

        MysqlSaver saverB = saver(CreateOption.CREATE_NONE);
        CompiledGraph graphB = reviewGraph(saverB, inference, review, successor);
        graphB.invokeAndGetOutput(Map.of("decision", "APPROVE_CONTINUE"), snapshot.config().withResume());

        assertEquals(1, inference.get()); assertEquals(1, review.get()); assertEquals(1, successor.get());
    }

    @Test
    void rejectEndsWithoutAResumeCheckpointOrSuccessor() throws Exception {
        AtomicInteger successor = new AtomicInteger();
        MysqlSaver saver = saver(CreateOption.CREATE_OR_REPLACE);
        CompiledGraph graph = new StateGraph(KeyStrategy.builder().addStrategy("decision").build())
                .addNode("risk", state -> CompletableFuture.completedFuture(Map.of()))
                .addNode("successor", state -> { successor.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addEdge(StateGraph.START, "risk")
                .addConditionalEdges("risk", state -> CompletableFuture.completedFuture("REJECT"), Map.of("REJECT", StateGraph.END, "APPROVE", "successor"))
                .addEdge("successor", StateGraph.END)
                .compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(saver).build()).build());
        graph.invokeAndGetOutput(Map.of(), RunnableConfig.builder().threadId("reject-thread").build());
        var snapshot = graph.getState(RunnableConfig.builder().threadId("reject-thread").build());

        assertEquals(StateGraph.END, snapshot.next()); assertEquals(0, successor.get());
    }

    @Test
    void checkpointMayRemainAnOrphanWhenBusinessCasDoesNotAcceptIt() throws Exception {
        AtomicInteger inference = new AtomicInteger(); AtomicInteger risk = new AtomicInteger(); AtomicInteger evidence = new AtomicInteger();
        CompiledGraph graph = passGraph(saver(CreateOption.CREATE_OR_REPLACE), inference, risk, evidence);
        graph.invokeAndGetOutput(Map.of(), RunnableConfig.builder().threadId("orphan-thread").build());
        var snapshot = graph.getState(RunnableConfig.builder().threadId("orphan-thread").build());
        jdbc.update("INSERT INTO t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,workflowVersion,explanationPublicationStatus,predictionExposureStatus) VALUES('orphan',1,'orphan','RUNNING','v','h','a',1,'NONE','NOT_AVAILABLE')");

        int cas = jdbc.update("UPDATE t_diagnosis_workflow SET workflowVersion=workflowVersion+1 WHERE workflowId='orphan' AND workflowVersion=0");

        assertEquals(0, cas); assertEquals(1L, jdbc.queryForObject("SELECT workflowVersion FROM t_diagnosis_workflow WHERE workflowId='orphan'", Long.class));
        assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM t_workflow_job WHERE workflowId='orphan'", Long.class));
        assertTrue(snapshot.config().checkPointId().isPresent()); assertTrue(jdbc.queryForObject("SELECT COUNT(*) FROM GRAPH_CHECKPOINT", Integer.class) >= 1);
    }

    private MysqlSaver saver(CreateOption option) { return MysqlSaver.builder().dataSource(dataSource).createOption(option).build(); }

    private static CompiledGraph passGraph(MysqlSaver saver, AtomicInteger inference, AtomicInteger risk, AtomicInteger evidence) throws Exception {
        return new StateGraph()
                .addNode("inference", state -> { inference.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addNode("risk", state -> { risk.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addNode("evidence", state -> { evidence.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addEdge(StateGraph.START, "inference").addEdge("inference", "risk").addEdge("risk", "evidence").addEdge("evidence", StateGraph.END)
                .compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(saver).build()).interruptAfter("risk").build());
    }

    private static CompiledGraph reviewGraph(MysqlSaver saver, AtomicInteger inference, AtomicInteger review, AtomicInteger successor) throws Exception {
        return new StateGraph(KeyStrategy.builder().addStrategy("decision").build())
                .addNode("inference", state -> { inference.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addNode("humanReview", state -> { review.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addNode("successor", state -> { successor.incrementAndGet(); return CompletableFuture.completedFuture(Map.of()); })
                .addEdge(StateGraph.START, "inference").addEdge("inference", "humanReview")
                .addConditionalEdges("humanReview", state -> CompletableFuture.completedFuture("APPROVE"), Map.of("APPROVE", "successor", "REJECT", StateGraph.END))
                .addEdge("successor", StateGraph.END)
                .compile(CompileConfig.builder().saverConfig(SaverConfig.builder().register(saver).build()).interruptBefore("humanReview").build());
    }

    private static boolean present(String value) { return value != null && !value.isBlank(); }
}
