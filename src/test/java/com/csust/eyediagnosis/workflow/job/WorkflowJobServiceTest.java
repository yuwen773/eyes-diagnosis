package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class WorkflowJobServiceTest {
    private static final WorkflowExecutionProperties PROPERTIES = new WorkflowExecutionProperties(true, Duration.ofSeconds(30), Duration.ofSeconds(5), Duration.ofSeconds(20), 10);

    @Test
    void claimUsesNewTokenAndReturnsOnlyTheDatabaseLease() {
        WorkflowExecutionGate gate = () -> true;
        WorkflowJobRepository repository = mock(WorkflowJobRepository.class);
        LeaseTokenGenerator tokenGenerator = () -> "token-2";
        WorkflowJobEntity selected = job("job-1", WorkflowJobStatus.READY.name(), 0, 0L);
        WorkflowJobEntity leased = job("job-1", WorkflowJobStatus.LEASED.name(), 1, 1L);
        leased.setLeaseOwner("worker-a");
        leased.setLeaseToken("token-2");
        leased.setLeaseUntil(LocalDateTime.now().plusSeconds(30));
        when(repository.findNextClaimableForUpdate(anyList(), anyList())).thenReturn(Optional.of(selected));
        when(repository.claimIfAvailable(eq("job-1"), eq("worker-a"), eq("token-2"), anyLong(), anyList(), anyList())).thenReturn(1);
        when(repository.findById("job-1")).thenReturn(Optional.of(leased));

        Optional<LeasedWorkflowJob> result = new DefaultWorkflowJobClaimService(gate, repository, tokenGenerator, PROPERTIES)
                .claimNext(new WorkerIdentity("worker-a"));

        assertTrue(result.isPresent());
        assertEquals(1L, result.orElseThrow().leaseVersion());
        assertEquals(1, result.orElseThrow().attempt());
        assertEquals("token-2", result.orElseThrow().leaseToken());
    }

    @Test
    void disabledGateDoesNotSelectOrClaimJobs() {
        WorkflowJobRepository repository = mock(WorkflowJobRepository.class);
        Optional<LeasedWorkflowJob> result = new DefaultWorkflowJobClaimService(() -> false, repository, () -> "token", PROPERTIES)
                .claimNext(new WorkerIdentity("worker-a"));

        assertTrue(result.isEmpty());
        verifyNoInteractions(repository);
    }

    @Test
    void leaseOperationsOnlyReportSuccessWhenTheFencedUpdateSucceeds() {
        WorkflowJobRepository repository = mock(WorkflowJobRepository.class);
        DefaultWorkflowJobLeaseService service = new DefaultWorkflowJobLeaseService(repository, PROPERTIES);
        when(repository.renewIfLeaseMatches(eq("job-1"), eq("worker-a"), eq("token"), eq(2L), anyLong())).thenReturn(1, 0);
        when(repository.markSucceededIfLeaseMatches("job-1", "worker-a", "token", 2L)).thenReturn(1, 0);
        LeasedJobFence fence = new LeasedJobFence("job-1", "worker-a", "token", 2, 1);

        assertEquals(LeaseRenewalResult.RENEWED, service.renew("job-1", new WorkerIdentity("worker-a"), "token", 2));
        assertEquals(LeaseRenewalResult.LEASE_LOST, service.renew("job-1", new WorkerIdentity("worker-a"), "token", 2));
        assertTrue(service.markSucceededIfLeaseMatches(fence));
        assertFalse(service.markSucceededIfLeaseMatches(fence));
    }

    @Test
    void retrySchedulesThenExhaustsOnlyWithTheCurrentFence() {
        WorkflowJobRepository repository = mock(WorkflowJobRepository.class);
        DefaultWorkflowJobRetryService service = new DefaultWorkflowJobRetryService(repository,
                new ExponentialJobRetryBackoffPolicy(Duration.ofSeconds(5), Duration.ofSeconds(20)));
        LeasedJobFence fence = new LeasedJobFence("job-1", "worker-a", "token", 2, 1);
        when(repository.scheduleRetryIfLeaseMatches(eq("job-1"), eq("worker-a"), eq("token"), eq(2L), anyLong(), eq("LEASE_LOST"))).thenReturn(1, 0);
        when(repository.failIfLeaseMatches("job-1", "worker-a", "token", 2, "RETRY_EXHAUSTED")).thenReturn(1);

        assertEquals(JobRetryResult.RETRY_SCHEDULED, service.scheduleRetry(fence, ControlledJobErrorCode.LEASE_LOST));
        assertEquals(JobRetryResult.RETRY_EXHAUSTED, service.scheduleRetry(fence, ControlledJobErrorCode.LEASE_LOST));
    }

    @Test
    void recoverySkipsWhenDisabledAndCancelsJobsForTerminalWorkflows() {
        WorkflowJobRepository repository = mock(WorkflowJobRepository.class);
        DefaultExpiredLeaseRecoveryService disabled = new DefaultExpiredLeaseRecoveryService(() -> false, PROPERTIES, repository,
                new ExponentialJobRetryBackoffPolicy(Duration.ofSeconds(5), Duration.ofSeconds(20)));
        assertTrue(disabled.recoverExpiredLeases().skipped());
        verifyNoInteractions(repository);

        WorkflowJobEntity expired = job("job-1", WorkflowJobStatus.LEASED.name(), 1, 1L);
        when(repository.findExpiredLeaseJobIdsForUpdate(10)).thenReturn(List.of("job-1"));
        when(repository.findById("job-1")).thenReturn(Optional.of(expired));
        when(repository.findWorkflowStatusForUpdate("workflow-1")).thenReturn("COMPLETED");
        when(repository.cancelExpiredLease("job-1")).thenReturn(1);
        DefaultExpiredLeaseRecoveryService enabled = new DefaultExpiredLeaseRecoveryService(() -> true, PROPERTIES, repository,
                new ExponentialJobRetryBackoffPolicy(Duration.ofSeconds(5), Duration.ofSeconds(20)));

        ExpiredLeaseRecoveryReport report = enabled.recoverExpiredLeases();
        assertFalse(report.skipped());
        assertEquals(1, report.cancelled());
    }

    @Test
    void creationReturnsTheExistingJobWithoutOverwritingItAfterUniqueConflict() {
        WorkflowJobRepository repository = mock(WorkflowJobRepository.class);
        NewWorkflowJob request = new NewWorkflowJob("workflow-1", 0, SegmentCode.INTAKE_INFERENCE_QUALITY, WorkflowJobType.START_SEGMENT, 3);
        WorkflowJobEntity existing = job("existing-job", WorkflowJobStatus.SUCCEEDED.name(), 1, 1L);
        doThrow(new DuplicateKeyException("duplicate")).when(repository).insert(any());
        when(repository.findByBusinessKey("workflow-1", 0, "INTAKE_INFERENCE_QUALITY", "START_SEGMENT")).thenReturn(Optional.of(existing));

        JobCreationResult result = new DefaultWorkflowJobCreationService(repository).createIfAbsent(request);

        assertEquals(JobCreationResult.Status.ALREADY_EXISTS, result.status());
        assertEquals("existing-job", result.jobId());
        assertEquals(WorkflowJobStatus.SUCCEEDED.name(), existing.getStatus());
    }

    private static WorkflowJobEntity job(String jobId, String status, int attempt, long leaseVersion) {
        WorkflowJobEntity entity = new WorkflowJobEntity();
        entity.setJobId(jobId);
        entity.setWorkflowId("workflow-1");
        entity.setJobType(WorkflowJobType.START_SEGMENT.name());
        entity.setSegmentCode(SegmentCode.INTAKE_INFERENCE_QUALITY.name());
        entity.setExecutionEpoch(0L);
        entity.setStatus(status);
        entity.setAttempt(attempt);
        entity.setMaxAttempts(3);
        entity.setLeaseVersion(leaseVersion);
        return entity;
    }
}
