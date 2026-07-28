package com.csust.eyediagnosis.workflow.observability;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Installs a per-request traceId into the MDC and echoes it back via the {@code X-Trace-Id}
 * response header. Honors an incoming {@code X-Trace-Id} so distributed callers can correlate.
 */
@Component
@Order(1)
public class TraceIdFilter extends OncePerRequestFilter {

    public static final String TRACE_HEADER = "X-Trace-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String incoming = request.getHeader(TRACE_HEADER);
        String traceId = (incoming == null || incoming.isBlank() || incoming.length() > 64)
                ? UUID.randomUUID().toString().replace("-", "")
                : incoming;
        MDC.put(WorkflowTraceContext.TRACE_ID, traceId);
        response.setHeader(TRACE_HEADER, traceId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(WorkflowTraceContext.TRACE_ID);
        }
    }
}
