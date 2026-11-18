package com.csust.eyediagnosis.model.vo.diagnosis;

import java.io.Serializable;

/**
 * 判读记录的「来源与复核」只读投影。
 *
 * <p>这不是一个新的业务状态，而是把数据库里**本来分开存着**的三件事并排摆出来，
 * 让报告页不必再用「有没有公开 URL」「状态是不是 REVIEWED」猜：
 *
 * <ol>
 *   <li>协作草稿审核 —— `t_doctor_review`：医生是否批准了某个版本的协作说明；</li>
 *   <li>患者授权保存 —— `t_patient_authorization`：患者是否同意保存、何时授权、回执号；</li>
 *   <li>正式临床人工复核 —— `t_diagnosis.humanReviewStatus`：谁在什么时候做了人工结论。</li>
 * </ol>
 *
 * <p>三者不能互相替代。患者授权保存**不等于**临床人工复核，也不等于医生批准了草稿。
 *
 * @param recordSource  记录来源：`DIRECT`（患者自传影像直接判读）/ `COLLABORATION_DRAFT`（经协作任务落下的记录）。
 *                      只描述「这条记录挂在一个影像任务上」，**不**断言草稿已获批或患者已授权——
 *                      那两件事分别看 `draftReviewState` 与 `authorizationState`。
 * @param patientTaskId 关联的影像任务 id；直接拍摄的记录为 null
 * @param draftReviewState 协作草稿审核状态（PENDING / APPROVED / REJECTED）；无关联草稿为 null
 * @param authorizationState 患者授权状态（OFFERED / APPROVED / EXPIRED）；无授权记录为 null
 * @param authorizedAt  患者授权时间（ISO-8601，UTC）；未授权为 null
 * @param authorizationReceipt 回执号**前缀**（前 8 位 + 省略号）。完整回执是否对本人开放是产品决策，本轮不开放
 * @param imageArchivalState 影像归档状态：ARCHIVED / ARCHIVED_NOT_PUBLIC / NOT_ARCHIVED / UNKNOWN
 */
public record DiagnosisSourceProjection(
        String recordSource,
        String patientTaskId,
        String draftReviewState,
        String authorizationState,
        String authorizedAt,
        String authorizationReceipt,
        String imageArchivalState
) implements Serializable {

    /** 患者自己上传、直接判读的记录（历史数据也走这一支）。 */
    public static final String SOURCE_DIRECT = "DIRECT";
    /** 协作草稿经医生批准、患者授权保存后落下的记录。 */
    public static final String SOURCE_COLLABORATION_DRAFT = "COLLABORATION_DRAFT";

    /**
     * 影像归档状态。
     *
     * <p>刻意不用 boolean：「有没有原图」和「能不能给你看这张原图」是两件事。
     * 协作影像按隐私策略不对外公开 URL，但它**确实归档了**——把它显示成
     * 「未保存」就是在说一件不成立的事。
     */
    public static final class Archival {
        /**
         * 记录引用了公开影像地址。
         *
         * <p>只说「记录里有这个地址」，**不**保证对象此刻仍在——本轮没有做存储侧
         * 存在性探测（那需要一次远端 HEAD）。要升级为「已确认可取回」得先有探测。
         */
        public static final String ARCHIVED = "ARCHIVED";
        /** 影像按隐私策略不提供公开地址（协作影像）；对象键存在，但同样未做存在性探测。 */
        public static final String ARCHIVED_NOT_PUBLIC = "ARCHIVED_NOT_PUBLIC";
        /** 既没有地址也没有对象键：这张判读确实没有留下影像。 */
        public static final String NOT_ARCHIVED = "NOT_ARCHIVED";
        /** 判定所需的查询失败或证据不足。**不能**当成「没有」。 */
        public static final String UNKNOWN = "UNKNOWN";

        private Archival() {
        }
    }
}
