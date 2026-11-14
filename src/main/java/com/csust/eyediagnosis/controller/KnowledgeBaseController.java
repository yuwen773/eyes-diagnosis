package com.csust.eyediagnosis.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.BatchIdsRequest;
import com.csust.eyediagnosis.common.BatchResultVO;
import com.csust.eyediagnosis.common.DeleteRequest;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.manager.CosManager;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeQueryDTO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUpdateDTO;
import com.csust.eyediagnosis.model.dto.knowledge.KnowledgeUploadRequest;
import com.csust.eyediagnosis.model.entity.KnowledgeDocument;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.vo.knowledge.KnowledgeDetailVO;
import com.csust.eyediagnosis.service.KnowledgeBaseService;
import com.csust.eyediagnosis.service.UserService;
import com.qcloud.cos.model.COSObject;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.nio.charset.StandardCharsets;
import java.util.List;

@Slf4j
@RestController
@RequestMapping("/knowledge")
public class KnowledgeBaseController {

    @Resource
    private KnowledgeBaseService knowledgeBaseService;

    @Resource
    private UserService userService;

    @Resource
    private CosManager cosManager;

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
     * 原文内容：管理端阅读器用。
     *
     * <p>知识文档的对象存储在 COS 私有桶里，浏览器既拿不到直链、也没有跨域读授权。
     * 这里按与 {@code /get/{id}} 同一条 owner / 管理员 规则鉴权后把原文代理流出，
     * MIME 按扩展名映射，文件名走 RFC 5987 编码；不暴露服务器路径、不放行长期凭据。
     * 端点排在 /get/{id} 之后，Spring 会把 /get/ 前缀的路径优先匹配到详情接口。
     *
     * <p>HEAD 请求只回头不下载正文（管理端阅读器探「这是不是 PDF」用）：取对象的
     * 元信息即可，不把整份文件从对象存储拉一遍。
     */
    @GetMapping("/{id}/content")
    @AuthCheck
    public ResponseEntity<StreamingResponseBody> getContent(
            @PathVariable("id") Long id,
            @RequestParam(value = "download", defaultValue = "false") boolean download,
            HttpServletRequest httpRequest) {
        User loginUser = userService.getLoginUser(httpRequest);
        KnowledgeDocument doc = knowledgeBaseService.getDocumentForRead(id, loginUser);

        String fileName = doc.getFileName();
        String contentType = contentTypeOf(doc.getFileType());
        // 内嵌阅读器要 inline（attachment 会被浏览器当成下载、iframe 一片空白），
        // 下载按钮显式带 download=1 才走 attachment。文件名两种情况都按 RFC 5987 编码。
        ContentDisposition disposition = (download ? ContentDisposition.attachment()
                : ContentDisposition.inline())
                .filename(fileName == null ? "document" : fileName, StandardCharsets.UTF_8)
                .build();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(disposition);
        // MIME 已按扩展名钉死，禁止浏览器再嗅探成可执行/可渲染类型。
        headers.set("X-Content-Type-Options", "nosniff");
        // 私有文档字节：不允许任何中间层留存，也不允许浏览器缓存。
        headers.setCacheControl("private, no-store");

        ResponseEntity.BodyBuilder builder = ResponseEntity.ok()
                .headers(headers)
                .contentType(org.springframework.http.MediaType.parseMediaType(contentType));

        // HEAD 探针：只取对象元信息，不下载正文。管理端阅读器在显示 PDF 前会先探
        // 一次「这是不是 PDF」，若这里照样把整个对象拉下来，每开一份文档就会从
        // 对象存储下载两遍——探针自己成了第二遍下载。
        if (httpRequest != null && "HEAD".equalsIgnoreCase(httpRequest.getMethod())) {
            try {
                builder.contentLength(cosManager.getObjectMetadata(doc.getFileUrl()).getContentLength());
            } catch (Exception e) {
                log.warn("知识文档对象元信息读取失败: docId={}", id, e);
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, "文件读取失败");
            }
            // HEAD 没有响应体（容器也会丢弃它），这里保持空流即可。
            return builder.body(output -> {
            });
        }

        COSObject object;
        try {
            object = cosManager.getObject(doc.getFileUrl());
        } catch (Exception e) {
            log.warn("知识文档对象读取失败: docId={}", id, e);
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "文件读取失败");
        }

        return builder
                .contentLength(object.getObjectMetadata().getContentLength())
                .body(output -> {
                    try (java.io.InputStream in = object.getObjectContent()) {
                        in.transferTo(output);
                    } catch (java.io.IOException e) {
                        // 客户端提前断开（切文档、关抽屉）是正常操作，不是服务端错误：
                        // 响应头早已钉成文件类型，这时再把异常抛给全局 JSON 处理器，
                        // 它写不进 {code,msg}，最后只剩一条 500 堆栈。
                        log.debug("客户端提前断开文档流: docId={}", id, e);
                    }
                });
    }

    /**
     * 文件扩展名 → MIME。未知扩展名一律按二进制下载处理，不让浏览器猜错类型。
     */
    private static String contentTypeOf(String fileType) {
        if (fileType == null) {
            return "application/octet-stream";
        }
        return switch (fileType.toLowerCase()) {
            case "pdf" -> "application/pdf";
            case "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "doc" -> "application/msword";
            case "txt" -> "text/plain;charset=UTF-8";
            case "md", "markdown" -> "text/markdown;charset=UTF-8";
            default -> "application/octet-stream";
        };
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
