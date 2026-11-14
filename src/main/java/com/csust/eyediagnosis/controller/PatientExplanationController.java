package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.patientexplanation.PatientExplanationService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/diagnosis-tasks")
public class PatientExplanationController {
    private final PatientExplanationService explanations;
    private final UserService users;

    public PatientExplanationController(PatientExplanationService explanations, UserService users) {
        this.explanations = explanations; this.users = users;
    }

    @ModelAttribute
    public void preventCaching(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @GetMapping("/{id}/explanation")
    @AuthCheck
    public BaseResponse<PatientExplanationService.View> view(@PathVariable String id, HttpServletRequest request) {
        return ResultUtils.success(explanations.view(id, users.getLoginUser(request).getId()));
    }

    @GetMapping("/{id}/citations/{index}")
    @AuthCheck
    public BaseResponse<PatientExplanationService.Source> citation(@PathVariable String id, @PathVariable int index, HttpServletRequest request) {
        return ResultUtils.success(explanations.citation(id, users.getLoginUser(request).getId(), index));
    }
}
