package com.csust.eyediagnosis.config;

import org.junit.jupiter.api.Test;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.CorsRegistration;
import org.springframework.web.servlet.handler.AbstractHandlerMethodMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CorsConfigTest {

    @Test
    void allowlistedOriginIsConfiguredAndCredentialsEnabled() throws Exception {
        CorsConfig config = new CorsConfig();
        config.setAllowedOrigins(List.of("http://localhost:5173"));

        CorsRegistry registry = new CorsRegistry();
        config.addCorsMappings(registry);

        // 验证 CorsConfiguration 中含授权 Origin 与 credentials=true
        CorsConfiguration corsConfig = extractFirstCorsConfiguration(registry);
        assertNotNull(corsConfig, "expected CORS configuration to be registered");
        assertTrue(corsConfig.getAllowedOrigins().contains("http://localhost:5173"),
                "allowed origin should be registered: " + corsConfig.getAllowedOrigins());
        assertEquals(Boolean.TRUE, corsConfig.getAllowCredentials());
    }

    @Test
    void configDoesNotUseWildcard() throws Exception {
        CorsConfig config = new CorsConfig();
        config.setAllowedOrigins(List.of("http://localhost:5173"));

        CorsRegistry registry = new CorsRegistry();
        config.addCorsMappings(registry);

        CorsConfiguration corsConfig = extractFirstCorsConfiguration(registry);
        assertNotNull(corsConfig);
        // 不允许 "*" 或 patterns
        assertTrue(corsConfig.getAllowedOrigins() == null
                        || !corsConfig.getAllowedOrigins().contains("*"),
                "must not allow wildcard origin when credentials are enabled");
        assertTrue(corsConfig.getAllowedOriginPatterns() == null
                        || corsConfig.getAllowedOriginPatterns().isEmpty(),
                "must not use allowedOriginPatterns (would re-enable wildcard credentials)");
    }

    @SuppressWarnings("unchecked")
    private CorsConfiguration extractFirstCorsConfiguration(CorsRegistry registry) throws Exception {
        Field f = CorsRegistry.class.getDeclaredField("registrations");
        f.setAccessible(true);
        List<CorsRegistration> list = (List<CorsRegistration>) f.get(registry);
        assertNotNull(list, "no CORS registrations found");
        CorsRegistration registration = list.get(0);
        // 反射读取注册器上注册的 CorsConfiguration
        Field corsConfigField = CorsRegistration.class.getDeclaredField("config");
        corsConfigField.setAccessible(true);
        return (CorsConfiguration) corsConfigField.get(registration);
    }
}
