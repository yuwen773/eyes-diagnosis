package com.csust.eyediagnosis.model.vo.knowledge;

import lombok.Data;

import java.io.Serializable;

/**
 * 一条切片（chunk）的读数。
 *
 * <p>切片是 RAG 真正检索的最小单位：管理员要能回答「这份文档被切成了什么样子、
 * 每块多长、边界切在哪」，否则 RAG 出了问题（比如检索不到、召回串段）无从下手。
 */
@Data
public class KnowledgeChunkVO implements Serializable {

    /** 切片序号（从 0 开始，与向量库里的 chunk id 后缀一致） */
    private int index;

    /** 切片正文 */
    private String text;

    /** 切片字符数 */
    private int chars;

    public KnowledgeChunkVO() {
    }

    public KnowledgeChunkVO(int index, String text) {
        this.index = index;
        this.text = text;
        this.chars = text == null ? 0 : text.length();
    }

    private static final long serialVersionUID = 1L;
}
