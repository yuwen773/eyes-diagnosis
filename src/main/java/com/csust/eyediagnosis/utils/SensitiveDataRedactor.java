package com.csust.eyediagnosis.utils;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 工具结果与工具参数的文本级脱敏。
 *
 * <p>工具返回是外部系统的原文，工具参数是模型生成的，两者都可能夹着
 * {@code Authorization: Bearer …}、{@code "password": "…"}、PEM / PGP 私钥、
 * 带 userinfo 的数据库 URL。这些内容会进入 SSE、落库并展示，所以写出去之前
 * 统一过这一道。
 *
 * <p>只处理结构明确、可判定的凭据形态；不猜测「看起来像密码」的普通值——
 * 过度打码会把正常的医学参数一起删掉。计数类键（{@code max_tokens}、
 * {@code token_limit}）有显式豁免，否则排障信息会被一并抹掉。
 *
 * <p>值允许带空格：{@code password = correct horse battery staple}、
 * {@code Authorization: Basic dXNlcjpwYXNz} 都要整段打掉，只抹第一个词
 * 等于没抹。
 *
 * <p>脱敏后仍可能包含用户医学信息，因此工具结果只写进该用户自己的会话，
 * 不写进应用日志。
 */
public final class SensitiveDataRedactor {

    public static final String REDACTED = "••••••";

    /** PEM 私钥（含 PGP PRIVATE KEY BLOCK、RSA/EC/OPENSSH PRIVATE KEY）。 */
    private static final Pattern PEM_PRIVATE_KEY = Pattern.compile(
            "-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----"
                    + "[\\s\\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern BEARER = Pattern.compile(
            "\\b(bearer)\\s+[A-Za-z0-9._~+/=-]{8,}", Pattern.CASE_INSENSITIVE);

    /** 数据库 / 代理 URL 里的 userinfo：{@code postgres://app:s3cret@db}。 */
    private static final Pattern URL_USERINFO = Pattern.compile(
            "\\b([a-z][a-z0-9+.-]*://)([^/\\s:@]+):([^@\\s/]+)@", Pattern.CASE_INSENSITIVE);

    /**
     * 敏感键名。{@code api key} 这种键名里带空格的写法也算；
     * 计数类键由 {@link #SAFE_KEY} 单独豁免（{@code token} 会命中
     * {@code max_tokens} 里的子串）。
     */
    private static final String SECRET_KEYS =
            "(?:pass(?:word)?|passwd|pwd|secret|token|api[-_\\s]?key|apikey"
                    + "|authorization|proxy-authorization|cookie|credential"
                    + "|private[-_]?key|access[-_]?key|client[-_]?secret)";

    /** 键与值之间可能隔着引号、反斜杠（二次转义 JSON）与空白。 */
    private static final String KEY_TAIL = "[\\w.-]*[\\\\\"']*\\s*[=:]\\s*";

    /**
     * 键值对。值分三种形态：双引号、单引号（均可带转义反斜杠）、裸值到行尾。
     * 引号形态保留原引号，只替换里面的值。
     */
    private static final Pattern SECRET_PAIR = Pattern.compile(
            "(" + SECRET_KEYS + KEY_TAIL + ")(?:"
                    + "(\\\\?\")((?:[^\"\\\\\\r\\n]|\\\\.){2,})(\\\\?\")"
                    + "|(\\\\?')((?:[^'\\\\\\r\\n]|\\\\.){2,})(\\\\?')"
                    + "|([^\\r\\n,;}\\]]{2,})"
                    + ")",
            Pattern.CASE_INSENSITIVE);

    /** 计数 / 上限类键：打码它们只会让排障更难。 */
    private static final Pattern SAFE_KEY = Pattern.compile(
            "^(?:max[-_ ]?)?tokens?(?:[-_ ]?(?:count|limit|budget|size))?$",
            Pattern.CASE_INSENSITIVE);

    private SensitiveDataRedactor() {
    }

    public static String redact(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        String out = PEM_PRIVATE_KEY.matcher(text).replaceAll(REDACTED);
        out = BEARER.matcher(out).replaceAll("$1 " + REDACTED);
        out = URL_USERINFO.matcher(out).replaceAll("$1$2:" + REDACTED + "@");
        return redactPairs(out);
    }

    private static String redactPairs(String text) {
        Matcher matcher = SECRET_PAIR.matcher(text);
        StringBuilder out = new StringBuilder(text.length());
        while (matcher.find()) {
            String prefix = matcher.group(1);
            String replacement = matcher.group();
            if (!isSafeKey(prefix)) {
                if (matcher.group(2) != null) {
                    replacement = prefix + matcher.group(2) + REDACTED + matcher.group(4);
                } else if (matcher.group(5) != null) {
                    replacement = prefix + matcher.group(5) + REDACTED + matcher.group(7);
                } else {
                    replacement = prefix + REDACTED;
                }
            }
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    /** 从匹配到的键前缀里取出键名，判断它是不是计数 / 上限类。 */
    static boolean isSafeKey(String keyPrefix) {
        int cut = Math.max(keyPrefix.lastIndexOf('='), keyPrefix.lastIndexOf(':'));
        String key = cut > 0 ? keyPrefix.substring(0, cut) : keyPrefix;
        key = key.replaceAll("[\\\\\"'\\s]", "").toLowerCase();
        return SAFE_KEY.matcher(key).matches();
    }
}
