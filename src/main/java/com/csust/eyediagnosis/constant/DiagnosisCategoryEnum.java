package com.csust.eyediagnosis.constant;

import cn.hutool.core.util.ObjUtil;
import lombok.Getter;

@Getter
public enum DiagnosisCategoryEnum {
    NORMAL("normal", "正常"),
    AMD("amd", "年龄相关性黄斑变性"),
    CATARACT("cataract", "白内障"),
    DIABETES("diabetes", "糖尿病"),
    GLAUCOMA("glaucoma", "青光眼"),
    HYPERTENSION("hypertension", "高血压"),
    MYOPIA("myopia", "近视"),
    OTHER("other", "其他");

    private final String englishLabel;
    private final String chineseLabel;

    DiagnosisCategoryEnum(String englishLabel, String chineseLabel) {
        this.englishLabel = englishLabel;
        this.chineseLabel = chineseLabel;
    }

    /**
     * 根据英文标签获取对应的枚举值
     * @param englishLabel 英文标签
     * @return 枚举值
     */
    public static DiagnosisCategoryEnum getEnumByEnglishLabel(String englishLabel) {
        if(ObjUtil.isEmpty(englishLabel)){
            return null;
        }
        for (DiagnosisCategoryEnum category : values()) {
            if (category.englishLabel.equals(englishLabel)) {
                return category;
            }
        }
        return null;
    }

    /**
     * 根据英文标签获取对应的中文标签
     * @param englishLabel 英文标签
     * @return 中文标签
     */
    public static String getChineseLabelByEnglishLabel(String englishLabel) {
        DiagnosisCategoryEnum category = getEnumByEnglishLabel(englishLabel);
        return category != null ? category.getChineseLabel() : null;
    }

    public static void main(String[] args) {
        // 测试示例
        String result = getChineseLabelByEnglishLabel("normal");
        System.out.println(result); // 输出: 正常

        DiagnosisCategoryEnum category = getEnumByEnglishLabel("myopia");
        System.out.println(category.getChineseLabel()); // 输出: 近视
    }
}