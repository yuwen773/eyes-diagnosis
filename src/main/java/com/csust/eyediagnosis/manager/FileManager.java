package com.csust.eyediagnosis.manager;

import cn.hutool.core.date.DateUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.NumberUtil;
import cn.hutool.core.util.RandomUtil;
import com.csust.eyediagnosis.config.CosClientConfig;
import com.csust.eyediagnosis.constant.FileConstant;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.model.dto.file.UploadPictureDetail;
import com.qcloud.cos.model.PutObjectResult;
import com.qcloud.cos.model.ciModel.persistence.ImageInfo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.io.File;
import java.util.Date;

import static com.csust.eyediagnosis.constant.FileConstant.*;

/**
 * @ClassNameFileManager
 * @Description 文件上传统一的方法
 * @Author钰玟
 * @Date2025/4/17 下午3:11
 * @Version 1.0
 **/

@Service
@Slf4j
public class FileManager {

    @Resource
    private CosClientConfig cosClientConfig;

    @Resource
    private CosManager cosManager;

    /**
     * 上传图片
     * @param multipartFile 文件
     * @param uploadPathPrefix 上传路径前缀
     * @return 图片详细信息
     */
    public UploadPictureDetail uploadPicture(MultipartFile multipartFile,String uploadPathPrefix) {
        //校验图片
        validPicture(multipartFile);
        //图片上传地址的处理
        String uuid = RandomUtil.randomNumbers(16);
        //文件图片名称
        String originalFilename = multipartFile.getOriginalFilename();
        //           DateUtil.formatDateTime(new Date()) 创建日期  uuid ：uuid  FileUtil.getSuffix(originalFilename))：后缀名 例如 : .jpg  .png
        //           DateUtil.formatDate(new Date()) 创建日期  uuid ：uuid  FileUtil.getSuffix(originalFilename))：后缀名 例如 : .jpg  .png
        String uploadFileName = String.format("%s_%s.%s", DateUtil.formatDate(new Date()), uuid, FileUtil.getSuffix(originalFilename));
        String uploadPath = String.format("/%s/%s", uploadPathPrefix, uploadFileName);
        File file = null;
        try {
            //创建临时文件
            file = File.createTempFile(uploadPath,null);
            multipartFile.transferTo(file);
            //上传图片
            PutObjectResult putObjectResult = cosManager.putPictureObject(uploadPath,file);
            ImageInfo imageInfo = putObjectResult.getCiUploadResult().getOriginalInfo().getImageInfo();
            //封装返回结果
            UploadPictureDetail uploadPictureDetail = new UploadPictureDetail();
            //宽度
            int picWidth = imageInfo.getWidth();
            //高度
            int picHeight = imageInfo.getHeight();
            //宽高比例
            double picScale = NumberUtil.round(picWidth*1.0/picHeight,2).doubleValue();
            //图片名称
            uploadPictureDetail.setPicWidth(picWidth);
            uploadPictureDetail.setPicHeight(picHeight);
            uploadPictureDetail.setPicScale(picScale);
            uploadPictureDetail.setPicFormat(imageInfo.getFormat());
            uploadPictureDetail.setPicSize(FileUtil.size(file));
            //拼接图片访问地址
            uploadPictureDetail.setUrl(cosClientConfig.getHost()+"/"+uploadPath);
            return uploadPictureDetail;
        } catch (Exception e) {
            log.error("图片上传到对象存储失败",e);
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, FileConstant.FAIL_UPLOAD);
        }finally{
            this.deleteTemFile(file);
        }
    }

    /**
     * 校验图片文件是否合法
     * @param multipartFile 图片文件
     */
    private void validPicture(MultipartFile multipartFile) {
        ThrowUtils.throwIf(multipartFile==null,ErrorCode.PARAMS_ERROR,FILE_CAN_NOT_BE_NULL);
        //1.校验文件大小
        long fileSize = multipartFile.getSize();
        //不能超过 2M
        ThrowUtils.throwIf(fileSize>2*ONE_M,ErrorCode.PARAMS_ERROR,FILE_SIZE_ERROR);
        //2. 校验文件后缀
        String fileSuffix = FileUtil.getSuffix(multipartFile.getOriginalFilename());
        ThrowUtils.throwIf(!ALLOW_FILE_SUFFIX.contains(fileSuffix),ErrorCode.PARAMS_ERROR,FILE_TYPE_ERROR);
    }

    /**
     * 删除临时文件
     * @param file 文件
     */
    private void deleteTemFile(File file) {
        if(file==null){
            return;
        }
        //删除临时文件
        boolean deleteResult = file.delete();
        if(!deleteResult){
            log.error("file delete fail,filePath:{}",file.getAbsolutePath());
        }
    }
}

