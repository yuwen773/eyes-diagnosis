package com.csust.eyediagnosis.db;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 仅在 SPRING_PROFILES_ACTIVE=flyway 时启用，便于 CI 在没有 MySQL 时自动跳过。
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.flyway.enabled=true",
        "spring.datasource.url=jdbc:h2:mem:flyway-baseline;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@EnabledIfEnvironmentVariable(named = "SPRING_PROFILES_ACTIVE", matches = "flyway")
class FlywayBaselineTest {

    @Autowired(required = false)
    private org.flywaydb.core.Flyway flyway;

    @Test
    void migrationsAppliedAtStartup() {
        assertNotNull(flyway, "Flyway bean not configured");
        assertTrue(flyway.info().applied().length > 0, "no migrations applied");
    }
}
