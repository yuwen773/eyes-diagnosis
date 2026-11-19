package com.csust.eyediagnosis.agent.rag;

import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;

/**
 * 内置知识语料的公共约定。
 *
 * <p>内置语料（{@code src/main/resources/rag/*.md}）不归属任何用户，
 * 但要对所有登录用户可检索，因此用一个不与真实用户冲突的哨兵 owner 表示。
 */
public final class BuiltinCorpus {

    /**
     * 内置语料的 owner 哨兵值。用户主键自增且从 1 开始，0 不会与真实用户冲突。
     */
    public static final long SYSTEM_OWNER_ID = 0L;

    /** 内置语料在向量库 metadata 中的标记。 */
    public static final String CORPUS_TAG = "builtin";

    /**
     * 内置语料的检索过滤表达式：当前用户的私有文档 + 公共的内置语料。
     *
     * <p>用 {@link FilterExpressionBuilder} 直接构造表达式，而不是拼
     * {@code "ownerUserId == 2123010432165113858"} 这种文本：文本解析器把数字
     * 字面量按 {@code Integer} 解析，雪花 ID 超出 int 范围会直接抛
     * {@code NumberFormatException}——检索随即失败，而失败又被工具吞成一句
     * 「暂时不可用」。构造型表达式没有这条解析路径。
     */
    public static Filter.Expression ownerFilter(Long currentUserId) {
        FilterExpressionBuilder builder = new FilterExpressionBuilder();
        return builder.or(
                builder.eq("ownerUserId", currentUserId),
                builder.eq("ownerUserId", SYSTEM_OWNER_ID)
        ).build();
    }

    private BuiltinCorpus() {
    }
}
