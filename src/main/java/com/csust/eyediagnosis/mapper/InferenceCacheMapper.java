package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.InferenceCache;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface InferenceCacheMapper extends BaseMapper<InferenceCache> {

    InferenceCache findByHash(@Param("imageHash") String imageHash,
                              @Param("modelVersion") String modelVersion,
                              @Param("weightSha256") String weightSha256,
                              @Param("preprocessVersion") String preprocessVersion);

    int insertOne(InferenceCache entity);
}
