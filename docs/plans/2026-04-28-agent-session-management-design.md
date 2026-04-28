# Agent 会话管理功能设计

## 1. 概述

为 Agent 聊天系统补全会话管理能力，包括删除、重命名、AI 自动生成标题、置顶、导出等功能。

## 2. 功能清单

| 功能 | 类型 | 描述 |
|------|------|------|
| 删除会话 | 软删除 | isDelete=1，支持恢复 |
| 批量删除 | 批量操作 | 多选模式，批量软删除 |
| 删除确认 | 交互 | 所有删除均弹窗确认 |
| 重命名会话 | 编辑 | 悬停标题旁铅笔图标，点击编辑 |
| AI 生成标题 | 自动 | 第一条用户消息发送后异步生成，廉价模型 |
| 会话置顶 | 置顶 | 置顶会话排最前 |
| 会话导出 | 导出 | Markdown / JSON 格式 |

## 3. 数据库变更

### 3.1 AgentSession 表变更

```sql
ALTER TABLE t_agent_session
  ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否置顶：0-否，1-是',
  ADD COLUMN pin_time DATETIME COMMENT '置顶时间';
```

- `pinned`：置顶标志
- `pin_time`：置顶时间，用于置顶会话间的排序
- `is_delete`：现有字段，复用为软删除标志

## 4. 后端接口设计

### 4.1 删除会话
- **DELETE** `/api/agent/sessions/{sessionId}`
- 响应：BaseResponse\<boolean\>
- 逻辑：is_delete = 1

### 4.2 批量删除会话
- **DELETE** `/api/agent/sessions/batch`
- 请求体：`{ sessionIds: string[] }`
- 响应：BaseResponse\<int\>（删除了多少条）

### 4.3 更新会话标题
- **PUT** `/api/agent/sessions/{sessionId}/title`
- 请求体：`{ title: string }`
- 响应：BaseResponse\<boolean\>

### 4.4 置顶/取消置顶
- **PUT** `/api/agent/sessions/{sessionId}/pin`
- 请求体：`{ pinned: boolean }`
- 响应：BaseResponse\<boolean\>

### 4.5 导出会话
- **GET** `/api/agent/history/{sessionId}/export?format=markdown|json`
- 响应：BaseResponse\<string\>（文件内容或下载链接）
- 格式：
  - Markdown：对话格式，每条消息 `# 角色: 内容`，包含时间戳
  - JSON：`{ sessionId, title, createdAt, messages: [{role, content, time}] }`

### 4.6 AI 生成标题（内部逻辑）
- 时机：第一条用户消息保存后，异步触发
- 模型：dashscope 廉价模型（如 qwen-turbo）
- 提示词：`请为以下对话生成一个简短标题（不超过20字）：\n{第一条用户消息}`
- 结果写入 `title` 字段

## 5. 前端交互设计

### 5.1 历史列表（LeftSidebar.vue）

**多选模式**
- 左上角"选择"按钮，点击进入多选模式
- 每个会话项左侧出现复选框
- 底部出现批量操作栏：显示已选数量 + "删除" 按钮
- 再次点击"选择"按钮退出多选模式

**删除**
- 每个会话项悬停时右侧出现删除图标（×）
- 点击后弹出确认对话框："确定删除该会话？"
- 批量删除弹出："确定删除选中的 N 个会话？"

**重命名**
- 每个会话项悬停时标题旁出现铅笔图标
- 点击标题旁的铅笔图标，标题变为输入框
- Enter 保存，Esc 取消，焦点离开自动保存
- 调用更新标题接口

**置顶**
- 悬停菜单（或右键菜单）包含"置顶"/"取消置顶"选项
- 置顶后会话出现在列表最顶部，pinTime 更新

### 5.2 排序规则

```
1. pinned = true 的会话（按 pinTime 升序）
2. pinned = false 的会话（按 updatedTime 降序）
   - 今天
   - 昨天
   - 更早
```

### 5.3 导出入口
- 悬停菜单含"导出"选项，点击展开子菜单：Markdown / JSON
- 点击后浏览器下载对应文件

### 5.4 AI 生成标题（前端触发）
- 用户发送第一条消息后，触发 AI 生成标题请求
- 请求异步发送，不阻塞消息发送
- 标题生成后更新会话列表中的标题显示

## 6. 实现步骤

### Phase 1：后端基础（2~3 天）
1. 数据库字段变更
2. 删除 / 批量删除接口
3. 更新标题接口
4. 置顶接口
5. 导出接口（Markdown / JSON）
6. AI 生成标题异步逻辑

### Phase 2：前端交互（2~3 天）
1. 多选模式 + 批量删除 UI
2. 删除确认弹窗
3. 标题悬停编辑交互
4. 置顶按钮
5. 导出下拉菜单
6. 标题 AI 生成触发 + 更新

### Phase 3：联调测试（1 天）
1. 全流程联调
2. 边界情况处理
3. 已有功能回归测试

## 7. 风险与注意事项

- AI 生成标题需控制并发，避免同一会话多次生成
- 软删除后，查询会话列表时需过滤 is_delete=0
- 导出内容较大时需注意接口响应时间
- 标题编辑需防 XSS 攻击，长度限制在 50 字以内
