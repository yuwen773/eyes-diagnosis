package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditEventEntity;
import com.csust.eyediagnosis.workflow.audit.WorkflowAuditRecorder;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * PR-12.2/12.3 audit read gateway. Read-only: exposes the append-only audit trail to
 * AUDITOR / ADMIN roles. There is deliberately no mutation endpoint.
 */
@RestController
@RequestMapping("/audit")
public class AuditController {

    @Resource
    private WorkflowAuditRecorder auditRecorder;

    @GetMapping("/workflows/{workflowId}/events")
    @AuthCheck(mustRole = AuthConstant.AUDITOR_ROLE)
    public BaseResponse<List<WorkflowAuditEventEntity>> workflowAuditTrail(@PathVariable String workflowId) {
        return ResultUtils.success(auditRecorder.findByWorkflowId(workflowId));
    }
}
