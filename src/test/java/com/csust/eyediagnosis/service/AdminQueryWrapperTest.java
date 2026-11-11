package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisQueryDTO;
import com.csust.eyediagnosis.model.dto.news.NewsQueryDTO;
import com.csust.eyediagnosis.model.dto.user.UserQueryDTO;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import com.csust.eyediagnosis.service.impl.NewsServiceImpl;
import com.csust.eyediagnosis.service.impl.UserServiceImpl;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 管理端列表的筛选条件。
 *
 * <p>三条约定：
 * <ol>
 *   <li>角色筛选曾经「收了参数却不生效」（wrapper 里那行 eq 被注释掉了），
 *       管理端要能一眼分开管理员 / 普通用户 / 已封禁；</li>
 *   <li>排序字段来自请求体，必须走白名单——直接拼进 ORDER BY 等于把 SQL 片段
 *       交给客户端；</li>
 *   <li>未指定排序时按时间倒序：管理端最先看最新的记录。</li>
 * </ol>
 *
 * <p>列名按项目约定是小驼峰（项目关掉了 map-underscore-to-camel-case），
 * 所以断言写的是 {@code userRole} 而不是 {@code user_role}。
 */
class AdminQueryWrapperTest {

    private static String sqlOf(QueryWrapper<?> wrapper) {
        return wrapper.getTargetSql();
    }

    @Test
    void 用户列表按角色筛选() {
        UserServiceImpl service = new UserServiceImpl();
        UserQueryDTO dto = new UserQueryDTO();
        dto.setUserRole("ban");

        String sql = sqlOf(service.getUserQueryWrapper(dto));

        assertTrue(sql.contains("userRole"), "角色条件应落到 SQL：" + sql);
    }

    @Test
    void 用户列表默认按注册时间倒序() {
        UserServiceImpl service = new UserServiceImpl();
        String sql = sqlOf(service.getUserQueryWrapper(new UserQueryDTO()));
        assertTrue(sql.contains("ORDER BY"), "应有排序：" + sql);
        assertTrue(sql.contains("createTime DESC"), "默认按注册时间倒序：" + sql);
    }

    @Test
    void 排序字段不在白名单时被忽略() {
        UserServiceImpl service = new UserServiceImpl();
        UserQueryDTO dto = new UserQueryDTO();
        dto.setSortField("userPassword; drop table t_user");

        String sql = sqlOf(service.getUserQueryWrapper(dto));

        assertFalse(sql.contains("drop table"), "白名单外的排序字段不能进 SQL：" + sql);
        assertFalse(sql.contains("userPassword"), "白名单外的排序字段不能进 SQL：" + sql);
        assertTrue(sql.contains("createTime DESC"), "应退化为默认排序：" + sql);
    }

    @Test
    void 判读列表按复核状态与拒识标记筛选() {
        DiagnosisServiceImpl service = new DiagnosisServiceImpl();
        DiagnosisQueryDTO dto = new DiagnosisQueryDTO();
        dto.setReexamineStatus(3);
        dto.setAiRejected(true);

        String sql = sqlOf(service.getDiagnosisQueryWrapper(dto));

        assertTrue(sql.contains("reexamineStatus"), "复审状态应落到 SQL：" + sql);
        assertTrue(sql.contains("aiRejected"), "拒识标记应落到 SQL：" + sql);
    }

    @Test
    void 待人工复核筛选落成状态等值条件() {
        DiagnosisServiceImpl service = new DiagnosisServiceImpl();
        DiagnosisQueryDTO dto = new DiagnosisQueryDTO();
        dto.setRequiresReview(true);

        String sql = sqlOf(service.getDiagnosisQueryWrapper(dto));

        assertTrue(sql.contains("humanReviewStatus"), "待复核应落成 humanReviewStatus 条件：" + sql);
    }

    @Test
    void 资讯列表按发布状态与发布时间筛选() {
        NewsServiceImpl service = new NewsServiceImpl();
        NewsQueryDTO dto = new NewsQueryDTO();
        dto.setVisibleOnly(false);
        dto.setStatus(3);
        dto.setStartDate("2026-11-01");
        dto.setEndDate("2026-11-30");

        String sql = sqlOf(service.getNewsQueryWrapper(dto));

        assertTrue(sql.contains("status"), "发布状态应落到 SQL：" + sql);
        assertTrue(sql.contains("publishTime"), "发布时间区间应落到 SQL：" + sql);
    }
}
