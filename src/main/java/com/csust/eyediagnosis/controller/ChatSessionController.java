package com.csust.eyediagnosis.controller;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.csust.eyediagnosis.ai.AiDiagnosisService;
import com.csust.eyediagnosis.annotation.AuthCheck;
import com.csust.eyediagnosis.common.BaseResponse;
import com.csust.eyediagnosis.common.ResultUtils;
import com.csust.eyediagnosis.constant.AuthConstant;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.model.dto.chat.ChatHistoryQueryRequest;
import com.csust.eyediagnosis.model.dto.chat.ChatSessionAddRequest;
import com.csust.eyediagnosis.model.entity.ChatHistory;
import com.csust.eyediagnosis.model.entity.Chatsession;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.service.ChatHistoryService;
import com.csust.eyediagnosis.service.ChatsessionService;
import com.csust.eyediagnosis.service.UserService;
import com.csust.eyediagnosis.utils.TokenStreamUtils;
import dev.langchain4j.service.TokenStream;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import jakarta.annotation.Resource;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * @ClassNameChatController
 * @Description 聊天会话控制器
 * @Author钰玟
 * @Date2025/4/25 下午6:24
 * @Version 1.0
 **/
@RestController
@RequestMapping("/chat")
@Slf4j
public class ChatSessionController {


    @Resource
    private ChatsessionService chatsessionService;
    @Resource
    private UserService userService;
    @Resource
    private ChatHistoryService chatHistoryService;
    /**
     * 创建会话
     *
     * @param chatSessionAddRequest 创建会话请求
     * @param request       请求
     * @return 应用 id
     */
    @PostMapping("/add")
    public BaseResponse<Long> addChatSession(@RequestBody ChatSessionAddRequest chatSessionAddRequest, HttpServletRequest request) {
        ThrowUtils.throwIf(chatSessionAddRequest == null, ErrorCode.PARAMS_ERROR);
        // 参数校验
        String initPrompt = chatSessionAddRequest.getInitPrompt();
        ThrowUtils.throwIf(StrUtil.isBlank(initPrompt), ErrorCode.PARAMS_ERROR, "初始化 prompt 不能为空");
        // 获取当前登录用户
        User loginUser = userService.getLoginUser(request);
        Long appId = chatsessionService.createChatSession(chatSessionAddRequest, loginUser);
        return ResultUtils.success(appId);
    }

    @GetMapping("/question")
    public Flux<ServerSentEvent<String>> chatByQuestionWithAI(@RequestParam("sessionId") Long sessionId
            , @RequestParam("message") String message,Boolean isThinking, HttpServletRequest  request) {
        //1. 参数校验
        ThrowUtils.throwIf(sessionId == null || sessionId <= 0, ErrorCode.PARAMS_ERROR, "会话ID不能为空");
        ThrowUtils.throwIf(StrUtil.isBlank(message), ErrorCode.PARAMS_ERROR, "消息内容不能为空");
        User loginUser = userService.getLoginUser(request);
        //2.调用 ai助手服务
        Flux<String> stringFlux = chatsessionService.chatToDiagnosis(sessionId, message, loginUser,isThinking);
        //3. 返回数据流
        // 转换为 ServerSentEvent 格式
        return stringFlux.map(chunk->{
                    Map<String, String> wrapper = Map.of("d", chunk);
                    // 构造 ServerSentEvent
                    return ServerSentEvent.<String>builder()
                            .data(JSONUtil.toJsonStr(wrapper))
                            .build();
                })
                .concatWith(Mono.just(
                        // 发送结束事件
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("")
                                .build()
                ));
    }
    /**
     * 分页查询用户下的会话列表
     * @param request        请求
     * @return 对话历史分页
     */
    @GetMapping("/chat_session/list/page")
    public BaseResponse<Page<Chatsession>> listChatSession(HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        QueryWrapper<Chatsession> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("userId", loginUser.getId());
        Page<Chatsession> chatsessionPage = chatsessionService.page(new Page<>(1, 10), queryWrapper);
        return ResultUtils.success(chatsessionPage);
    }
    /**
     * 分页查询某个应用的对话历史（游标查询）
     *
     * @param sessionId          会话ID
     * @param pageSize       页面大小
     * @param lastCreateTime 最后一条记录的创建时间
     * @param request        请求
     * @return 对话历史分页
     */
    @GetMapping("/chat_session/{sessionId}")
    public BaseResponse<Page<ChatHistory>> listChatSessionChatHistory(@PathVariable Long sessionId,
                                                              @RequestParam(defaultValue = "10") int pageSize,
                                                              @RequestParam(required = false) LocalDateTime lastCreateTime,
                                                              HttpServletRequest request) {
        User loginUser = userService.getLoginUser(request);
        Page<ChatHistory> result = chatHistoryService.listAppChatHistoryByPage(sessionId, pageSize, lastCreateTime, loginUser);
        return ResultUtils.success(result);
    }
    /**
     * 管理员分页查询所有对话历史
     *
     * @param chatHistoryQueryRequest 查询请求
     * @return 对话历史分页
     */
    @PostMapping("/admin/list/page/vo")
    @AuthCheck(mustRole = AuthConstant.ADMIN_ROLE)
    public BaseResponse<Page<ChatHistory>> listAllChatHistoryByPageForAdmin(@RequestBody ChatHistoryQueryRequest chatHistoryQueryRequest) {
        ThrowUtils.throwIf(chatHistoryQueryRequest == null, ErrorCode.PARAMS_ERROR);
        long pageNum = chatHistoryQueryRequest.getCurrent();
        long pageSize = chatHistoryQueryRequest.getPageSize();
        // 查询数据
        QueryWrapper<ChatHistory> queryWrapper = chatHistoryService.getQueryWrapper(chatHistoryQueryRequest);
        Page<ChatHistory> result = chatHistoryService.page(Page.of(pageNum, pageSize), queryWrapper);
        return ResultUtils.success(result);
    }


}
