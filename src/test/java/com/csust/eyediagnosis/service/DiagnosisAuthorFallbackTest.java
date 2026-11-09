package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.mapper.UserMapper;
import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisManageVO;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import com.csust.eyediagnosis.model.entity.User;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * getDiagnosisManageVO 对孤儿 userId（作者查不到）的空值兜底。
 *
 * <p>管理端全站视角放大了既有问题：admin 列表遇 userId 指向已删除用户时，
 * {@code userMapper.selectUserNameAndUserAvatarByUserId(...)} 返回 null，
 * 旧代码 {@code user.getUserName()} 直接 NPE → 列表 500。
 *
 * <p>测试缝：无 Spring 容器，new 出 DiagnosisServiceImpl + ReflectionTestUtils
 * 注入 mock 的 UserMapper（仓库既有形态，见 InferenceCacheTest）。
 */
class DiagnosisAuthorFallbackTest {

    @Test
    void orphanAuthorFallsBackToUnknownUser() {
        UserMapper userMapper = mock(UserMapper.class);
        when(userMapper.selectUserNameAndUserAvatarByUserId(any())).thenReturn(null);

        DiagnosisServiceImpl service = new DiagnosisServiceImpl();
        ReflectionTestUtils.setField(service, "userMapper", userMapper);

        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setId(1L);
        diagnosis.setUserId(404L); // 孤儿 userId
        diagnosis.setResult("正常");

        DiagnosisManageVO vo = assertDoesNotThrow(
                () -> service.getDiagnosisManageVO(diagnosis));
        assertEquals("未知用户", vo.getUsername());
    }
}
