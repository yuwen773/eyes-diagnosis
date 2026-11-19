package com.csust.eyediagnosis.agent.queue;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * 每会话按提交顺序串行，不同会话可并行。
 *
 * <p>三条硬约束（独立复审提出的失效模式，逐条对应）：
 * <ol>
 *   <li><b>等待有界</b>：调用方最多等 {@link #awaitTimeout}。数据库挂起时，
 *       请求线程与图工作线程都拿得到明确错误，而不是一起挂死。</li>
 *   <li><b>逐键隔离</b>：一个永久失败的写不会永久堵死该会话。失败的键累计到上限后被淘汰，
 *       后续的写照常进行；失败本身照常抛给调用方，不静默吞掉。</li>
 *   <li><b>有淘汰</b>：待写集合按会话限额与存活时长淘汰，失败的键不会无限堆积。</li>
 * </ol>
 *
 * <p>被淘汰的写在 {@link #droppedKeys} 里留键（按存活时长过期）：历史读取据此显式声明
 * 「本会话存在未提交的终态」；落库回调据此把「没写成功」和「已提交」分开，
 * 不会把一条没落库的终态发给客户端。
 */
public class SessionMessageQueue {

    private static final Logger log = LoggerFactory.getLogger(SessionMessageQueue.class);

    /** 单次落库等待上限：超过即认为数据库不可用，调用方收到明确错误。 */
    static final Duration DEFAULT_AWAIT_TIMEOUT = Duration.ofSeconds(15);
    /** 同一键连续失败多少次后淘汰：再多的重试也不会成功，只会把会话堵死。 */
    static final int MAX_ATTEMPTS = 3;
    /** 单会话待写上限：超出时淘汰最早的键（已提交的不在此列）。 */
    static final int MAX_PENDING_PER_SESSION = 256;
    /** 待写键的最长存活时间：超过即淘汰，避免失败的键永久占用内存。 */
    static final Duration PENDING_TTL = Duration.ofMinutes(30);
    /** 被淘汰键的记录保留多久：够回答「这个键写了没」，又不至于永久占用内存。 */
    static final Duration DROPPED_TTL = Duration.ofMinutes(30);

    private final ExecutorService executor;
    private final Map<String, CompletableFuture<?>> tails = new ConcurrentHashMap<>();
    private final Map<String, Map<String, PendingWrite>> pendingWrites = new ConcurrentHashMap<>();
    /**
     * 每会话被淘汰的键（键 → 淘汰时间）。
     *
     * <p><b>必须留键，不能只记数</b>：一条写的终态有三种，只有两种能靠「在不在待写集合里」分开——
     * 在 → 还没写；不在 → 写过了**或被淘汰了**。后者表示消息不在库里，绝不能被当成成功。
     * 记录按 {@link #DROPPED_TTL} 过期，内存占用有上界。
     */
    private final Map<String, Map<String, Long>> droppedKeys = new ConcurrentHashMap<>();
    private final Duration awaitTimeout;
    private final int maxPendingPerSession;

    public SessionMessageQueue(int parallelism) {
        this(parallelism, DEFAULT_AWAIT_TIMEOUT, MAX_PENDING_PER_SESSION);
    }

    public SessionMessageQueue(int parallelism, Duration awaitTimeout) {
        this(parallelism, awaitTimeout, MAX_PENDING_PER_SESSION);
    }

    SessionMessageQueue(int parallelism, Duration awaitTimeout, int maxPendingPerSession) {
        this.executor = Executors.newFixedThreadPool(Math.max(1, parallelism));
        this.awaitTimeout = awaitTimeout == null || awaitTimeout.isZero() || awaitTimeout.isNegative()
                ? DEFAULT_AWAIT_TIMEOUT : awaitTimeout;
        this.maxPendingPerSession = Math.max(1, maxPendingPerSession);
    }

    public synchronized <T> Future<T> submit(String sessionId, Callable<T> task) {
        CompletableFuture<?> previous = tails.getOrDefault(sessionId, CompletableFuture.completedFuture(null));
        CompletableFuture<T> next = previous.handle((value, error) -> null).thenApplyAsync(ignored -> {
            try {
                return task.call();
            } catch (Exception e) {
                throw new CompletionException(e);
            }
        }, executor);
        tails.put(sessionId, next);
        next.whenComplete((value, error) -> tails.remove(sessionId, next));
        return next;
    }

    /**
     * 终态等到事务提交才返回；失败的原任务保留，供显式历史重读恢复。
     *
     * <p>等待有界：超时后任务继续在后台跑完（写入按雪花 id 幂等），
     * 调用方收到明确异常，不会有「接口挂死」这种情况。
     */
    public void submitRecoverableAndWait(String sessionId, String key, Callable<Void> task) {
        Future<?> write;
        synchronized (this) {
            Map<String, PendingWrite> pending =
                    pendingWrites.computeIfAbsent(sessionId, ignored -> new LinkedHashMap<>());
            pending.putIfAbsent(key, new PendingWrite(task));
            evictOverflow(sessionId, pending);
            write = submit(sessionId, () -> {
                flush(sessionId, key);
                return null;
            });
        }
        await(write);
    }

    /**
     * 一次读取只尝试恢复一次。
     *
     * <p>**不抛错**：恢复失败必须降级成「本会话存在未提交的终态」这个显式标记，
     * 而不是让整个历史读取 500——历史里已有的消息仍然对用户可见。
     */
    public void recoverPending(String sessionId) {
        Future<?> recovery = submit(sessionId, () -> {
            flushIsolated(sessionId);
            return null;
        });
        try {
            await(recovery);
        } catch (RuntimeException notRecovered) {
            log.warn("Pending message recovery did not complete, sessionId={}, errorType={}",
                    sessionId, notRecovered.getClass().getSimpleName());
        }
    }

    /** 当前会话是否还有没落库的消息（写入失败、被淘汰或尚未提交）。 */
    public boolean hasUncommitted(String sessionId) {
        return recoveryOutcome(sessionId).uncommitted();
    }

    /** 当前会话未提交消息的明细。 */
    public RecoveryOutcome recoveryOutcome(String sessionId) {
        List<String> stillPending;
        int dropped;
        synchronized (this) {
            Map<String, PendingWrite> pending = pendingWrites.get(sessionId);
            stillPending = pending == null ? List.of() : new ArrayList<>(pending.keySet());
            Map<String, Long> droppedForSession = droppedKeys.get(sessionId);
            if (droppedForSession != null) pruneDropped(sessionId, droppedForSession);
            dropped = droppedForSession == null ? 0 : droppedForSession.size();
        }
        boolean uncommitted = !stillPending.isEmpty() || dropped > 0;
        return new RecoveryOutcome(uncommitted, stillPending.size(), dropped);
    }

    /**
     * 按提交顺序把待写键逐个写掉。
     *
     * <p>失败分两种，处理方式不同：
     * <ul>
     *   <li><b>本次提交的这一条失败</b> → 必须报给调用方。它的消息没落库，
     *       调用方（落库回调）需要据此发流错误；悄悄放过等于宣称「已提交」。</li>
     *   <li><b>前面某个键失败</b> → 顺序不能乱，后面的键先不写；但如果那个键
     *       已经被淘汰（重试到上限），它就不再挡路，继续写后面的。</li>
     * </ul>
     *
     * <p><b>收尾必须核对目标键的三种结果</b>：它可能在本轮写成功，也可能在遍历开始时
     * 就已经被淘汰（超限/过期）——后者不会出现在 {@code keys} 里，循环走完也不会报错。
     * 两种都「安静地结束」就等于把「没写」当成了「写了」，所以这里要显式判定。
     */
    private void flush(String sessionId, String targetKey) throws Exception {
        List<String> keys = pendingKeys(sessionId);
        for (String key : keys) {
            try {
                writePending(sessionId, key);
            } catch (DroppedWriteException dropped) {
                // 这个键已经因重试到上限被淘汰：它不再挡路，继续写后面的。
                // 但**本次提交的这一条**被淘汰时，失败必须报给调用方——
                // 它的消息没有落库，调用方（落库回调）要据此发流错误。
                if (key.equals(targetKey)) throw dropped.original();
            } catch (Exception failure) {
                // 前面某个键失败且还没被淘汰：顺序不能乱，后面的键先不写。
                throw failure;
            }
        }
        // 走到这里：目标键要么写成功（不在待写集合里、也没有淘汰记录），
        // 要么在遍历开始前就被淘汰了（因此根本没被尝试）。后者不能当成功。
        if (wasDropped(sessionId, targetKey)) {
            throw new IllegalStateException(
                    "Message write was dropped before it could be committed");
        }
    }

    /**
     * 恢复用的逐键隔离版本：某个键失败不影响其他键，尽最大努力提交。
     */
    private void flushIsolated(String sessionId) {
        List<String> keys = pendingKeys(sessionId);
        for (String key : keys) {
            try {
                writePending(sessionId, key);
            } catch (Exception failure) {
                log.warn("Pending message write still failing, sessionId={}, key={}, errorType={}",
                        sessionId, key, failure.getClass().getSimpleName());
            }
        }
    }

    private List<String> pendingKeys(String sessionId) {
        synchronized (this) {
            Map<String, PendingWrite> pending = pendingWrites.get(sessionId);
            if (pending == null) return List.of();
            evictExpired(sessionId, pending);
            return new ArrayList<>(pending.keySet());
        }
    }

    private void writePending(String sessionId, String key) throws Exception {
        PendingWrite pending;
        boolean dropped;
        synchronized (this) {
            Map<String, PendingWrite> map = pendingWrites.get(sessionId);
            pending = map == null ? null : map.get(key);
            dropped = pending == null && wasDropped(sessionId, key);
        }
        if (pending == null) {
            if (dropped) {
                // 不在待写集合里不等于写成功：它可能刚被淘汰（消息没落库）。
                throw new DroppedWriteException(
                        new IllegalStateException("Message write was dropped before it could be committed"));
            }
            return;
        }
        try {
            pending.task.call();
        } catch (Exception failure) {
            if (markFailure(sessionId, key)) {
                throw new DroppedWriteException(failure);
            }
            throw failure;
        }
        synchronized (this) {
            Map<String, PendingWrite> map = pendingWrites.get(sessionId);
            if (map != null) {
                map.remove(key);
                if (map.isEmpty()) pendingWrites.remove(sessionId);
            }
        }
    }

    /**
     * 累计失败次数；达到上限就淘汰该键：再重试也不会成功，只会把会话堵死。
     *
     * @return true 表示这个键已经被淘汰
     */
    private boolean markFailure(String sessionId, String key) {
        synchronized (this) {
            Map<String, PendingWrite> map = pendingWrites.get(sessionId);
            if (map == null) return false;
            PendingWrite pending = map.get(key);
            if (pending == null) return false;
            pending.attempts++;
            if (pending.attempts < MAX_ATTEMPTS) return false;
            map.remove(key);
            if (map.isEmpty()) pendingWrites.remove(sessionId);
            recordDropped(sessionId, key);
            log.error("Dropping permanently failing message write, sessionId={}, key={}, attempts={}",
                    sessionId, key, pending.attempts);
            return true;
        }
    }

    /** 单会话待写超过上限：淘汰最早的键。 */
    private void evictOverflow(String sessionId, Map<String, PendingWrite> pending) {
        while (pending.size() > maxPendingPerSession) {
            Iterator<String> keys = pending.keySet().iterator();
            if (!keys.hasNext()) return;
            String oldest = keys.next();
            keys.remove();
            recordDropped(sessionId, oldest);
            log.error("Dropping oldest pending message write (session over cap), sessionId={}, key={}",
                    sessionId, oldest);
        }
    }

    /** 待写键存活超过上限：淘汰，避免失败的键永久占用内存。 */
    private void evictExpired(String sessionId, Map<String, PendingWrite> pending) {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, PendingWrite>> iterator = pending.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, PendingWrite> entry = iterator.next();
            if (now - entry.getValue().createdAt < PENDING_TTL.toMillis()) continue;
            iterator.remove();
            recordDropped(sessionId, entry.getKey());
            log.error("Dropping expired pending message write, sessionId={}, key={}", sessionId, entry.getKey());
        }
    }

    /** 记下「这个键被淘汰了」——flush / writePending 靠它把「已提交」和「没提交」分开。 */
    private void recordDropped(String sessionId, String key) {
        Map<String, Long> dropped = droppedKeys.computeIfAbsent(sessionId, ignored -> new LinkedHashMap<>());
        dropped.put(key, System.currentTimeMillis());
        pruneDropped(sessionId, dropped);
    }

    private void pruneDropped(String sessionId, Map<String, Long> dropped) {
        long now = System.currentTimeMillis();
        dropped.entrySet().removeIf(entry -> now - entry.getValue() > DROPPED_TTL.toMillis());
        if (dropped.isEmpty()) droppedKeys.remove(sessionId);
    }

    /** 这个键是否已被淘汰（消息确定没落库）。 */
    private boolean wasDropped(String sessionId, String key) {
        Map<String, Long> dropped = droppedKeys.get(sessionId);
        return dropped != null && dropped.containsKey(key);
    }

    /** 取消线程也必须等终态写入反馈，之后恢复中断标志，不取消写任务。 */
    private void await(Future<?> future) {
        boolean interrupted = false;
        long deadline = System.nanoTime() + awaitTimeout.toNanos();
        try {
            while (true) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) {
                    throw new IllegalStateException(
                            "Message persistence did not complete within " + awaitTimeout.toSeconds() + "s");
                }
                try {
                    future.get(remaining, TimeUnit.NANOSECONDS);
                    return;
                } catch (InterruptedException e) {
                    interrupted = true;
                } catch (TimeoutException timedOut) {
                    // 写任务继续在后台跑完（按雪花 id 幂等）；调用方拿到明确错误。
                    throw new IllegalStateException(
                            "Message persistence did not complete within " + awaitTimeout.toSeconds() + "s", timedOut);
                } catch (ExecutionException e) {
                    Throwable cause = e.getCause();
                    while (cause instanceof CompletionException && cause.getCause() != null) cause = cause.getCause();
                    if (cause instanceof RuntimeException failure) throw failure;
                    throw new IllegalStateException("Message persistence failed", cause);
                }
            }
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    @PreDestroy
    public void shutdown() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 这个写已被淘汰（重试到上限）：失败仍然要报给调用方，但它不再挡住后面的键。
     */
    private static final class DroppedWriteException extends Exception {
        private final Exception original;

        private DroppedWriteException(Exception original) {
            super(original);
            this.original = original;
        }

        /** 原始失败（RuntimeException 原样返回；受检异常按写失败包装）。 */
        private RuntimeException original() {
            return original instanceof RuntimeException runtime
                    ? runtime : new IllegalStateException("Message persistence failed", original);
        }
    }

    /** 待写的一条消息。 */
    private static final class PendingWrite {
        private final Callable<Void> task;
        private final long createdAt = System.currentTimeMillis();
        private int attempts;

        private PendingWrite(Callable<Void> task) {
            this.task = task;
        }
    }

    /**
     * 恢复结果：有没有没落库的消息。
     *
     * @param uncommitted 是否存在未提交的消息（待写或已被淘汰）
     * @param pendingCount 仍待写的条数
     * @param droppedCount 已被淘汰（写失败到上限或超限）的条数
     */
    public record RecoveryOutcome(boolean uncommitted, int pendingCount, int droppedCount) {
        public static RecoveryOutcome clean() {
            return new RecoveryOutcome(false, 0, 0);
        }
    }
}
