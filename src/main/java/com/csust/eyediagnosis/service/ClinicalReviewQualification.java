package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.model.entity.User;

/**
 * 正式临床复核的写入资格（D-01b 的**安全关闭**实现）。
 *
 * <p>产品决策（2026-11-18 已确认）：
 * <ul>
 *   <li>管理员与医生职责分离，管理员默认最小权限；</li>
 *   <li>正式临床复核只能由**具有有效、已核验授权**的医生执行；</li>
 *   <li>医生身份走人工核验、由授权管理员受控开通；</li>
 *   <li>{@code userRole = doctor} 只说明账号角色，**不构成**资质证明。</li>
 * </ul>
 *
 * <p>本系统当前没有任何可核验的执业资质数据源：{@code t_user} 只有一个
 * {@code userRole}，没有执业证书编号、没有核验记录、没有开通/吊销流程。
 * 因此这里**fail-closed**：一律不允许写入正式临床复核结论，
 * 而不是退回到「管理员即复核人」或「角色是 doctor 即资质合格」。
 *
 * <p>为什么不用一个「打开就能用」的开关：没有资质数据源时，任何开关都只能
 * 用角色顶替资质证明，那正是本轮要消除的越权路径。要放开，必须先落地
 * <b>资质数据源 + 核验记录 + 受控开通</b> 三件事（见
 * {@code docs/reviews/iris-roundtable-final-integration.md} 的 Backlog），
 * 再把这里改成读那份凭证，而不是读 {@code userRole}。
 *
 * <p>历史记录不受影响：已写入的 {@code humanReviewStatus=REVIEWED} 与
 * {@code t_diagnosis_audit} 原样保留，展示层**一律**标「资质未核验」——
 * 不按 {@code reviewerRole} 豁免：账号角色可以被管理员改派，拿它当资质证明
 * 和拿角色当资历是同一件事。
 */
public final class ClinicalReviewQualification {

    /** 对外的关闭理由：接口直接回这段话，不让调用方猜。 */
    public static final String SAFE_OFF_REASON =
            "正式临床复核写入已安全关闭：系统尚无经过核验的医生资质数据源，"
                    + "管理员角色与账号角色都不构成临床资质证明。";

    /**
     * 该复核人是否有资格写入正式临床复核结论。
     *
     * <p>当前恒为 {@code false}：资质核验尚未建设。这不是占位实现，
     * 而是本轮授权的**安全关闭策略**本身。
     *
     * <p>{@code reviewer} 参数是给将来「查资质凭证」预留的入口；现在**故意不读它**——
     * 当前唯一能读到的就是 {@code userRole}，读它等于把角色当资质证明。
     */
    public static boolean mayWriteFormalClinicalReview(User reviewer) {
        // 故意不写 `reviewer != null && ADMIN_ROLE.equals(...)` 或 `doctor` 分支：
        // 任何按角色放行的写法都会立刻重新引入 D-01b 的越权路径。
        return false;
    }

    private ClinicalReviewQualification() {
    }
}
