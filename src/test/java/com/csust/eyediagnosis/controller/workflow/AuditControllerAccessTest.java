package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditEventEntity;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditRecorder;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.DeleteMapping;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** PR-12.3 audit endpoint access-control tests. */
class AuditControllerAccessTest {

    @Test
    void auditTrailEndpointRequiresAuditorRole() throws Exception {
        Method method = AuditController.class.getMethod("workflowAuditTrail", String.class);
        AuthCheck authCheck = method.getAnnotation(AuthCheck.class);
        assertNotNull(authCheck, "audit endpoint must be protected by @AuthCheck");
        assertEquals(AuthConstant.AUDITOR_ROLE, authCheck.mustRole());
    }

    @Test
    void auditControllerExposesReadOnlyEndpoints() {
        List<Method> handlers = Arrays.stream(AuditController.class.getDeclaredMethods())
                .filter(m -> m.isAnnotationPresent(GetMapping.class)
                        || m.isAnnotationPresent(PostMapping.class)
                        || m.isAnnotationPresent(PutMapping.class)
                        || m.isAnnotationPresent(DeleteMapping.class))
                .toList();
        assertTrue(handlers.stream().allMatch(m -> m.isAnnotationPresent(GetMapping.class)),
                "audit gateway must be read-only (GET only)");
    }

    @Test
    void auditTrailReturnsRecorderPayload() {
        WorkflowAuditRecorder recorder = mock(WorkflowAuditRecorder.class);
        WorkflowAuditEventEntity event = new WorkflowAuditEventEntity();
        event.setWorkflowId("wf-1");
        event.setEventType("RESULT_EXPOSED");
        when(recorder.findByWorkflowId("wf-1")).thenReturn(List.of(event));

        AuditController controller = new AuditController();
        ReflectionTestUtils.setField(controller, "auditRecorder", recorder);
        BaseResponse<List<WorkflowAuditEventEntity>> response = controller.workflowAuditTrail("wf-1");

        assertEquals(0, response.getCode());
        assertEquals(1, response.getData().size());
        assertEquals("RESULT_EXPOSED", response.getData().get(0).getEventType());
    }
}
