package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.DiagnosisRun;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 判读运行状态。所有状态迁移都是**条件更新**（compare-and-set），
 * 不做「先读后写」——取消与落库可能同时发生，谁先提交谁说了算。
 */
@Mapper
public interface DiagnosisRunMapper extends BaseMapper<DiagnosisRun> {

    @Select("select * from t_diagnosis_run where runId = #{runId}")
    DiagnosisRun selectByRunId(@Param("runId") String runId);

    /**
     * 占用这次运行：PENDING → DONE。
     *
     * @return 1 表示占用成功（取消没赢）；0 表示已被取消或已结束
     */
    @Update("update t_diagnosis_run set status = 'DONE' where runId = #{runId} and status = 'PENDING'")
    int claim(@Param("runId") String runId);

    /** 占用成功之后补上正式记录 id。 */
    @Update("update t_diagnosis_run set diagnosisId = #{diagnosisId} where runId = #{runId}")
    int attachDiagnosis(@Param("runId") String runId, @Param("diagnosisId") Long diagnosisId);

    /**
     * 取消：PENDING → CANCELLED。
     *
     * @return 1 表示取消成功；0 表示运行已结束（或不存在）
     */
    @Update("update t_diagnosis_run set status = 'CANCELLED' where runId = #{runId} and status = 'PENDING'")
    int cancel(@Param("runId") String runId);
}
