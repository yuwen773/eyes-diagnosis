package com.csust.eyediagnosis.agent.config;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertThrows;

class AgentExecutorConfigTest {

    @Test
    void boundedExecutorRejectsWhenSaturated() throws Exception {
        ThreadPoolExecutor executor = AgentExecutorConfig.buildMcpExecutor(1, 1, 1, 60);
        CountDownLatch stuck = new CountDownLatch(1);
        try {
            executor.submit(() -> {
                try {
                    stuck.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            // 等 worker 启动并占用，再用一个任务占满 queue
            for (int i = 0; i < 50 && executor.getActiveCount() < 1; i++) {
                Thread.sleep(20);
            }
            executor.submit(() -> {});
            for (int i = 0; i < 50 && executor.getQueue().size() < 1; i++) {
                Thread.sleep(20);
            }
            // 现在 worker 在跑，queue 也满了，第三个提交必须被拒绝
            assertThrows(RejectedExecutionException.class, () -> executor.submit(() -> {}));
        } finally {
            stuck.countDown();
            executor.shutdownNow();
            executor.awaitTermination(2, TimeUnit.SECONDS);
        }
    }
}
