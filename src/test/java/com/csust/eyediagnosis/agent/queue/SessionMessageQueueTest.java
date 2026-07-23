package com.csust.eyediagnosis.agent.queue;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
}