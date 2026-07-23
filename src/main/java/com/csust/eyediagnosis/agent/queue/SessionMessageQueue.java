package com.csust.eyediagnosis.agent.queue;

import jakarta.annotation.PreDestroy;

import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * 每会话串行队列：相同 sessionId 的任务在单个信号量上排队，不同会话可并行。
 */
public class SessionMessageQueue {

    private final ExecutorService executor;
    private final Map<String, Semaphore> locks = new ConcurrentHashMap<>();

    public SessionMessageQueue(int parallelism) {
        this.executor = Executors.newFixedThreadPool(Math.max(1, parallelism));
    }

    public <T> Future<T> submit(String sessionId, Callable<T> task) {
        Semaphore gate = locks.computeIfAbsent(sessionId, key -> new Semaphore(1));
        return executor.submit(() -> {
            try {
                gate.acquire();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("queue interrupted", e);
            }
            try {
                return task.call();
            } finally {
                gate.release();
            }
        });
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
}