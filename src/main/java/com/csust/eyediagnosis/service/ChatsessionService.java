package com.csust.eyediagnosis.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.csust.eyediagnosis.model.dto.chat.ChatSessionAddRequest;
import com.csust.eyediagnosis.model.entity.Chatsession;
import com.csust.eyediagnosis.model.entity.User;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

/**
* @author 钰玟
* @description 针对表【t_chatsession(会话)】的数据库操作Service
* @createDate 2025-04-25 19:28:30
*/
@Service
public interface ChatsessionService extends IService<Chatsession> {

    /**
     * 诊断聊天
     * @param sessionId 会话id
     * @param message 消息
     * @param loginUser 登录用户
     * @return Flux<String>
     */
    Flux<String> chatToDiagnosis(Long sessionId, String message, User loginUser, boolean isThinking);


    Long createChatSession(ChatSessionAddRequest chatSessionAddRequest, User loginUser);
}
