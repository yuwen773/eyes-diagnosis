package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.doctorreview.DoctorReviewService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/doctor-reviews")
public class DoctorReviewController {
    private final DoctorReviewService reviews;
    private final UserService users;

    public DoctorReviewController(DoctorReviewService reviews, UserService users) {
        this.reviews = reviews; this.users = users;
    }

    public record Assignment(String taskId, Long doctorId) {}

    @ModelAttribute
    public void preventCaching(jakarta.servlet.http.HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @PostMapping("/assign")
    @AuthCheck
    public BaseResponse<DoctorReviewService.Summary> assign(@RequestBody Assignment assignment, HttpServletRequest request) {
        var review = reviews.assign(users.getLoginUser(request), assignment.taskId(), assignment.doctorId());
        return ResultUtils.success(new DoctorReviewService.Summary(review.reviewId(), review.taskId(), review.status(), review.assignedAt()));
    }

    @GetMapping
    @AuthCheck
    public BaseResponse<List<DoctorReviewService.Summary>> list(HttpServletRequest request) {
        return ResultUtils.success(reviews.list(users.getLoginUser(request)));
    }

    @GetMapping("/{id}")
    @AuthCheck
    public BaseResponse<DoctorReviewService.Detail> detail(@PathVariable String id, HttpServletRequest request) {
        return ResultUtils.success(reviews.detail(users.getLoginUser(request), id));
    }

    @PostMapping("/{id}/decision")
    @AuthCheck
    public BaseResponse<DoctorReviewService.Detail> decide(@PathVariable String id,
            @RequestBody DoctorReviewService.Decision decision, HttpServletRequest request) {
        return ResultUtils.success(reviews.decide(users.getLoginUser(request), id, decision));
    }

    @ExceptionHandler(DoctorReviewService.ReviewConflict.class)
    public ResponseEntity<BaseResponse<?>> conflict(DoctorReviewService.ReviewConflict error) {
        return ResponseEntity.status(409).body(ResultUtils.error(40900, error.getMessage()));
    }
}
