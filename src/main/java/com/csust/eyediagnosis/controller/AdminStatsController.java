package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.model.vo.stats.AdminOverviewVO;
import com.csust.eyediagnosis.service.AdminStatsService;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 管理端的统计端点。
 *
 * <p>仪表盘与数据分析两个页面共用这一个入口：同一份口径、同一批数字。
 */
@RestController
@RequestMapping("/stats")
public class AdminStatsController {

    @Resource
    private AdminStatsService adminStatsService;

    /**
     * 总览读数。
     *
     * @param days 时间窗长度（天），默认 30，收敛到 [7, 365]
     */
    @GetMapping("/admin/overview")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<AdminOverviewVO> overview(@RequestParam(value = "days", defaultValue = "30") int days) {
        return ResultUtils.success(adminStatsService.overview(days));
    }
}
