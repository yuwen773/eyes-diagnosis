# Algorithm - 眼科疾病图像分类服务

基于 EfficientNet-B4 的眼底图像分类服务，支持 gRPC 和 MCP 两种调用方式，可识别 8 种常见眼科疾病。

## 技术栈

| 技术 | 用途 |
|------|------|
| PyTorch | 深度学习框架 |
| EfficientNet-B4 | 主分类模型（也支持 ResNet50、DenseNet121、ViT 等） |
| gRPC + Protobuf | 与 Java 后端通信 |
| MCP (Model Context Protocol) | 供 AI Agent 调用的工具服务 |

## 疾病分类

| 标签 | 疾病 | 说明 |
|------|------|------|
| `normal` | 正常 | 正常眼底 |
| `amd` | AMD | 年龄相关性黄斑变性 |
| `cataract` | 白内障 | 白内障 |
| `diabetes` | 糖尿病 | 糖尿病视网膜病变 |
| `glaucoma` | 青光眼 | 青光眼 |
| `hypertension` | 高血压 | 高血压视网膜病变 |
| `myopia` | 近视 | 病理性近视 |
| `other` | 其他 | 其他疾病 |

## 目录结构

```
algorithm/
├── eye_disease_model.py       # 模型定义（EfficientNet-B4 等）
├── grpc_server.py             # gRPC 推理服务
├── run_mcp_server.py          # MCP 服务入口
├── train_model.py             # 模型训练脚本
├── evaluate_model.py          # 模型评估脚本
├── prepare_data.py            # 数据集准备（CSV 分割）
├── generate_proto.py          # 从后端唯一 Proto 源生成 Python 绑定
├── diagnosis_pb2.py           # 自动生成的 Protobuf 代码
├── diagnosis_pb2_grpc.py      # 自动生成的 gRPC 存根
├── requirements.txt           # Python 依赖
├── mcp_server/                # MCP 服务模块
│   ├── config.py              # 配置（环境变量）
│   ├── server.py              # FastMCP 服务器定义
│   ├── tools.py               # 模型加载与推理编排
│   ├── image_handler.py       # 图片输入解析（URL/文件/Base64）
│   ├── diagnosis.py           # 诊断结果构建与可靠性评分
│   └── tests/                 # 单元测试
│       ├── test_config.py
│       ├── test_diagnosis.py
│       └── test_image_handler.py
└── models/                    # 模型权重文件（gitignored，需自行准备）
```

## 模型架构

### EfficientNet-B4（主模型）

- **输入尺寸**：380 x 380
- **分类头**：Dropout(0.3) → Linear → BatchNorm1d(512) → ReLU → Dropout(0.4) → Linear(8)
- **预训练权重**：ImageNet

### 训练特性

- 混合精度训练（`torch.cuda.amp`）
- 余弦退火学习率 + 2 epoch 线性预热
- AdamW 优化器（weight decay）
- 标签平滑（0.1）+ 梯度裁剪（max norm 1.0）
- 早停（patience=10）
- 数据增强：翻转、旋转、颜色抖动、仿射变换、透视变换、高斯模糊、随机擦除
- 保存最优 loss 和最优 accuracy 两个检查点

## 两种服务模式

### gRPC 服务

供 Java 后端直接调用，进行图像分类。

```bash
python generate_proto.py       # 从 ../src/main/proto/diagnosis.proto 生成绑定
python grpc_server.py    # 监听 0.0.0.0:50051
```

**接口定义**（`diagnosis.proto`）：

```protobuf
service DiagnosisService {
  rpc Diagnose(DiagnosisRequest) returns (DiagnosisResponse);
}

message DiagnosisRequest {
  bytes image_data = 1;
  string image_format = 2;
}

message DiagnosisResponse {
  string predicted_label = 1;
  double probability = 2;
  int32 reliability_score = 3;
  string description = 4;
  repeated DiseasePrediction top_predictions = 5;
}
```

**返回内容**：预测标签、概率（0-100）、可靠性评分（50-95）、中文描述、Top-3 预测。

### MCP 服务

供 AI Agent 通过 MCP 协议调用。

```bash
python run_mcp_server.py    # Streamable HTTP 传输
```

**暴露工具**：`eye_disease_diagnosis(image_input: str)`

输入支持三种格式：
- HTTP/HTTPS URL（自动下载）
- 本地文件路径
- Base64 编码字符串

返回 JSON 格式的诊断结果。

## 环境变量配置

MCP 服务支持以下环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_HOST` | `0.0.0.0` | 服务绑定地址 |
| `MCP_PORT` | `8000` | 服务端口 |
| `MODEL_PATH` | 自动搜索 | 模型权重文件路径 |
| `MODEL_ARCH` | `efficientnet_b4` | 模型架构 |
| `DEVICE` | 自动检测 | `cuda` 或 `cpu` |
| `NUM_CLASSES` | `8` | 分类数 |
| `LOG_LEVEL` | `INFO` | 日志级别 |

## 安装与运行

### 安装依赖

```bash
pip install -r requirements.txt
```

核心依赖：`torch`, `torchvision`, `grpcio`, `grpcio-tools`, `httpx`, `mcp[cli]`

训练额外依赖：`scikit-learn`, `pandas`, `matplotlib`, `seaborn`

### 准备模型权重

将训练好的 `.pth` 文件放到以下路径之一：
1. `models/efficientnet_b4_<timestamp>/best_acc_eye_disease_model.pth`
2. `models/best_acc_eye_disease_model.pth`
3. `models/best_eye_disease_model.pth`

或通过 `MODEL_PATH` 环境变量指定。

### 数据准备

```bash
# 将数据集按类别存放
dataset/
├── normal/
├── amd/
├── cataract/
├── diabetes/
├── glaucoma/
├── hypertension/
├── myopia/
└── other/

# 生成训练/验证 CSV 分割
python prepare_data.py
```

### 训练模型

```bash
python train_model.py --model efficientnet_b4 --epochs 50 --batch_size 32
# 可选：--freeze（两阶段训练）, --sample-ratio（子集训练）
```

### 评估模型

```bash
python evaluate_model.py --model_path models/best_acc_eye_disease_model.pth --test_data data/val_dataset.csv
```

输出：混淆矩阵、ROC 曲线、分类分布图。

## 可靠性评分

根据 Top-1 和 Top-2 概率差值计算：

| 差值 | 评分 |
|------|------|
| ≥ 0.5 | 95 |
| ≥ 0.3 | 85 |
| ≥ 0.2 | 75 |
| ≥ 0.1 | 65 |
| < 0.1 | 50 |

## 注意事项

本系统仅作为辅助诊断工具，不能替代专业医生的诊断。
