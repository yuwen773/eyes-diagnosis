package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.patientfollowup.PatientFollowUpService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/diagnosis-tasks")
public class PatientFollowUpController {
    private final PatientFollowUpService followUps;
    private final UserService users;

    public PatientFollowUpController(PatientFollowUpService followUps, UserService users) {
        this.followUps = followUps; this.users = users;
    }

    @ModelAttribute
    public void preventCaching(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @PostMapping("/{id}/follow-ups")
    @AuthCheck
    public BaseResponse<PatientFollowUpService.Answer> ask(@PathVariable String id, @RequestBody PatientFollowUpService.Question question,
                                                         HttpServletRequest request) {
        return ResultUtils.success(followUps.ask(id, users.getLoginUser(request).getId(), question));
    }
}
