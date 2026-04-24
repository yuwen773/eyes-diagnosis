# 眼科疾病智能诊断系统

## 项目简介
本项目是一个基于深度学习的眼科疾病诊断系统，通过分析眼底图像来识别8种常见的眼科疾病。系统采用EfficientNet-B4深度学习模型，通过迁移学习和模型优化，为医生提供辅助诊断支持。

## 系统架构

### 后端架构
- 深度学习模型：EfficientNet-B4
- 框架：PyTorch
- API服务：Flask
- 数据存储：CSV文件

### 前端架构
- 框架：Vue.js
- UI组件：Element Plus
- 图表库：ECharts

## 主要特点

### 1. 模型架构
- 使用EfficientNet-B4作为基础模型，相比传统ResNet50具有更好的特征提取能力
- 模型架构

  \- EfficientNet-B4（主模型）

  \- ResNet50（辅助模型）

  \- DenseNet121（辅助模型）

  \- 模型集成机制

### 2. 数据处理
- 实现了基础的图像预处理，包括尺寸调整和标准化
- 使用数据增强技术扩充训练样本，提高模型泛化能力
- 针对眼底图像特点，保留了关键的医学特征

### 3. 训练优化
- 使用学习率预热策略，提高模型训练的稳定性
- 实现了混合精度训练，加快训练速度
- 采用早停机制，防止模型过拟合
- 使用梯度裁剪，避免梯度爆炸问题

### 4. 实用功能
- 支持批量图像处理
- 提供详细的预测结果和置信度
- 可以保存和加载训练好的模型

### 5. Web界面功能
- 图像上传和预览
- 实时诊断结果展示
- 诊断报告导出
- 数据可视化展示

## 技术栈

##### 后端框架：Flask

##### 深度学习框架：PyTorch（CUDA 11.0+（GPU加速））

##### 其他依赖见requirements.txt

#### 前端环境
- HTML5
- CSS3
- JavaScript
-  Bootstrap 5

## 使用说明

### 1. 安装后端依赖
```bash
pip install -r requirements.txt
```

### 2. 安装前端依赖
```bash
cd frontend
npm install
```

### 3. 准备数据
将眼底图像按照以下结构放置：
```
data/
├── train/
│   ├── normal/
│   ├── amd/
│   ├── cataract/
│   └── ...
└── val/
    ├── normal/
    ├── amd/
    ├── cataract/
    └── ...
```

### 4. 训练模型
```bash
python train_model.py --model efficientnet_b4 --epochs 50 --batch_size 32
```

### 5. 启动后端服务
```bash
python app.py
```

### 6. 启动前端服务
```bash
cd frontend
npm run serve
```

### 7. 评估模型
```bash
python evaluate_model.py --model_path models/best_model.pth --test_data data/val_dataset.csv --batch_size 32
```

## 项目结构
```
├── backend/                # 后端代码
│   ├── app.py             # Flask应用主程序
│   ├── models/            # 模型文件
├── templates/           # HTML模板
│   ├── index.html    # 主页
│   ├── login.html    # 登录页
│   ├── register.html # 注册页
│   ├── history.html  # 历史记录页
│   └── result.html   # 诊断结果页
├── dataset/                  # 数据集目录
├── models/                # 模型保存目录
├── eye_disease_model.py   # 模型定义
├── train_model.py        # 训练脚本
├── evaluate_model.py     # 评估脚本
├── prepare_data.py       # 数据准备脚本
└── requirements.txt      # 项目依赖
```

## 实际效果
- 在验证集上达到80%以上的准确率
- 单张图像处理时间小于100ms
- 支持8种常见眼科疾病的识别
- Web界面响应时间<1s

## 注意事项
本系统仅作为辅助诊断工具，不能替代专业医生的诊断



