package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.model.entity.Diagnosis;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.DiagnosisService;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 隐私小项：密码哈希不出现在任何响应里；判读响应不允许被缓存。
 *
 * <p>两条都是「接口本身没做错业务，但把不该流出去的东西流出去了」——
 * 不会在功能测试里暴露，只能这样钉住。
 */
class DiagnosisPrivacyTest {

    private static final String HASH = "$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

    private DiagnosisService diagnosisService;
    private UserService userService;
    private MockMvc diagnosisMvc;
    private MockMvc userMvc;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        diagnosisService = mock(DiagnosisService.class);
        userService = mock(UserService.class);

        DiagnosisController diagnosisController = new DiagnosisController();
        ReflectionTestUtils.setField(diagnosisController, "diagnosisService", diagnosisService);
        ReflectionTestUtils.setField(diagnosisController, "userService", userService);
        diagnosisMvc = MockMvcBuilders.standaloneSetup(diagnosisController).build();

        UserController userController = new UserController();
        ReflectionTestUtils.setField(userController, "userService", userService);
        userMvc = MockMvcBuilders.standaloneSetup(userController).build();
    }

    @Test
    void userEntityNeverSerialisesThePasswordHash() throws Exception {
        User user = new User();
        user.setId(1L);
        user.setUserAccount("tester");
        user.setUserPassword(HASH);

        String json = objectMapper.writeValueAsString(user);

        assertFalse(json.contains("userPassword"), "序列化结果不应包含 userPassword 字段");
        assertFalse(json.contains("$2a$10$"), "序列化结果不应包含 BCrypt 哈希");
    }

    @Test
    void adminUserLookupDoesNotLeakThePasswordHash() throws Exception {
        User user = new User();
        user.setId(2L);
        user.setUserAccount("patient01");
        user.setUserPassword(HASH);
        when(userService.getById(anyLong())).thenReturn(user);

        userMvc.perform(get("/user/get").param("id", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userAccount").value("patient01"))
                .andExpect(jsonPath("$.data.userPassword").doesNotExist())
                .andExpect(content().string(not(containsString("$2a$"))));
    }

    @Test
    void diagnosisDetailIsNotCacheable() throws Exception {
        User loginUser = new User();
        loginUser.setId(7L);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(loginUser);
        Diagnosis diagnosis = new Diagnosis();
        diagnosis.setId(9L);
        diagnosis.setUserId(7L);
        diagnosis.setResult("normal");
        when(diagnosisService.getOwnedDiagnosis(anyLong(), any(User.class))).thenReturn(diagnosis);

        diagnosisMvc.perform(get("/diagnosis/get/9"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(content().string(not(containsString(HASH))));
    }
}
