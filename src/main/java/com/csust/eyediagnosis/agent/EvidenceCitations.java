package com.csust.eyediagnosis.agent;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 正文证据引用的服务端审计。
 *
 * <p>模型在回答里用 `[[文档ID#片段序号]]` 标注依据（见 {@code DiagnosisAgent} 的
 * 系统提示词）。这个类是**旁路观测**：不改写正文、不替前端判定，只回答一个
 * 运维问题——这一次回答里有多少引用对不上本回合真实检索到的片段。
 *
 * <p>核验的权威在前端渲染时（那里才有资源列表与回合划分），这里只用于发现
 * 「提示词失效 / 模型开始编造引用」这类回归，按条数记日志。
 *
 * <p>键的形状必须与前端 {@code CITE_KEY_RE} 一致：含空白、标点的 `[[...]]`
 * 不是引用，不当成违规，也不会计入统计。
 */
public final class EvidenceCitations {

    /** 与前端 markdown 的 inline 规则同一形状：documentId 可含 {@code . : _ -}，序号为非负整数。 */
    private static final Pattern MARKER = Pattern.compile("\\[\\[([A-Za-z0-9_.:-]+#\\d+)]]");

    private EvidenceCitations() {
    }

    /**
     * 扫描结果。
     *
     * @param keys         正文里出现的证据键（去重、保持首次出现顺序）
     * @param unverifiable 其中不在本回合检索结果里的键（去重、保持顺序）
     */
    public record Audit(List<String> keys, List<String> unverifiable) {
        public boolean hasUnverifiable() {
            return !unverifiable.isEmpty();
        }
    }

    /**
     * @param text  完整回答正文
     * @param valid 本回合工具真实返回并可核验的证据键（{@link
     *              com.csust.eyediagnosis.model.dto.agent.ResourceRef#evidenceKey()}）
     */
    public static Audit audit(String text, Set<String> valid) {
        if (text == null || text.isEmpty()) return new Audit(List.of(), List.of());
        Set<String> seen = new LinkedHashSet<>();
        Set<String> unknown = new LinkedHashSet<>();
        Matcher matcher = MARKER.matcher(text);
        while (matcher.find()) {
            String key = matcher.group(1);
            if (!seen.add(key)) continue;
            if (valid == null || !valid.contains(key)) unknown.add(key);
        }
        return new Audit(new ArrayList<>(seen), new ArrayList<>(unknown));
    }
}
