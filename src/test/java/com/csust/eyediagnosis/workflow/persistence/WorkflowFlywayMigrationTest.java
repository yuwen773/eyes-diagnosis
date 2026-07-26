package com.csust.eyediagnosis.workflow.persistence;

import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkflowFlywayMigrationTest {
    @Test
    void appliesWorkflowMigrationsFromTheExistingV9BaselineAndIsRepeatable() throws Exception {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:workflow_flyway;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;DB_CLOSE_DELAY=-1");
        dataSource.setUser("sa");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE existing_schema_anchor (id INT PRIMARY KEY)");
        }
        Flyway flyway = Flyway.configure().dataSource(dataSource).baselineOnMigrate(true).baselineVersion("9")
                .locations("classpath:db/migration").load();
        assertEquals(4, flyway.migrate().migrationsExecuted);
        assertEquals(0, flyway.migrate().migrationsExecuted);
        Set<String> tables = Set.of("t_diagnosis_workflow", "t_diagnosis_workflow_event", "t_workflow_job", "t_workflow_node_execution", "t_inference_envelope", "t_diagnosis_citation", "t_explanation_snapshot", "t_human_review_task");
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            for (String table : tables) { try (ResultSet result = statement.executeQuery("SELECT COUNT(*) FROM " + table)) { assertTrue(result.next()); } }
        }
    }
}
