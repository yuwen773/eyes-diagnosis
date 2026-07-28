package com.csust.eyediagnosis.demo;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PR-12.5 环境隔离守卫：Demo 种子绝不允许泄漏到 test/prod。 */
class DemoDataSeederGuardTest {

    @Test
    void seederIsStrictlyBoundToDemoProfile() {
        Profile profile = DemoDataSeeder.class.getAnnotation(Profile.class);
        assertNotNull(profile, "DemoDataSeeder must be profile-guarded");
        assertEquals(1, profile.value().length);
        assertEquals("demo", profile.value()[0]);
    }

    @Test
    void seederRequiresExplicitEnableSwitch() {
        ConditionalOnProperty conditional = DemoDataSeeder.class.getAnnotation(ConditionalOnProperty.class);
        assertNotNull(conditional, "DemoDataSeeder must require demo.seed.enabled=true");
        assertEquals("demo.seed", conditional.prefix());
        assertTrue(Arrays.asList(conditional.name()).contains("enabled"));
        assertEquals("true", conditional.havingValue());
    }
}
