package com.csust.eyediagnosis.controller;

import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.controlledreference.ControlledReferenceService;
import com.csust.eyediagnosis.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/controlled-references")
public class ControlledReferenceController {
    private final ControlledReferenceService references;
    private final UserService users;

    public ControlledReferenceController(ControlledReferenceService references, UserService users) {
        this.references = references;
        this.users = users;
    }

    @PostMapping
    @AuthCheck
    public BaseResponse<ControlledReferenceService.Reference> upload(@RequestPart("file") MultipartFile file,
            @RequestParam String title, @RequestParam String source, @RequestParam(defaultValue = "true") boolean isTest,
            HttpServletRequest request) {
        return ResultUtils.success(references.upload(users.getLoginUser(request), file, title, source, isTest));
    }

    @GetMapping
    @AuthCheck
    public BaseResponse<ControlledReferenceService.ReferencePage> list(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, HttpServletRequest request) {
        return ResultUtils.success(references.list(users.getLoginUser(request), page, pageSize));
    }

    @GetMapping("/{id}")
    @AuthCheck
    public BaseResponse<ControlledReferenceService.Detail> detail(@PathVariable String id, HttpServletRequest request) {
        return ResultUtils.success(references.detail(users.getLoginUser(request), id));
    }

    @GetMapping("/{id}/file")
    @AuthCheck
    public org.springframework.http.ResponseEntity<byte[]> file(@PathVariable String id, HttpServletRequest request) {
        return org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.APPLICATION_OCTET_STREAM)
                .header("Content-Disposition", "attachment; filename=reference.bin")
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                .body(references.originalFile(users.getLoginUser(request), id));
    }

    @PostMapping("/{id}/governance")
    @AuthCheck
    public BaseResponse<ControlledReferenceService.Reference> govern(@PathVariable String id,
            @RequestBody ControlledReferenceService.Governance governance, HttpServletRequest request) {
        return ResultUtils.success(references.govern(users.getLoginUser(request), id, governance));
    }

    @DeleteMapping("/{id}")
    @AuthCheck
    public BaseResponse<Boolean> delete(@PathVariable String id, @RequestParam long expectedGovernanceVersion,
            HttpServletRequest request) {
        references.delete(users.getLoginUser(request), id, expectedGovernanceVersion);
        return ResultUtils.success(true);
    }

    @ExceptionHandler(ControlledReferenceService.GovernanceConflict.class)
    public org.springframework.http.ResponseEntity<BaseResponse<?>> conflict() {
        return org.springframework.http.ResponseEntity.status(409).body(
                ResultUtils.error(40900, "资料治理版本已变化，请刷新后重新审核"));
    }
}
