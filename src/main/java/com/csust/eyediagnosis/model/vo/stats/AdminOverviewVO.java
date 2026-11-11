package com.csust.eyediagnosis.model.vo.stats;

import lombok.Data;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 管理端的经营读数总览。
 *
 * <p>仪表盘与数据分析两个页面共用这一份口径：同一个指标在两页里必须是同一个数，
 * 否则管理员会以为其中一个页面坏了。
 *
 * <p>口径约定：
 * <ul>
 *   <li>{@code xxxTotal} 是历史累计（全站）；</li>
 *   <li>{@code xxxInRange} / {@code xxxNew} 是选定时间窗内的量；</li>
 *   <li>所有趋势与分布都按时间窗内的数据算，窗口期与界面上的时间范围选择器一致。</li>
 * </ul>
 */
@Data
public class AdminOverviewVO implements Serializable {

    /** 时间窗长度（天） */
    private int days;

    /** 时间窗起点（yyyy-MM-dd） */
    private String rangeStart;

    /** 时间窗终点（yyyy-MM-dd） */
    private String rangeEnd;

    /* ── 用户 ── */
    /** 用户总数（全站累计） */
    private long userTotal;
    /** 时间窗内新增用户 */
    private long userNew;
    /** 上一个等长时间窗的新增用户数（环比用） */
    private long previousUserNew;
    /** 管理员账号数 */
    private long userAdmin;

    /* ── 判读 ── */
    /** 判读记录总数（全站累计） */
    private long diagnosisTotal;
    /** 时间窗内判读数 */
    private long diagnosisInRange;
    /** 上一个等长时间窗的判读数（环比用） */
    private long previousDiagnosisInRange;
    /** 今日判读数 */
    private long diagnosisToday;
    /** AI 拒识数（时间窗内） */
    private long diagnosisAiRejected;
    /** 待人工复核数（时间窗内） */
    private long diagnosisAwaitingReview;
    /**
     * 待人工复核积压量（全站累计）。
     *
     * <p>与 {@code diagnosisAwaitingReview} 不同：那个是「窗口内新增的待复核」，
     * 这个是「现在还有多少没处理」。管理端的首要动作是清积压，看的必须是后者。
     */
    private long diagnosisAwaitingReviewTotal;
    /** 已完成人工复核数（时间窗内） */
    private long diagnosisReviewed;
    /** 平均置信度（时间窗内，无结论的记录不参与平均；无样本时为 null） */
    private Double avgConfidence;

    /* ── 知识库 ── */
    /** 文档总数（全站累计） */
    private long knowledgeTotal;
    /** 切片总数（全站累计） */
    private long knowledgeChunks;
    /** 处理失败的文档数（全站累计，status = 2）——管理端要能直接去处理 */
    private long knowledgeFailed;
    /** 按处理状态分布 */
    private List<StatBucket> knowledgeByStatus = new ArrayList<>();

    /* ── 资讯 ── */
    /** 资讯总数（全站累计） */
    private long newsTotal;
    /** 按发布状态分布 */
    private List<StatBucket> newsByStatus = new ArrayList<>();

    /* ── 图表序列 ── */
    /** 时间窗的日期序列（补齐无数据的天，图表按它对齐） */
    private List<String> trendDays = new ArrayList<>();
    /** 每日判读数 */
    private List<StatDayCount> diagnosisTrend = new ArrayList<>();
    /** 上一个等长时间窗的每日判读数（与 diagnosisTrend 按天对齐，环比用） */
    private List<StatDayCount> previousDiagnosisTrend = new ArrayList<>();
    /** 上一个等长时间窗的每日新增用户数（与 userTrend 按天对齐，环比用） */
    private List<StatDayCount> previousUserTrend = new ArrayList<>();
    /** 每日新增用户数 */
    private List<StatDayCount> userTrend = new ArrayList<>();
    /** 病种分布（时间窗内） */
    private List<StatBucket> diagnosisDistribution = new ArrayList<>();
    /** 人工复核状态分布（时间窗内） */
    private List<StatBucket> reviewDistribution = new ArrayList<>();
    /** 按病种拆开的日趋势（时间窗内） */
    private List<StatDayNameCount> diagnosisTrendByResult = new ArrayList<>();

    private static final long serialVersionUID = 1L;
}
