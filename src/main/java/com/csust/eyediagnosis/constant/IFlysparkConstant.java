package com.csust.eyediagnosis.constant;

/**
 * @ClassNameIFlysparkConstant
 * @Description TODO
 * @Author钰玟
 * @Date2025/3/14 下午8:44
 * @Version 1.0
 **/

/**
 * 讯飞星火接入的相关常量
 */
public class IFlysparkConstant {
    //接入 讯飞星火
    public static final String AUTHORIZATION = "Authorization";
    public static final String AUTHORIZATION_PREFIX = "Bearer ";
    public static final String MODEL = "model";
    public static final String MESSAGE = "messages";
    public static final String MODEL_NAME = "4.0Ultra";
    public static final String ROLE = "role";
    public static final String USER_ROLE_NAME = "user";
    public static final String SYSTEM_ROLE = "system";
    public static final String CONTENT = "content";
    public static final String SYSTEM_CONTENT =
            "假如你是一个眼科医生，用户会提相关眼科方面的问题，你应该体贴而全面的回答用户的问题，文字无需有样式，只需要条理清晰(换行，标点) ";
}
