package com.csust.eyediagnosis.workflow.api;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.model.vo.workflow.WorkflowStatsSummaryVO;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.mapper.DiagnosisWorkflowMapper;
import com.csust.eyediagnosis.workflow.persistence.mapper.HumanReviewTaskMapper;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * PR-12.6 read-only aggregation for the operations dashboard. Pure SELECT/COUNT queries; it
 * never touches workflow state and never exposes raw model output.
 */
@Service
public class WorkflowStatsService {

    private static final List<String> DONE_STATUSES =
            List.of(WorkflowStatus.COMPLETED.name(), WorkflowStatus.COMPLETED_LIMITED.name());

    private final DiagnosisWorkflowMapper workflowMapper;
    private final HumanReviewTaskMapper reviewTaskMapper;

    public WorkflowStatsService(DiagnosisWorkflowMapper workflowMapper, HumanReviewTaskMapper reviewTaskMapper) {
        this.workflowMapper = workflowMapper;
        this.reviewTaskMapper = reviewTaskMapper;
    }

    public WorkflowStatsSummaryVO summarize() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();

        long todayCount = count(new QueryWrapper<DiagnosisWorkflowEntity>().ge("createdAt", startOfDay));
        long doneToday = count(new QueryWrapper<DiagnosisWorkflowEntity>()
                .ge("createdAt", startOfDay).in("status", DONE_STATUSES));

        List<DiagnosisWorkflowEntity> doneRows = workflowMapper.selectList(
                new QueryWrapper<DiagnosisWorkflowEntity>()
                        .select("createdAt", "updatedAt")
                        .ge("createdAt", startOfDay).in("status", DONE_STATUSES));
        long avgSeconds = Math.round(doneRows.stream()
                .filter(row -> row.getCreatedAt() != null && row.getUpdatedAt() != null)
                .mapToLong(row -> Duration.between(row.getCreatedAt(), row.getUpdatedAt()).getSeconds())
                .filter(seconds -> seconds >= 0)
                .average().orElse(0));

        Long pending = reviewTaskMapper.selectCount(
                new QueryWrapper<HumanReviewTaskEntity>().in("status", "OPEN", "CLAIMED"));

        WorkflowStatsSummaryVO vo = new WorkflowStatsSummaryVO();
        vo.setTodayCount(todayCount);
        vo.setCompletionRate(todayCount == 0 ? 0 : (double) doneToday / todayCount);
        vo.setAvgDurationSeconds(avgSeconds);
        vo.setPendingReviewCount(pending == null ? 0 : pending);
        return vo;
    }

    private long count(QueryWrapper<DiagnosisWorkflowEntity> wrapper) {
        Long value = workflowMapper.selectCount(wrapper);
        return value == null ? 0 : value;
    }
}
