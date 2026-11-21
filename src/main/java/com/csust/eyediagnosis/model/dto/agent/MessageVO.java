package com.csust.eyediagnosis.model.dto.agent;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Date;
import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MessageVO {
    private String finishReason;
    private Long id;
    private String role;
    private String subType;
    private String content;
    private boolean isSummary;
    private Date createdTime;
    private List<String> images;

    /** 回答侧行所属的用户消息 id；旧数据为 null。 */
    private Long replyToId;
    /** 本次生成的版本组；旧数据为 null。 */
    private String variantId;
    /** 仅用户行：当前显示哪一份回答；null 表示旧数据（只有一份）。 */
    private String selectedVariantId;
    /** 仅用户行：这一轮出现过的版本，按生成顺序。 */
    private List<String> variantIds;

    public MessageVO(Long id, String role, String subType, String content, boolean isSummary, Date createdTime) {
        this(null, id, role, subType, content, isSummary, createdTime, null, null, null, null, null);
    }
}
