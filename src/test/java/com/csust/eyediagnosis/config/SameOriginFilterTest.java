package com.csust.eyediagnosis.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/** 评审 P1-06：状态变更请求必须通过 Origin/Referer 同源校验。 */
class SameOriginFilterTest {

    private SameOriginFilter filter;
    private FilterChain chain;
    private MockHttpServletResponse response;

    @BeforeEach
    void setUp() {
        filter = new SameOriginFilter();
        ReflectionTestUtils.setField(filter, "additionalHosts", List.of("review.example.com"));
        chain = mock(FilterChain.class);
        response = new MockHttpServletResponse();
    }

    private MockHttpServletRequest request(String method, String origin, String referer) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/agent/collaboration-runs");
        request.setServerName("localhost");
        request.setServerPort(8081);
        if (origin != null) request.addHeader("Origin", origin);
        if (referer != null) request.addHeader("Referer", referer);
        return request;
    }

    @Test
    void crossSitePostIsRejectedWithJsonFault() throws Exception {
        filter.doFilter(request("POST", "http://evil.example.com", null), response, chain);
        assertEquals(403, response.getStatus());
        assertTrue(response.getContentAsString().contains("CROSS_ORIGIN_BLOCKED"));
        verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void missingOriginAndRefererOnPostIsRejected() throws Exception {
        filter.doFilter(request("POST", null, null), response, chain);
        assertEquals(403, response.getStatus());
        verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void crossSiteRefererIsRejected() throws Exception {
        filter.doFilter(request("POST", null, "https://evil.example.com/form"), response, chain);
        assertEquals(403, response.getStatus());
    }

    @Test
    void whitelistedHostIsAccepted() throws Exception {
        filter.doFilter(request("POST", "https://review.example.com", null), response, chain);
        verify(chain).doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void defaultPortsAreNormalized() throws Exception {
        // https 默认 443 端口不参与比对
        filter.doFilter(request("POST", "https://localhost:443", null), response, chain);
        assertEquals(403, response.getStatus()); // host localhost:8081 ≠ localhost
    }

    @Test
    void sameHostDifferentPortIsRejected() throws Exception {
        filter.doFilter(request("POST", "http://localhost:9999", null), response, chain);
        assertEquals(403, response.getStatus());
    }

    @Test
    void safeMethodsBypassCheck() throws Exception {
        for (String method : new String[]{"GET", "HEAD", "OPTIONS"}) {
            MockHttpServletResponse perCall = new MockHttpServletResponse();
            filter.doFilter(request(method, "http://evil.example.com", null), perCall, chain);
            assertEquals(200, perCall.getStatus());
        }
        verify(chain, org.mockito.Mockito.times(3))
                .doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void nullOriginLiteralIsRejected() throws Exception {
        // 浏览器把「无来源」标为 Origin: null，必须拒绝
        filter.doFilter(request("POST", "null", null), response, chain);
        assertEquals(403, response.getStatus());
    }
}
