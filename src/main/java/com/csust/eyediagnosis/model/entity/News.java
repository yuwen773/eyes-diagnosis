package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
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
     * 发布生命周期状态，取值见 {@link com.csust.eyediagnosis.constant.NewsStatus}：
     * 0 草稿 / 1 已发布 / 2 下架 / 3 待审核。
     * 公开端只展示 1；值域由 NewsServiceImpl 守卫，DB 不设 CHECK（3306 为 5.7）。
     */
    private Integer status;

    /** 提交审核人 id */
    private Long submittedById;

    /** 提交审核时间 */
    private Date submittedAt;

    /** 审核人 id */
    private Long reviewedById;

    /** 审核时间 */
    private Date reviewedAt;

    /** 审核意见 / 驳回理由 */
    private String reviewNote;

    /** 内容分类（可空：生产库历史数据无分类） */
    private String category;

    /** 来源出处 */
    private String source;

    /** 是否精选：0-否 1-是 */
    private Integer featured;

    /** 下架原因 */
    private String offlineReason;

    /**
     * 发布时间
     */
    private Date publishTime;

    /**
     * 修改时间
     */
    private Date editTime;

    /**
     * 逻辑删除，与全局 logic-delete-field: isDelete 一致。
     * 删除改为软删，保留「曾经有过这篇文章」的事实。
     */
    @TableLogic
    private Integer isDelete;
}
