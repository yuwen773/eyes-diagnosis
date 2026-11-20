package com.csust.eyediagnosis.agent;

import com.alibaba.cloud.ai.graph.agent.interceptor.ToolCallRequest;
import com.csust.eyediagnosis.agent.manager.MCPManager;
import com.csust.eyediagnosis.agent.mcp.McpToolCallback;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import com.csust.eyediagnosis.model.dto.mcp.*;
import com.csust.eyediagnosis.model.entity.McpServer;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class McpTerminalCategoryTest {
    @Test void interruptedWaitCancelsTransportAndRetainsCancellation() throws Exception {
        classify(new InterruptedException("synthetic cancellation"), ToolStepContract.ErrorCategory.CANCELLED);
    }
    @Test void deadlineCancelsTransportAndRetainsTimeout() throws Exception {
        classify(new TimeoutException("synthetic deadline"), ToolStepContract.ErrorCategory.TIMEOUT);
    }
    @Test void checkedTransportFailureIsNotReportedAsTimeout() throws Exception {
        classify(new ExecutionException(new java.io.IOException("synthetic transport failure")),
                ToolStepContract.ErrorCategory.TOOL_EXCEPTION);
    }

    @SuppressWarnings("unchecked")
    private void classify(Exception failure, ToolStepContract.ErrorCategory expected) throws Exception {
        ThreadPoolExecutor executor = mock(ThreadPoolExecutor.class);
        Future<McpServerCallToolResponse> future = mock(Future.class);
        when(executor.submit(any(Callable.class))).thenReturn(future);
        when(future.get(anyLong(), eq(TimeUnit.SECONDS))).thenThrow(failure);
        MCPManager manager = new MCPManager(null, null, executor, 1, 1);
        McpServer server = new McpServer();
        server.setMcpServerCode("fixture");
        McpTool tool = new McpTool();
        tool.setName("fixture");
        tool.setInputSchema(new InputSchema());
        McpToolCallback callback = new McpToolCallback(manager, server, tool);
        var frames = new ArrayList<MessageDTO>();
        var audits = new ArrayList<ToolStepSink.ToolAuditRecord>();
        ToolStepSink sink = new ToolStepSink("fixture", 42L, audits::add);
        sink.events().asFlux().subscribe(frames::add);
        try {
            var observer = new ToolExecutionInterceptor(sink, new byte[]{1});
            assertThrows(RuntimeException.class, () -> observer.interceptToolCall(
                    new ToolCallRequest("fixture", "{}", "call", Map.of()), req -> {
                        callback.call("{}");
                        throw new AssertionError("expected callback failure");
                    }));
            assertEquals(expected.name(), frames.getLast().getErrorCategory());
            assertEquals(expected, audits.getLast().errorCategory());
            if (!(failure instanceof ExecutionException)) verify(future).cancel(true);
            if (failure instanceof InterruptedException) assertTrue(Thread.currentThread().isInterrupted());
        } finally {
            Thread.interrupted();
        }
    }
}
