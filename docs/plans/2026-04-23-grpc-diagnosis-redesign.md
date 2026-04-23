# gRPC 诊断服务重构设计

## 背景

当前 Java 后端通过 HuTool HTTP 调用 Flask Python 服务进行眼底图像诊断。存在以下问题：
- `algorithm/` 目录冗余：Flask 自带用户系统/HTML 模板与 Spring Boot 架构重复
- HTTP+JSON 通信效率低，无超时/重试机制
- Python 端需要从 COS 下载图片，增加延迟

## 方案：gRPC + Python 精简 + 图片直传 + Hash 缓存

### 1. Proto 定义

```protobuf
syntax = "proto3";
package diagnosis;

option java_package = "com.csust.eyediagnosis.grpc";

message DiagnosisRequest {
  bytes image_data = 1;
  string image_format = 2;
}

message DiseasePrediction {
  string label = 1;
  double probability = 2;
}

message DiagnosisResponse {
  string predicted_label = 1;
  double probability = 2;
  int32 reliability_score = 3;
  string description = 4;
  repeated DiseasePrediction top_predictions = 5;
}

service DiagnosisService {
  rpc Diagnose(DiagnosisRequest) returns (DiagnosisResponse);
}
```

### 2. Python 端重构

**精简后目录结构：**
```
algorithm/
  eye_disease_model.py       -- 保留：核心模型类
  grpc_server.py              -- 新增：gRPC 服务端
  diagnosis.proto             -- 新增：协议定义
  requirements.txt            -- 更新：去掉 flask，加 grpcio/grpcio-tools
  models/                     -- 保留：模型权重
```

**删除：** `backend/` 整个目录、父级 `templates/`、`user_database.db`、`schema.sql`

**grpc_server.py 职责：**
- 加载 EyeDiseaseModel
- 实现 DiagnosisServicer：接收 image bytes → 临时文件 → predict() → 返回结果
- 包含 calculate_reliability() 逻辑（从 app.py 迁移）
- 监听 0.0.0.0:50051

### 3. Java 端集成

**新增依赖：** grpc-netty-shaded, grpc-protobuf, grpc-stub, protobuf-maven-plugin

**新增文件：**
- `src/main/proto/diagnosis.proto`
- `com.csust.eyediagnosis.grpc.DiagnosisGrpcClient` — gRPC 客户端封装

**修改文件：**
- `DiagnosisServiceImpl.doDiagnosis()` — 接收 MultipartFile bytes → 计算hash → gRPC 调用
- `DiagnosisController.doDiagnosis()` — 参数从 DiagnosisDTO 改为 MultipartFile
- `Diagnosis` 实体 — 新增 imageHash 字段
- `DiagnosisMapper` — 新增 hash 查询方法

**删除文件：** PythonConfig, PythonConstant

**配置：** GrpcConfig 替代 PythonConfig，配置 gRPC 地址

### 4. 图片 Hash 缓存

- 收到图片后计算 SHA-256 hash
- 查询 t_diagnosis 表是否已有相同 hash 的记录
- 命中则直接返回缓存结果，跳过 gRPC 调用
- 未命中则正常诊断，保存时一并写入 hash

**数据库变更：** t_diagnosis 新增 image_hash VARCHAR(64) + 唯一索引

### 5. 调用流程

```
前端上传图片 (MultipartFile)
  → Controller 接收
  → 计算 SHA-256 hash → 查数据库
    → 命中 → 返回缓存结果
    → 未命中 → gRPC 调用 Python
      → Python 推理返回结果
      → Java 翻译标签 + 推荐方案
      → 异步上传 COS
      → 保存诊断记录(含hash)
      → 返回 DiagnosisResultVO
```

### 6. 错误处理

| 场景 | 处理 |
|------|------|
| Python 服务不可达 | 3s 连接超时，返回"诊断服务暂时不可用" |
| 推理超时 | 10s 请求超时，返回友好错误 |
| 图片格式错误 | Java 端校验 + Python 端校验 |
| COS 上传失败 | 不影响诊断结果，日志记录后台重试 |

### 7. 改动清单

| 类型 | 文件 | 操作 |
|------|------|------|
| Proto | diagnosis.proto | 新增 |
| Python | grpc_server.py | 新增 |
| Python | requirements.txt | 更新 |
| Python | backend/, templates/, *.db | 删除 |
| Java | DiagnosisGrpcClient.java | 新增 |
| Java | GrpcConfig.java | 新增 |
| Java | DiagnosisServiceImpl.java | 修改 |
| Java | DiagnosisController.java | 修改 |
| Java | Diagnosis.java (entity) | 修改 |
| Java | DiagnosisMapper | 修改 |
| Java | PythonConfig, PythonConstant | 删除 |
| DB | t_diagnosis | DDL: +image_hash |
