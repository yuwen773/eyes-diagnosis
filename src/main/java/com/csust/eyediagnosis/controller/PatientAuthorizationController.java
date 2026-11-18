package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.patientauthorization.PatientAuthorizationService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/diagnosis-tasks")
public class PatientAuthorizationController {
    private final PatientAuthorizationService authorizations;
    private final UserService users;

    public PatientAuthorizationController(PatientAuthorizationService authorizations, UserService users) {
        this.authorizations = authorizations; this.users = users;
    }

    @ModelAttribute
    public void preventCaching(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @GetMapping("/{id}/save-authorization")
    @AuthCheck
    public BaseResponse<PatientAuthorizationService.View> view(@PathVariable String id, HttpServletRequest request) {
        return ResultUtils.success(authorizations.view(id, users.getLoginUser(request).getId()));
    }

    @PostMapping("/{id}/save-authorization/approve")
    @AuthCheck
    public BaseResponse<PatientAuthorizationService.View> approve(@PathVariable String id,
            @RequestBody PatientAuthorizationService.Approval approval, HttpServletRequest request) {
        return ResultUtils.success(authorizations.approve(id, users.getLoginUser(request).getId(), approval));
    }

    @ExceptionHandler(PatientAuthorizationService.SaveConflict.class)
    public ResponseEntity<BaseResponse<?>> conflict(PatientAuthorizationService.SaveConflict error) {
        return ResponseEntity.status(409).body(ResultUtils.error(40900, error.getMessage()));
    }
}
