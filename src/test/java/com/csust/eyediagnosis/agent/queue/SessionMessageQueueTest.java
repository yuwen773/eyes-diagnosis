package com.csust.eyediagnosis.agent.queue;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SessionMessageQueueTest {

    @Test
    void messagesAreSerializedPerSession() throws Exception {
        SessionMessageQueue queue = new SessionMessageQueue(2);
        List<String> seen = new ArrayList<>();
        CountDownLatch gate = new CountDownLatch(1);
        CountDownLatch firstRunning = new CountDownLatch(1);

        queue.submit("s1", () -> {
            firstRunning.countDown();
            gate.await();
            synchronized (seen) {
                seen.add("a");
            }
            return null;
        });

        // Wait until first task has acquired the per-session gate
        assertTrue(firstRunning.await(1, TimeUnit.SECONDS));

        // Submit second task: it must queue behind the first.
        queue.submit("s1", () -> {
            synchronized (seen) {
                seen.add("b");
            }
            return null;
        });

        // Release the first task. The second should follow serially.
        gate.countDown();

        // Wait for both to finish.
        Thread.sleep(150);
        queue.shutdown();

        assertEquals(List.of("a", "b"), seen);
    }

    @Test
    void differentSessionsRunInParallel() throws Exception {
        SessionMessageQueue queue = new SessionMessageQueue(4);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maxActive = new AtomicInteger();
        CountDownLatch started = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);

        queue.submit("s1", () -> {
            int n = active.incrementAndGet();
            maxActive.updateAndGet(m -> Math.max(m, n));
            started.countDown();
            release.await();
            active.decrementAndGet();
            return null;
        });
        queue.submit("s2", () -> {
            int n = active.incrementAndGet();
            maxActive.updateAndGet(m -> Math.max(m, n));
            started.countDown();
            release.await();
            active.decrementAndGet();
            return null;
        });

        assertTrue(started.await(1, TimeUnit.SECONDS));
        assertTrue(maxActive.get() >= 2, "different sessions should run in parallel");
        release.countDown();
        queue.shutdown();
    }

    /**
     * 一个永久失败的写不能毒死整个会话。
     *
     * <p>复现的是独立复审指出的失效模式：队头那个写永远失败 → 后续消息永远不落库。
     * 现在失败达到上限的键会被淘汰并记账，之后的写照常进行。
     */
    @Test
    void aPermanentlyFailingWriteDoesNotPoisonTheSession() {
        SessionMessageQueue queue = new SessionMessageQueue(2);
        AtomicInteger attempts = new AtomicInteger();
        try {
            // 同一个键连续失败三次：第三次之后被淘汰。
            for (int attempt = 0; attempt < 3; attempt++) {
                assertThrows(RuntimeException.class, () -> queue.submitRecoverableAndWait("s1", "poison", () -> {
                    attempts.incrementAndGet();
                    throw new IllegalStateException("permanent failure");
                }));
            }
            assertEquals(3, attempts.get());

            // 之后的写照常落库。
            AtomicInteger later = new AtomicInteger();
            queue.submitRecoverableAndWait("s1", "later", () -> {
                later.incrementAndGet();
                return null;
            });
            assertEquals(1, later.get(), "later writes must not be blocked by the failed one");
            assertTrue(queue.hasUncommitted("s1"), "the dropped write must be reported as uncommitted");
        } finally {
            queue.shutdown();
        }
    }

    /**
     * 数据库挂起时，等待必须有上限：调用方拿到明确错误，而不是一起挂死。
     */
    @Test
    void aHangingWriteDoesNotBlockTheCallerForever() {
        SessionMessageQueue queue = new SessionMessageQueue(1, Duration.ofMillis(200));
        long startedAt = System.nanoTime();
        try {
            assertThrows(IllegalStateException.class, () -> queue.submitRecoverableAndWait("s1", "hang", () -> {
                Thread.sleep(1500);
                return null;
            }));
            long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;
            assertTrue(elapsedMs < 1200, "caller must get an error instead of hanging, elapsed=" + elapsedMs);
        } finally {
            queue.shutdown();
        }
    }

    /** 待写集合有上限：失败的写不会无限堆积。 */
    @Test
    void pendingWritesStayBoundedAfterManyFailures() {
        SessionMessageQueue queue = new SessionMessageQueue(2);
        try {
            for (int index = 0; index < 50; index++) {
                String key = "k" + index;
                assertThrows(RuntimeException.class, () -> queue.submitRecoverableAndWait("s1", key, () -> {
                    throw new IllegalStateException("permanent failure");
                }));
            }
            var outcome = queue.recoveryOutcome("s1");
            assertTrue(outcome.pendingCount() <= SessionMessageQueue.MAX_PENDING_PER_SESSION,
                    "pending writes must stay bounded, pending=" + outcome.pendingCount());
            assertTrue(outcome.droppedCount() > 0, "evicted writes must be accounted for");
        } finally {
            queue.shutdown();
        }
    }

    /** 恢复本身失败时不抛错：历史读取要能继续，只是要标出「不完整」。 */
    @Test
    void recoveryFailureIsReportedNotThrown() {
        SessionMessageQueue queue = new SessionMessageQueue(2);
        try {
            assertThrows(RuntimeException.class, () -> queue.submitRecoverableAndWait("s1", "broken", () -> {
                throw new IllegalStateException("permanent failure");
            }));
            queue.recoverPending("s1");
            assertTrue(queue.hasUncommitted("s1"));
            assertFalse(queue.hasUncommitted("other-session"));
        } finally {
            queue.shutdown();
        }
    }
}