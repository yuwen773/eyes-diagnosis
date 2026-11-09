package com.csust.eyediagnosis.model.vo.news;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;
/**
 * @ClassNameNewsVO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/23 下午7:17
 * @Version 1.0
 **/



@Data
public class NewsVO implements Serializable {
    /**
     * id
     */
    private Long id;

    /**
     * 新闻标题
     */
    private String title;

    /**
     * 创建用户名称(作者名)
     */
    private String author;
    /**
     * 创建用户名称(作者头像)
     */
    private String avatar;
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
    private String coverImage;

    /**
     * 发布时间
     */
    private Date publishTime;

    /**
     * 发布状态（0 草稿 / 1 已发布 / 2 下架），与实体 News.status 同名同型
     */
    private Integer status;

    private static final long serialVersionUID = 1L;

}
