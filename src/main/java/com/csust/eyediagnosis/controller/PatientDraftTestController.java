package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.patientdraft.PatientDraftTestService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Operator entry for the four-agent draft flow. Registered only with
 * {@code eye-diagnosis.draft.test-entry.enabled=true} and callable only by admins; it starts the same
 * coordinator run a poller would start and reports role states, timing, citation checks and stop reasons.
 */
@RestController
@RequestMapping("/patient-draft-test")
@ConditionalOnProperty(name = "eye-diagnosis.draft.test-entry.enabled", havingValue = "true")
public class PatientDraftTestController {
    private final PatientDraftTestService service;

    public PatientDraftTestController(PatientDraftTestService service) {
        this.service = service;
    }

    @ModelAttribute
    public void preventCaching(jakarta.servlet.http.HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @GetMapping("/tasks")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<List<PatientDraftTestService.TaskRow>> tasks() {
        return ResultUtils.success(service.tasks());
    }

    @GetMapping("/tasks/{taskId}")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<PatientDraftTestService.Trace> trace(@PathVariable String taskId) {
        return ResultUtils.success(service.trace(taskId));
    }

    @PostMapping("/tasks/{taskId}/run")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<PatientDraftTestService.Trace> run(@PathVariable String taskId) {
        service.trigger(taskId);
        return ResultUtils.success(service.trace(taskId));
    }

    @ExceptionHandler(PatientDraftTestService.Busy.class)
    public ResponseEntity<BaseResponse<?>> busy(PatientDraftTestService.Busy busy) {
        return ResponseEntity.status(409).body(ResultUtils.error(40900, busy.getMessage()));
    }
}
