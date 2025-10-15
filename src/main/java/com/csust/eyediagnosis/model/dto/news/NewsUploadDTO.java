package com.csust.eyediagnosis.model.dto.news;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNamePictureUploadDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/17 下午2:13
 * @Version 1.0
 **/
@Data
public class NewsUploadDTO implements Serializable {
    /**
     * 新闻 id（用于修改）
     */
    private Long id;

    private static final long serialVersionUID = 1L;
}

