package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.aop.AuthInterceptor;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.dto.user.UserEditDTO;
import com.csust.eyediagnosis.service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import jakarta.servlet.http.HttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class UserControllerOwnershipTest {

    private UserService userService;
    private MockMvc mockMvc;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        userService = mock(UserService.class);
        UserController controller = new UserController();
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "userService", userService);
        // 绕过 AuthInterceptor 与 AuthCheck AOP
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .build();
    }

    @Test
    void userCenterUpdateUsesSessionUserInsteadOfRequestId() throws Exception {
        User loginUser = new User();
        loginUser.setId(10L);
        when(userService.getLoginUser(any(HttpServletRequest.class))).thenReturn(loginUser);
        when(userService.updateOwnProfile(any(UserEditDTO.class), eq(loginUser))).thenReturn(true);

        String body = "{\"userName\":\"safe-name\",\"id\":99,\"userRole\":\"admin\"}";
        mockMvc.perform(post("/user/update/userCenter")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isOk());

        ArgumentCaptor<UserEditDTO> captor = ArgumentCaptor.forClass(UserEditDTO.class);
        verify(userService).updateOwnProfile(captor.capture(), eq(loginUser));
        UserEditDTO passedDto = captor.getValue();
        // Service receives only the editable fields; no id/userRole leakage
        assertEquals("safe-name", passedDto.getUserName());
        assertFalse(objectMapper.valueToTree(passedDto).has("id"));
        assertFalse(objectMapper.valueToTree(passedDto).has("userRole"));
    }
}
