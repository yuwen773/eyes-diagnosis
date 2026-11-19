package com.csust.eyediagnosis.agent;

import com.csust.eyediagnosis.agent.queue.SessionMessageQueue;
import com.csust.eyediagnosis.agent.service.ChatHistoryService;
import com.csust.eyediagnosis.agent.service.ChatMessageWriter;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ToolTerminalCommitTest {
    @Test
    void queuedTerminalCannotReachSseBeforeWriterCommitReturns() throws Exception {
        SessionMessageQueue queue = new SessionMessageQueue(1);
        ChatMessageWriter writer = mock(ChatMessageWriter.class);
        ChatHistoryService history = new ChatHistoryService(null, null, null, queue, writer);
        CountDownLatch gate = new CountDownLatch(1);
        CountDownLatch workerBlocked = new CountDownLatch(1);
        CountDownLatch persistAttempted = new CountDownLatch(1);
        var frames = new CopyOnWriteArrayList<MessageDTO>();
        try {
            queue.submit("session", () -> { workerBlocked.countDown(); gate.await(); return null; });
            assertTrue(workerBlocked.await(2, TimeUnit.SECONDS));
            ToolStepSink sink = new ToolStepSink("session", 42L, audit -> { }, dto -> {
                persistAttempted.countDown();
                history.saveToolResultMessage("session", 42L, dto.getErrorCategory());
            });
            sink.events().asFlux().subscribe(frames::add);
            sink.started("call", "searchDocuments", null, null);
            Thread terminal = Thread.startVirtualThread(() -> sink.finished("call", "searchDocuments", false,
                    ToolStepContract.ErrorCategory.TIMEOUT));
            assertTrue(persistAttempted.await(2, TimeUnit.SECONDS));
            assertEquals(1, frames.size(), "queued is not committed");
            verifyNoInteractions(writer);
            gate.countDown();
            terminal.join(2_000);
            assertFalse(terminal.isAlive());
            verify(writer).writeAssistantMessage(eq("session"), eq("TIMEOUT"), eq("tool-result"), anyLong(),
                    isNull(), isNull());
            assertEquals("TIMEOUT", frames.getLast().getErrorCategory());
        } finally {
            gate.countDown();
            queue.shutdown();
        }
    }
}
