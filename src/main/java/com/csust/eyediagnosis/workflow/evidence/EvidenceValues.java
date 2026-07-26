package com.csust.eyediagnosis.workflow.evidence;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.TreeSet;

final class EvidenceValues {
    static final int MAX_TOP_K = 10;
    static final int MAX_QUOTE_LENGTH = 4_000;
    private EvidenceValues() { }
    static Set<String> codes(Set<String> values, String name) {
        if (values == null || values.isEmpty()) throw new InvalidWorkflowContractException(name + " must not be empty");
        TreeSet<String> ordered = new TreeSet<>();
        for (String value : values) {
            if (value == null || !value.matches("[A-Za-z][A-Za-z0-9_-]{1,63}")) {
                throw new InvalidWorkflowContractException(name + " contains an uncontrolled code");
            }
            ordered.add(value);
        }
        return Collections.unmodifiableSet(new LinkedHashSet<>(ordered));
    }
    static Set<String> terms(Set<String> values) {
        if (values == null || values.isEmpty()) throw new InvalidWorkflowContractException("controlledTerms must not be empty");
        TreeSet<String> ordered = new TreeSet<>();
        for (String value : values) if (value == null || value.isBlank() || value.length() > 128) throw new InvalidWorkflowContractException("controlledTerms contains invalid text"); else ordered.add(value.trim());
        return Collections.unmodifiableSet(new LinkedHashSet<>(ordered));
    }
    static String required(String value, String name) {
        if (value == null || value.isBlank()) throw new InvalidWorkflowContractException(name + " is required");
        return value.trim();
    }
    static String digest(String text) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(normalize(text).getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte value : hash) result.append(String.format("%02x", value));
            return result.toString();
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    static String normalize(String text) { return text == null ? "" : text.replaceAll("\\s+", " ").trim(); }
}
