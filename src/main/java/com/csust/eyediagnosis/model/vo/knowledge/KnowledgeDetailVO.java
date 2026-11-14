package com.csust.eyediagnosis.model.vo.knowledge;

import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 知识文档详情（管理端预览用）。
 *
 * <p>一次给全三样东西：文档元信息、原文预览入口、切片清单。
 * 管理员点开一份文档时最想确认的正是「它到底被切成了什么」，
 * 分成三个端点就要来回切三次。
 */
@Data
public class KnowledgeDetailVO implements Serializable {

    /** 文档 id */
    private Long id;

    /** 标题 */
    private String title;

    /** 原始文件名 */
    private String fileName;

    /** 文件类型 */
    private String fileType;

    /** 文件大小（字节） */
    private Long fileSize;

    /** 切片数（已入库的计数） */
    private Integer chunkCount;

    /** 处理状态：0 处理中 / 1 已完成 / 2 失败 */
    private Integer status;

    /** 上传者 id */
    private Long userId;

    /** 上传时间 */
    private LocalDateTime createTime;

    /** 更新时间 */
    private LocalDateTime updateTime;

    /** 原文预览地址（限时签名 URL，10 分钟有效） */
    private String previewUrl;

    /** 预览方式：pdf = 浏览器内嵌 / text = 纯文本直读 / none = 只能下载 */
    private String previewKind;

    /** 纯文本直读的内容（仅 text 类文档有值，截断到 4000 字） */
    private String textPreview;

    /** 切片清单 */
    private List<KnowledgeChunkVO> chunks;

    /** 切片是否可读：解析失败或文件缺失时为 false */
    private boolean chunksReadable;

    /**
     * 切片是否因数量上限被截断。
     *
     * <p>重放最多回传 {@code MAX_PREVIEW_CHUNKS} 块；被截断时前端必须写明
     * 「最多显示 N 块」，否则截断后的数字会被当成真实块数。
     */
    private boolean chunksTruncated;

    /** 切片不可读时的原因 */
    private String chunksMessage;

    private static final long serialVersionUID = 1L;
}
