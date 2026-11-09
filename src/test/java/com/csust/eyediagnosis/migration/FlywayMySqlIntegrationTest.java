package com.csust.eyediagnosis.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.sql.DriverManager;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FlywayMySqlIntegrationTest {

    @Test
    void migratesAnEmptyMySqlDatabaseThroughTheCurrentSafetySchema() throws Exception {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
                "Set FLYWAY_TEST_URL to run the real MySQL Flyway gate");

        // Keep the empty-database assertion independent of the upload mapper suite.
        String schema = "diagnosis_ci_empty_" + UUID.randomUUID().toString().replace("-", "");
        String username = System.getenv("FLYWAY_TEST_USERNAME");
        String password = System.getenv("FLYWAY_TEST_PASSWORD");
        try (var connection = DriverManager.getConnection(url, username, password);
             var statement = connection.createStatement()) {
            statement.executeUpdate("CREATE DATABASE `" + schema + "`");
            try {
                Flyway flyway = Flyway.configure()
                        .dataSource(url, username, password)
                        .schemas(schema)
                        .locations("classpath:db/migration", "classpath:db/callback")
                        .load();

                int expectedMigrations = flyway.info().all().length;
                assertEquals(expectedMigrations, flyway.migrate().migrationsExecuted);
                assertEquals("13", flyway.info().current().getVersion().toString());
            } finally {
                statement.executeUpdate("DROP DATABASE `" + schema + "`");
            }
        }
    }
}
