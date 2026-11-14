package com.csust.eyediagnosis.collaboration;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/** Bounded transport only; durable event polling also catches up after missed notifications. */
@Component
@ConditionalOnProperty(name = "eye-diagnosis.collaboration.enabled", havingValue = "true")
public class CollaborationStreams implements AutoCloseable {
    public static final int BUFFER = 64;
    private final CollaborationRunService runs;
    private final ScheduledThreadPoolExecutor poller = new ScheduledThreadPoolExecutor(2, r -> {
        var t = new Thread(r, "collaboration-event-poller"); t.setDaemon(true); return t;
    });
    private final ThreadPoolExecutor writers = new ThreadPoolExecutor(8, 8, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8), r -> {
        var t = new Thread(r, "collaboration-sse-writer"); t.setDaemon(true); return t;
    });
    private final Set<Connection> active = new HashSet<>();

    public CollaborationStreams(CollaborationRunService runs) {
        this.runs = runs; poller.setRemoveOnCancelPolicy(true);
    }

    public SseEmitter open(CollaborationRunService.Subscription subscription, LongSupplier identity) {
        var emitter = new SseEmitter(180_000L);
        Connection connection = connect(subscription, identity, new Sink() {
            public void send(Delivery delivery) throws IOException {
                var frame = SseEmitter.event().id(delivery.cursor());
                if (delivery.event() == null) frame.name("run.heartbeat").data(Map.of("schemaVersion", 1));
                else frame.name(delivery.event().type()).data(delivery.event());
                emitter.send(frame);
            }
            public void close(Throwable failure) {
                if (failure == null) emitter.complete(); else emitter.completeWithError(failure);
            }
        });
        emitter.onCompletion(() -> connection.stop(null));
        emitter.onTimeout(() -> connection.stop(null));
        emitter.onError(connection::stop);
        return emitter;
    }

    // Package-visible transport seam permits a truly stalled consumer without a fake coordinator/event store.
    Connection connect(CollaborationRunService.Subscription subscription, LongSupplier identity, Sink sink) {
        var connection = new Connection(subscription, identity, sink);
        synchronized (active) {
            if (active.size() >= 8 || active.stream().filter(c -> c.subscription.userId() == subscription.userId()).count() >= 2)
                throw new CollaborationRunService.Fault(429, "SUBSCRIPTION_LIMIT");
            active.add(connection);
        }
        try {
            connection.writer = writers.submit(connection::drain);
            connection.polling = poller.scheduleWithFixedDelay(connection::poll, 0, 250, TimeUnit.MILLISECONDS);
            if (connection.stopped.get()) { connection.polling.cancel(false); connection.writer.cancel(true); }
        } catch (RejectedExecutionException busy) { connection.stop(busy); throw new CollaborationRunService.Fault(503, "STREAM_UNAVAILABLE"); }
        return connection;
    }

    record Delivery(String cursor, CollaborationRunService.Event event, boolean end) {}
    interface Sink { void send(Delivery delivery) throws Exception; void close(Throwable failure); }

    final class Connection {
        final CollaborationRunService.Subscription subscription;
        private final LongSupplier identity;
        private final Sink sink;
        private final ArrayBlockingQueue<Delivery> queue = new ArrayBlockingQueue<>(BUFFER);
        private final AtomicBoolean stopped = new AtomicBoolean();
        private volatile Future<?> writer;
        private volatile ScheduledFuture<?> polling;
        private long scanned;
        private long heartbeat = System.nanoTime();
        private boolean firstBatch = true;
        private final long opened = System.nanoTime();
        private boolean ending;

        Connection(CollaborationRunService.Subscription subscription, LongSupplier identity, Sink sink) {
            this.subscription = subscription; this.identity = identity; this.sink = sink; scanned = subscription.sequence();
        }
        private void authorized() {
            if (identity.getAsLong() != subscription.userId()) throw new CollaborationRunService.Fault(403, "ACCESS_DENIED");
            runs.reauthorize(subscription);
        }
        void poll() {
            if (stopped.get() || ending) return;
            try {
                authorized();
                if (System.nanoTime() - opened >= TimeUnit.SECONDS.toNanos(180)) { stop(null); return; }
                var batch = runs.read(subscription, scanned);
                for (var frame : batch.frames()) enqueue(new Delivery(frame.cursor(), frame.event(), false));
                scanned = batch.scannedSequence();
                if (firstBatch || batch.terminal() || System.nanoTime() - heartbeat >= TimeUnit.SECONDS.toNanos(15)) {
                    enqueue(new Delivery(batch.resumeCursor(), null, batch.terminal()));
                    heartbeat = System.nanoTime();
                }
                firstBatch = false;
                ending = batch.terminal();
            } catch (Exception failure) { stop(failure); }
        }
        private void enqueue(Delivery delivery) {
            if (!queue.offer(delivery)) throw new CollaborationRunService.Fault(429, "SLOW_CONSUMER");
        }
        private void drain() {
            try {
                while (!stopped.get()) {
                    Delivery next = queue.poll(1, TimeUnit.SECONDS);
                    if (next == null) continue;
                    authorized();
                    if (stopped.get()) return;
                    sink.send(next);
                    if (next.end()) { stop(null); return; }
                }
            } catch (Exception failure) { stop(failure); }
        }
        void stop(Throwable failure) {
            if (!stopped.compareAndSet(false, true)) return;
            if (polling != null) polling.cancel(false);
            if (writer != null) writer.cancel(true);
            writers.purge();
            queue.clear();
            synchronized (active) { active.remove(this); }
            sink.close(failure);
        }
        boolean isStopped() { return stopped.get(); }
    }

    @Override @jakarta.annotation.PreDestroy public void close() {
        List<Connection> connections;
        synchronized (active) { connections = List.copyOf(active); }
        connections.forEach(c -> c.stop(null)); poller.shutdownNow(); writers.shutdownNow();
    }
}
