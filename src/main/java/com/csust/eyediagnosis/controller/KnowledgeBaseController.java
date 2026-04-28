package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.DeleteRequest;
import com.csust.eyediagnosis.common.PageRequest;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.service.KnowledgeBaseService;
import com.csust.eyediagnosis.service.UserService;
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
        Long userId = userService.getLoginUser(httpRequest).getId();

        Page<KnowledgeDocument> page = knowledgeBaseService.lambdaQuery()
                .eq(KnowledgeDocument::getUserId, userId)
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
