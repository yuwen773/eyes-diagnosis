package com.csust.eyediagnosis.model.dto.agent;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 会话资源（右侧资源与证据中心的数据单元）。
 *
 * <p><b>只登记真实存在的东西</b>：用户上传的图片、检索真实命中的文档片段、
 * 助手消息里真实出现的链接。文档类资源只能由检索工具产生——不从模型生成的
 * Markdown 里反向猜测来源，也不给普通外链贴「医学证据」标签。
 *
 * <p>{@code id} 是去重键：图片用 URL、文档用 {@code doc:<documentId>#<chunkIndex>}
 * （拿不到片段序号时退回 {@code doc:<documentId>}）、链接用规范化后的 URL。
 * 同一资源在一个会话里只出现一次。
 *
 * <p>文档类资源的证据粒度是<b>片段</b>而不是文档：同一文档命中两段要出现两条，
 * 因为「模型看到的是哪一段」才是可核验的对象。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ResourceRef(
        /** 稳定标识：同一会话内去重。 */
        String id,
        /** image | document | link */
        String kind,
        String title,
        /** upload | knowledge-base | assistant | tool */
        String source,
        /** 图片/链接的可访问地址；文档类为空。 */
        String url,
        /** 知识库文档标识（来自检索结果，不由模型生成）。 */
        String documentId,
        /**
         * 最终排序分：rerank 生效时是重排序分，否则是文档自带的检索分。
         * 只有检索结果真的带分数时才有值。
         */
        Double score,
        /**
         * 原始检索分（向量相似度 / 文档自带分）。只在 rerank 生效、且这一条拿到了重排序分
         * 时单独记录；没有 rerank（含回退）时与 {@link #score} 同源，保持为空，
         * 避免两个分数看起来不一致。
         */
        Double retrievalScore,
        /** 命中的片段（来自检索结果原文）。 */
        String snippet,
        /** 产生这条资源的工具调用，便于和执行步骤对上。 */
        String toolCallId,
        /** 上传文档的已发布索引版本；历史读取时再次核验。 */
        String indexVersion,
        /** 向量库里这一段的稳定 id（服务端生成，不由模型生成）。 */
        String chunkId,
        /** 这一段在该文档内的序号（从 0 起）；拿不到时为空。 */
        Integer chunkIndex
) {
    /** 旧形状（无片段信息）：历史 JSON 与不需要片段粒度的调用方继续可用。 */
    public ResourceRef(String id, String kind, String title, String source, String url, String documentId,
                       Double score, Double retrievalScore, String snippet, String toolCallId) {
        this(id, kind, title, source, url, documentId, score, retrievalScore, snippet, toolCallId,
                null, null, null);
    }

    public static ResourceRef document(String documentId, String title, Double score, Double retrievalScore,
                                       String snippet, String toolCallId) {
        return new ResourceRef("doc:" + documentId, "document", title, "knowledge-base",
                null, documentId, score, retrievalScore, snippet, toolCallId);
    }

    /**
     * 片段级证据：id 带上片段序号，同一文档的不同片段各占一条。
     *
     * @param chunkId    向量库里的片段 id；为空时 id 退回文档级
     * @param chunkIndex 片段序号；为空时 id 退回文档级
     */
    public static ResourceRef documentChunk(String documentId, String chunkId, Integer chunkIndex,
                                            String title, Double score, Double retrievalScore,
                                            String snippet, String toolCallId) {
        String id = chunkIndex == null ? "doc:" + documentId : "doc:" + documentId + "#" + chunkIndex;
        return new ResourceRef(id, "document", title, "knowledge-base", null, documentId,
                score, retrievalScore, snippet, toolCallId, null, chunkId, chunkIndex);
    }

    public ResourceRef withIndexVersion(String indexVersion) {
        return new ResourceRef(id, kind, title, source, url, documentId, score, retrievalScore, snippet,
                toolCallId, indexVersion, chunkId, chunkIndex);
    }

    /**
     * 补齐产生这条资源的工具调用 id：工具内部只知道自己检索了什么，
     * 不知道框架分配的 {@code toolCallId}，由旁路观察者在调用结束时补上。
     */
    public ResourceRef withToolCallId(String toolCallId) {
        if (toolCallId == null || toolCallId.isBlank()) {
            return this;
        }
        if (this.toolCallId != null && !this.toolCallId.isBlank()) {
            return this;
        }
        return new ResourceRef(id, kind, title, source, url, documentId, score, retrievalScore, snippet,
                toolCallId, indexVersion, chunkId, chunkIndex);
    }

    /**
     * 证据处理键：{@code documentId#chunkIndex}。
     *
     * <p>正文引用只认这个键：模型引用的必须是本轮真实检索到的片段，
     * 文档级引用（没有片段序号）不构成可核验证据。
     */
    public String evidenceKey() {
        if (documentId == null || chunkIndex == null) {
            return null;
        }
        return documentId + "#" + chunkIndex;
    }
}
