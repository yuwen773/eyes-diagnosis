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
import static org.junit.jupiter.api.Assertions.assertNotNull;
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

    /**
     * 被淘汰的写**绝不能返回成功**。
     *
     * <p>复审 E1：`flush` 遍历的是「当时还在待写集合里的键」。如果一个键在遍历开始前就被
     * 淘汰（超限/过期），它根本不会被尝试，循环安静走完——调用方于是以为「已提交」，
     * 终态帧就发给了一个库里不存在的行。这条用例把那个静默成功的路径钉死：
     * 目标键在待写集合里查不到时，必须再确认它是被淘汰（失败）而不是已提交（成功）。
     */
    @Test
    void anEvictedWriteNeverReportsSuccess() throws Exception {
        // 上限设为 1：第二条待写一定会把第一条挤掉。
        SessionMessageQueue queue = new SessionMessageQueue(1, Duration.ofSeconds(10), 1);
        CountDownLatch blockerStarted = new CountDownLatch(1);
        CountDownLatch gate = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<Throwable> firstOutcome =
                new java.util.concurrent.atomic.AtomicReference<>(new IllegalStateException("did not finish"));
        try {
            // 占住唯一的执行线程，让两条写的 flush 都排在后面。
            queue.submit("s1", () -> {
                blockerStarted.countDown();
                gate.await();
                return null;
            });
            assertTrue(blockerStarted.await(2, TimeUnit.SECONDS));

            Thread first = new Thread(() -> {
                try {
                    queue.submitRecoverableAndWait("s1", "k1", () -> null);
                    firstOutcome.set(null);   // 返回成功——正是不能出现的结果
                } catch (Throwable failure) {
                    firstOutcome.set(failure);
                }
            });
            first.start();
            Thread.sleep(200);   // k1 已登记，它的 flush 排在 blocker 后面

            Thread second = new Thread(() -> {
                try {
                    queue.submitRecoverableAndWait("s1", "k2", () -> null);
                } catch (Throwable ignored) {
                    // 第二条是否成功不在本用例的断言范围
                }
            });
            second.start();
            Thread.sleep(200);   // 上限 1 → k1 被 evictOverflow 淘汰

            gate.countDown();
            first.join(5000);
            second.join(5000);

            assertNotNull(firstOutcome.get(),
                    "被淘汰的写不能以成功返回：那等于宣称「已提交」，而库里没有这一行");
            assertEquals(1, queue.recoveryOutcome("s1").droppedCount(),
                    "淘汰必须记到具体键上，而不是只记一个数");
        } finally {
            gate.countDown();
            queue.shutdown();
        }
    }

    /** 正常写入仍然是成功（三种结果的第三种）：不能因为加固把成功也变成异常。 */
    @Test
    void aCommittedWriteStillReportsSuccess() {
        SessionMessageQueue queue = new SessionMessageQueue(2);
        try {
            queue.submitRecoverableAndWait("s1", "ok", () -> null);
            assertFalse(queue.hasUncommitted("s1"), "写成功的会话不能报「历史可能不完整」");
            assertEquals(0, queue.recoveryOutcome("s1").droppedCount());
            assertEquals(0, queue.recoveryOutcome("s1").pendingCount());
        } finally {
            queue.shutdown();
        }
    }
}