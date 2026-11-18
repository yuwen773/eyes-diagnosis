package com.csust.eyediagnosis.poc.realtime;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/**
 * TASK-11 B1 — ISOLATED PROOF OF CONCEPT, TEST SCOPE ONLY.
 *
 * <p>This class is deliberately NOT a Spring bean, NOT registered in {@code application.yml}
 * and NOT wired into {@code PatientDraftCoordinator} or {@code DraftAgents.Transport}. It
 * exists to prove which parts of a strictly-format-only retry can be made safe with a
 * deterministic model, and to show why runtime enablement is still blocked: a retry needs
 * a durable per-attempt idempotency record that the current medical workflow does not have.
 *
 * <p>Rules enforced here (stricter than the task, never looser):
 * <ul>
 *   <li>Only {@link JsonProcessingException} from the strict mapper (JSON syntax or
 *       creator-property / schema validation) may trigger the single extra attempt.</li>
 *   <li>Provider faults, timeouts, response-shape guards, content-safety rejections and
 *       insufficient-citation faults are terminal; no second model call.</li>
 *   <li>Every REAL attempt is charged to the shared durable-style ledger BEFORE the call.</li>
 *   <li>The retry reuses the exact same role, instructions, context, evidence version,
 *       task id and fencing token; nothing is rewritten or re-retrieved.</li>
 *   <li>Cancellation, fencing and total-deadline guards are checked before each attempt.</li>
 *   <li>CRITIC is excluded so its feedback budget cannot be affected.</li>
 *   <li>A CHARGED row without a COMMITTED result blocks a fresh "process" from issuing
 *       the model call again. A naive retry without this ledger would double-call.</li>
 * </ul>
 *
 * <p>Default OFF: {@code enabled=false} means exactly one attempt.
 */
public final class FormatOnlyRetryPoc {

    private static final Object CRASH = new Object();

    public enum Fault {
        RESPONSE_SHAPE, PROVIDER, TIMEOUT, SAFETY, INSUFFICIENT_CITATION, FORMAT_SCHEMA
    }

    public enum ChargeResult { OK, DUPLICATE, BUDGET, FENCING }

    public enum RowState { CHARGED, COMMITTED, FAILED }

    /** Immutable identity of one logical model call. The retry must not mutate any field. */
    public record AttemptSpec(String callId, String taskId, String role, String instructions,
                              Object context, int evidenceVersion, String workflowVersion,
                              long fencingToken) {
        public AttemptSpec {
            Objects.requireNonNull(callId);
            Objects.requireNonNull(taskId);
            Objects.requireNonNull(role);
            Objects.requireNonNull(instructions);
            Objects.requireNonNull(context);
            Objects.requireNonNull(workflowVersion);
        }
    }

    public record LedgerRow(AttemptSpec spec, RowState state, String result) {}

    /** Stands in for a durable per-attempt table; shared across simulated process restarts. */
    public static final class Ledger {
        private final Map<String, LedgerRow> rows = new LinkedHashMap<>();
        private final int maxCalls;
        private long fencingToken;
        private int charged;

        public Ledger(int maxCalls, long fencingToken) {
            this.maxCalls = maxCalls;
            this.fencingToken = fencingToken;
        }

        public synchronized LedgerRow find(String attemptId) { return rows.get(attemptId); }

        public synchronized ChargeResult charge(String attemptId, AttemptSpec spec) {
            if (rows.containsKey(attemptId)) return ChargeResult.DUPLICATE;
            if (charged >= maxCalls) return ChargeResult.BUDGET;
            if (spec.fencingToken() != fencingToken) return ChargeResult.FENCING;
            rows.put(attemptId, new LedgerRow(spec, RowState.CHARGED, null));
            charged++;
            return ChargeResult.OK;
        }

        public synchronized void commit(String attemptId, String result) {
            LedgerRow row = rows.get(attemptId);
            if (row == null || row.state() != RowState.CHARGED) {
                throw new IllegalStateException("Only a charged, in-flight attempt can commit");
            }
            rows.put(attemptId, new LedgerRow(row.spec(), RowState.COMMITTED, result));
        }

        public synchronized void fail(String attemptId) {
            LedgerRow row = rows.get(attemptId);
            if (row == null || row.state() != RowState.CHARGED) {
                throw new IllegalStateException("Only a charged, in-flight attempt can fail");
            }
            rows.put(attemptId, new LedgerRow(row.spec(), RowState.FAILED, null));
        }

        public synchronized int chargedCount() { return charged; }

        public synchronized void bumpFence(long next) { fencingToken = next; }

        /** Recovery evidence: an attempt charged but never committed is never re-dispatched. */
        public synchronized int pendingChargedCount() {
            return (int) rows.values().stream().filter(r -> r.state() == RowState.CHARGED).count();
        }
    }

    /** Terminal fault classification. Only Jackson parse/strict-schema failures are format-only. */
    public static final class PocFault extends RuntimeException {
        private final Fault fault;
        public PocFault(Fault fault) {
            super("synthetic " + fault + " fault", null);
            this.fault = fault;
        }
        public Fault fault() { return fault; }
    }

    /** Simulated abrupt process death AFTER the attempt was charged and BEFORE any result. */
    public static final class ProcessCrash extends RuntimeException {
        public ProcessCrash() { super("synthetic process death", null); }
    }

    public static final class RetryBlocked extends RuntimeException {
        private final String reason;
        public RetryBlocked(String reason) {
            super("retry blocked: " + reason, null);
            this.reason = reason;
        }
        public String reason() { return reason; }
    }

    /** Deterministic, zero-network ChatModel. A script entry is text, a PocFault, or CRASH. */
    public static final class ScriptedModel implements ChatModel {
        private final Deque<Object> script = new ArrayDeque<>();
        private final List<Prompt> prompts = new ArrayList<>();

        public ScriptedModel then(String text) { script.add(Objects.requireNonNull(text)); return this; }
        public ScriptedModel thenFault(Fault fault) { script.add(new PocFault(fault)); return this; }
        public ScriptedModel thenCrash() { script.add(CRASH); return this; }

        public int calls() { return prompts.size(); }
        public List<Prompt> prompts() { return List.copyOf(prompts); }

        @Override
        public ChatResponse call(Prompt prompt) {
            prompts.add(prompt);
            Object next = script.poll();
            if (next == null) throw new AssertionError("Scripted model exhausted");
            if (next instanceof PocFault fault) throw fault;
            if (next == CRASH) throw new ProcessCrash();
            return new ChatResponse(List.of(new Generation(new AssistantMessage((String) next))));
        }
    }

    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES);

    private final ChatModel model;
    private final Ledger ledger;
    private final boolean enabled;
    private final long deadlineAtMillis;
    private final BooleanSupplier cancelled;
    private final LongSupplier now;

    public FormatOnlyRetryPoc(ChatModel model, Ledger ledger, boolean enabled,
                              long deadlineAtMillis, BooleanSupplier cancelled, LongSupplier now) {
        this.model = Objects.requireNonNull(model);
        this.ledger = Objects.requireNonNull(ledger);
        this.enabled = enabled;
        this.deadlineAtMillis = deadlineAtMillis;
        this.cancelled = cancelled;
        this.now = now;
    }

    /** Never retry CRITIC: the feedback budget is a separate, already-frozen contract. */
    private static boolean retryableRole(String role) {
        return !Set.of("CRITIC").contains(role);
    }

    public static boolean isFormatOnly(Throwable failure) {
        return failure instanceof JsonProcessingException;
    }

    private static String attemptId(AttemptSpec spec, int index) {
        return spec.callId() + ":attempt:" + index;
    }

    public <T> T ask(AttemptSpec spec, Class<T> output) throws JsonProcessingException {
        int maxAttempts = enabled && retryableRole(spec.role()) ? 2 : 1;
        JsonProcessingException lastFormatFailure = null;

        for (int index = 1; index <= maxAttempts; index++) {
            String id = attemptId(spec, index);
            LedgerRow existing = ledger.find(id);
            if (existing != null) {
                if (existing.state() == RowState.COMMITTED) {
                    return json.readValue(existing.result(), output);
                }
                // CHARGED with no commit = an in-flight call whose outcome is unknown
                // after process death. FAILED = a terminal attempt already accounted
                // for. Neither state is allowed to dispatch the model again.
                throw new RetryBlocked(existing.state() == RowState.CHARGED
                        ? "RECOVERY_PENDING" : "ALREADY_CONSUMED");
            }
            if (cancelled.getAsBoolean()) throw new RetryBlocked("CANCELLED");
            if (now.getAsLong() > deadlineAtMillis) throw new RetryBlocked("TOTAL_TIMEOUT");

            ChargeResult charge = ledger.charge(id, spec);
            if (charge == ChargeResult.BUDGET) throw new RetryBlocked("CALL_BUDGET");
            if (charge == ChargeResult.FENCING) throw new RetryBlocked("FENCING_MISMATCH");
            if (charge != ChargeResult.OK) throw new RetryBlocked("DUPLICATE_ATTEMPT");

            String text;
            try {
                text = invoke(spec);
            } catch (ProcessCrash crash) {
                // No fail/commit: the row stays CHARGED, exactly like a killed process.
                throw crash;
            } catch (PocFault fault) {
                ledger.fail(id);
                throw fault;
            } catch (JsonProcessingException e) {
                // Context serialization is not model-output jitter; never retry it.
                ledger.fail(id);
                throw e;
            } catch (RuntimeException e) {
                ledger.fail(id);
                throw new PocFault(Fault.PROVIDER);
            }

            try {
                T parsed = json.readValue(text, output);
                if (parsed == null) {
                    ledger.fail(id);
                    throw new PocFault(Fault.RESPONSE_SHAPE);
                }
                ledger.commit(id, text);
                return parsed;
            } catch (JsonProcessingException e) {
                ledger.fail(id);
                lastFormatFailure = e;
                // Stay on the identical spec: same role, context, evidence version, task.
            }
        }
        throw lastFormatFailure;
    }

    /** Same prompt construction as DraftAgents.Transport.ask, including the no-tools options. */
    private String invoke(AttemptSpec spec) throws JsonProcessingException {
        var options = ToolCallingChatOptions.builder().toolCallbacks(List.of()).toolNames(Set.of())
                .internalToolExecutionEnabled(false).maxTokens(4000).build();
        var prompt = new Prompt(List.of(
                new SystemMessage(spec.role() + "\n" + spec.instructions()),
                new UserMessage(json.writeValueAsString(spec.context()))), options);
        var response = model.call(prompt);
        if (response == null || response.getResults() == null || response.getResults().size() != 1
                || response.getResult().getOutput().hasToolCalls()) {
            throw new PocFault(Fault.RESPONSE_SHAPE);
        }
        String text = response.getResult().getOutput().getText();
        if (text == null || text.length() > 32_000) throw new PocFault(Fault.RESPONSE_SHAPE);
        return text;
    }
}
