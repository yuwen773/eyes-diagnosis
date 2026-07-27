package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.model.dto.workflow.SubmitReviewDecisionRequest;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.workflow.ReviewSubmissionVO;
import com.csust.eyediagnosis.model.vo.workflow.ReviewTaskSummaryVO;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.workflow.api.ReviewApiService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * PR-10 human-review REST gateway. Every state change is delegated to the frozen
 * {@link com.csust.eyediagnosis.workflow.review.HumanReviewTaskService} (PR-09); this controller
 * only enforces the API-level capability gate (doctor only) and shapes the wire contract.
 */
@RestController
@RequestMapping("/reviews")
public class ReviewController {

    @Resource
    private ReviewApiService reviewApiService;
    @Resource
    private UserService userService;

    @GetMapping("/tasks")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<List<ReviewTaskSummaryVO>> listTasks(HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        return ResultUtils.success(reviewApiService.listOpenTasks(loginUser));
    }

    @PostMapping("/tasks/{taskId}/claim")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<?> claim(@PathVariable String taskId, HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        reviewApiService.claimTask(taskId, loginUser);
        return ResultUtils.success(null);
    }

    @PostMapping("/tasks/{taskId}/submit")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<ReviewSubmissionVO> submit(@PathVariable String taskId,
                                                   @RequestBody SubmitReviewDecisionRequest body,
                                                   HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        return ResultUtils.success(reviewApiService.submitTask(taskId, body, loginUser));
    }
}
