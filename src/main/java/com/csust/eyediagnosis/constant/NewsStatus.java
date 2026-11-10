package com.csust.eyediagnosis.constant;

/**
 * 健康资讯的发布生命周期状态，对应 {@code t_news.status}。
 *
 * <p>0/1/2 是历史既有值，语义不变；3 是本次新增的「待审核」。
 * 医疗资讯面向患者，管理员提交后需经复核才能对公开端可见。
 *
 * <p>所有状态共用一个列，不另设 reviewStatus —— 它们同属一条
 * 发布生命周期，并列两列会造成状态双写漂移。
 */
public interface NewsStatus {
    /** 草稿：仅管理端可见 */
    int DRAFT = 0;
    /** 已发布：公开端可见 */
    int PUBLISHED = 1;
    /** 下架：曾发布过，因故撤回 */
    int OFFLINE = 2;
    /** 待审核：已提交，等待复核 */
    int PENDING_REVIEW = 3;

    /** 公开端唯一可见的状态 */
    int PUBLIC_VISIBLE = PUBLISHED;

    static boolean isValid(int status) {
        return status == DRAFT || status == PUBLISHED
                || status == OFFLINE || status == PENDING_REVIEW;
    }

    static String label(int status) {
        return switch (status) {
            case DRAFT -> "DRAFT";
            case PUBLISHED -> "PUBLISHED";
            case OFFLINE -> "OFFLINE";
            case PENDING_REVIEW -> "PENDING_REVIEW";
            default -> "UNKNOWN(" + status + ")";
        };
    }
}
