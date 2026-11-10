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
     * 状态（0 草稿 / 1 已发布 / 2 下架 / 3 待审核），取值见 NewsStatus。
     * 不传则不改状态；迁移合法性由 NewsLifecycleService 校验。
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

    /**
     * 审核意见 / 驳回理由 / 下架原因。
     * 仅当本次同时提交 status 且迁移到目标状态时生效；纯内容编辑传 null。
     */
    private String note;

    private static final long serialVersionUID = 1L;
}
