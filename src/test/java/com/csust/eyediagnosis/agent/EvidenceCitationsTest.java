package com.csust.eyediagnosis.agent;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 引用审计的口径：只认本回合真实返回的证据键，形状不对的 `[[...]]` 不算引用。
 */
class EvidenceCitationsTest {

    @Test
    void citationsMatchingToolResultsAreVerifiable() {
        EvidenceCitations.Audit audit = EvidenceCitations.audit(
                "睑板腺功能障碍是主要原因[[42#3]]，泪膜破裂时间缩短提示不稳定[[57#0]]。",
                Set.of("42#3", "57#0"));

        assertEquals(List.of("42#3", "57#0"), audit.keys());
        assertFalse(audit.hasUnverifiable());
    }

    @Test
    void citationsTheTurnNeverRetrievedAreReported() {
        EvidenceCitations.Audit audit = EvidenceCitations.audit(
                "依据[[42#3]]与[[99#1]]。",
                Set.of("42#3"));

        assertEquals(List.of("42#3", "99#1"), audit.keys(), "按首次出现顺序");
        assertEquals(List.of("99#1"), audit.unverifiable());
    }

    @Test
    void repeatedKeysAreCountedOnce() {
        EvidenceCitations.Audit audit = EvidenceCitations.audit(
                "甲[[42#3]]，乙[[42#3]]，丙[[99#1]]，丁[[99#1]]。",
                Set.of("42#3"));

        assertEquals(List.of("42#3", "99#1"), audit.keys());
        assertEquals(List.of("99#1"), audit.unverifiable());
    }

    @Test
    void malformedBracketsAreNotCitations() {
        EvidenceCitations.Audit audit = EvidenceCitations.audit(
                "[[42]]、[[42#a]]、[[ 42#3]]、[42#3]、[[42#3]]",
                Set.of("42#3"));

        // 形状不符的按原文看待：既不算引用，也不算违规。
        assertEquals(List.of("42#3"), audit.keys());
        assertFalse(audit.hasUnverifiable());
    }

    @Test
    void noMarkersMeansNothingToAudit() {
        EvidenceCitations.Audit audit = EvidenceCitations.audit("没有任何引用。", Set.of());

        assertTrue(audit.keys().isEmpty());
        assertFalse(audit.hasUnverifiable());
        assertEquals(List.of(), EvidenceCitations.audit(null, Set.of()).keys());
    }

    @Test
    void builtinCorpusKeysWithColonAreSupported() {
        EvidenceCitations.Audit audit =
                EvidenceCitations.audit("见[[builtin:dry-eye#2]]。", Set.of());

        assertEquals(List.of("builtin:dry-eye#2"), audit.keys());
        assertEquals(List.of("builtin:dry-eye#2"), audit.unverifiable());
    }
}
