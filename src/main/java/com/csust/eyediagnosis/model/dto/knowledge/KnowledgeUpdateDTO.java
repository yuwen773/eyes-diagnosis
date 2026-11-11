package com.csust.eyediagnosis.model.dto.knowledge;

import lombok.Data;

import java.io.Serializable;

/**
 * 知识文档的标题修改请求。
 *
 * <p>只允许改标题（人读的名字）。文件本体要换，走重新上传的通道——
 * 换文件等于换一份新文档的全部切片，不该由「改标题」顺带发生。
 */
@Data
public class KnowledgeUpdateDTO implements Serializable {

    /** 文档 id */
    private Long id;

    /** 新标题 */
    private String title;

    private static final long serialVersionUID = 1L;
}
