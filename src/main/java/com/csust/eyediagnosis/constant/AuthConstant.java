package com.csust.eyediagnosis.constant;

/**
 * @ClassNameUserAuthConstant
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/12 下午5:55
 * @Version 1.0
 **/

public class AuthConstant {
    /**
     * 默认角色
     */
    public static final String DEFAULT_ROLE = "user";
    /**
     * 管理员角色
     */
    public static final String ADMIN_ROLE = "admin";
    /**
     * 医生角色（PR-12.3：提交/认领人工复核仅限医生）
     */
    public static final String DOCTOR_ROLE = "doctor";
    /**
     * 审计角色（PR-12.3：审计视图允许审计员与管理员）
     */
    public static final String AUDITOR_ROLE = "auditor";
}
