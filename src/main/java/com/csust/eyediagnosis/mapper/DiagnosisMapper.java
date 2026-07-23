package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import org.apache.ibatis.annotations.Select;

/**
* @author 钰玟
* @description 针对表【t_diagnosis(诊断)】的数据库操作Mapper
* @createDate 2025-04-21 20:33:03
* @Entity com.csust.eyediagnosis.model.entity.Diagnosis
*/
public interface DiagnosisMapper extends BaseMapper<Diagnosis> {

    @Select("select id from t_diagnosis where url = #{imageUrl}")
    Long selectIdByImageUrl(String imageUrl);
}
