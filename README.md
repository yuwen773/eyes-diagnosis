# Eye Diagnosis AI System - 眼科智能诊断系统

基于深度学习的眼科疾病智能诊断系统。通过分析眼底图像，利用 EfficientNet-B4 模型识别 8 种常见眼科疾病，并提供 AI 智能问诊和知识库检索功能。

## 系统架构

```
┌─────────────┐     HTTP/REST      ┌──────────────────┐     gRPC      ┌──────────────────┐
│   Frontend   │ ◄──────────────► │   Backend (Java)  │ ◄──────────► │  Algorithm (Py)  │
│  Vue 3 + TS  │     SSE Stream    │   Spring Boot 3   │    :50051     │  EfficientNet-B4 │
│   :5173      │                   │     :8081/api      │              │     :50051       │
└─────────────┘                   └──────────────────┘              └──────────────────┘
                                         │  │  │
                                         │  │  └────► ChromaDB (向量数据库 :8000)
                                         │  └──────► Redis (会话 + 缓存 :6379)
                                         └────────► MySQL (主数据库 :3306)
                                                    DashScope (LLM + 视觉 + 向量)
                                                    腾讯云 COS (文件存储)
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Java 21, Spring Boot 3.5.6, Spring AI 1.1.2, MyBatis Plus 3.5.12 |
| 前端 | Vue 3, TypeScript, Vite 5, Ant Design Vue 4, Tailwind CSS v4, Pinia |
| 算法 | Python, PyTorch, EfficientNet-B4, gRPC, MCP (Model Context Protocol) |
| 数据库 | MySQL 8, Redis, ChromaDB |
| AI 服务 | 阿里云 DashScope (Qwen LLM + Qwen-VL-Plus 视觉模型 + 文本嵌入) |
| 存储 | 腾讯云 COS |

## 功能特性

- **图像诊断**：上传眼底图像，AI 自动识别 8 种眼科疾病（正常、AMD、白内障、糖尿病视网膜病变、青光眼、高血压视网膜病变、近视、其他）
- **AI 智能问诊**：基于 Spring AI ReactAgent 的流式对话，支持工具调用（图像分析、文档检索）
- **知识库 RAG**：上传文档（PDF/MD/TXT/DOCX），自动解析、分块、向量化，支持语义检索
- **MCP 集成**：支持用户配置外部 MCP 工具服务器（STDIO/SSE/HTTP），动态扩展 Agent 能力
- **后台管理**：用户管理、诊断记录管理、新闻管理、知识库管理、数据分析仪表盘

## 快速开始

### 环境要求

- Java 21+
- Node.js 18+
- Python 3.10+
- MySQL 8.0+
- Redis 7+
- Docker（用于 ChromaDB）

### 1. 启动基础设施

```bash
# 启动 ChromaDB 向量数据库
docker-compose up -d
```

### 2. 配置后端

```bash
# 创建本地配置（不提交到 Git）
cp src/main/resources/application-dev.yml src/main/resources/application-local.yml
# 编辑 application-local.yml，填入数据库、Redis、DashScope、COS 等配置
```

### 3. 启动后端

```bash
mvn clean package
mvn spring-boot:run    # 启动于 http://localhost:8081/api
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev            # 启动于 http://localhost:5173
```

### 5. 启动算法服务

```bash
cd algorithm
pip install -r requirements.txt

# 方式一：gRPC 服务（供后端直接调用）
python grpc_server.py  # 监听 :50051

# 方式二：MCP 服务（供 Agent 调用）
python run_mcp_server.py
```

## 项目结构

```
eye-diagnosis/
├── src/                    # Java 后端（Spring Boot）
│   └── main/java/com/csust/eyediagnosis/
│       ├── agent/          # AI Agent 系统（ReactAgent、MCP、RAG、工具）
│       ├── controller/     # REST 控制器（6 个）
│       ├── service/        # 业务逻辑层
│       ├── mapper/         # MyBatis Plus 数据访问层
│       ├── model/          # 实体、DTO、VO、枚举
│       ├── grpc/           # gRPC 客户端（调用 Python 算法服务）
│       ├── config/         # Spring 配置类
│       └── ...
├── frontend/               # Vue 3 前端
│   └── src/
│       ├── pages/          # 页面组件
│       ├── components/     # 通用组件
│       ├── stores/         # Pinia 状态管理
│       ├── api/            # API 调用层（OpenAPI 自动生成）
│       ├── composables/    # 组合式函数
│       └── ...
├── algorithm/              # Python 算法服务
│   ├── eye_disease_model.py    # EfficientNet-B4 模型定义
│   ├── grpc_server.py          # gRPC 推理服务
│   ├── mcp_server/             # MCP 工具服务
│   ├── train_model.py          # 模型训练脚本
│   └── diagnosis.proto         # Protobuf 定义
├── docs/                   # 设计文档
├── docker-compose.yml      # ChromaDB 服务
└── pom.xml                 # Maven 构建配置
```

## API 文档

后端启动后访问 Knife4j 文档：`http://localhost:8081/api/swagger-ui.html`

| 模块 | 路径前缀 | 说明 |
|------|----------|------|
| UserController | `/api/user/*` | 用户认证、CRUD |
| DiagnosisController | `/api/diagnosis/*` | 图像上传、gRPC 诊断、分页查询 |
| AgentController | `/api/agent/*` | SSE 流式对话、会话管理 |
| McpServerController | `/api/mcp/*` | MCP 服务器 CRUD |
| KnowledgeBaseController | `/api/knowledge/*` | RAG 文档管理 |
| NewsController | `/api/news/*` | 健康资讯 CRUD |

## 数据库

MySQL 数据库名 `diagnosis`，建表脚本位于 `src/main/resources/db/schema.sql`。

核心表：`t_user`、`t_diagnosis`、`t_agent_session`、`t_agent_message`、`t_mcp_server`、`t_knowledge_document`、`t_news`。

## 许可证

本项目由长沙理工大学开发，仅供学习和研究使用。本系统仅作为辅助诊断工具，不能替代专业医生的诊断。
