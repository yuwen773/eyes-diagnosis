package com.csust.eyediagnosis.workflow.persistence;

import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** H2 contract test for the repository's narrow non-terminal projection. */
class ActiveWorkflowGraphBindingRepositoryTest {
    private JdbcDataSource dataSource;

    @BeforeEach void migrate() throws Exception {
        dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:graph_binding" + System.nanoTime() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        dataSource.setUser("sa");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) { statement.execute("create table anchor(id int primary key)"); }
        Flyway.configure().dataSource(dataSource).baselineOnMigrate(true).baselineVersion("9").locations("classpath:db/migration").load().migrate();
    }

    @Test
    void nonTerminalBindingProjectionExcludesTerminalRowsAndPatientContent() throws Exception {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            insert(statement, "active", "WAITING_HUMAN_REVIEW", "patient question must not be selected");
            insert(statement, "terminal", "COMPLETED", "terminal patient question");
            try (ResultSet rows = statement.executeQuery("select workflowId,status,graphDefinitionVersion,graphDefinitionHash,actionVersion from t_diagnosis_workflow where status in ('CREATED','QUEUED','RUNNING','WAITING_HUMAN_REVIEW') order by workflowId")) {
                assertTrue(rows.next());
                assertEquals("active", rows.getString("workflowId"));
                assertEquals("fundus-diagnosis-v1", rows.getString("graphDefinitionVersion"));
                assertFalse(rows.next());
            }
        }
    }

    private static void insert(Statement statement, String workflowId, String status, String question) throws Exception {
        statement.execute("insert into t_diagnosis_workflow(workflowId,ownerUserId,creationIdempotencyKey,status,graphDefinitionVersion,graphDefinitionHash,actionVersion,explanationPublicationStatus,predictionExposureStatus,questionText) values('"
                + workflowId + "',1,'" + workflowId + "','" + status + "','fundus-diagnosis-v1','hash','diagnosis-actions-v1','NONE','NOT_AVAILABLE','" + question + "')");
    }
}
