package com.csust.eyediagnosis.model.dto.user;

import com.csust.eyediagnosis.common.BatchIdsRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;

/**
 * 批量改角色的请求体：目标用户 id + 目标角色。
 *
 * <p>角色只有 user / ban / admin 三档，取值由服务层校验。
 */
@EqualsAndHashCode(callSuper = true)
@Data
public class UserBatchRoleDTO extends BatchIdsRequest implements Serializable {

    /**
     * 目标角色：user（普通）/ ban（封禁）/ admin（管理员）
     */
    private String userRole;

    private static final long serialVersionUID = 1L;
}
