package com.csust.eyediagnosis.collaboration;

import com.fasterxml.jackson.databind.*;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.prompt.Prompt;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Test-only, newly authorized 32-request ledger. Never resets/retries/reopens a live experiment. */
final class ProductProviderLedger implements ChatModel {
    private final ObjectMapper json = new ObjectMapper();
    private final Path privateDir;
    private final Path output;
    private final String key;
    private final HttpClient client;
    private final List<Map<String, Object>> entries = new ArrayList<>();
    private volatile boolean stopped;

    ProductProviderLedger() throws Exception {
        this(Path.of("target/product-provider-private"), Path.of("docs/testing/product-acceptance-20261112/real-provider-requests.json"),
                System.getenv("DASHSCOPE_API_KEY"), verifiedClient());
    }
    ProductProviderLedger(Path privateDir, Path output, String key, HttpClient client) throws Exception {
        this.privateDir = privateDir; this.output = output; this.key = key; this.client = client;
        if (key == null || key.isBlank()) throw new IllegalArgumentException("Provider credential missing");
        Files.createDirectories(privateDir);
        Files.writeString(privateDir.resolve("RUN_STARTED"), Instant.now().toString(), StandardOpenOption.CREATE_NEW);
        persist();
    }
    private static HttpClient verifiedClient() throws Exception {
        var registration = new ObjectMapper().readTree(Path.of("docs/testing/product-acceptance-20261112/live-preregistration.json").toFile());
        for (var files = registration.path("files").fields(); files.hasNext();) {
            var file = files.next();
            if (!sha(Files.readAllBytes(Path.of(file.getKey()))).equals(file.getValue().asText())) throw new IllegalStateException("Frozen candidate changed: " + file.getKey());
        }
        return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build();
    }
    private static String sha(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private synchronized void persist() throws Exception {
        Files.writeString(output, json.writerWithDefaultPrettyPrinter().writeValueAsString(Map.of("hardLimit", 32, "requests", entries, "stopped", stopped, "realRequests", entries.size())) + "\n");
    }
    private synchronized Map<String, Object> reserve(String role, String digest, byte[] body) throws Exception {
        if (stopped || entries.size() >= 32) throw new IllegalStateException("LIVE_EXPERIMENT_STOPPED");
        String text = new String(body, StandardCharsets.UTF_8);
        if (text.contains("objectKey") || text.contains("userId") || text.contains("taskId") || text.contains("responseProtobufBase64")) { stopped = true; throw new IllegalArgumentException("Unsafe outbound fields"); }
        int id = entries.size() + 1;
        var row = new ConcurrentHashMap<String, Object>(); row.put("id", id); row.put("role", role); row.put("snapshotDigest", digest);
        row.put("reservedAt", Instant.now().toString()); row.put("state", "RESERVED"); row.put("requestSha256", sha(body));
        Files.writeString(privateDir.resolve(String.format("reservation-%02d.json", id)), json.writeValueAsString(row), StandardOpenOption.CREATE_NEW);
        Files.write(privateDir.resolve(String.format("request-%02d.json", id)), body, StandardOpenOption.CREATE_NEW);
        entries.add(row); persist(); return row;
    }
    @Override public ChatResponse call(Prompt prompt) {
        Map<String, Object> row = null; long start = System.nanoTime();
        try {
            String role = prompt.getSystemMessage().getText().split("\n")[0];
            JsonNode context = json.readTree(prompt.getUserMessage().getText());
            JsonNode inference = context.has("inference") ? context.path("inference") : context;
            byte[] body = json.writeValueAsBytes(Map.of("model", "qwen3.5-plus", "temperature", 0.2, "enable_thinking", false,
                    "max_tokens", 4000, "stream", false, "messages", List.of(Map.of("role", "system", "content", prompt.getSystemMessage().getText()),
                            Map.of("role", "user", "content", prompt.getUserMessage().getText()))));
            row = reserve(role, inference.path("snapshotDigest").asText(), body);
            var request = HttpRequest.newBuilder(URI.create("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"))
                    .timeout(Duration.ofSeconds(20)).header("Authorization", "Bearer " + key).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            row.put("state", "SENT"); persist();
            var response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            Files.write(privateDir.resolve(String.format("response-%02d.json", row.get("id"))), response.body(), StandardOpenOption.CREATE_NEW);
            row.put("httpStatus", response.statusCode()); row.put("responseSha256", sha(response.body()));
            row.put("requestId", response.headers().firstValue("x-request-id").orElse("NOT_RETURNED"));
            if (response.statusCode() != 200) {
                if (Set.of(401, 403, 429).contains(response.statusCode())) stopped = true;
                throw new org.springframework.ai.retry.NonTransientAiException("HTTP " + response.statusCode());
            }
            var data = json.readTree(response.body());
            if (data.has("usage")) row.put("usage", data.get("usage"));
            row.put("returnedModel", data.path("model").asText());
            var choices = data.path("choices");
            if (!choices.isArray() || choices.size() != 1) throw new IllegalArgumentException("INVALID_OUTPUT");
            var message = choices.get(0).path("message");
            row.put("reasoningContentPresent", message.hasNonNull("reasoning_content"));
            if (message.path("tool_calls").size() != 0 || !message.path("content").isTextual()) throw new IllegalArgumentException("INVALID_OUTPUT");
            row.put("state", "RETURNED"); return new ChatResponse(List.of(new Generation(new AssistantMessage(message.path("content").asText()))));
        } catch (Exception failure) {
            if (row != null) { row.put("state", "FAILED"); row.put("failureType", failure.getClass().getSimpleName()); }
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IllegalStateException(failure.getMessage(), failure);
        } finally {
            if (row != null) row.put("elapsedMillis", (System.nanoTime() - start) / 1_000_000);
            try { persist(); } catch (Exception failure) { stopped = true; throw new IllegalStateException("Request ledger persistence failed", failure); }
        }
    }
}
