package com.csust.eyediagnosis.agent;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

class ToolStepConcurrencyTest {
    @Test void closeOwnsTheTerminalWhileAnIgnoringToolReturns() throws Exception {
        var audit = new CopyOnWriteArrayList<String>();
        var seen = new CopyOnWriteArrayList<String>();
        var closing = new CountDownLatch(1); var release = new CountDownLatch(1);
        var sink = new ToolStepSink("s", 42L, r -> {
            audit.add(r.status().wire());
            if (r.status() == ToolStepContract.Status.CANCELLED) {
                closing.countDown();
                try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
                catch (InterruptedException failure) { throw new AssertionError(failure); }
            }
        });
        sink.events().asFlux().subscribe(e -> seen.add(e.getToolStatus()));
        sink.started("late", "searchDocuments", null, null);
        var close = new FutureTask<Void>(() -> { sink.closePending(); return null; });
        new Thread(close).start();
        assertTrue(closing.await(5, TimeUnit.SECONDS));
        var finish = new FutureTask<Void>(() -> { sink.finished("late", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE); return null; });
        var worker = new Thread(finish); worker.start();
        try {
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!finish.isDone() && worker.getState() != Thread.State.BLOCKED && System.nanoTime() < end) Thread.onSpinWait();
            assertTrue(finish.isDone() || worker.getState() == Thread.State.BLOCKED);
        } finally { release.countDown(); }
        close.get(5, TimeUnit.SECONDS); finish.get(5, TimeUnit.SECONDS);
        assertEquals(List.of("running", "cancelled"), audit);
        assertEquals(audit, seen);
    }

    @Test void unexpectedSinkTerminationIsReportedAndCancellationRetainsAudit() {
        var sink = new ToolStepSink("s", 42L, null);
        sink.started("one", "searchDocuments", null, null);
        sink.events().tryEmitComplete().orThrow();
        assertThrows(reactor.core.publisher.Sinks.EmissionException.class,
                () -> sink.finished("one", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE));
        var audit = new CopyOnWriteArrayList<String>();
        var cancelled = new ToolStepSink("s", 42L, r -> audit.add(r.status().wire()));
        var subscription = cancelled.events().asFlux().subscribe();
        cancelled.started("two", "searchDocuments", null, null);
        subscription.dispose();
        cancelled.closePending();
        cancelled.finished("two", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
        assertEquals(List.of("running", "cancelled"), audit);
    }

    @Test void overlappingCompletionsDeliverEveryAuditedFrameInOrder() throws Exception {
        var audit = new CopyOnWriteArrayList<String>();
        var seen = new CopyOnWriteArrayList<String>();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var sink = new ToolStepSink("s", 42L, r -> audit.add(r.toolCallId() + ":" + r.status().wire()));
        sink.events().asFlux().subscribe(e -> {
            seen.add(e.getToolCallId() + ":" + e.getToolStatus());
            if (e.getToolCallId().equals("one") && e.getToolStatus().equals("succeeded")) {
                entered.countDown();
                try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
                catch (InterruptedException failure) { throw new AssertionError(failure); }
            }
        });
        sink.started("one", "searchDocuments", null, null);
        sink.started("two", "searchDocuments", null, null);
        var first = new FutureTask<Void>(() -> { sink.finished("one", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE); return null; });
        var secondDone = new AtomicBoolean();
        var second = new FutureTask<Void>(() -> {
            try { sink.finished("two", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE); return null; }
            finally { secondDone.set(true); }
        });
        var secondThread = new Thread(second);
        new Thread(first).start();
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            secondThread.start();
            // Keep the first delivery in flight until the competing call either
            // blocks on serialization or returns (the old sink drops its frame).
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!secondDone.get() && secondThread.getState() != Thread.State.BLOCKED && System.nanoTime() < end) Thread.onSpinWait();
            assertTrue(secondDone.get() || secondThread.getState() == Thread.State.BLOCKED);
        } finally { release.countDown(); }
        first.get(5, TimeUnit.SECONDS); second.get(5, TimeUnit.SECONDS);
        sink.closePending();
        assertEquals(List.of("one:running", "two:running", "one:succeeded", "two:succeeded"), seen);
        assertEquals(audit, seen);
    }

    @Test void lateAndDuplicateResultsCannotAcquireASecondTerminalState() {
        var audit = new CopyOnWriteArrayList<String>();
        var seen = new CopyOnWriteArrayList<String>();
        var sink = new ToolStepSink("s", 42L, r -> audit.add(r.status().wire()));
        sink.events().asFlux().subscribe(e -> seen.add(e.getToolStatus()));
        sink.started("late", "searchDocuments", null, null);
        sink.closePending();
        sink.finished("late", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
        sink.finished("late", "searchDocuments", false, ToolStepContract.ErrorCategory.TOOL_EXCEPTION);
        sink.closePending();
        sink.started("after-close", "searchDocuments", null, null);
        assertEquals(List.of("running", "cancelled"), audit);
        assertEquals(audit, seen);
    }

    @Test void duplicateStartAndFinishCannotReopenACompletedCall() {
        var audit = new CopyOnWriteArrayList<String>();
        var sink = new ToolStepSink("s", 42L, r -> audit.add(r.status().wire()));
        sink.started("one", "searchDocuments", null, null);
        sink.finished("one", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
        sink.finished("one", "searchDocuments", true, ToolStepContract.ErrorCategory.NONE);
        sink.started("one", "searchDocuments", null, null);
        sink.closePending();
        assertEquals(List.of("running", "succeeded"), audit);
    }
}
