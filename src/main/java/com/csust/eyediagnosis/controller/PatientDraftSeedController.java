package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.patientdraft.PatientDraftTestService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

/**
 * Creates one synthetic task plus a synthetic controlled reference so the operator page can be exercised
 * without the image pipeline. Both switches must be on:
 * {@code eye-diagnosis.draft.test-entry.enabled} and {@code eye-diagnosis.draft.test-entry.allow-seed}.
 * The reference is written with synthetic title/source and never claims real medical review.
 */
@RestController
@RequestMapping("/patient-draft-test")
@ConditionalOnProperty(name = {"eye-diagnosis.draft.test-entry.enabled", "eye-diagnosis.draft.test-entry.allow-seed"},
        havingValue = "true")
public class PatientDraftSeedController {
    private final PatientDraftTestService service;
    private final UserService users;

    public PatientDraftSeedController(PatientDraftTestService service, UserService users) {
        this.service = service;
        this.users = users;
    }

    @ModelAttribute
    public void preventCaching(jakarta.servlet.http.HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @PostMapping("/seed")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<String> seed(@RequestParam(defaultValue = "glaucoma") String label, HttpServletRequest request) {
        return ResultUtils.success(service.seed(users.getLoginUser(request).getId(), label));
    }
}
