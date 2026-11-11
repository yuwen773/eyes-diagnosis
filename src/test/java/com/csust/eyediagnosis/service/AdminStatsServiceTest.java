package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.mapper.AdminStatsMapper;
import com.csust.eyediagnosis.model.vo.stats.AdminOverviewVO;
import com.csust.eyediagnosis.model.vo.stats.StatDayCount;
import com.csust.eyediagnosis.service.impl.AdminStatsServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 统计读数的口径。
 *
 * <p>两条硬规矩：
 * <ol>
 *   <li>时间窗收敛在 [7, 365]，前端传 1 天或 1000 天都不该照单全收；</li>
 *   <li>趋势要补齐空缺的天——数据库只返回有数据的日子，图表的横轴却是连续的
 *       时间窗，不补零的话，「周三没数据」会被画成和周二一样多，那是假的。</li>
 * </ol>
 */
class AdminStatsServiceTest {

    private AdminStatsMapper mapper;
    private AdminStatsService service;

    @BeforeEach
    void setUp() {
        mapper = mock(AdminStatsMapper.class);
        // MyBatis 实际返回空列表而不是 null，这里同样按空列表打底，
        // 免得测试的失败原因变成 NPE 而不是断言。
        when(mapper.diagnosisDailySince(any())).thenReturn(List.of());
        when(mapper.userDailySince(any())).thenReturn(List.of());
        when(mapper.knowledgeByStatus()).thenReturn(List.of());
        when(mapper.newsByStatus()).thenReturn(List.of());
        when(mapper.diagnosisDistributionSince(any())).thenReturn(List.of());
        when(mapper.reviewDistributionSince(any())).thenReturn(List.of());
        when(mapper.diagnosisDailyByResultSince(any())).thenReturn(List.of());
        service = new AdminStatsServiceImpl();
        ReflectionTestUtils.setField(service, "adminStatsMapper", mapper);
    }

    @Test
    void 时间窗收敛到七到三百六十五天() {
        assertEquals(7, service.overview(1).getDays());
        // 0 / 负数不是「零天窗口」，而是「没指定」——落到默认的 30 天
        assertEquals(30, service.overview(0).getDays());
        assertEquals(30, service.overview(-5).getDays());
        assertEquals(30, service.overview(30).getDays());
        assertEquals(365, service.overview(1000).getDays());
    }

    @Test
    void 趋势补齐空缺的天() {
        String day = LocalDate.now().minusDays(1).toString();
        when(mapper.diagnosisDailySince(any())).thenReturn(List.of(new StatDayCount(day, 4L)));

        AdminOverviewVO vo = service.overview(7);

        assertEquals(7, vo.getTrendDays().size());
        assertEquals(7, vo.getDiagnosisTrend().size());
        // 补出来的日子必须是 0，而不是缺项——缺项会让折线跳过那天。
        long nonZero = vo.getDiagnosisTrend().stream().filter(d -> d.getValue() > 0).count();
        assertEquals(1, nonZero);
        assertTrue(vo.getDiagnosisTrend().stream()
                .anyMatch(d -> d.getDay().equals(day) && d.getValue() == 4L));
    }

    @Test
    void 起始日期与结束日期都落在窗口内() {
        AdminOverviewVO vo = service.overview(7);
        assertNotNull(vo.getRangeStart());
        assertNotNull(vo.getRangeEnd());
        assertTrue(vo.getRangeStart().compareTo(vo.getRangeEnd()) <= 0);
    }

    @Test
    void 没有样本时平均置信度是空而不是零() {
        when(mapper.avgConfidenceSince(any())).thenReturn(null);
        assertNull(service.overview(30).getAvgConfidence());
    }

    @Test
    void 平均置信度保留四位小数() {
        when(mapper.avgConfidenceSince(any())).thenReturn(0.87654321);
        // 取 doubleValue 再比：assertEquals(double, Double) 会因为装箱歧义编译不过
        assertEquals(0.8765, service.overview(30).getAvgConfidence().doubleValue(), 1e-9);
    }

    @Test
    void 上一窗口与当前窗口首尾相接() {
        service.overview(7);

        ArgumentCaptor<Date> prevFrom = ArgumentCaptor.forClass(Date.class);
        ArgumentCaptor<Date> prevTo = ArgumentCaptor.forClass(Date.class);
        verify(mapper).countDiagnosesBetween(prevFrom.capture(), prevTo.capture());

        ArgumentCaptor<Date> currentFrom = ArgumentCaptor.forClass(Date.class);
        verify(mapper).countDiagnosesSince(currentFrom.capture());

        // 上一窗的终点就是当前窗的起点：两段拼起来不留缝、不重叠
        assertEquals(currentFrom.getValue(), prevTo.getValue(),
                "上一窗口终点应等于当前窗口起点");
        long spanMillis = prevTo.getValue().getTime() - prevFrom.getValue().getTime();
        assertEquals(7L, spanMillis / 86_400_000L, "上一窗口长度应与当前窗口相同");
    }

    @Test
    void 上一窗口的趋势也补齐空缺的天() {
        when(mapper.diagnosisDailyBetween(any(), any()))
                .thenReturn(List.of(new StatDayCount("2026-10-30", 2L)));

        AdminOverviewVO vo = service.overview(7);

        assertEquals(7, vo.getPreviousDiagnosisTrend().size());
        assertEquals(7, vo.getPreviousUserTrend().size());
        long nonZero = vo.getPreviousDiagnosisTrend().stream()
                .filter(day -> day.getValue() > 0).count();
        assertEquals(1, nonZero);
    }

    @Test
    void 待复核积压是全站累计而不是窗口内新增() {
        when(mapper.countAwaitingReviewTotal()).thenReturn(9L);

        AdminOverviewVO vo = service.overview(30);

        assertEquals(9L, vo.getDiagnosisAwaitingReviewTotal());
    }
}
