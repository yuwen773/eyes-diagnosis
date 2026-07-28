package com.csust.eyediagnosis.controller.workflow;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowStatsSummaryVO;
import com.csust.eyediagnosis.workflow.api.WorkflowStatsService;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** PR-12.6 dashboard stats gateway: aggregated counters only, readable by any logged-in role. */
@RestController
@RequestMapping("/workflow/stats")
public class WorkflowStatsController {

    @Resource
    private WorkflowStatsService statsService;

    @GetMapping("/summary")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<WorkflowStatsSummaryVO> summary() {
        return ResultUtils.success(statsService.summarize());
    }
}
