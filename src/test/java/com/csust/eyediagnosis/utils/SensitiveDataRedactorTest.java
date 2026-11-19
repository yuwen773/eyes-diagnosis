package com.csust.eyediagnosis.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 脱敏只抹凭据、不抹正常内容。这里按审查列出的绕过逐条锁住：
 * 值带空格、键名带空格、URL userinfo、二次转义 JSON、PGP 私钥、
 * 以及计数类键的豁免。
 */
class SensitiveDataRedactorTest {

    private static final String R = SensitiveDataRedactor.REDACTED;

    @Test
    void bearerTokenIsRedacted() {
        String out = SensitiveDataRedactor.redact("Authorization: Bearer abcdefghijklmnop");
        assertFalse(out.contains("abcdefghijklmnop"), out);
    }

    @Test
    void basicAuthValueWithSpaceIsFullyRedacted() {
        String out = SensitiveDataRedactor.redact("Authorization: Basic dXNlcjpwYXNz");
        assertFalse(out.contains("dXNlcjpwYXNz"), out);
        assertTrue(out.contains(R), out);
    }

    @Test
    void multiWordPassphraseIsFullyRedacted() {
        String out = SensitiveDataRedactor.redact("password = correct horse battery staple");
        assertFalse(out.contains("horse"), out);
    }

    @Test
    void quotedJsonSecretKeepsQuotes() {
        String out = SensitiveDataRedactor.redact("{\"password\":\"s3cret-value\"}");
        assertEquals("{\"password\":\"" + R + "\"}", out);
    }

    @Test
    void escapedJsonSecretIsRedacted() {
        String raw = "{\\\"password\\\":\\\"s3cret-value\\\"}";
        String out = SensitiveDataRedactor.redact(raw);
        assertFalse(out.contains("s3cret-value"), out);
    }

    @Test
    void keyWithSpaceIsRedacted() {
        String out = SensitiveDataRedactor.redact("api key: sk-live-1234567890");
        assertFalse(out.contains("sk-live-1234567890"), out);
    }

    @Test
    void urlUserInfoIsRedacted() {
        String out = SensitiveDataRedactor.redact("postgres://app:S3cret@db.internal:5432/x");
        assertFalse(out.contains("S3cret"), out);
        assertTrue(out.contains("app:" + R + "@"), out);
    }

    @Test
    void pgpPrivateKeyBlockIsRedacted() {
        String raw = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nAAAA\n-----END PGP PRIVATE KEY BLOCK-----";
        String out = SensitiveDataRedactor.redact(raw);
        assertFalse(out.contains("AAAA"), out);
        assertEquals(R, out);
    }

    @Test
    void countingKeysAreNotRedacted() {
        assertEquals("max_tokens: 4096", SensitiveDataRedactor.redact("max_tokens: 4096"));
        assertEquals("token_limit: 100", SensitiveDataRedactor.redact("token_limit: 100"));
        assertTrue(SensitiveDataRedactor.isSafeKey("max_tokens: "));
        assertFalse(SensitiveDataRedactor.isSafeKey("password: "));
    }

    @Test
    void ordinaryMedicalTextIsLeftAlone() {
        String text = "建议每日使用人工泪液 4 次，2 周后复查眼压。";
        assertEquals(text, SensitiveDataRedactor.redact(text));
        // 「token」作为普通词、后面没有等号或冒号时不动
        assertEquals("本次会话的 token 消耗较大", SensitiveDataRedactor.redact("本次会话的 token 消耗较大"));
    }
}
