package com.csust.eyediagnosis.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FlywayMySqlIntegrationTest {

    @Test
    void migratesAnEmptyMySqlDatabaseThroughTheCurrentSafetySchema() {
        String url = System.getenv("FLYWAY_TEST_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
                "Set FLYWAY_TEST_URL to run the real MySQL Flyway gate");

        Flyway flyway = Flyway.configure()
                .dataSource(url, System.getenv("FLYWAY_TEST_USERNAME"), System.getenv("FLYWAY_TEST_PASSWORD"))
                .schemas("diagnosis_ci")
                .locations("classpath:db/migration", "classpath:db/callback")
                .load();

        assertEquals(12, flyway.migrate().migrationsExecuted);
    }
}
