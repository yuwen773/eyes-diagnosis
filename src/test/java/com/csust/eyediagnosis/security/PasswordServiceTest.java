package com.csust.eyediagnosis.security;

import com.csust.eyediagnosis.security.PasswordService.PasswordVerification;
import org.junit.jupiter.api.Test;
import org.springframework.util.DigestUtils;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PasswordServiceTest {

    private final PasswordService service = new PasswordService();

    @Test
    void bcryptUsesCostTwelveAndMatches() {
        String encoded = service.encode("correct horse battery staple");
        assertTrue(encoded.startsWith("$2"));
        assertTrue(service.verify("correct horse battery staple", encoded).matches());
        assertFalse(service.verify("wrong", encoded).matches());
    }

    @Test
    void legacyMd5MatchRequestsUpgrade() {
        String legacy = DigestUtils.md5DigestAsHex(
                "yuwen12345678".getBytes(StandardCharsets.UTF_8));
        PasswordVerification result = service.verify("12345678", legacy);
        assertTrue(result.matches());
        assertTrue(result.needsUpgrade());
    }
}
