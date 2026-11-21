package com.csust.eyediagnosis.service.impl;

import com.csust.eyediagnosis.mapper.AdminStatsMapper;
import com.csust.eyediagnosis.model.vo.stats.AdminOverviewVO;
import com.csust.eyediagnosis.model.vo.stats.StatBucket;
import com.csust.eyediagnosis.model.vo.stats.StatDayCount;
import com.csust.eyediagnosis.model.vo.stats.StatDayNameCount;
import com.csust.eyediagnosis.service.AdminStatsService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class AdminStatsServiceImpl implements AdminStatsService {

    /** 时间窗收敛区间：7 天太短看不出趋势，365 天够看一年的季节性。 */
    private static final int MIN_DAYS = 7;
    private static final int MAX_DAYS = 365;
    private static final int DEFAULT_DAYS = 30;

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    @Resource
    private AdminStatsMapper adminStatsMapper;

    @Override
    public AdminOverviewVO overview(int days) {
        int window = Math.min(Math.max(days <= 0 ? DEFAULT_DAYS : days, MIN_DAYS), MAX_DAYS);
        LocalDate today = LocalDate.now();
        LocalDate startDay = today.minusDays(window - 1L);
        Date from = Date.from(startDay.atStartOfDay(ZoneId.systemDefault()).toInstant());
        Date todayStart = Date.from(today.atStartOfDay(ZoneId.systemDefault()).toInstant());

        AdminOverviewVO vo = new AdminOverviewVO();
        vo.setDays(window);
        vo.setRangeStart(startDay.format(DAY));
        vo.setRangeEnd(today.format(DAY));

        // 上一个等长时间窗：用来算环比与画对比曲线。
        // 当前窗是 [startDay, 今日]，上一窗是 [startDay - window, startDay)。
        LocalDate prevStartDay = startDay.minusDays(window);
        Date prevFrom = Date.from(prevStartDay.atStartOfDay(ZoneId.systemDefault()).toInstant());
        List<String> prevTrendDays = new ArrayList<>(window);
        for (int i = 0; i < window; i++) {
            prevTrendDays.add(prevStartDay.plusDays(i).format(DAY));
        }

        vo.setUserTotal(adminStatsMapper.countUsers());
        vo.setUserNew(adminStatsMapper.countUsersSince(from));
        vo.setUserAdmin(adminStatsMapper.countAdmins());
        vo.setPreviousUserNew(adminStatsMapper.countUsersBetween(prevFrom, from));

        vo.setDiagnosisTotal(adminStatsMapper.countDiagnoses());
        vo.setDiagnosisInRange(adminStatsMapper.countDiagnosesSince(from));
        vo.setPreviousDiagnosisInRange(adminStatsMapper.countDiagnosesBetween(prevFrom, from));
        vo.setDiagnosisToday(adminStatsMapper.countDiagnosesToday(todayStart));
        vo.setDiagnosisAiRejected(adminStatsMapper.countAiRejectedSince(from));
        vo.setDiagnosisAwaitingReview(adminStatsMapper.countAwaitingReviewSince(from));
        vo.setDiagnosisAwaitingReviewTotal(adminStatsMapper.countAwaitingReviewTotal());
        vo.setDiagnosisReviewed(adminStatsMapper.countReviewedSince(from));
        Double avg = adminStatsMapper.avgConfidenceSince(from);
        vo.setAvgConfidence(avg == null ? null : Math.round(avg * 10000d) / 10000d);

        vo.setKnowledgeTotal(adminStatsMapper.countKnowledgeDocs());
        vo.setKnowledgeChunks(adminStatsMapper.sumKnowledgeChunks());
        vo.setKnowledgeFailed(adminStatsMapper.countKnowledgeFailed());
        vo.setKnowledgeByStatus(adminStatsMapper.knowledgeByStatus());

        vo.setNewsTotal(adminStatsMapper.countNews());
        vo.setNewsByStatus(adminStatsMapper.newsByStatus());

        List<String> trendDays = new ArrayList<>(window);
        for (int i = 0; i < window; i++) {
            trendDays.add(startDay.plusDays(i).format(DAY));
        }
        vo.setTrendDays(trendDays);

        vo.setDiagnosisTrend(fillDays(trendDays, adminStatsMapper.diagnosisDailySince(from)));
        vo.setUserTrend(fillDays(trendDays, adminStatsMapper.userDailySince(from)));
        // 上一窗的两条趋势也补齐并按天对齐：缺一天，对比曲线就会错位一天。
        vo.setPreviousDiagnosisTrend(
                fillDays(prevTrendDays, adminStatsMapper.diagnosisDailyBetween(prevFrom, from)));
        vo.setPreviousUserTrend(
                fillDays(prevTrendDays, adminStatsMapper.userDailyBetween(prevFrom, from)));
        vo.setDiagnosisDistribution(adminStatsMapper.diagnosisDistributionSince(from));
        vo.setReviewDistribution(adminStatsMapper.reviewDistributionSince(from));
        vo.setDiagnosisTrendByResult(adminStatsMapper.diagnosisDailyByResultSince(from));

        return vo;
    }

    /**
     * 把「只有有数的那几天」补成窗口内的每一天。
     *
     * <p>数据库只返回有数据的日子；图表的横轴却是连续的时间窗——不补零，
     * 折线会把「周三没数据」画成「周三和周二一样多」，那是假的。
     */
    private List<StatDayCount> fillDays(List<String> trendDays, List<StatDayCount> raw) {
        Map<String, Long> byDay = new HashMap<>();
        if (raw != null) {
            for (StatDayCount row : raw) {
                byDay.put(row.getDay(), row.getValue());
            }
        }
        List<StatDayCount> filled = new ArrayList<>(trendDays.size());
        for (String day : trendDays) {
            filled.add(new StatDayCount(day, byDay.getOrDefault(day, 0L)));
        }
        return filled;
    }
}
