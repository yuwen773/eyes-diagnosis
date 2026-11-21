package com.csust.eyediagnosis.agent.observability;

import com.csust.eyediagnosis.model.dto.agent.ResourceRef;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 资源收集器是线程内的：一次工具调用不能看到、也不能带走别的线程登记的资源。
 *
 * <p>这里刻意用真线程（而不是同一个测试线程重复 drain）验证隔离与清理——
 * 收集器活在 {@code ThreadLocal} 里，串线只会发生在跨线程。
 */
class ToolResourceContextTest {

    @AfterEach
    void clear() {
        ToolResourceContext.drain();
    }

    @Test
    void resourcesRegisteredOnAnotherThreadAreInvisible() throws Exception {
        AtomicReference<List<ResourceRef>> seenFromWorker = new AtomicReference<>();

        Thread worker = new Thread(() -> {
            ToolResourceContext.record(ResourceRef.document("10", "并发线程的来源", 0.7, null, "片段", null));
            seenFromWorker.set(ToolResourceContext.drain());
        }, "tool-resource-worker");
        worker.start();
        worker.join();

        assertEquals(1, seenFromWorker.get().size(), "登记线程自己能取到");
        assertEquals(List.of(), ToolResourceContext.drain(),
                "别的线程不能看到这次调用登记的资源");
    }

    @Test
    void drainClearsSoRepeatedDrainIsEmpty() {
        ToolResourceContext.record(ResourceRef.document("11", "来源", 0.6, null, "片段", null));

        assertEquals(1, ToolResourceContext.drain().size());
        assertEquals(List.of(), ToolResourceContext.drain(), "取走即清空，不残留到下一次调用");
    }

    @Test
    void duplicateIdsKeepFirstAndIdlessRefsAreIgnored() {
        ToolResourceContext.record(ResourceRef.document("12", "第一条", 0.9, null, "片段", null));
        ToolResourceContext.record(ResourceRef.document("12", "重复", 0.1, null, "片段", null));
        ToolResourceContext.record(new ResourceRef(null, "document", "无 id", "knowledge-base",
                null, "13", 0.5, null, "片段", null));

        List<ResourceRef> refs = ToolResourceContext.drain();
        assertEquals(1, refs.size());
        assertEquals("第一条", refs.get(0).title());
    }

    @Test
    void returnedListIsASnapshot() {
        ToolResourceContext.record(ResourceRef.document("14", "来源", 0.5, null, "片段", null));
        List<ResourceRef> drained = ToolResourceContext.drain();
        ToolResourceContext.record(ResourceRef.document("15", "后登记", 0.5, null, "片段", null));

        assertEquals(1, drained.size(), "取走的列表不会被之后登记的条目改写");
        assertTrue(drained.stream().noneMatch(ref -> "15".equals(ref.documentId())));
    }
}
