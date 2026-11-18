package com.csust.eyediagnosis.model.dto.agent;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 会话资源（右侧资源与证据中心的数据单元）。
 *
 * <p><b>只登记真实存在的东西</b>：用户上传的图片、检索真实命中的文档片段、
 * 助手消息里真实出现的链接。文档类资源只能由检索工具产生——不从模型生成的
 * Markdown 里反向猜测来源，也不给普通外链贴「医学证据」标签。
 *
 * <p>{@code id} 是去重键：图片用 URL、文档用 {@code doc:<documentId>}、
 * 链接用规范化后的 URL。同一资源在一个会话里只出现一次。
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
        /** 检索相关度（仅当检索结果真的带分数）。 */
        Double score,
        /** 命中的片段（来自检索结果原文）。 */
        String snippet,
        /** 产生这条资源的工具调用，便于和执行步骤对上。 */
        String toolCallId
) {
    public static ResourceRef image(String url, String title) {
        return new ResourceRef("image:" + url, "image", title, "upload", url, null, null, null, null);
    }

    public static ResourceRef document(String documentId, String title, Double score, String snippet,
                                       String toolCallId) {
        return new ResourceRef("doc:" + documentId, "document", title, "knowledge-base",
                null, documentId, score, snippet, toolCallId);
    }

    public static ResourceRef link(String url, String title, String source) {
        return new ResourceRef("link:" + url, "link", title, source, url, null, null, null, null);
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
        return new ResourceRef(id, kind, title, source, url, documentId, score, snippet, toolCallId);
    }
}
