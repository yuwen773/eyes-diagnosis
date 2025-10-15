package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.config.PythonConfig;
import com.csust.eyediagnosis.constant.DiagnosisCategoryEnum;
import com.csust.eyediagnosis.constant.DiagnosisRecommendationEnum;
import com.csust.eyediagnosis.constant.ExceptionConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.manager.FileManager;
import com.csust.eyediagnosis.mapper.DiagnosisMapper;
import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.vo.diagnosis.Disease;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisUploadDTO;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisResultVO;
import com.csust.eyediagnosis.service.DiagnosisService;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.stream.Collectors;

import static cn.hutool.core.date.DateTime.now;
import static com.csust.eyediagnosis.constant.FileConstant.PICTURE_FAIL_UPLOAD;
import static com.csust.eyediagnosis.constant.OrderConstant.ASC;
import static com.csust.eyediagnosis.constant.PythonConstant.*;

/**
* @author 钰玟
* @description 针对表【t_diagnosis(诊断)】的数据库操作Service实现
* @createDate 2025-04-21 20:33:03
*/
@Service
public class DiagnosisServiceImpl extends ServiceImpl<DiagnosisMapper, Diagnosis>
    implements DiagnosisService{

    @Resource
    private FileManager fileManager;
    @Resource
    private UserMapper userMapper;
    @Resource
    private PythonConfig pythonConfig;
    @Resource
    private DiagnosisMapper diagnosisMapper;

    @Override
    public DiagnosisManageVO uploadDiagnosisPicture(MultipartFile multipartFile, DiagnosisUploadDTO diagnosisUploadDTO, User loginUser) {
        //是否有权限
        ThrowUtils.throwIf(loginUser==null, ErrorCode.NO_AUTH_ERROR);


        //上传图片
        //用户Id作为每个用户的图库前缀
        String uploadPrefix = String.format("public/%s",loginUser.getId());
        UploadPictureDetail uploadPictureDetail = fileManager.uploadPicture(multipartFile, uploadPrefix);
        //构造要入库的图片基本信息
        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setUrl(uploadPictureDetail.getUrl());
        diagnosis.setPicSize(uploadPictureDetail.getPicSize());
        diagnosis.setPicWidth(uploadPictureDetail.getPicWidth());
        diagnosis.setPicHeight(uploadPictureDetail.getPicHeight());
        diagnosis.setPicScale(uploadPictureDetail.getPicScale());
        diagnosis.setPicFormat(uploadPictureDetail.getPicFormat());
        diagnosis.setUserId(loginUser.getId());

        //插入/更新
        boolean result = this.saveOrUpdate(diagnosis);
        ThrowUtils.throwIf(!result,ErrorCode.OPERATION_ERROR,PICTURE_FAIL_UPLOAD);
        return DiagnosisManageVO.objToVo(diagnosis);
    }

    @Override
    public QueryWrapper<Diagnosis> getDiagnosisQueryWrapper(DiagnosisQueryDTO diagnosisQueryDTO) {
        if(diagnosisQueryDTO ==null){
            throw new BusinessException(ErrorCode.PARAMS_ERROR, ExceptionConstant.PARAMS_IS_NULL);
        }
        //提取查询字段
        QueryWrapper<Diagnosis> queryWrapper = new QueryWrapper<>();
        //用户的Id
        Long userId = diagnosisQueryDTO.getUserId();
        //1. 疾病id
        Long id = diagnosisQueryDTO.getId();
        //2. 疾病名称
        String result = diagnosisQueryDTO.getResult();
        //3. 排序字段
        String sortField = diagnosisQueryDTO.getSortField();
        //4. 排序依据
        String sortOrder = diagnosisQueryDTO.getSortOrder();

//        封装wrapper
        queryWrapper.eq(ObjUtil.isNotNull(id),"userId", userId);
        queryWrapper.eq(ObjUtil.isNotNull(id),"id", id);
        queryWrapper.like(StrUtil.isNotBlank(result),"result", result);
        queryWrapper.orderBy(StrUtil.isNotBlank(sortField),sortOrder.equals(ASC),sortField);
        queryWrapper.eq(ObjUtil.isNotNull(userId),"userId", userId);
        //返回query

        return queryWrapper;
    }

    @Override
    public List<DiagnosisManageVO> getDiagnosisManageVOList(List<Diagnosis> DiagnosisList) {
        if (CollUtil.isEmpty(DiagnosisList)){
            return new ArrayList<>();
        }
        return DiagnosisList.stream().map(this::getDiagnosisManageVO).collect(Collectors.toList());
    }

    @Override
    public DiagnosisManageVO getDiagnosisManageVO(Diagnosis Diagnosis) {
        DiagnosisManageVO diagnosisManageVO = new DiagnosisManageVO();

        BeanUtil.copyProperties(Diagnosis,diagnosisManageVO);
        //获取当前诊断的用户
        User user = userMapper.selectUserNameAndUserAvatarByUserId(Diagnosis.getUserId());
        //设置作者名
        String Username = user.getUserName();
        diagnosisManageVO.setUsername(Username);
        return diagnosisManageVO;
    }
    /**
     * 根据上传的图片进行诊断
     * @param diagnosisDTO dto
     * @return vo
     */
    @Override
    public DiagnosisResultVO doDiagnosis(DiagnosisDTO diagnosisDTO) {
        //获取诊断图片的url
        String imageUrl = diagnosisDTO.getImageUrl();
        String pythonUrl = pythonConfig.getPythonUrl();
        DiagnosisResultVO diagnosisResultVO = null;
        try {
            // 发生post请求
            HttpResponse response = HttpRequest.post(pythonUrl).form(
                    IMAGE_URL,imageUrl
            ).execute();
            //获取状态码
            int responseCode = response.getStatus();
            //响应体
            String body = response.body();

            //判断是否请求成功
            if(responseCode == HttpURLConnection.HTTP_OK){
                // 使用 HuTool 解析JSON
                JSONObject result = JSONUtil.parseObj(body);
                // 提取主要诊断结果
                //结果(的描述)
                String description = result.getStr(DESCRIPTION);
                //结果 （English）
                String predictedLabel = result.getStr(PREDICTED_LABEL);
                //可能性
                double probability = result.getDouble(PROBABILITY);
                //可靠性 （置信度）
                double reliabilityScore = result.getInt(RELIABILITY_SCORE);

                //封装vo
                diagnosisResultVO = new DiagnosisResultVO();
                //封装url 更新的依据
                diagnosisResultVO.setUrl(imageUrl);
                //更新的依据
                Long diagnosisId = diagnosisMapper.selectIdByImageUrl(imageUrl);
                diagnosisResultVO.setId(diagnosisId);
                //结果
                String chineseResult = DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(predictedLabel);
                diagnosisResultVO.setResult(chineseResult);
                //详情
                diagnosisResultVO.setDetails(description);
                //可能性
                diagnosisResultVO.setProbability(probability);
                //严重程度
                List<String> severityList = Arrays.asList("normal","mild","moderate","severe");
                //TODO 随机设置
                Random random = new Random();
                int randomIndex = random.nextInt(severityList.size()); // 获取0到列表大小-1之间的随机索引
                diagnosisResultVO.setSeverity(severityList.get(randomIndex));
                //置信度
                diagnosisResultVO.setConfidence(reliabilityScore);
                //建议
                String recommendation = DiagnosisRecommendationEnum.getRecommendationByEnglishLabel(predictedLabel);
                diagnosisResultVO.setRecommendations(recommendation);
                //设置诊断时间
                diagnosisResultVO.setCreateTime(now());

                //插入数据库
                Diagnosis diagnosis = DiagnosisResultVO.voToObj(diagnosisResultVO);

                diagnosisMapper.updateById(diagnosis);
                //创建数组--其他疾病
                List<Disease> diseases = new ArrayList<>();
                // 处理其他可能的诊断结果
                result.getJSONArray(TOP_PREDICTIONS).forEach(pred -> {
                    Disease disease = new Disease();
                    //解析 obj
                    JSONObject prediction = JSONUtil.parseObj(pred);
                    //设置name
                    disease.setName(prediction.getStr(LABEL));
                    //设置probability
                    disease.setProbability(prediction.getDouble(PROBABILITY));
//                    System.err.println(disease);
                    diseases.add(disease);
                });
                //封装其他疾病
                diagnosisResultVO.setOtherDisease(diseases);
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        return diagnosisResultVO;
    }
}




