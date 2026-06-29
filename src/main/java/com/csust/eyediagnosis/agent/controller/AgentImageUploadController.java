package com.csust.eyediagnosis.agent.controller;

import com.csust.eyediagnosis.agent.service.AgentImageUploadService;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/agent/image")
public class AgentImageUploadController {

    @Resource
    private AgentImageUploadService agentImageUploadService;

    @PostMapping("/upload")
    public BaseResponse<String> upload(@RequestPart("file") MultipartFile file) {
        String url = agentImageUploadService.uploadImage(file);
        return ResultUtils.success(url);
    }

    @PostMapping("/upload/delete")
    public BaseResponse<Boolean> delete(@RequestBody Map<String, String> body) {
        String url = body.get("url");
        agentImageUploadService.deleteImage(url);
        return ResultUtils.success(true);
    }
}
