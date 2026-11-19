package com.csust.eyediagnosis.agent.queue;

import jakarta.annotation.PreDestroy;

import java.util.Map;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 每会话按提交顺序串行，不同会话可并行。
 */
public class SessionMessageQueue {

    private final ExecutorService executor;
    private final Map<String, CompletableFuture<?>> tails = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Callable<Void>>> pendingWrites = new ConcurrentHashMap<>();

    public SessionMessageQueue(int parallelism) {
        this.executor = Executors.newFixedThreadPool(Math.max(1, parallelism));
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

    /** 终态等到事务提交才返回；失败的原任务保留，供显式历史重读恢复。 */
    public void submitRecoverableAndWait(String sessionId, String key, Callable<Void> task) {
        Future<?> write;
        synchronized (this) {
            pendingWrites.computeIfAbsent(sessionId, ignored -> new LinkedHashMap<>()).putIfAbsent(key, task);
            write = submit(sessionId, () -> { writeThrough(sessionId, key); return null; });
        }
        await(write);
    }

    /** 一次读取只尝试恢复一次；数据库仍不可用时抛错，不能返回陈旧历史冒充终态。 */
    public void recoverPending(String sessionId) {
        await(submit(sessionId, () -> {
            ArrayList<String> keys;
            synchronized (this) {
                keys = new ArrayList<>(pendingWrites.getOrDefault(sessionId, Map.of()).keySet());
            }
            for (String key : keys) writePending(sessionId, key);
            return null;
        }));
    }

    private void writePending(String sessionId, String key) throws Exception {
        Callable<Void> task;
        synchronized (this) {
            task = pendingWrites.getOrDefault(sessionId, Map.of()).get(key);
        }
        if (task == null) return;
        task.call();
        synchronized (this) {
            Map<String, Callable<Void>> pending = pendingWrites.get(sessionId);
            pending.remove(key);
            if (pending.isEmpty()) pendingWrites.remove(sessionId);
        }
    }

    private void writeThrough(String sessionId, String key) throws Exception {
        ArrayList<String> keys;
        synchronized (this) {
            keys = new ArrayList<>(pendingWrites.getOrDefault(sessionId, Map.of()).keySet());
        }
        for (String earlier : keys) {
            writePending(sessionId, earlier);
            if (earlier.equals(key)) break;
        }
    }

    /** 取消线程也必须等终态写入反馈，之后恢复中断标志，不取消写任务。 */
    private static void await(Future<?> future) {
        boolean interrupted = false;
        try {
            while (true) {
                try {
                    future.get();
                    return;
                } catch (InterruptedException e) {
                    interrupted = true;
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
}
