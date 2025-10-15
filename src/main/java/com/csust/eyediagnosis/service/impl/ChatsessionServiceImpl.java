package com.csust.eyediagnosis.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.csust.eyediagnosis.ai.AiDiagnosisService;
import com.csust.eyediagnosis.ai.AiDiagnosisServiceFactory;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.exception.ThrowUtils;
import com.csust.eyediagnosis.mapper.ChatsessionMapper;
import com.csust.eyediagnosis.model.dto.chat.ChatSessionAddRequest;
import com.csust.eyediagnosis.model.entity.Chatsession;
import com.csust.eyediagnosis.model.entity.User;
import com.csust.eyediagnosis.model.enums.ChatHistoryMessageTypeEnum;
import com.csust.eyediagnosis.service.ChatHistoryService;
import com.csust.eyediagnosis.service.ChatsessionService;
import com.csust.eyediagnosis.utils.TokenStreamUtils;
import dev.langchain4j.service.TokenStream;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

import java.io.Serializable;

/**
* @author 钰玟
* @description 针对表【t_chatsession(会话)】的数据库操作Service实现
* @createDate 2025-04-25 19:28:30
*/
@Service
@Slf4j
public class ChatsessionServiceImpl extends ServiceImpl<ChatsessionMapper, Chatsession>
    implements ChatsessionService {

    @Resource
    private ChatHistoryService chatHistoryService;
    @Resource
    private AiDiagnosisServiceFactory aiDiagnosisServiceFactory;

    /**
     * 诊断聊天
     * @param sessionId 会话id
     * @param message 消息
     * @param loginUser 登录用户
     * @return Flux<String>
     */
    @Override
    public Flux<String> chatToDiagnosis(Long sessionId, String message, User loginUser, boolean isThinking) {

        // 5. 通过校验后，添加用户消息到对话历史
        chatHistoryService.addChatMessage(sessionId, message, ChatHistoryMessageTypeEnum.USER.getValue(), loginUser.getId());
        // 6. 调用 AI 生成代码（流式）
        AiDiagnosisService aiDiagnosisService = aiDiagnosisServiceFactory.createAiDiagnosisService(sessionId,isThinking);
        TokenStream tokenStream = aiDiagnosisService.askForDiagnosis(message);
        Flux<String> stringFlux = TokenStreamUtils.tokenStreamAdaptFlux(tokenStream);
        //处理流并且 保存到数据库
        return TokenStreamUtils.handle(stringFlux,sessionId,chatHistoryService,loginUser);

    }

    /**
     * 创建会话
     * @param chatSessionAddRequest 创建会话请求
     * @param loginUser 登录用户
     * @return  Long
     */
    @Override
    public Long createChatSession(ChatSessionAddRequest chatSessionAddRequest, User loginUser) {
        // 参数校验
        String initPrompt = chatSessionAddRequest.getInitPrompt();
        ThrowUtils.throwIf(StrUtil.isBlank(initPrompt), ErrorCode.PARAMS_ERROR, "初始化 prompt 不能为空");
        // 构造入库对象
        Chatsession chatsession = new Chatsession();
        BeanUtil.copyProperties(chatSessionAddRequest, chatsession);
        chatsession.setUserId(loginUser.getId());
        // 应用名称暂时为 initPrompt 前 12 位
        chatsession.setTitle(initPrompt.substring(0, Math.min(initPrompt.length(), 12)));
        // 插入数据库
        boolean result = this.save(chatsession);
        ThrowUtils.throwIf(!result, ErrorCode.OPERATION_ERROR);
        log.info("应用创建成功，ID: {}", chatsession.getId());
        return chatsession.getId();
    }

    /**
     * 删除应用时关联删除对话历史
     *
     * @param id 应用ID
     * @return 是否成功
     */
    @Override
    public boolean removeById(Serializable id) {
        if (id == null) {
            return false;
        }
        // 转换为 Long 类型
        Long appId = Long.valueOf(id.toString());
        if (appId <= 0) {
            return false;
        }
        // 先删除关联的对话历史
        try {
            chatHistoryService.deleteByAppId(appId);
        } catch (Exception e) {
            // 记录日志但不阻止应用删除
            log.error("删除应用关联对话历史失败 {}" +  e.getMessage());
        }
        // 删除应用
        return super.removeById(id);
    }

}




