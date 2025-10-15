package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 新闻附件表
 * @TableName t_attachment
 */
@TableName(value ="t_attachment")
@Data
public class Attachment {
    /**
     * id
     */
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /**
     * 关联新闻id
     */
    private Long newsId;

    /**
     * 图片 url
     */
    private String url;

    /**
     * 段落顺序(用于排序)
     */
    private Integer order;

    /**
     * 图片描述
     */
    private String description;
}