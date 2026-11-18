package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.diagnosistask.DiagnosisTaskService;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

@RestController
@RequestMapping("/diagnosis-tasks")
public class DiagnosisTaskController {
    private final DiagnosisTaskService tasks;
    private final UserService users;

    public DiagnosisTaskController(DiagnosisTaskService tasks, UserService users) {
        this.tasks = tasks;
        this.users = users;
    }

    @GetMapping("/{id}")
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisTaskService.SafeStatus> get(@PathVariable String id, HttpServletRequest request) {
        return ResultUtils.success(tasks.getOwned(id, users.getLoginUser(request).getId()));
    }

    @GetMapping
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<java.util.List<DiagnosisTaskService.SafeStatus>> list(HttpServletRequest request) {
        return ResultUtils.success(tasks.listOwned(users.getLoginUser(request).getId()));
    }

    @PostMapping
    @AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
    public BaseResponse<DiagnosisTaskService.SafeStatus> create(@RequestPart("file") MultipartFile file,
            @RequestParam("idempotencyKey") String key, HttpServletRequest request) {
        return ResultUtils.success(tasks.create(users.getLoginUser(request).getId(), key, file));
    }

    @ExceptionHandler(DiagnosisTaskService.RequestConflict.class)
    public ResponseEntity<BaseResponse<?>> conflict() {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ResultUtils.error(40900, "幂等键已用于不同的请求"));
    }
}
