package com.csust.eyediagnosis.service;

/**
 * 管理端的统计读数。
 *
 * <p>仪表盘与数据分析要的是「同一份口径」——同一指标在两页里必须是同一个数，
 * 否则管理员会以为其中一个页面坏了。
 */
public interface AdminStatsService {

    /**
     * 取时间窗内的经营读数。
     *
     * @param days 时间窗长度（天），实现内部会收敛到 [7, 365]
     * @return 总览读数
     */
    com.csust.eyediagnosis.model.vo.stats.AdminOverviewVO overview(int days);
}
