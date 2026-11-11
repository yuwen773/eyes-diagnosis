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

    /**
     * 是否只返回公开可见（status=1 已发布）的文章。
     * 由控制器按登录用户角色设置：管理员 false（看全部状态），
     * 普通用户/匿名访客 true。默认 true，保证任何漏设的调用点都安全。
     * 参与缓存 key 计算，因此两种视角不会互相串号。
     */
    private boolean visibleOnly = true;

    /**
     * 发布状态筛选：0 草稿 / 1 已发布 / 2 下架 / 3 待审核；不传则不限。
     */
    private Integer status;

    /**
     * 内容分类（精确匹配）
     */
    private String category;

    /**
     * 发布时间下界（含当天），格式 yyyy-MM-dd
     */
    private String startDate;

    /**
     * 发布时间上界（含当天），格式 yyyy-MM-dd
     */
    private String endDate;

    private static final long serialVersionUID = 1L;
}
