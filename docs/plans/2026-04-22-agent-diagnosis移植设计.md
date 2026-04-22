# 眼科诊断 Agent + MCP 系统设计方案

**日期**: 2026-04-22
**项目**: Eye Diagnosis AI System
**目标**: 从 VisionSpace 移植 Agent + MCP 功能到 eye-diagnosis

---

## 1. 背景与目标

### 1.1 需求描述
将 VisionSpace 项目的 Agent 对话功能（含 MCP 工具调用）移植到 eye-diagnosis 眼科诊断系统。

### 1.2 核心能力
| 能力 | 描述 |
|------|------|
| 智能问诊 | 对话式收集症状，评估可能疾病 |
| 报告解读 | 分析眼底照片、验光单等检查结果 |
| 知识库问答 | 眼科医学知识检索与解答 |
| MCP工具调用 | 连接外部医学工具（知识库、文献搜索） |

### 1.3 关键假设（待用户确认）
- MCP用于医学知识库查询和文献搜索
- 前端界面风格参考VisionSpace Agent页面
- 会话存储使用MySQL（复用现有架构）

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Vue 5173)                   │
│   DiagnosisChatPage.vue  │  MCP配置面板                  │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP/SSE
┌──────────────────────────▼──────────────────────────────┐
│              Backend (SpringBoot 8081)                   │
│                                                          │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │AgentController│  │McpServer   │  │DiagnosisAgent   │ │
│  │ /api/agent/* │  │Controller   │  │(诊断专用Agent)   │ │
│  └──────────────┘  │ /api/mcp/*  │  └────────┬────────┘  │
│                   └─────────────┘         │             │
│                                          │             │
│  ┌────────────────────────────────────────▼─────────┐  │
│  │              MCPManager                            │  │
│  │  - getMcpSyncClient()                             │  │
│  │  - getTools() + callTool()                         │  │
│  │  - 工具缓存 (Redis)                                │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │DiagnosisTools│  │ChatHistory  │  │ LangChain4j     │ │
│  │(内置诊断工具)│  │Service      │  │ + DeepSeek      │ │
│  └──────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              MCP Servers (外部工具)                       │
│  - 医学知识库 (STDIO/HTTP)                               │
│  - 文献搜索服务 (SSE)                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 系统提示词设计

```java
private static final String DIAGNOSIS_AGENT_INSTRUCTION = """
你是一个专业的眼科AI诊断助手。

## 核心职责
1. 通过问诊收集患者的症状、视力问题、眼部不适等信息
2. 根据收集的信息评估可能的眼部疾病（给出参考建议，不做最终诊断）
3. 解读用户上传的眼底照片、验光单等检查报告
4. 提供眼部护理建议和就医指导

## 工作流程
### 问诊阶段（EXPLORATION）
- 使用开放式问题收集症状：「您有什么眼部不适？」
- 确认关键信息：视力变化、眼疼、流泪、闪光感等
- 调用【疾病知识库】查询可能的疾病类型

### 报告解读阶段
- 用户上传眼底照片或验光单时，调用【图像分析工具】
- 识别照片中的异常（杯盘比、血管、出血等）
- 给出初步评估和建议

### 满意度询问（每次回复后）
「这些信息对您有帮助吗？是否有其他问题需要进一步解答？」

## 约束
- 不直接确诊，只提供参考建议
- 强调「建议就医」的重要性，尤其是症状严重时
- 涉及手术、处方等必须建议专业就诊
- 保护用户隐私，谨慎处理敏感医学信息

## 工具使用
- analyze_eye_image: 分析眼底照片
- search_medical_knowledge: 查询医学知识库
- search_literature: 搜索最新研究文献
- evaluate_diagnosis_quality: 评估诊断建议质量
""";
```

---

## 4. 数据库设计

### 4.1 新增表

```sql
-- Agent会话表
CREATE TABLE t_agent_session (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64) NOT NULL COMMENT '会话ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    title VARCHAR(255) DEFAULT '新会话' COMMENT '会话标题',
    status TINYINT DEFAULT 1 COMMENT '状态:0结束,1活跃',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_session_id (session_id)
);

-- Agent消息表
CREATE TABLE t_agent_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64) NOT NULL COMMENT '会话ID',
    role VARCHAR(20) NOT NULL COMMENT '角色:user/assistant/tool/reasoning',
    content TEXT COMMENT '消息内容',
    message_type VARCHAR(20) COMMENT '类型:text/tool_request/tool_confirm/reasoning',
    tool_calls JSON COMMENT '工具调用列表',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session_id (session_id),
    INDEX idx_create_time (create_time)
);

-- MCP服务器表（如不存在则新增）
CREATE TABLE t_mcp_server (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    mcp_server_code VARCHAR(100) NOT NULL COMMENT '服务器代码',
    mcp_server_name VARCHAR(255) NOT NULL COMMENT '服务器名称',
    install_type VARCHAR(20) NOT NULL COMMENT '安装类型:STDIO/SSE/HTTP',
    host VARCHAR(500) COMMENT '服务器地址',
    deploy_config JSON COMMENT '部署配置',
    status TINYINT DEFAULT 1 COMMENT '状态:0禁用,1启用',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
);
```

---

## 5. 移植文件清单

### 5.1 后端 (Java)

| 源文件 (VisionSpace) | 目标文件 (eye-diagnosis) | 说明 |
|----------------------|------------------------|------|
| `agent/ImageAgent.java` | `agent/DiagnosisAgent.java` | 核心Agent，改写系统提示词 |
| `agent/manager/MCPManager.java` | `agent/manager/MCPManager.java` | MCP管理器（直接复用） |
| `agent/service/ChatHistoryService.java` | `agent/service/ChatHistoryService.java` | 会话历史服务（复用） |
| `agent/service/McpServerService.java` | `agent/service/McpServerService.java` | MCP服务器CRUD（复用） |
| `agent/mcp/McpToolCallback*.java` | `agent/mcp/*.java` | MCP回调（复用） |
| `agent/interceptor/TextMcpModelInterceptor.java` | `agent/interceptor/TextMcpModelInterceptor.java` | MCP拦截器（复用） |
| `controller/AgentController.java` | `controller/AgentController.java` | Agent API（扩展） |
| `controller/McpServerController.java` | `controller/McpServerController.java` | MCP管理API（复用） |
| `model/entity/McpServer.java` | `model/entity/McpServer.java` | MCP服务器实体（复用） |
| `model/entity/AgentMessage.java` | `model/entity/AgentMessage.java` | 消息记录（复用） |
| `model/entity/AgentSession.java` | `model/entity/AgentSession.java` | 会话记录（复用） |

### 5.2 前端 (Vue)

| 源文件 (VisionSpace) | 目标文件 (eye-diagnosis) | 说明 |
|----------------------|------------------------|------|
| `AgentChatPage.vue` | `DiagnosisChatPage.vue` | 诊断对话页面 |
| `AgentMessageList.vue` | `DiagnosisMessageList.vue` | 消息列表组件 |
| `AgentResourcePanel.vue` | `DiagnosisResourcePanel.vue` | 资源面板 |
| `settings/SettingsModal.vue` | `settings/SettingsModal.vue` | 设置弹窗（复用） |
| `settings/McpServicePanel.vue` | `settings/McpServicePanel.vue` | MCP服务面板（复用） |
| `api/agentController.ts` | `api/agentController.ts` | Agent API客户端 |
| `api/mcpController.ts` | `api/mcpController.ts` | MCP API客户端 |
| `composables/useAgentStream.ts` | `composables/useAgentStream.ts` | 流式通信（复用） |
| `types/mcp.ts` | `types/mcp.ts` | MCP类型定义（复用） |

---

## 6. 依赖配置

### 6.1 pom.xml 新增依赖

```xml
<!-- Spring AI MCP -->
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-mcp</artifactId>
</dependency>

<!-- ModelContextProtocol Client -->
<dependency>
    <groupId>io.modelcontextprotocol</groupId>
    <artifactId>mcp-client</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Alibaba Graph Agent (VisionSpace使用的agent框架) -->
<dependency>
    <groupId>com.alibaba.cloud.ai</groupId>
    <artifactId>graph-agent</artifactId>
    <version>1.0.0</version>
</dependency>
```

---

## 7. 实施步骤

### Phase 1: 基础架构（1-2天）
- [ ] 创建 `agent/` 包结构
- [ ] 移植 `DiagnosisAgent.java`（基于ImageAgent改写系统提示词）
- [ ] 移植 `ChatHistoryService.java`
- [ ] 创建数据库表 `t_agent_session`, `t_agent_message`

### Phase 2: MCP集成（1-2天）
- [ ] 移植 `MCPManager.java`
- [ ] 移植 `McpServerService.java`
- [ ] 移植 `TextMcpModelInterceptor.java`
- [ ] 配置MCP依赖

### Phase 3: 前端界面（1-2天）
- [ ] 创建 `DiagnosisChatPage.vue`
- [ ] 移植 `AgentMessageList.vue`
- [ ] 移植 MCP配置面板
- [ ] 流式对话对接

### Phase 4: 调试优化（0.5-1天）
- [ ] 系统提示词调优
- [ ] 工具注册与测试
- [ ] 端到端测试

---

## 8. 风险与注意事项

1. **Alibaba Graph Agent依赖**: VisionSpace使用了`com.alibaba.cloud.ai.graph`框架，需确认eye-diagnosis是否引入
2. **MCP工具适配**: 内置工具（图片搜索、生成）不适用于眼科场景，需替换为诊断相关工具
3. **会话隔离**: 确保多用户会话数据隔离

---

## 9. 待确认事项

- [ ] MCP工具具体用途（医学知识库？文献搜索？）
- [ ] 是否需要支持图像生成能力
- [ ] 会话历史保留策略