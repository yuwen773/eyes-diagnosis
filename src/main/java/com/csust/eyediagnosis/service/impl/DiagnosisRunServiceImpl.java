package com.csust.eyediagnosis.service.impl;

import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.mapper.DiagnosisRunMapper;
import com.csust.eyediagnosis.model.entity.DiagnosisRun;
import com.csust.eyediagnosis.service.DiagnosisRunService;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
@RequiredArgsConstructor
public class DiagnosisRunServiceImpl implements DiagnosisRunService {

    private final DiagnosisRunMapper diagnosisRunMapper;

    @Override
    public void begin(String runId, Long userId) {
        DiagnosisRun run = new DiagnosisRun();
        run.setRunId(runId);
        run.setUserId(userId);
        run.setStatus(DiagnosisRun.PENDING);
        try {
            diagnosisRunMapper.insert(run);
        } catch (DuplicateKeyException duplicate) {
            // 同一 runId 再次进来：要么上一次还在跑，要么已经结束。
            // 两种都不能再落一条记录，也不该覆盖已有状态。
            DiagnosisRun existing = diagnosisRunMapper.selectByRunId(runId);
            if (existing == null) {
                throw new BusinessException(ErrorCode.OPERATION_ERROR, "判读运行状态异常，请重新开始");
            }
            if (!Objects.equals(existing.getUserId(), userId)) {
                throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "这次判读不属于当前账号");
            }
            if (DiagnosisRun.PENDING.equals(existing.getStatus())) {
                throw new BusinessException(ErrorCode.OPERATION_ERROR, "这次判读正在进行中，请稍候");
            }
            throw new BusinessException(ErrorCode.OPERATION_ERROR, "这次判读已经结束，请重新开始");
        }
    }

    @Override
    public boolean claim(String runId) {
        return diagnosisRunMapper.claim(runId) == 1;
    }

    @Override
    public void attachDiagnosis(String runId, Long diagnosisId) {
        diagnosisRunMapper.attachDiagnosis(runId, diagnosisId);
    }

    @Override
    public CancelOutcome cancel(String runId, Long userId) {
        DiagnosisRun run = diagnosisRunMapper.selectByRunId(runId);
        // 别人的 runId 一律按「没有」处理：不泄露存在性。
        if (run == null || !Objects.equals(run.getUserId(), userId)) {
            return CancelOutcome.NOT_FOUND;
        }
        // 条件更新才是胜负判定；上面的读只用来区分「已结束」与「不存在」。
        return diagnosisRunMapper.cancel(runId) == 1
                ? CancelOutcome.CANCELLED
                : CancelOutcome.ALREADY_FINISHED;
    }

    @Override
    public boolean isCancelled(String runId) {
        DiagnosisRun run = diagnosisRunMapper.selectByRunId(runId);
        return run != null && DiagnosisRun.CANCELLED.equals(run.getStatus());
    }
}
