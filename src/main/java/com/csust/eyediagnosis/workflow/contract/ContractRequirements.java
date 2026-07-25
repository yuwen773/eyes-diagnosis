package com.csust.eyediagnosis.workflow.contract;

import com.csust.eyediagnosis.workflow.exception.InvalidWorkflowContractException;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

final class ContractRequirements {
    private ContractRequirements() {
    }

    static String requiredText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new InvalidWorkflowContractException(field + " must not be blank");
        }
        return value;
    }

    static long nonNegative(long value, String field) {
        if (value < 0) {
            throw new InvalidWorkflowContractException(field + " must not be negative");
        }
        return value;
    }

    static int range(int value, int minimum, int maximum, String field) {
        if (value < minimum || value > maximum) {
            throw new InvalidWorkflowContractException(field + " must be between " + minimum + " and " + maximum);
        }
        return value;
    }

    static double probability(double value, String field) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value < 0.0 || value > 1.0) {
            throw new InvalidWorkflowContractException(field + " must be between 0 and 1");
        }
        return value;
    }

    static <T> T required(T value, String field) {
        if (value == null) {
            throw new InvalidWorkflowContractException(field + " must not be null");
        }
        return value;
    }

    static <T> Set<T> immutableSet(Collection<T> values, String field) {
        required(values, field);
        LinkedHashSet<T> copy = new LinkedHashSet<>(values);
        if (copy.stream().anyMatch(Objects::isNull)) {
            throw new InvalidWorkflowContractException(field + " must not contain null");
        }
        return Set.copyOf(copy);
    }

    static Set<String> immutableNonBlankSet(Collection<String> values, String field) {
        Set<String> copy = immutableSet(values, field);
        copy.forEach(value -> requiredText(value, field + " entry"));
        return copy;
    }

    static <T> List<T> immutableList(Collection<T> values, String field) {
        required(values, field);
        List<T> copy = List.copyOf(values);
        if (copy.stream().anyMatch(Objects::isNull)) {
            throw new InvalidWorkflowContractException(field + " must not contain null");
        }
        return copy;
    }

    static List<String> immutableNonBlankList(Collection<String> values, String field) {
        List<String> copy = immutableList(values, field);
        copy.forEach(value -> requiredText(value, field + " entry"));
        return copy;
    }
}
