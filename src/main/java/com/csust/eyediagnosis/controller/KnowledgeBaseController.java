package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.DeleteRequest;
import com.csust.eyediagnosis.common.PageRequest;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.KnowledgeBaseService;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.service.impl.DiagnosisServiceImpl;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/knowledge")
public class KnowledgeBaseController {

    @Resource
    private KnowledgeBaseService knowledgeBaseService;

    @Resource
    private UserService userService;

    @PostMapping("/upload")
    @AuthCheck
    public BaseResponse<List<Long>> upload(@ModelAttribute KnowledgeUploadRequest request,
                                           HttpServletRequest httpRequest) {
        Long userId = userService.getLoginUser(httpRequest).getId();
        List<Long> docIds = knowledgeBaseService.uploadDocument(request, userId);
        return ResultUtils.success(docIds);
    }

    @PostMapping("/list/page")
    @AuthCheck
    public BaseResponse<Page<KnowledgeDocument>> listPage(@RequestBody PageRequest pageRequest,
                                                          HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        // 管理员看全站（userId 为 null，完全不加 eq 条件）；普通用户仍只看本人
        boolean seesAll = DiagnosisServiceImpl.seesAllRecords(loginUser);
        Long scopedUserId = seesAll ? null : loginUser.getId();

        Page<KnowledgeDocument> page = knowledgeBaseService.lambdaQuery()
                .eq(!seesAll, KnowledgeDocument::getUserId, scopedUserId)
                .orderByDesc(KnowledgeDocument::getCreateTime)
                .page(new Page<>(pageRequest.getCurrent(), pageRequest.getPageSize()));
        return ResultUtils.success(page);
    }

    @DeleteMapping("/delete")
    @AuthCheck
    public BaseResponse<Boolean> delete(@RequestBody DeleteRequest deleteRequest,
                                        HttpServletRequest httpRequest) {
        Long userId = userService.getLoginUser(httpRequest).getId();

        knowledgeBaseService.deleteDocument(deleteRequest.getId(), userId);
        return ResultUtils.success(true);
    }
}
