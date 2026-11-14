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

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
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
                    try (InputStream in = object.getObjectContent()) {
                        StreamResult result = copyDocumentStream(in, output);
                        switch (result.outcome()) {
                            // 客户端提前断开（切文档、关抽屉）是正常操作，不是服务端错误：
                            // 响应头早已钉成文件类型，这时再把异常抛给全局 JSON 处理器，
                            // 它写不进 {code,msg}，最后只剩一条 500 堆栈。
                            case CLIENT_ABORTED -> log.debug("客户端提前断开文档流: docId={}", id,
                                    result.error());
                            // 上游读取失败是服务端故障：对象存储真的坏了，必须留痕。
                            case UPSTREAM_FAILED -> log.error("知识文档上游读取失败: docId={}", id,
                                    result.error());
                            case COMPLETED -> {
                                // 正常传完，不用记日志。
                            }
                        }
                    } catch (IOException e) {
                        // 关闭上游流失败：同样不能当成断连吞掉。
                        log.error("知识文档上游流关闭失败: docId={}", id, e);
                    }
                });
    }

    /** 文档流传输的结果分类。 */
    enum StreamOutcome {
        /** 正常传完。 */
        COMPLETED,
        /** 客户端提前断开（切文档、关抽屉）：正常操作。 */
        CLIENT_ABORTED,
        /** 上游读取失败：服务端故障，必须留痕。 */
        UPSTREAM_FAILED
    }

    /**
     * 文档流传输结果。
     *
     * @param outcome 结果分类
     * @param error 失败时的原始异常（正常结束为 null）
     */
    record StreamResult(StreamOutcome outcome, IOException error) {
        static StreamResult completed() {
            return new StreamResult(StreamOutcome.COMPLETED, null);
        }

        static StreamResult clientAborted(IOException error) {
            return new StreamResult(StreamOutcome.CLIENT_ABORTED, error);
        }

        static StreamResult upstreamFailed(IOException error) {
            return new StreamResult(StreamOutcome.UPSTREAM_FAILED, error);
        }
    }

    /**
     * 把对象内容复制到响应流，并把「客户端断开」与「上游读取失败」分开。
     *
     * <p>写侧失败（往浏览器写不动）= 客户端断开：切文档、关抽屉、刷新页面都是
     * 正常操作，不该打错误日志。读侧失败（从对象存储读不动）= 服务端故障：
     * 对象存储真的坏了，必须留 ERROR 堆栈，否则 COS 读取失败就此隐身。
     *
     * <p>早期版本用一个 catch 把两者都当成断连、只记 debug——上游故障被静默吞掉，
     * 线上既没有 5xx 也没有错误日志。
     *
     * @param in 对象存储的正文流
     * @param out 响应输出流
     * @return 传输结果，调用方据此决定记哪一级日志
     */
    static StreamResult copyDocumentStream(InputStream in, OutputStream out) {
        byte[] buffer = new byte[16 * 1024];
        try {
            int read;
            while ((read = in.read(buffer)) != -1) {
                try {
                    out.write(buffer, 0, read);
                } catch (IOException e) {
                    return StreamResult.clientAborted(e);
                }
            }
            return StreamResult.completed();
        } catch (IOException e) {
            return StreamResult.upstreamFailed(e);
        }
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
