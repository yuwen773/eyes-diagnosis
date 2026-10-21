package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface UploadTaskMapper extends BaseMapper<UploadTask> {

    /**
     * 查询该用户仍然"有效"的上传对象 key：这些对象在 COS 上必须保留。
     *
     * <p>保留哪些状态由调用方以 {@code statuses} 传入，唯一来源是
     * {@link com.csust.eyediagnosis.upload.state.UploadStatus#activeCodes()}：
     * 保留 UPLOADING / PERSISTED / COMPLETED，FAILED 与 DELETED 视为可清理。
     */
    List<String> selectActiveKeys(@Param("userId") Long userId, @Param("statuses") List<Integer> statuses);

    void insertPending(UploadTask task);

    /**
     * 按 (userId, objectKey) 查找最近一条上传任务。
     */
    UploadTask selectByObjectKey(@Param("userId") Long userId, @Param("objectKey") String objectKey);

    /**
     * 以 compare-and-set 方式推进状态：仅当库中状态仍为 {@code fromStatus} 时才写入 {@code toStatus}。
     *
     * @return 受影响行数，0 表示状态已被其它流程改动
     */
    int updateStatus(@Param("taskId") String taskId,
                     @Param("fromStatus") Integer fromStatus,
                     @Param("toStatus") Integer toStatus);
}
