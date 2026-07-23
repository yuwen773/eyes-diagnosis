package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.UploadTask;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface UploadTaskMapper extends BaseMapper<UploadTask> {

    List<String> selectActiveKeys(Long userId);

    void insertPending(UploadTask task);
}