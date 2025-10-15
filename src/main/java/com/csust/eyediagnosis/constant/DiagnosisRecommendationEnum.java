package com.csust.eyediagnosis.constant;

import cn.hutool.core.util.ObjUtil;
import lombok.Getter;

@Getter
public enum DiagnosisRecommendationEnum {
    NORMAL("normal", "正常"),
    AMD("amd", "抗VEGF药物注射治疗，如雷珠单抗、艾伐仑单抗等\n" +
            "定期眼科检查，监测病情变化\n" +
            "合理饮食，补充含抗氧化剂的食物（如深绿色蔬菜、橙色水果）\n" +
            "戒烟，控制血压和血脂\n" +
            "佩戴防蓝光眼镜，减少蓝光伤害"),
    CATARACT("cataract", "早期可通过更换眼镜度数缓解症状\n" +
            "中晚期主要采用手术治疗，包括超声乳化白内障吸除术和人工晶体植入\n" +
            "术后需按医嘱使用抗生素和激素眼药水\n" +
            "避免强光照射，必要时佩戴太阳镜\n" +
            "控制血糖，避免糖尿病加速白内障发展"),
    DIABETES("diabetes", "严格控制血糖、血压和血脂\n" +
            "定期进行眼底检查，早期发现视网膜病变\n" +
            "激光光凝治疗，控制视网膜新生血管\n" +
            "抗VEGF药物玻璃体内注射\n" +
            "严重增殖期可能需要玻璃体视网膜手术"),
    GLAUCOMA("glaucoma", "药物治疗：降眼压滴眼液（如β受体阻滞剂、前列腺素类药物）\n" +
            "激光治疗：选择性激光小梁成形术(SLT)或激光周边虹膜切除术\n" +
            "手术治疗：小梁切除术、青光眼引流管植入术等\n" +
            "避免剧烈运动和情绪波动，保持规律生活作息\n" +
            "长期定期随访，监测眼压变化"),
    HYPERTENSION("hypertension", "严格控制血压，按时服用降压药物\n" +
            "低盐低脂饮食，控制体重\n" +
            "戒烟限酒，规律运动\n" +
            "定期眼科检查，监测视网膜血管变化\n" +
            "严重视网膜病变可能需要激光光凝治疗"),
    MYOPIA("myopia", "科学验光，正确佩戴眼镜或隐形眼镜\n" +
            "低度近视儿童可考虑角膜塑形镜或阿托品滴眼液控制近视发展\n" +
            "使用电子设备时注意休息（20-20-20法则：每20分钟远眺20英尺外物体20秒）\n" +
            "保持充足光线，正确阅读姿势\n" +
            "高度近视需定期检查眼底，监测视网膜变性风险"),
    OTHER("other", "其他");

    private final String englishLabel;
    private final String recommendation;

    DiagnosisRecommendationEnum(String englishLabel, String recommendation) {
        this.englishLabel = englishLabel;
        this.recommendation = recommendation;
    }

    /**
     * 根据英文标签获取对应的枚举值
     * @param englishLabel 英文标签
     * @return 枚举值
     */
    public static DiagnosisRecommendationEnum getEnumByEnglishLabel(String englishLabel) {
        if(ObjUtil.isEmpty(englishLabel)){
            return null;
        }
        for (DiagnosisRecommendationEnum category : values()) {
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
    public static String getRecommendationByEnglishLabel(String englishLabel) {
        DiagnosisRecommendationEnum category = getEnumByEnglishLabel(englishLabel);
        return category != null ? category.getRecommendation() : null;
    }

}