package com.csust.eyediagnosis.model.vo.workflow;

import lombok.Data;

/** PR-12.6 dashboard summary. Aggregated counters only — no per-patient medical detail. */
@Data
public class WorkflowStatsSummaryVO {
    /** Workflows created today. */
    private long todayCount;
    /** COMPLETED + COMPLETED_LIMITED today / created today, in [0,1]; 0 when no data. */
    private double completionRate;
    /** Average created->updated duration in seconds of workflows completed today. */
    private long avgDurationSeconds;
    /** Review tasks currently waiting for a doctor (OPEN or CLAIMED). */
    private long pendingReviewCount;
}
