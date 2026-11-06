package com.csust.eyediagnosis.model.enums;

import cn.hutool.core.util.ObjUtil;
import lombok.Getter;

@Getter
public enum UserRole {
    USER("用户","user"),
    ADMIN("管理员","admin"),
    EVIDENCE_REVIEWER("领域审核人员","evidence_reviewer")
     ;


    private final String text;
    private final String value;

    UserRole(String text, String value) {
        this.text = text;
        this.value = value;
    }

    /**
     * 根据 value  获取 userRole
     * @param value value
     * @return userRole
     */
    public static UserRole getEnumByValue(String value) {
        if(ObjUtil.isEmpty(value)){
            return null;
        }
        for (UserRole role : values()) {
            if (role.value.equals(value)) {
                return role;
            }
        }
        return null;
    }
}
