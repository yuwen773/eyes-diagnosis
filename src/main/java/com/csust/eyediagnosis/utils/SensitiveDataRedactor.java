package com.csust.eyediagnosis.utils;

import java.util.regex.Pattern;

/**
 * 工具结果的文本级脱敏。
 *
 * <p>工具返回是外部系统的原文，里面可能夹着
 * {@code Authorization: Bearer …}、{@code "password": "…"}、PEM 私钥。
 * 这些内容会进入 SSE、落库并展示，所以写出去之前统一过这一道。
 *
 * <p>只处理结构明确、可判定的凭据形态；不猜测「看起来像密码」的普通值——
 * 过度打码会把正常的医学参数一起删掉。脱敏后仍可能包含用户医学信息，
 * 因此工具结果只写进该用户自己的会话，不写进应用日志。
 */
public final class SensitiveDataRedactor {

    public static final String REDACTED = "••••••";

    private static final Pattern PEM_PRIVATE_KEY = Pattern.compile(
            "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----");

    private static final Pattern BEARER = Pattern.compile(
            "\\b(bearer)\\s+[A-Za-z0-9._~+/=-]{8,}", Pattern.CASE_INSENSITIVE);

    private static final Pattern SECRET_PAIR = Pattern.compile(
            "((?:pass(?:word)?|passwd|pwd|secret|token|api[-_]?key|apikey|authorization|cookie"
                    + "|credential|private[-_]?key|access[-_]?key|client[-_]?secret)"
                    + "[\"']?\\s*[=:]\\s*)([\"']?)([^\\s\"',;}\\]]{2,})\\2",
            Pattern.CASE_INSENSITIVE);

    private SensitiveDataRedactor() {
    }

    public static String redact(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        String out = PEM_PRIVATE_KEY.matcher(text).replaceAll(REDACTED);
        out = BEARER.matcher(out).replaceAll("$1 " + REDACTED);
        out = SECRET_PAIR.matcher(out).replaceAll("$1$2" + REDACTED + "$2");
        return out;
    }
}
