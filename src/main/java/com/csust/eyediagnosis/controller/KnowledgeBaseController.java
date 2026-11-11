package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.BatchIdsRequest;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.common.DeleteRequest;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeQueryDTO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUpdateDTO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.knowledge.KnowledgeDetailVO;
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

    /**
     * 分页列表（带筛选）。
     *
     * <p>可见范围由服务端裁决：管理员看全站，普通用户只看本人——
     * 客户端不能靠请求体提权。
     */
    @PostMapping("/list/page")
    @AuthCheck
    public BaseResponse<Page<KnowledgeDocument>> listPage(@RequestBody KnowledgeQueryDTO query,
                                                          HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        Page<KnowledgeDocument> page = knowledgeBaseService.pageDocuments(query, loginUser);
        return ResultUtils.success(page);
    }

    /**
     * 文档详情：元信息 + 限时预览链接 + 切片清单。
     */
    @GetMapping("/get/{id}")
    @AuthCheck
    public BaseResponse<KnowledgeDetailVO> getDetail(@PathVariable("id") Long id,
                                                     HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        return ResultUtils.success(knowledgeBaseService.getDocumentDetail(id, loginUser));
    }

    /**
     * 改标题（只改人读的名字，不动文件本体与切片）。
     */
    @PostMapping("/update")
    @AuthCheck
    public BaseResponse<Boolean> update(@RequestBody KnowledgeUpdateDTO update,
                                        HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        knowledgeBaseService.updateTitle(update.getId(), update.getTitle(), loginUser);
        return ResultUtils.success(true);
    }

    @DeleteMapping("/delete")
    @AuthCheck
    public BaseResponse<Boolean> delete(@RequestBody DeleteRequest deleteRequest,
                                        HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        knowledgeBaseService.deleteDocument(deleteRequest.getId(), loginUser);
        return ResultUtils.success(true);
    }

    /**
     * 批量删除：逐条鉴权与执行，部分失败如实回执（见 BatchResultVO）。
     */
    @DeleteMapping("/delete/batch")
    @AuthCheck
    public BaseResponse<BatchResultVO> deleteBatch(@RequestBody BatchIdsRequest batchRequest,
                                                   HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        return ResultUtils.success(knowledgeBaseService.deleteDocuments(batchRequest.getIds(), loginUser));
    }
}
