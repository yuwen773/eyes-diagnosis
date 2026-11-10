package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 新闻状态与内容变更审计（V17 建表）。
 *
 * <p>payload 只记「改了哪些字段」的字段级摘要，不复制富文本正文全文。
 */
@Data
@TableName("t_news_audit")
public class NewsAudit {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 新闻 id */
    private Long newsId;

    /** 操作人 id */
    private Long actorId;

    /** 操作人角色 */
    private String actorRole;

    /** 动作: EDIT / SUBMIT_REVIEW / REJECT / PUBLISH / OFFLINE / DELETE */
    private String action;

    /** 变更前状态 */
    private String fromStatus;

    /** 变更后状态 */
    private String toStatus;

    /** 变更摘要（JSON 字符串） */
    private String payload;

    private Date createdTime;
}
