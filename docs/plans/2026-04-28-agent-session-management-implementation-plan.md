# Agent 会话管理功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Agent 聊天系统补全删除、重命名、AI 生成标题、置顶、导出功能

**Architecture:** 后端新增 5 个 REST 接口 + AI 异步生成标题逻辑；前端改造 LeftSidebar 实现多选、编辑、置顶、导出交互

**Tech Stack:** Spring Boot + MyBatis Plus + Vue 3 + TypeScript

---

## Phase 1: 后端基础

### Task 1: 数据库字段变更

**Files:**
- Modify: `src/main/resources/db/schema.sql`

**Step 1: 添加数据库字段**

```sql
ALTER TABLE t_agent_session
  ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否置顶：0-否，1-是',
  ADD COLUMN pin_time DATETIME COMMENT '置顶时间';
```

**Step 2: 更新 AgentSession 实体类**

Modify: `src/main/java/com/csust/eyediagnosis/model/entity/AgentSession.java`

添加两个字段：
```java
private Integer pinned;  // 默认 0
private Date pinTime;
```

**Step 3: 提交**

```bash
git add src/main/java/com/csust/eyediagnosis/model/entity/AgentSession.java
git commit -m "feat(agent): 添加置顶字段 pinned, pin_time"
```

---

### Task 2: 删除会话接口

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/agent/service/ChatHistoryService.java`
- Modify: `src/main/java/com/csust/eyediagnosis/mapper/AgentSessionMapper.java`
- Create: `src/main/java/com/csust/eyediagnosis/controller/AgentController.java` (添加方法)

**Step 1: Mapper 添加软删除方法**

Modify: `AgentSessionMapper.java`

```java
@Update("UPDATE t_agent_session SET is_delete = 1, updated_time = NOW() WHERE session_id = #{sessionId}")
int softDeleteBySessionId(@Param("sessionId") String sessionId);
```

**Step 2: ChatHistoryService 添加删除方法**

```java
public void deleteSession(String sessionId, Long userId) {
    if (!isSessionOwner(sessionId, userId)) {
        throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }
    sessionMapper.softDeleteBySessionId(sessionId);
}
```

**Step 3: Controller 添加删除接口**

Add to `AgentController.java`:

```java
@DeleteMapping("/sessions/{sessionId}")
public BaseResponse<Boolean> deleteSession(
        @PathVariable String sessionId,
        HttpServletRequest httpRequest) {
    User loginUser = userService.getLoginUser(httpRequest);
    if (loginUser == null) {
        throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
    }
    chatHistoryService.deleteSession(sessionId, loginUser.getId());
    return ResultUtils.success(true);
}
```

**Step 4: 提交**

```bash
git add src/main/java/com/csust/eyediagnosis/agent/service/ChatHistoryService.java
git add src/main/java/com/csust/eyediagnosis/mapper/AgentSessionMapper.java
git add src/main/java/com/csust/eyediagnosis/controller/AgentController.java
git commit -m "feat(agent): 添加删除会话接口 DELETE /sessions/{sessionId}"
```

---

### Task 3: 批量删除会话接口

**Files:**
- Modify: `AgentSessionMapper.java`
- Modify: `ChatHistoryService.java`
- Modify: `AgentController.java`

**Step 1: Mapper 添加批量软删除**

```java
@Update("<script>" +
        "UPDATE t_agent_session SET is_delete = 1, updated_time = NOW() WHERE session_id IN " +
        "<foreach collection='sessionIds' item='id' open='(' separator=',' close=')'>" +
        "#{id}</foreach>" +
        "</script>")
int batchSoftDelete(@Param("sessionIds") List<String> sessionIds);
```

**Step 2: ChatHistoryService 添加批量删除**

```java
public int batchDeleteSessions(List<String> sessionIds, Long userId) {
    // 校验用户拥有所有会话
    for (String sessionId : sessionIds) {
        if (!isSessionOwner(sessionId, userId)) {
            throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "无权限删除会话: " + sessionId);
        }
    }
    return sessionMapper.batchSoftDelete(sessionIds);
}
```

**Step 3: Controller 添加批量删除接口**

```java
@DeleteMapping("/sessions/batch")
public BaseResponse<Integer> batchDeleteSessions(
        @RequestBody Map<String, List<String>> body,
        HttpServletRequest httpRequest) {
    User loginUser = userService.getLoginUser(httpRequest);
    if (loginUser == null) {
        throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
    }
    List<String> sessionIds = body.get("sessionIds");
    if (sessionIds == null || sessionIds.isEmpty()) {
        throw new BusinessException(ErrorCode.PARAMS_ERROR, "sessionIds 不能为空");
    }
    int count = chatHistoryService.batchDeleteSessions(sessionIds, loginUser.getId());
    return ResultUtils.success(count);
}
```

**Step 4: 提交**

```bash
git commit -m "feat(agent): 添加批量删除会话接口 DELETE /sessions/batch"
```

---

### Task 4: 更新会话标题接口

**Files:**
- Modify: `AgentSessionMapper.java`
- Modify: `ChatHistoryService.java`
- Modify: `AgentController.java`

**Step 1: Mapper 添加更新标题方法**

```java
@Update("UPDATE t_agent_session SET title = #{title}, updated_time = NOW() WHERE session_id = #{sessionId}")
int updateTitle(@Param("sessionId") String sessionId, @Param("title") String title);
```

**Step 2: ChatHistoryService 添加更新标题方法**

```java
public void updateSessionTitle(String sessionId, Long userId, String title) {
    if (!isSessionOwner(sessionId, userId)) {
        throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }
    // 标题长度限制
    if (title == null || title.length() > 50) {
        throw new BusinessException(ErrorCode.PARAMS_ERROR, "标题长度不能超过50字");
    }
    sessionMapper.updateTitle(sessionId, title);
}
```

**Step 3: Controller 添加更新标题接口**

```java
@PutMapping("/sessions/{sessionId}/title")
public BaseResponse<Boolean> updateSessionTitle(
        @PathVariable String sessionId,
        @RequestBody Map<String, String> body,
        HttpServletRequest httpRequest) {
    User loginUser = userService.getLoginUser(httpRequest);
    if (loginUser == null) {
        throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
    }
    String title = body.get("title");
    chatHistoryService.updateSessionTitle(sessionId, loginUser.getId(), title);
    return ResultUtils.success(true);
}
```

**Step 4: 提交**

```bash
git commit -m "feat(agent): 添加更新会话标题接口 PUT /sessions/{sessionId}/title"
```

---

### Task 5: 置顶/取消置顶接口

**Files:**
- Modify: `AgentSessionMapper.java`
- Modify: `ChatHistoryService.java`
- Modify: `AgentController.java`

**Step 1: Mapper 添加置顶方法**

```java
@Update("UPDATE t_agent_session SET pinned = #{pinned}, pin_time = #{pinTime}, updated_time = NOW() WHERE session_id = #{sessionId}")
int updatePinStatus(@Param("sessionId") String sessionId, @Param("pinned") Integer pinned, @Param("pinTime") Date pinTime);
```

**Step 2: ChatHistoryService 添加置顶逻辑**

```java
public void updatePinStatus(String sessionId, Long userId, boolean pinned) {
    if (!isSessionOwner(sessionId, userId)) {
        throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }
    sessionMapper.updatePinStatus(sessionId, pinned ? 1 : 0, pinned ? new Date() : null);
}
```

**Step 3: Controller 添加置顶接口**

```java
@PutMapping("/sessions/{sessionId}/pin")
public BaseResponse<Boolean> updatePinStatus(
        @PathVariable String sessionId,
        @RequestBody Map<String, Boolean> body,
        HttpServletRequest httpRequest) {
    User loginUser = userService.getLoginUser(httpRequest);
    if (loginUser == null) {
        throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
    }
    Boolean pinned = body.get("pinned");
    if (pinned == null) {
        throw new BusinessException(ErrorCode.PARAMS_ERROR);
    }
    chatHistoryService.updatePinStatus(sessionId, loginUser.getId(), pinned);
    return ResultUtils.success(true);
}
```

**Step 4: 提交**

```bash
git commit -m "feat(agent): 添加置顶接口 PUT /sessions/{sessionId}/pin"
```

---

### Task 6: 会话导出接口（Markdown / JSON）

**Files:**
- Modify: `ChatHistoryService.java`
- Modify: `AgentController.java`

**Step 1: ChatHistoryService 添加导出方法**

```java
public String exportSession(String sessionId, Long userId, String format) {
    if (!isSessionOwner(sessionId, userId)) {
        throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }
    List<AgentMessage> messages = messageMapper.selectBySessionIdOrderByTimeASC(sessionId, 1000);
    AgentSession session = sessionMapper.selectBySessionId(sessionId);

    if ("json".equalsIgnoreCase(format)) {
        return exportAsJson(session, messages);
    } else {
        return exportAsMarkdown(session, messages);
    }
}

private String exportAsJson(AgentSession session, List<AgentMessage> messages) {
    Map<String, Object> result = new HashMap<>();
    result.put("sessionId", session.getSessionId());
    result.put("title", session.getTitle());
    result.put("createdAt", session.getCreatedTime());
    result.put("messages", messages.stream().map(m -> {
        Map<String, Object> msg = new HashMap<>();
        msg.put("role", m.getRole());
        msg.put("content", m.getContent());
        msg.put("time", m.getCreatedTime());
        return msg;
    }).toList());
    return new ObjectMapper().writeValueAsString(result);
}

private String exportAsMarkdown(AgentSession session, List<AgentMessage> messages) {
    StringBuilder sb = new StringBuilder();
    sb.append("# ").append(session.getTitle()).append("\n\n");
    sb.append("会话 ID: ").append(session.getSessionId()).append("\n");
    sb.append("创建时间: ").append(session.getCreatedTime()).append("\n\n");
    sb.append("---\n\n");
    for (AgentMessage m : messages) {
        String role = "USER".equals(m.getRole()) ? "用户" : "AI";
        sb.append("## ").append(role).append("\n");
        sb.append(m.getContent()).append("\n\n");
        sb.append("*").append(m.getCreatedTime()).append("*\n\n");
    }
    return sb.toString();
}
```

**Step 2: Controller 添加导出接口**

```java
@GetMapping("/history/{sessionId}/export")
public BaseResponse<String> exportSession(
        @PathVariable String sessionId,
        @RequestParam(defaultValue = "markdown") String format,
        HttpServletRequest httpRequest) {
    User loginUser = userService.getLoginUser(httpRequest);
    if (loginUser == null) {
        throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
    }
    String content = chatHistoryService.exportSession(sessionId, loginUser.getId(), format);
    return ResultUtils.success(content);
}
```

**Step 3: 提交**

```bash
git commit -m "feat(agent): 添加会话导出接口 GET /history/{sessionId}/export"
```

---

### Task 7: AI 异步生成标题

**Files:**
- Modify: `ChatHistoryService.java`
- Create: `src/main/java/com/csust/eyediagnosis/agent/service/TitleGenerationService.java`

**Step 1: 创建 TitleGenerationService**

```java
@Service
public class TitleGenerationService {

    @Value("${agent.title.model:qwen-turbo}")
    private String modelName;

    @Value("${agent.title.api-key:#{null}}")
    private String apiKey;

    @Async("agentAsyncExecutor")
    public void generateTitleAsync(String sessionId, String firstMessage) {
        try {
            // 调用廉价模型生成标题
            // 使用 DashScope 或其他 LLM API
            // 提示词：生成不超过20字的简短标题
            String prompt = "为以下对话生成一个简短标题（不超过20字）：" + firstMessage;

            // 调用 LLM 获取标题
            String title = callLlm(prompt);

            // 更新会话标题
            AgentSession session = sessionMapper.selectBySessionId(sessionId);
            if (session != null && session.getTitle().length() < 10) {
                sessionMapper.updateTitle(sessionId, title);
            }
        } catch (Exception e) {
            // 生成失败不影响主流程，记录日志
            log.warn("AI 生成标题失败, sessionId={}", sessionId, e);
        }
    }

    private String callLlm(String prompt) {
        // TODO: 实现 LLM 调用，可使用 DashScope 或配置的 API
        // 返回生成的标题
        return "新对话"; // 临时实现
    }
}
```

**Step 2: ChatHistoryService 保存用户消息时触发标题生成**

Modify: `ChatHistoryService.saveUserMessage()` 添加：

```java
// 在消息保存后，异步生成标题
if (session.getMessageCount() == 0) {
    // 第一条消息，触发标题生成
    titleGenerationService.generateTitleAsync(sessionId, content);
}
```

**Step 3: 提交**

```bash
git add src/main/java/com/csust/eyediagnosis/agent/service/TitleGenerationService.java
git commit -m "feat(agent): 添加 AI 异步生成标题功能"
```

---

### Task 8: 修改 getUserSessions 查询排序

**Files:**
- Modify: `AgentSessionMapper.xml` 或 `AgentSessionMapper.java`

**Step 1: 修改查询排序**

当前按 updatedTime 降序，改为：
1. pinned = 1 的会话按 pinTime 升序
2. pinned = 0 的会话按 updatedTime 降序

```sql
ORDER BY pinned DESC, pin_time ASC, updated_time DESC
```

**Step 2: 提交**

```bash
git commit -m "feat(agent): 修改会话列表排序，置顶会话优先"
```

---

## Phase 2: 前端交互

### Task 9: LeftSidebar.vue 多选模式

**Files:**
- Modify: `frontend/src/components/agent/LeftSidebar.vue`

**Step 1: 添加多选状态**

```typescript
const multiSelectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

const toggleMultiSelect = () => {
  multiSelectMode.value = !multiSelectMode.value
  if (!multiSelectMode.value) {
    selectedIds.value.clear()
  }
}

const toggleSelect = (id: string) => {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}
```

**Step 2: 修改历史项渲染**

在 history-item 上添加：
- 左侧复选框（多选模式时显示）
- `:class="{ selected: selectedIds.has(item.id) }"`

**Step 3: 添加底部批量操作栏**

```vue
<div v-if="multiSelectMode && selectedIds.size > 0" class="batch-actions">
  <span>已选择 {{ selectedIds.size }} 项</span>
  <a-button type="primary" danger @click="handleBatchDelete">删除</a-button>
</div>
```

**Step 4: 提交**

```bash
git commit -m "feat(frontend): LeftSidebar 多选模式支持"
```

---

### Task 10: 删除确认弹窗

**Files:**
- Modify: `LeftSidebar.vue`

**Step 1: 单个删除确认**

```typescript
import { Modal } from 'ant-design-vue'

const handleDelete = (id: string) => {
  Modal.confirm({
    title: '确定删除该会话？',
    content: '删除后可从"回收站"恢复',
    okText: '删除',
    okType: 'danger',
    onOk: () => deleteSession(id)
  })
}
```

**Step 2: 批量删除确认**

```typescript
const handleBatchDelete = () => {
  Modal.confirm({
    title: `确定删除选中的 ${selectedIds.value.size} 个会话？`,
    okText: '删除',
    okType: 'danger',
    onOk: () => {
      batchDeleteSessions(Array.from(selectedIds.value))
      multiSelectMode.value = false
      selectedIds.value.clear()
    }
  })
}
```

**Step 3: 调用后端 API**

```typescript
import { deleteSession, batchDeleteSessions } from '@/api/agentController'

const deleteSession = async (sessionId: string) => {
  await agentController.deleteSession(sessionId)
  await loadSessions()
}

const batchDeleteSessions = async (sessionIds: string[]) => {
  await agentController.batchDeleteSessions(sessionIds)
  await loadSessions()
}
```

**Step 4: 提交**

```bash
git commit -m "feat(frontend): 添加删除确认弹窗"
```

---

### Task 11: 标题悬停编辑

**Files:**
- Modify: `LeftSidebar.vue`

**Step 1: 添加编辑状态**

```typescript
const editingId = ref<string | null>(null)
const editingTitle = ref('')

const startEdit = (item: HistoryItem) => {
  editingId.value = item.id
  editingTitle.value = item.title
}

const saveEdit = async () => {
  if (editingId.value) {
    await updateSessionTitle(editingId.value, editingTitle.value)
    editingId.value = null
    await loadSessions()
  }
}

const cancelEdit = () => {
  editingId.value = null
}
```

**Step 2: 悬停显示铅笔图标**

```vue
<span class="history-title" @dblclick="startEdit(item)">
  {{ item.title || '新对话' }}
</span>
<button v-if="!multiSelectMode" class="edit-btn" @click="startEdit(item)">
  <svg>...</svg>
</button>
```

**Step 3: 输入框编辑模式**

```vue
<input
  v-if="editingId === item.id"
  v-model="editingTitle"
  class="title-input"
  @keyup.enter="saveEdit"
  @keyup.esc="cancelEdit"
  @blur="saveEdit"
  maxlength="50"
/>
```

**Step 4: 调用后端 API**

```typescript
import { updateSessionTitle } from '@/api/agentController'
```

**Step 5: 提交**

```bash
git commit -m "feat(frontend): 标题悬停编辑功能"
```

---

### Task 12: 置顶按钮

**Files:**
- Modify: `LeftSidebar.vue`

**Step 1: 添加悬停菜单**

```typescript
const showMenuId = ref<string | null>(null)

const toggleMenu = (id: string) => {
  showMenuId.value = showMenuId.value === id ? null : id
}

const handlePin = async (item: HistoryItem) => {
  await updatePinStatus(item.id, !item.isPinned)
  showMenuId.value = null
  await loadSessions()
}
```

**Step 2: 悬停菜单 UI**

```vue
<div class="history-item" @mouseenter="showMenuId = item.id" @mouseleave="showMenuId = null">
  ...
  <div v-if="showMenuId === item.id" class="hover-menu">
    <button @click="handlePin(item)">
      {{ item.isPinned ? '取消置顶' : '置顶' }}
    </button>
    <button @click="handleExport(item, 'markdown')">导出 Markdown</button>
    <button @click="handleExport(item, 'json')">导出 JSON</button>
  </div>
</div>
```

**Step 3: 调用后端 API**

```typescript
import { updatePinStatus } from '@/api/agentController'
```

**Step 4: 提交**

```bash
git commit -m "feat(frontend): 置顶/取消置顶功能"
```

---

### Task 13: 导出功能

**Files:**
- Modify: `agentController.ts`
- Modify: `LeftSidebar.vue`

**Step 1: agentController 添加导出方法**

```typescript
export const exportSession = (
  sessionId: string,
  format: 'markdown' | 'json'
): Promise<BaseResponse<string>> => {
  return fetch(`${BASE_URL}/agent/history/${sessionId}/export?format=${format}`, {
    method: 'GET',
    credentials: 'include',
  }).then(res => res.json())
}
```

**Step 2: 触发下载**

```typescript
const handleExport = async (item: HistoryItem, format: 'markdown' | 'json') => {
  const res = await exportSession(item.id, format)
  if (res.code === 0) {
    const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.title || '会话'}_${format}.${format === 'json' ? 'json' : 'md'}`
    a.click()
    URL.revokeObjectURL(url)
  }
}
```

**Step 3: 提交**

```bash
git commit -m "feat(frontend): 会话导出 Markdown/JSON 功能"
```

---

### Task 14: AI 生成标题前端触发

**Files:**
- Modify: `AgentChatPage.vue`

**Step 1: 发送消息后触发标题生成**

```typescript
const handleSend = async (text: string, files: File[] = []) => {
  // ... 现有逻辑

  // 如果是第一条消息，触发标题生成
  if (currentThreadId.value && messages.value.length === 1) {
    // 发请求通知后端生成标题
    generateTitle(currentThreadId.value, text)
  }
}

import { generateTitle } from '@/api/agentController'
```

**Step 2: agentController 添加标题生成接口**

```typescript
export const generateTitle = (sessionId: string, firstMessage: string): Promise<BaseResponse<boolean>> => {
  return fetch(`${BASE_URL}/agent/sessions/${sessionId}/generate-title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstMessage }),
    credentials: 'include',
  }).then(res => res.json())
}
```

**Step 3: 后端添加标题生成触发接口**

AgentController 添加：

```java
@PostMapping("/sessions/{sessionId}/generate-title")
public BaseResponse<Boolean> generateTitle(
        @PathVariable String sessionId,
        @RequestBody Map<String, String> body,
        HttpServletRequest httpRequest) {
    User loginUser = userService.getLoginUser(httpRequest);
    if (loginUser == null) {
        throw new BusinessException(ErrorCode.NOT_LOGIN_ERROR);
    }
    String firstMessage = body.get("firstMessage");
    chatHistoryService.triggerTitleGeneration(sessionId, loginUser.getId(), firstMessage);
    return ResultUtils.success(true);
}
```

ChatHistoryService 添加：

```java
public void triggerTitleGeneration(String sessionId, Long userId, String firstMessage) {
    if (!isSessionOwner(sessionId, userId)) {
        throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }
    titleGenerationService.generateTitleAsync(sessionId, firstMessage);
}
```

**Step 4: 提交**

```bash
git commit -m "feat: AI 异步生成标题前后端联调"
```

---

## Phase 3: 联调测试

### Task 15: 全流程联调

1. 删除会话 → 刷新列表 → 确认消失
2. 批量删除 → 确认弹窗 → 刷新列表
3. 重命名 → 保存 → 列表更新
4. 置顶/取消置顶 → 排序变化
5. 导出 → 下载文件 → 检查内容
6. AI 标题生成 → 等待异步 → 列表更新

### Task 16: 已有功能回归

- 新建会话
- 发送消息
- 加载历史消息
- SSE 流式对话
- MCP 工具调用

### Task 17: 提交最终代码**

```bash
git commit -m "feat(agent): 完成会话管理功能开发"
```