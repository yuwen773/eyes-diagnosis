package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallHandler;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolInterceptor;
import com.csust.eyediagnosis.agent.observability.ToolResourceContext;
import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import com.csust.eyediagnosis.utils.SensitiveDataRedactor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.TreeSet;

/**
 * Observes REAL tool execution for one chat stream. Registered per request through
 * {@code ReactAgent.Builder.interceptors(...)}; it is never a Spring singleton.
 *
 * <p>Two outputs, both fail-closed with respect to sensitive data:
 * <ul>
 *   <li>Status events into {@link ToolStepSink} — SUCCEEDED only after the delegate
 *       handler actually returned a successful response.</li>
 *   <li>A structured audit record. The only argument-derived material is an HMAC
 *       over the sorted JSON key names; values (which may contain patient data or
 *       secrets) are never read, logged or persisted. A shared low-entropy value
 *       cannot be recovered from a key-name digest, and the HMAC key is server-side.</li>
 * </ul>
 *
 * <p><b>失败语义</b>：本类只陈述自己观察到的事实。它向内层 handler 要结果时，
 * 异常会原样抛出，由最外层的
 * {@link com.csust.eyediagnosis.agent.guard.ToolFailureBoundaryInterceptor}
 * 转成 {@code ToolCallResponse.error(...)}。不要在这里把异常吞成正常结果——
 * 那正是 1.1.2.2 内置 {@code ToolExecutionException} 处理会犯的错。
 */
public final class ToolExecutionInterceptor extends ToolInterceptor {

    /** 工具正文出站前的硬上限：历史行有长度约束，整段 JSON 结果不适合原样下发。 */
    static final int MAX_TOOL_RESULT_CHARS = 32_000;

    /**
     * 字节上限，比字符上限更硬。
     *
     * <p>历史表的 {@code content} 列在 V27 之前建库的实例上仍是 {@code TEXT}
     * （65,535 <b>字节</b>）——V27 的 {@code CREATE TABLE IF NOT EXISTS} 不会改造旧表。
     * 32,000 个中文字符约 96 KB，写进去会触发 1406，而且失败发生在会话写队列的
     * 异步任务里，用户只看到「刷新后这一步变成未确认」。这里按 UTF-8 字节再兜一刀。
     */
    static final int MAX_TOOL_RESULT_BYTES = 48_000;

    private final ToolStepSink sink;
    private final ObjectMapper json = new ObjectMapper();
    private final byte[] hmacKey;

    public ToolExecutionInterceptor(ToolStepSink sink, byte[] hmacKey) {
        this.sink = sink;
        this.hmacKey = hmacKey.clone();
    }

    @Override
    public String getName() {
        return "iris-tool-step-observer";
    }

    @Override
    public ToolCallResponse interceptToolCall(ToolCallRequest request, ToolCallHandler handler) {
        String id = request.getToolCallId();
        String name = request.getToolName();
        String argsDigest = digestOfKeyNames(request.getArguments());
        String keyNames = keyNamesOf(request.getArguments());

        // 上一次调用若异常退出可能留下残渣：开始前清空，避免串到这一次。
        ToolResourceContext.drain();
        sink.started(id, name, argsDigest, keyNames);
        try {
            ToolCallResponse response = handler.call(request);
            boolean failed = response == null || response.isError();
            if (failed) {
                ToolResourceContext.drain();
                // 失败/超时/中断的调用不带走任何资源：侧栏不拿它当证据。
                // 预算拒绝也走这里——工具确实没有产出结果。
                sink.finished(id, name, false, ToolStepContract.ErrorCategory.TOOL_EXCEPTION);
            } else {
                // 资源只来自成功调用；工具不知道框架分配的 toolCallId，在这里补齐。
                List<ResourceRef> resources = ToolResourceContext.drain().stream()
                        .map(ref -> ref.withToolCallId(id))
                        .toList();
                sink.finished(id, name, true, ToolStepContract.ErrorCategory.NONE,
                        resources, outboundContent(response));
            }
            return response;
        } catch (RuntimeException e) {
            ToolResourceContext.drain();
            sink.finished(id, name, false, ToolStepContract.categorize(e, false));
            throw e;
        }
    }

    /** 出站前统一脱敏 + 截断；两种处理都在这里做一次，避免各处口径漂移。 */
    static String outboundContent(ToolCallResponse response) {
        if (response == null || response.getResult() == null) {
            return "";
        }
        return truncate(SensitiveDataRedactor.redact(response.getResult()));
    }

    private static String truncate(String content) {
        String cut = byChars(content);
        return byBytes(cut, cut.length() < content.length());
    }

    private static String byChars(String content) {
        if (content.length() <= MAX_TOOL_RESULT_CHARS) {
            return content;
        }
        int cut = MAX_TOOL_RESULT_CHARS;
        // 切点落在代理对中间会留下孤立高代理：浏览器渲染成替换符，
        // utf8mb4 列也可能拒收整行历史。
        if (Character.isHighSurrogate(content.charAt(cut - 1))) {
            cut -= 1;
        }
        return content.substring(0, cut) + "\n…（工具结果过长，已截断）";
    }

    /** 再按 UTF-8 字节收敛一次；只在中文字符边界切断，不留半个码点。 */
    private static String byBytes(String content, boolean alreadyTruncated) {
        byte[] utf8 = content.getBytes(StandardCharsets.UTF_8);
        if (utf8.length <= MAX_TOOL_RESULT_BYTES) {
            return content;
        }
        int bytes = 0;
        int end = 0;
        while (end < content.length()) {
            int codePoint = content.codePointAt(end);
            int width = new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8).length;
            if (bytes + width > MAX_TOOL_RESULT_BYTES) break;
            bytes += width;
            end += Character.charCount(codePoint);
        }
        String suffix = alreadyTruncated ? "" : "\n…（工具结果过长，已截断）";
        return content.substring(0, end) + suffix;
    }

    /** Sorted argument key names only. Malformed JSON degrades to a fixed marker. */
    private String keyNamesOf(String arguments) {
        if (arguments == null || arguments.isBlank()) return "";
        try {
            JsonNode node = json.readTree(arguments);
            if (!node.isObject()) return "[non-object]";
            TreeSet<String> keys = new TreeSet<>();
            node.fieldNames().forEachRemaining(keys::add);
            return String.join(",", keys);
        } catch (Exception e) {
            return "[unparsed]";
        }
    }

    /**
     * Protected digest of key names. HMAC (not a bare hash) prevents dictionary
     * attacks; no values enter the digest, so even a known key name/value pair
     * cannot be reversed from the stored string.
     */
    private String digestOfKeyNames(String arguments) {
        String keys = keyNamesOf(arguments);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(hmacKey, "HmacSHA256"));
            byte[] out = mac.doFinal(keys.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(out);
        } catch (Exception e) {
            // No fallback to a plain hash: an unavailable digest must not silently
            // downgrade to a reversible value.
            return "[unavailable]";
        }
    }
}
