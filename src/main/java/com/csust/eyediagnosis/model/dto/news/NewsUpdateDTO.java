package com.csust.eyediagnosis.model.dto.news;

import lombok.Data;

import java.io.Serializable;

/**
 * @ClassNameUserUpdateDTO
 * @Description 修改传输对象
 * @Author钰玟
 * @Date2025/4/12 下午5:29
 * @Version 1.0
 **/

@Data
public class NewsUpdateDTO implements Serializable {
    /**
     * 新闻id
     */
    private Long id;

    /**
     * 新闻标题
     */
    private String title;

    /**
     * 新闻内容
     */
    private String content;

    /**
     * 新闻文中图片
     */
//    private List<Attachment> attachments;
    /**
     * 新闻文中图片
     */
    /**
     * 状态（0草稿/1已发布/2下架）
     */
    private Integer status;
    /**
     * 新闻封面
     */
    private String coverImage;

    /** 内容分类（可空，不传则不改） */
    private String category;

    /** 来源出处 */
    private String source;

    /** 是否精选：0-否 1-是 */
    private Integer featured;

    private static final long serialVersionUID = 1L;
}
