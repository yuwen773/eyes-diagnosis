package com.csust.eyediagnosis.agent.observability;

/**
 * 证据登记的线程前提被破坏：有工具调用正在执行，但登记发生在它的执行线程之外。
 *
 * <p>单独一个类型，是为了让工具内部的兜底 catch 能认出它并**原样抛出**——
 * 否则它会被包装成「检索暂时不可用」，护栏以检索故障的名义出现，日志里
 * 只剩一个被包住的 cause，真正的原因（线程前提被破坏）反而看不见。
 */
public final class EvidenceContextViolation extends IllegalStateException {

    public EvidenceContextViolation(String message) {
        super(message);
    }
}
