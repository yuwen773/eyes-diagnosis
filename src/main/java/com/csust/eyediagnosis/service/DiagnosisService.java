package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisResultDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
* @author 钰玟
* @description 针对表【t_diagnosis(诊断)】的数据库操作Service
* @createDate 2025-04-21 20:33:03
*/
public interface DiagnosisService extends IService<Diagnosis> {



    /**
     * 诊断图片上传
     * @param multipartFile file
     * @param diagnosisUploadDTO dto
     * @param loginUser user
     * @return vo
     */
    DiagnosisManageVO uploadDiagnosisPicture(MultipartFile multipartFile, DiagnosisUploadDTO diagnosisUploadDTO, User loginUser);


    /**
     * 获取 queryWrapper
     * @param diagnosisQueryDTO
     * @return
     */
    QueryWrapper<Diagnosis> getDiagnosisQueryWrapper(DiagnosisQueryDTO diagnosisQueryDTO);


    /**
     * 获取newsVO的列表
     * @param DiagnosisList DiagnosisList
     * @return VO
     */
    List<DiagnosisManageVO> getDiagnosisManageVOList(List<Diagnosis> DiagnosisList);

    /**
     * 将entity对象转化为vo对象
     * @param Diagnosis entity
     * @return VO
     */
    DiagnosisManageVO getDiagnosisManageVO(Diagnosis Diagnosis);

    /**
     * 根据上传的图片进行诊断
     * @param file 上传的图片文件
     * @param loginUser 登录用户
     * @return vo
     */
    DiagnosisResultVO doDiagnosis(MultipartFile file, User loginUser);

    /**
     * 加载当前用户有权访问的诊断详情（普通用户仅限本人；管理员可访问全部）。
     */
    Diagnosis getOwnedDiagnosis(Long diagnosisId, User loginUser);

    /**
     * 人工复核记录。AI 字段不得由本接口覆盖。
     */
    void recordHumanReview(Long diagnosisId, User reviewer, DiagnosisResultDTO dto);
}
