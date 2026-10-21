package com.csust.eyediagnosis.agent.rag;

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

    /** 内置语料的检索过滤表达式：当前用户的私有文档 + 公共的内置语料。 */
    public static String ownerFilter(Long currentUserId) {
        return "ownerUserId == " + currentUserId + " || ownerUserId == " + SYSTEM_OWNER_ID;
    }

    private BuiltinCorpus() {
    }
}
