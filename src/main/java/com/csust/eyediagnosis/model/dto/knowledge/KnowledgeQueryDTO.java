package com.csust.eyediagnosis.model.dto.knowledge;

import com.csust.eyediagnosis.common.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;

/**
 * 知识库列表的筛选条件。
 *
 * <p>原先列表端点只收 {@code {current, pageSize}}，管理员除了翻页没有任何筛选手段：
 * 「这份文档解析失败了吗」「上周传的 PDF 是哪几份」都得靠肉眼扫。
 *
 * <p>日期一律用 {@code yyyy-MM-dd} 字符串，不用 Date：Jackson 把 "2026-11-01"
 * 解析成 Date 时按 UTC 解释，东八区会偏 8 小时，筛选边界不可预期。
 */
@EqualsAndHashCode(callSuper = true)
@Data
public class KnowledgeQueryDTO extends PageRequest implements Serializable {

    /** 文件名模糊检索 */
    private String fileName;

    /** 标题模糊检索 */
    private String title;

    /** 处理状态：0 处理中 / 1 已完成 / 2 失败；不传则不限 */
    private Integer status;

    /** 文件类型：pdf / doc / docx / txt / md / markdown；不传则不限 */
    private String fileType;

    /** 上传时间下界（含当天），格式 yyyy-MM-dd */
    private String startDate;

    /** 上传时间上界（含当天），格式 yyyy-MM-dd */
    private String endDate;

    private static final long serialVersionUID = 1L;
}
