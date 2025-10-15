package com.csust.eyediagnosis.model.dto.news;

import com.csust.eyediagnosis.common.PageRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.io.Serializable;

/**
 * @ClassNameNewsQueryDTO
 * @Description TODO
 * @Author钰玟
 * @Date2025/4/23 下午7:20
 * @Version 1.0
 **/
@EqualsAndHashCode(callSuper = true)
@Data
public class NewsQueryDTO extends PageRequest implements Serializable {
    /**
     * 新闻id
     */
    private Long id;
    /**
     * 用户昵称
     */
    private String title;

    /**
     * 账号
     */
    private String summary;


    /**
     * 用户角色：user/admin/ban
     */
    private String userRole;

    private static final long serialVersionUID = 1L;
}
