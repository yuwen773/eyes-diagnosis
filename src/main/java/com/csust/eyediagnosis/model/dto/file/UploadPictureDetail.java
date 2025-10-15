package com.csust.eyediagnosis.model.dto.file;

/**
 * @ClassNameUploadPictureDetail
 * @Description 解析图片详细信息的包装类
 * @Author钰玟
 * @Date2025/4/17 下午3:12
 * @Version 1.0
 **/

import lombok.Data;

@Data
public class UploadPictureDetail {

    /**
     * 图片地址
     */
    private String url;

    /**
     * 文件体积
     */
    private Long picSize;

    /**
     * 图片宽度
     */
    private int picWidth;

    /**
     * 图片高度
     */
    private int picHeight;

    /**
     * 图片宽高比
     */
    private Double picScale;

    /**
     * 图片格式
     */
    private String picFormat;

}
