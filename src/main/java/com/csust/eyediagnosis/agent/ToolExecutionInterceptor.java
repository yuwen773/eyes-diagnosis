package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallHandler;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallResponse;
import com.alibaba.cloud.ai.graph.agent.interceptor.ToolInterceptor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
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
 */
public final class ToolExecutionInterceptor extends ToolInterceptor {

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

        sink.started(id, name, argsDigest, keyNames);
        try {
            ToolCallResponse response = handler.call(request);
            boolean failed = response == null || response.isError();
            ToolStepContract.ErrorCategory category = failed
                    ? ToolStepContract.ErrorCategory.TOOL_EXCEPTION
                    : ToolStepContract.ErrorCategory.NONE;
            sink.finished(id, name, !failed, category);
            return response;
        } catch (RuntimeException e) {
            sink.finished(id, name, false, ToolStepContract.categorize(e, false));
            throw e;
        }
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
