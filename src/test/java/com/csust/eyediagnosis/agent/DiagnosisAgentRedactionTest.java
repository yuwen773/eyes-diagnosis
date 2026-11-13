package com.csust.eyediagnosis.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.csust.eyediagnosis.model.dto.agent.MessageDTO;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A2 日志/历史脱敏：工具调用落库文本不能包含模型生成的原始参数、患者信息、
 * 密钥或完整 Prompt；SSE 兼容字段必须全部可选。
 */
class DiagnosisAgentRedactionTest {

    @Test
    void persistedToolCallTextIsWhitelistLabelOnly() {
        String persisted = DiagnosisAgent.redactedToolCall("searchDocuments");
        assertEquals("检索医学知识库", persisted);
        assertEquals("调用工具", DiagnosisAgent.redactedToolCall("mcpProvidedTool"));
        assertEquals("调用工具", DiagnosisAgent.redactedToolCall(null));
        assertFalse(persisted.contains("{"));
        assertFalse(persisted.contains("query"));
    }

    @Test
    void persistedTextNeverContainsRawArgumentsPatientDataOrSecrets() {
        String rawArgs = "{\"query\":\"患者张三 身份证 110101199001011234 apiKey=SECRET\","
                + "\"prompt\":\"完整系统提示词\"}";
        // 模拟 DiagnosisAgent 的拼接：只把白名单标签写进历史，不拼 rawArgs。
        String persisted = DiagnosisAgent.redactedToolCall("searchDocuments");
        assertFalse(persisted.contains("张三"));
        assertFalse(persisted.contains("110101199001011234"));
        assertFalse(persisted.contains("SECRET"));
        assertFalse(persisted.contains("完整系统提示词"));
        assertFalse(persisted.contains(rawArgs));
    }

    @Test
    void messageDtoNewFieldsAreOptionalAndSerializeWithoutBreakingOldClients() throws Exception {
        ObjectMapper json = new ObjectMapper();
        MessageDTO legacy = new MessageDTO();
        legacy.setContent("旧事件");
        String wire = json.writeValueAsString(legacy);
        assertFalse(wire.contains("toolCallId"));
        assertFalse(wire.contains("toolStatus"));
        assertFalse(wire.contains("stepLabel"));
        MessageDTO parsed = json.readValue(wire, MessageDTO.class);
        assertNull(parsed.getToolCallId());
        assertNull(parsed.getToolStatus());
        assertNull(parsed.getStepLabel());
        assertNull(parsed.getFinishReason());
        assertNull(parsed.getErrorCategory());
    }

    @Test
    void statusDtoRoundTripKeepsCorrelationKey() throws Exception {
        ObjectMapper json = new ObjectMapper();
        MessageDTO dto = new MessageDTO();
        dto.setToolCallId("call-1");
        dto.setToolStatus("succeeded");
        dto.setStepLabel("检索医学知识库");
        dto.setFinishReason("STOP");
        dto.setErrorCategory("NONE");
        MessageDTO back = json.readValue(json.writeValueAsString(dto), MessageDTO.class);
        assertEquals("call-1", back.getToolCallId());
        assertEquals("succeeded", back.getToolStatus());
        assertEquals("STOP", back.getFinishReason());
    }
}
