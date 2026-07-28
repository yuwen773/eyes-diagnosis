package com.csust.eyediagnosis.workflow.observability;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.mapper.HumanReviewTaskMapper;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Registers the live {@code review_pending_count} gauge: the number of review tasks that still
 * need a doctor (status OPEN or CLAIMED). Queried lazily on each scrape.
 */
@Component
public class ReviewPendingGaugeRegistrar {

    private static final Logger log = LoggerFactory.getLogger(ReviewPendingGaugeRegistrar.class);

    public ReviewPendingGaugeRegistrar(MeterRegistry registry, HumanReviewTaskMapper taskMapper) {
        Gauge.builder(WorkflowMetrics.REVIEW_PENDING, () -> countPending(taskMapper))
                .description("Review tasks currently waiting for a doctor (OPEN or CLAIMED)")
                .register(registry);
    }

    private static Number countPending(HumanReviewTaskMapper taskMapper) {
        try {
            QueryWrapper<HumanReviewTaskEntity> wrapper = new QueryWrapper<>();
            wrapper.in("status", "OPEN", "CLAIMED");
            Long count = taskMapper.selectCount(wrapper);
            return count == null ? 0 : count;
        } catch (RuntimeException exception) {
            log.warn("review_pending_count scrape failed; reporting 0", exception);
            return 0;
        }
    }
}
