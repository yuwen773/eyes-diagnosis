package com.csust.eyediagnosis.agent.controller;

import com.csust.eyediagnosis.agent.service.AgentImageUploadService;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.UserService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/agent/image")
public class AgentImageUploadController {

    @Resource
    private AgentImageUploadService agentImageUploadService;

    @Resource
    private UserService userService;

    @PostMapping("/upload")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<String> upload(@RequestPart("file") MultipartFile file,
                                       HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        String url = agentImageUploadService.uploadImage(file, loginUser.getId());
        return ResultUtils.success(url);
    }

    @PostMapping("/upload/delete")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<Boolean> delete(@RequestBody Map<String, String> body,
                                        HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        String url = body.get("url");
        agentImageUploadService.deleteImage(url, loginUser.getId());
        return ResultUtils.success(true);
    }
}
