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
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.net.URI;

import java.util.Map;

@RestController
@RequestMapping("/agent/image")
public class AgentImageUploadController {

    @Resource
    private AgentImageUploadService agentImageUploadService;

    @Resource
    private UserService userService;

    @GetMapping("/view/{fileName}")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public ResponseEntity<Void> view(@PathVariable String fileName, HttpServletRequest request) {
        User user = userService.getLoginUser(request);
        String target = agentImageUploadService.resolveViewTarget(fileName, user.getId());
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(target))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("Referrer-Policy", "no-referrer")
                .build();
    }

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
