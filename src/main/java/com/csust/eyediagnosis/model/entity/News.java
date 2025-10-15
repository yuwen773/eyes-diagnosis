package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 新闻
 * @TableName t_news
 */
@TableName(value ="t_news")
@Data
public class News {
    /**
     * id
     */
    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /**
     * 新闻标题
     */
    private String title;

    /**
     * 创建用户id
     */
    private Long userId;

    /**
     * 新闻正文（富文本)
     */
    private String content;

    /**
     * 摘要
     */
    private String summary;

    /**
     * 封面图片 url
     */
    private String coverImg;

    /**
     * 状态（0草稿/1已发布/2下架）
     */
    private Integer status;

    /**
     * 发布时间
     */
    private Date publishTime;

    /**
     * 修改时间
     */
    private Date editTime;
}