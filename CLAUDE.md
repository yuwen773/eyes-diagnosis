# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Spring Boot 3.5.6** backend (port 8081) + **Vue 3** frontend for Eye Diagnosis AI System using LangChain4j + DeepSeek.

## Build Commands

```bash
# Backend
mvn clean package          # Build
mvn spring-boot:run       # Run dev
mvn test -Dtest=...        # Run test

# Frontend (in frontend/)
npm install                # Install deps
npm run dev                # Dev server (port 5173)
npm run build              # Production build
```

## Architecture

**Backend**: Controller → Service → Mapper (MyBatis Plus)
- `controller/` HTTP请求, `service/` 业务逻辑, `mapper/` 数据库, `model/entity| dto| vo/` 数据模型

**Frontend**: Vue 3 + Vite + TypeScript + Ant Design Vue + Pinia + Vue Router
- `src/api/` API客户端, `src/stores/` 状态管理, `src/pages/` 路由页面, `src/components/` 组件

## API Patterns

`BaseResponse`: `{"code": 0, "data": {...}, "msg": "ok"}` (code 0=成功)

| Controller | Base Path |
|------------|-----------|
| UserController | `/api/user/*` |
| DiagnosisController | `/api/diagnosis/*` |
| NewsController | `/api/news/*` |
| ChatSessionController | `/api/chat/*` |

**Auth**: `@AuthCheck(mustRole = "admin")` AOP拦截

## Key Config

| File | Purpose |
|------|---------|
| `application.yml` | 端口8081, context-path /api |
| `application-dev.yml` | 数据库/Redis/COS/LangChain4j配置 |
| `db/schema.sql` | 7张表 (t_user, t_diagnosis, t_news, t_chatSession等) |
| `prompt/diagnosis-system-prompt.txt` | AI诊断系统提示词 |

## Error Handling

`ErrorCode` enum (40000-50001) → `BusinessException` → `GlobalExceptionHandler` 统一返回 `BaseResponse`

## Tech Stack

MyBatis Plus 3.5.12 | LangChain4j 1.5.0-beta11 + DeepSeek | Redis + Spring Session | Tencent COS | Knife4j 4.4.0
