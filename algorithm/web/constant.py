"""Constants transcribed from the Java constant classes.

These are contract, not implementation detail: the Chinese strings are returned
verbatim to the frontend and rendered in toasts, and the numeric literals go
into the database. Values are transcribed, not re-invented.
"""

# --- constant/UserConstant.java ---
PARAMS_IS_NULL = "参数为空"
ACCOUNT_MIN_LENGTH = 4
PASSWORD_MIN_LENGTH = 8
ACCOUNT_IS_SHORT = "用户账户过短"
PASSWORD_IS_SHORT = "用户密码过短"
DOUBLE_PASSWORD_NOT_EQUAL = "两次输入的密码不一致"
ACCOUNT_REPEATED = "账号重复"
FAIL_REGISTER = "注册失败，数据库错误"
ACCOUNT_ERROR = "账号错误"
PASSWORD_ERROR = "密码错误"
FAIL_LOGIN = "用户不存在或密码错误"
NO_LOGIN = "未登录"

# --- constant/OrderConstant.java ---
ASC = "ascend"
DESC = "descend"

# --- constant/AuthConstant.java (re-exported for convenience) ---
DEFAULT_ROLE = "user"
ADMIN_ROLE = "admin"

# --- constant/ReexamineConstant.java ---
#: All three, not just the one Phase 2.1 needed. 0 is NOT a valid state -- the
#: DDL default is 1 (``db/callback/beforeMigrate__bootstrap_legacy_flyway_schema.sql:27``).
REEXAMINE_STATUS_UNDONE = 1
REEXAMINE_STATUS_WAITING = 2
#: ``DiagnosisServiceImpl:276`` writes this as a bare literal rather than
#: through the constant, but it is the same value.
REEXAMINE_STATUS_DONE = 3

# --- constant/FileConstant.java ---
FAIL_UPLOAD = "上传失败"
FAIL_DOWNLOAD = "下载失败"
FILE_CAN_NOT_BE_NULL = "图片不能为空"
ONE_M = 1024 * 1024
FILE_SIZE_ERROR = "文件大小不能超过2M"
FILE_TYPE_ERROR = "文件类型错误"
PICTURE_NOT_EXISTS = "图片不存在"
PICTURE_FAIL_UPLOAD = "图片上传失败"
ID_CAN_NOT_BE_NULL = "id 不能为空"
URL_TOO_LONG = "url 过长"
PROFILE_TOO_LONG = "简介过长"

#: FileConstant.ALLOW_FILE_SUFFIX
ALLOW_FILE_SUFFIX = ("jpg", "jpeg", "png", "webp")

# --- constant/StatusConstant.java ---
#: ``DiagnosisManageVO.status`` is hardcoded to this at field-init and is NOT a
#: DB column (see ``DiagnosisManageVO.java:66``). DOING/CANCELED are defined in
#: Java but never written anywhere -- kept for fidelity, not for use.
STATUS_COMPLETED = "已完成"
STATUS_DOING = "进行中"
STATUS_CANCELED = "已取消"

# --- constant/HumanReviewStatus.java ---
#: A String-constant interface in Java, not an enum. Order matters only for
#: readability; all five are reachable in the DB.
HUMAN_REVIEW_PENDING_AI = "PENDING_AI"
HUMAN_REVIEW_AI_ONLY = "AI_ONLY"
HUMAN_REVIEW_AWAITING_REVIEW = "AWAITING_REVIEW"
HUMAN_REVIEW_REVIEWED = "REVIEWED"
HUMAN_REVIEW_OVERRIDDEN = "OVERRIDDEN"

HUMAN_REVIEW_STATUSES = (
    HUMAN_REVIEW_PENDING_AI,
    HUMAN_REVIEW_AI_ONLY,
    HUMAN_REVIEW_AWAITING_REVIEW,
    HUMAN_REVIEW_REVIEWED,
    HUMAN_REVIEW_OVERRIDDEN,
)

#: The only value Java ever writes to ``DiagnosisResultVO.severity``
#: (``DiagnosisServiceImpl.java:445``). The Chinese 低/中/高 branch in
#: ``DiagnosisReportDetail.vue:244-260`` is dead code -- see ruling 14.
SEVERITY_NOT_ASSESSED = "NOT_ASSESSED"

# --- constant/DiagnosisCategoryEnum.java ---
#: ``englishLabel -> chineseLabel``. ``getChineseLabelByEnglishLabel`` returns
#: **None** (no fallback) for an unknown label -- the same null-propagating
#: behaviour is preserved in ``web.schemas.diagnosis``.
DIAGNOSIS_CATEGORY_LABELS = {
    "normal": "正常",
    "amd": "年龄相关性黄斑变性",
    "cataract": "白内障",
    "diabetes": "糖尿病",
    "glaucoma": "青光眼",
    "hypertension": "高血压",
    "myopia": "近视",
    "other": "其他",
}

# --- constant/DiagnosisRecommendationEnum.java ---
#: Multi-line Chinese advice joined with "\n", stored in VARCHAR(512).
#: Longest entry is MYOPIA at 122 characters, so nothing overflows -- but the
#: strings must not be re-wrapped, because that would change what the frontend
#: splits on. Copy-pasted verbatim from the Java enum.
DIAGNOSIS_RECOMMENDATIONS = {
    "normal": "正常",
    "other": "其他",
    "amd": (
        "抗VEGF药物注射治疗，如雷珠单抗、艾伐仑单抗等\n"
        "定期眼科检查，监测病情变化\n"
        "合理饮食，补充含抗氧化剂的食物（如深绿色蔬菜、橙色水果）\n"
        "戒烟，控制血压和血脂\n"
        "佩戴防蓝光眼镜，减少蓝光伤害"
    ),
    "cataract": (
        "早期可通过更换眼镜度数缓解症状\n"
        "中晚期主要采用手术治疗，包括超声乳化白内障吸除术和人工晶体植入\n"
        "术后需按医嘱使用抗生素和激素眼药水\n"
        "避免强光照射，必要时佩戴太阳镜\n"
        "控制血糖，避免糖尿病加速白内障发展"
    ),
    "diabetes": (
        "严格控制血糖、血压和血脂\n"
        "定期进行眼底检查，早期发现视网膜病变\n"
        "激光光凝治疗，控制视网膜新生血管\n"
        "抗VEGF药物玻璃体内注射\n"
        "严重增殖期可能需要玻璃体视网膜手术"
    ),
    "glaucoma": (
        "药物治疗：降眼压滴眼液（如β受体阻滞剂、前列腺素类药物）\n"
        "激光治疗：选择性激光小梁成形术(SLT)或激光周边虹膜切除术\n"
        "手术治疗：小梁切除术、青光眼引流管植入术等\n"
        "避免剧烈运动和情绪波动，保持规律生活作息\n"
        "长期定期随访，监测眼压变化"
    ),
    "hypertension": (
        "严格控制血压，按时服用降压药物\n"
        "低盐低脂饮食，控制体重\n"
        "戒烟限酒，规律运动\n"
        "定期眼科检查，监测视网膜血管变化\n"
        "严重视网膜病变可能需要激光光凝治疗"
    ),
    "myopia": (
        "科学验光，正确佩戴眼镜或隐形眼镜\n"
        "低度近视儿童可考虑角膜塑形镜或阿托品滴眼液控制近视发展\n"
        "使用电子设备时注意休息（20-20-20法则：每20分钟远眺20英尺外物体20秒）\n"
        "保持充足光线，正确阅读姿势\n"
        "高度近视需定期检查眼底，监测视网膜变性风险"
    ),
}

#: Message when a human-review write is attempted by a non-admin
#: (``DiagnosisServiceImpl.java:261``).
ONLY_ADMIN_CAN_REVIEW = "仅管理员可写入人工复核字段"
#: Blank humanResult rejection (``DiagnosisServiceImpl.java:264``).
HUMAN_RESULT_REQUIRED = "必须填写人工结论"
