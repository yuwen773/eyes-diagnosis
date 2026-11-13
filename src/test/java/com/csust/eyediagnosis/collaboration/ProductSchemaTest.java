package com.csust.eyediagnosis.collaboration;

import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import static org.junit.jupiter.api.Assertions.*;

class ProductSchemaTest {
    @Test void freshSchemaContainsRealLoginAndEmptyChatDependencies() {
        String url = System.getenv("PRODUCT_ACCEPTANCE_TEST_URL");
        Assumptions.assumeTrue(url != null, "Requires isolated PRODUCT_ACCEPTANCE_TEST_URL");
        if (!url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/product_acceptance_test")) throw new IllegalArgumentException("Dedicated schema required");
        var source = new DriverManagerDataSource(url, "product_acceptance", "product_acceptance");
        org.flywaydb.core.Flyway.configure().dataSource(source).locations("classpath:db/migration", "classpath:db/callback").load().migrate();
        var jdbc = new JdbcTemplate(source);
        assertDoesNotThrow(() -> jdbc.queryForList("SELECT id,userAccount,userPassword,userRole FROM t_user LIMIT 0"));
        assertDoesNotThrow(() -> jdbc.queryForList("SELECT id,sessionId,userId,title,status,expiredTime,isDelete,pinned,pinTime FROM t_agent_session LIMIT 0"));
        assertDoesNotThrow(() -> jdbc.queryForList("SELECT id,sessionId,role,subType,content,tokenCount,isSummary,createdTime FROM t_agent_message LIMIT 0"));
    }
}
