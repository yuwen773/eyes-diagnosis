# 眼科诊断 Agent + MCP 系统实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 VisionSpace 的 Agent+MCP 功能移植到 eye-diagnosis，构建眼科诊断对话系统

**Architecture:** 基于 LangChain4j 的 Agent 框架，移植 VisionSpace 的会话管理、MCP集成、工具回调机制。核心差异：VisionSpace 使用 Alibaba Graph Agent，eye-diagnosis 使用 LangChain4j Agent。

**Tech Stack:** LangChain4j 1.5.x | SpringBoot 3.5.6 | MCP Client | Redis | MySQL

---

## 任务 1: 基础设施准备

**Files:**
- Modify: `pom.xml:132` - 添加 MCP 依赖
- Create: `db/schema.sql` - 补充 Agent 表结构

**Step 1: 添加 MCP 依赖到 pom.xml**

```xml
<!-- ModelContextProtocol Client -->
<dependency>
    <groupId>io.modelcontextprotocol</groupId>
    <artifactId>mcp-client</artifactId>
    <version>1.0.0</version>
</dependency>
```

在 `pom.xml` 的 `</dependencies>` 前添加上述依赖。

**Step 2: 添加 Agent 数据库表**

在 `db/schema.sql` 末尾追加：

```sql
-- Agent会话表
CREATE TABLE IF NOT EXISTS t_agent_session (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64) NOT NULL COMMENT '会话ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    title VARCHAR(255) DEFAULT '新会话' COMMENT '会话标题',
    status TINYINT DEFAULT 1 COMMENT '状态:0结束,1活跃',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_session_id (session_id)
) COMMENT 'Agent会话表';

-- Agent消息表
CREATE TABLE IF NOT EXISTS t_agent_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64) NOT NULL COMMENT '会话ID',
    role VARCHAR(20) NOT NULL COMMENT '角色:user/assistant/tool/reasoning',
    content TEXT COMMENT '消息内容',
    message_type VARCHAR(20) COMMENT '类型:text/tool_request/tool_confirm/reasoning',
    tool_calls JSON COMMENT '工具调用列表',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session_id (session_id),
    INDEX idx_create_time (create_time)
) COMMENT 'Agent消息表';

-- MCP服务器表
CREATE TABLE IF NOT EXISTS t_mcp_server (
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
    INDEX idx_user_id (user_id),
    UNIQUE INDEX idx_code_user (mcp_server_code, user_id)
) COMMENT 'MCP服务器配置表';
```

**Step 3: 提交**

```bash
git add pom.xml db/schema.sql
git commit -m "feat(agent): 添加MCP依赖和Agent数据库表结构

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 2: 创建 Agent 实体类

**Files:**
- Create: `model/entity/AgentSession.java`
- Create: `model/entity/AgentMessage.java`
- Create: `model/entity/McpServer.java`
- Create: `model/dto/agent/*.java` (多个DTO)

**Step 1: 创建 AgentSession 实体**

```java
package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_agent_session")
public class AgentSession {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String sessionId;
    private Long userId;
    private String title;
    private Integer status;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
```

**Step 2: 创建 AgentMessage 实体**

```java
package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_agent_message")
public class AgentMessage {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String sessionId;
    private String role;
    private String content;
    private String messageType;
    private String toolCalls;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}
```

**Step 3: 创建 McpServer 实体**

```java
package com.csust.eyediagnosis.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_mcp_server")
public class McpServer {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String mcpServerCode;
    private String mcpServerName;
    private String installType;
    private String host;
    private String deployConfig;
    private Integer status;
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
```

**Step 4: 创建 DTO 类**

创建 `model/dto/agent/` 包下的请求/响应类：
- `AgentChatRequest.java` - 对话请求
- `SessionVO.java` - 会话视图对象
- `ChatHistoryVO.java` - 聊天历史
- `MessageVO.java` - 消息视图对象
- `FeedbackRequest.java` - 反馈请求

创建 `model/dto/mcp/` 包下的MCP相关类：
- `McpServerDetail.java`
- `McpTool.java`
- `McpServerCallToolRequest.java`
- `McpServerCallToolResponse.java`

**Step 5: 提交**

```bash
git add model/entity/AgentSession.java model/entity/AgentMessage.java model/entity/McpServer.java
git add model/dto/agent/*.java model/dto/mcp/*.java
git commit -m "feat(agent): 添加Agent和MCP实体类及DTO

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 3: 创建 Mapper 接口

**Files:**
- Create: `mapper/AgentSessionMapper.java`
- Create: `mapper/AgentMessageMapper.java`
- Create: `mapper/McpServerMapper.java`

**Step 1: 创建 AgentSessionMapper**

```java
package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentSession;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface AgentSessionMapper extends BaseMapper<AgentSession> {
}
```

**Step 2: 创建 AgentMessageMapper**

```java
package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.AgentMessage;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface AgentMessageMapper extends BaseMapper<AgentMessage> {
}
```

**Step 3: 创建 McpServerMapper**

```java
package com.csust.eyediagnosis.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.model.entity.McpServer;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface McpServerMapper extends BaseMapper<McpServer> {
}
```

**Step 4: 提交**

```bash
git add mapper/AgentSessionMapper.java mapper/AgentMessageMapper.java mapper/McpServerMapper.java
git commit -m "feat(agent): 添加Agent和MCP的Mapper接口

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 4: 创建 MCP 管理器

**Files:**
- Create: `agent/manager/MCPManager.java`
- Create: `agent/mcp/McpToolCallback.java`
- Create: `agent/mcp/McpToolCallbackProvider.java`
- Create: `agent/interceptor/TextMcpModelInterceptor.java`

**Step 1: 创建 MCPManager**

从 VisionSpace 移植 `MCPManager.java`，主要功能：
- `getMcpSyncClient()` - 创建MCP客户端（支持STDIO/SSE/Streamable HTTP）
- `getTools()` - 获取MCP工具列表（带Redis缓存）
- `callTool()` - 调用MCP工具
- `invalidateToolsCache()` - 失效工具缓存

```java
package com.csust.eyediagnosis.agent.manager;

@Slf4j
@Component
@RequiredArgsConstructor
public class MCPManager {
    private final StringRedisTemplate redisTemplate;
    private final ExecutorService mcpExecutor = Executors.newCachedThreadPool();

    // ... 完整实现见 VisionSpace 源码
}
```

**Step 2: 创建 MCP回调相关类**

- `McpToolCallback.java` - 包装MCP工具为LangChain4j ToolCallback
- `McpToolCallbackProvider.java` - 提供MCP工具回调数组

**Step 3: 创建 TextMcpModelInterceptor**

从 VisionSpace 移植，负责解析MCP配置并创建回调数组。

**Step 4: 提交**

```bash
git add agent/manager/MCPManager.java agent/mcp/*.java agent/interceptor/TextMcpModelInterceptor.java
git commit -m "feat(agent): 添加MCP管理器和相关组件

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 5: 创建会话历史服务

**Files:**
- Create: `agent/service/ChatHistoryService.java`
- Create: `agent/service/McpServerService.java`

**Step 1: 创建 ChatHistoryService**

从 VisionSpace 移植，主要功能：
- `saveUserMessage()` / `saveAssistantMessage()` - 保存消息
- `saveReasoningMessage()` / `saveToolCallMessage()` - 保存特殊消息
- `loadHistory()` - 分页加载历史
- `getUserSessions()` - 获取用户会话列表
- `isSessionOwner()` - 验证会话归属

**Step 2: 创建 McpServerService**

从 VisionSpace 移植，提供MCP服务器的CRUD操作。

**Step 3: 提交**

```bash
git add agent/service/ChatHistoryService.java agent/service/McpServerService.java
git commit -m "feat(agent): 添加会话历史和MCP服务

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 6: 创建诊断Agent核心

**Files:**
- Create: `agent/DiagnosisAgent.java` - 核心Agent
- Create: `agent/config/AgentConstants.java` - Agent配置
- Create: `agent/service/impl/McpServerServiceImpl.java` - MCP服务实现

**Step 1: 创建 AgentConstants**

```java
package com.csust.eyediagnosis.agent.config;

@ConfigurationProperties(prefix = "agent")
@Data
public class AgentConstants {
    private int maxHistoryPageSize = 100;
    private int maxIterations = 10;
    private int modelCallLimit = 15;
}
```

**Step 2: 创建 DiagnosisAgent**

核心诊断Agent，基于LangChain4j实现：

```java
package com.csust.eyediagnosis.agent;

@Component
public class DiagnosisAgent {
    private static final Logger log = LoggerFactory.getLogger(DiagnosisAgent.class);

    // 诊断系统提示词
    private static final String DIAGNOSIS_AGENT_INSTRUCTION = """
        你是一个专业的眼科AI诊断助手...
        """;

    // 内置诊断工具
    // - analyzeEyeImage: 分析眼底照片
    // - searchMedicalKnowledge: 查询医学知识库
    // - evaluateDiagnosisQuality: 评估诊断质量

    // MCP工具集成
}
```

**Step 3: 创建 McpServerServiceImpl**

从 VisionSpace 移植。

**Step 4: 提交**

```bash
git add agent/DiagnosisAgent.java agent/config/AgentConstants.java agent/service/impl/McpServerServiceImpl.java
git commit -m "feat(agent): 添加诊断Agent核心类

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 7: 创建 Controller API

**Files:**
- Create: `controller/AgentController.java`
- Create: `controller/McpServerController.java`

**Step 1: 创建 AgentController**

从 VisionSpace 移植，修改API路径前缀为 `/api/agent`：

```java
@RestController
@RequestMapping("/api/agent")
public class AgentController {
    // POST /api/agent/image/chat - 对话
    // POST /api/agent/image/chat/stream - 流式对话
    // POST /api/agent/image/feedback - 反馈
    // GET /api/agent/history/{threadId} - 历史
    // GET /api/agent/sessions - 会话列表
}
```

**Step 2: 创建 McpServerController**

从 VisionSpace 移植，API路径 `/api/mcp`。

**Step 3: 提交**

```bash
git add controller/AgentController.java controller/McpServerController.java
git commit -m "feat(agent): 添加Agent和MCP的Controller API

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 8: 前端页面移植

**Files:**
- Create: `frontend/src/pages/DiagnosisChatPage.vue`
- Create: `frontend/src/components/agent/AgentMessageList.vue`
- Create: `frontend/src/components/agent/settings/SettingsModal.vue`
- Create: `frontend/src/components/agent/settings/McpServicePanel.vue`
- Create: `frontend/src/api/agentController.ts`
- Create: `frontend/src/api/mcpController.ts`
- Modify: `frontend/src/router/index.ts` - 添加路由

**Step 1: 创建 API 客户端**

从 VisionSpace 移植 `agentController.ts` 和 `mcpController.ts`，适配 eye-diagnosis 的 API 路径。

**Step 2: 创建 DiagnosisChatPage**

从 VisionSpace 的 `AgentChatPage.vue` 移植，修改为眼科诊断主题。

**Step 3: 创建组件**

- `AgentMessageList.vue` - 消息列表
- `SettingsModal.vue` - 设置弹窗
- `McpServicePanel.vue` - MCP服务面板
- `McpServerForm.vue` - MCP服务器表单

**Step 4: 添加路由**

在 `router/index.ts` 中添加诊断对话页面路由。

**Step 5: 提交**

```bash
git add frontend/src/pages/DiagnosisChatPage.vue
git add frontend/src/components/agent/
git add frontend/src/api/agentController.ts frontend/src/api/mcpController.ts
git commit -m "feat(agent): 添加前端诊断对话页面和组件

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 9: 配置更新

**Files:**
- Modify: `application.yml` - 添加 agent 配置
- Modify: `application-dev.yml` - 补充开发配置

**Step 1: 添加 agent 配置**

```yaml
spring:
  ai:
    model:
      # DeepSeek 配置 (已有)

agent:
  max-history-page-size: 100
  max-iterations: 10
  model-call-limit: 15
```

**Step 2: 提交**

```bash
git add application.yml application-dev.yml
git commit -m "feat(agent): 添加Agent配置

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 任务 10: 端到端测试

**Files:**
- Create: `src/test/java/com/csust/eyediagnosis/agent/DiagnosisAgentTest.java`
- Create: `src/test/java/com/csust/eyediagnosis/agent/service/ChatHistoryServiceTest.java`

**Step 1: 编写诊断Agent测试**

测试问诊流程、工具调用、流式输出。

**Step 2: 编写会话历史服务测试**

测试消息保存、加载、分页。

**Step 3: 运行测试**

```bash
mvn test -Dtest=*AgentTest,*ChatHistoryServiceTest
```

**Step 4: 提交**

```bash
git add src/test/java/com/csust/eyediagnosis/agent/
git commit -m "test(agent): 添加Agent单元测试

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-04-22-agent-diagnosis移植设计.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**