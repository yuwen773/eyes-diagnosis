package com.csust.eyediagnosis.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.DigestUtils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * 密码服务：
 * 1) 新写入的密码统一使用 BCrypt cost 12；
 * 2) 登录时同时支持 BCrypt 校验和 legacy MD5（"yuwen" 盐）校验；
 * 3) legacy 命中时返回 needsUpgrade=true，调用方应在登录成功后即时升级为 BCrypt。
 */
@Service
public class PasswordService {

    private static final String LEGACY_SALT = "yuwen";
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

    public String encode(String rawPassword) {
        return encoder.encode(rawPassword);
    }

    public PasswordVerification verify(String rawPassword, String storedHash) {
        if (storedHash == null) {
            return new PasswordVerification(false, false);
        }
        if (storedHash.startsWith("$2")) {
            return new PasswordVerification(encoder.matches(rawPassword, storedHash), false);
        }
        if (storedHash.matches("[0-9a-fA-F]{32}")) {
            String legacy = DigestUtils.md5DigestAsHex(
                    (LEGACY_SALT + rawPassword).getBytes(StandardCharsets.UTF_8));
            boolean matched = MessageDigest.isEqual(
                    legacy.getBytes(StandardCharsets.US_ASCII),
                    storedHash.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII));
            return new PasswordVerification(matched, true);
        }
        return new PasswordVerification(false, false);
    }

    public record PasswordVerification(boolean matches, boolean needsUpgrade) {}
}
