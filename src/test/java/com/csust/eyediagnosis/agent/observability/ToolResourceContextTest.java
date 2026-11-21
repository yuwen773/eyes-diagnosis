package com.csust.eyediagnosis.agent.observability;

import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 证据收集的线程前提必须是**显式**的：并行/异步执行时 ThreadLocal 会静默丢证据，
 * 那是最坏的一种失败——工具显示成功，侧栏少一条来源。跨线程登记必须当场报错。
 */
class ToolResourceContextTest {

    private static ResourceRef ref(String documentId, int chunkIndex) {
        return ResourceRef.documentChunk(documentId, "doc_" + documentId + "_chunk_" + chunkIndex,
                chunkIndex, "共识", 0.9, null, "片段", null);
    }

    @AfterEach
    void clear() {
        ToolResourceContext.drain();
    }

    @Test
    void recordsWithinTheInvocationThreadAreDrained() {
        ToolResourceContext.begin();
        ToolResourceContext.record(ref("42", 0));
        ToolResourceContext.record(ref("42", 0));

        List<ResourceRef> drained = ToolResourceContext.drain();
        assertEquals(1, drained.size(), "同一次调用的重复 id 只留第一条");
        assertEquals("doc:42#0", drained.get(0).id());
    }

    @Test
    void recordingFromAnotherThreadFailsLoudlyInsteadOfLosingTheEvidence() throws Exception {
        ToolResourceContext.begin();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = Thread.startVirtualThread(() -> {
            try {
                ToolResourceContext.record(ref("42", 0));
            } catch (Throwable e) {
                failure.set(e);
            }
        });
        worker.join(2_000);

        assertNotNull(failure.get(), "跨线程登记不能静默成功");
        assertTrue(failure.get() instanceof IllegalStateException);
        assertEquals(List.of(), ToolResourceContext.drain(),
                "调用线程取不到别人线程写的资源——这正是必须报错的理由");
    }

    @Test
    void directToolCallsWithoutAnInterceptorKeepWorking() {
        // 单测/内部直接调用没有拦截器 begin()：不做跨线程校验，行为保持原样。
        ToolResourceContext.record(ref("7", 2));
        assertEquals(1, ToolResourceContext.drain().size());
    }

    @Test
    void drainAlsoClearsOwnershipSoTheNextCallStartsClean() throws Exception {
        ToolResourceContext.begin();
        ToolResourceContext.drain();

        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = Thread.startVirtualThread(() -> {
            try {
                ToolResourceContext.record(ref("42", 1));
                ToolResourceContext.drain();
            } catch (Throwable e) {
                failure.set(e);
            }
        });
        worker.join(2_000);
        assertEquals(null, failure.get(), "drain 之后归属线程已清除，新线程不再被当成越界");
    }

    @Test
    void endAloneReleasesOwnershipSoAFailedInvocationDoesNotPoisonLaterOnes() throws Exception {
        // 拦截器的 finally 只调 end()（Error 路径不会走到 drain）：归属必须释放，
        // 否则 ACTIVE_THREADS 永远非空，之后每个线程的登记都会被误判为越界。
        ToolResourceContext.begin();
        ToolResourceContext.end();

        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = Thread.startVirtualThread(() -> {
            try {
                ToolResourceContext.record(ref("42", 2));
                ToolResourceContext.drain();
            } catch (Throwable e) {
                failure.set(e);
            }
        });
        worker.join(2_000);
        assertEquals(null, failure.get(), "end 之后归属线程已清除");
    }
}
