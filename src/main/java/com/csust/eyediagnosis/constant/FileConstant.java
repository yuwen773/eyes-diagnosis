package com.csust.eyediagnosis.constant;

import java.util.Arrays;
import java.util.List;

/**
 * @ClassNameFileConstant
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/17 下午1:27
 * @Version 1.0
 **/

public class FileConstant {
    public static final String FAIL_UPLOAD = "上传失败";
    public static final String FAIL_DOWNLOAD = "下载失败";
    public static final String FILE_CAN_NOT_BE_NULL = "图片不能为空";
    public static final long ONE_M = 1024 * 1024L; ;
    public static final String FILE_SIZE_ERROR = "文件大小不能超过2M";

    public static final List<String> ALLOW_FILE_SUFFIX = Arrays.asList("jpg", "jpeg", "png", "webp");
    public static final String FILE_TYPE_ERROR = "文件类型错误";

    public static final String PICTURE_NOT_EXISTS = "图片不存在";
    public static final String PICTURE_FAIL_UPLOAD = "图片上传失败";

    public static final String ID_CAN_NOT_BE_NULL = "id 不能为空";
    public static final String URL_TOO_LONG = "url 过长";
    public static final String PROFILE_TOO_LONG = "简介过长";




}
