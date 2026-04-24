import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image
import pandas as pd
import numpy as np
import os
import matplotlib.pyplot as plt
from sklearn.metrics import confusion_matrix, classification_report
import seaborn as sns
import random
from torch.optim.lr_scheduler import CosineAnnealingLR

# 定义眼科疾病类别
disease_categories = {
    0: 'normal',
    1: 'amd',        # 年龄相关性黄斑变性
    2: 'cataract',   # 白内障
    3: 'diabetes',   # 糖尿病视网膜病变
    4: 'glaucoma',   # 青光眼
    5: 'hypertension', # 高血压视网膜病变
    6: 'myopia',     # 病理性近视
    7: 'other'       # 其他疾病
}

# 设置随机种子以确保结果可重现
def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False

# 定义数据集类
class EyeDiseaseDataset(Dataset):
    def __init__(self, csv_file, transform=None):
        """
        Args:
            csv_file (string): 包含图像路径和标签的CSV文件路径
            transform (callable, optional): 应用于图像的转换
        """
        self.data_frame = pd.read_csv(csv_file)
        self.transform = transform
        
    def __len__(self):
        return len(self.data_frame)
    
    def __getitem__(self, idx):
        img_path = self.data_frame.iloc[idx, 0]
        # 修正路径分隔符 - 将Windows风格的反斜杠替换为Linux兼容的正斜杠
        img_path = img_path.replace('\\', '/')
        
        # 检查文件是否存在，如果不存在则给出详细错误
        if not os.path.exists(img_path):
            raise FileNotFoundError(f"找不到图像文件: {img_path}")
            
        image = Image.open(img_path).convert('RGB')
        label = self.data_frame.iloc[idx, 1]
        
        if self.transform:
            image = self.transform(image)
            
        return image, label

# 定义模型类
class EyeDiseaseModel:
    def __init__(self, num_classes=8, pretrained=True, learning_rate=0.001, model_name='efficientnet_b4'):
        """
        初始化眼科疾病模型
        Args:
            num_classes: 分类类别数
            pretrained: 是否使用预训练模型
            learning_rate: 学习率
            model_name: 模型名称，支持'efficientnet_b0'到'efficientnet_b7','resnet50','resnet101','vit_b_16'等
        """
        # 设置随机种子
        set_seed()
        
        # 设置设备
        self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        print(f"使用设备: {self.device}")
        
        # 模型尺寸对应表
        self.model_image_size = {
            'efficientnet_b0': 224,
            'efficientnet_b1': 240,
            'efficientnet_b2': 260,
            'efficientnet_b3': 300,
            'efficientnet_b4': 380,
            'efficientnet_b5': 456,
            'efficientnet_b6': 528,
            'efficientnet_b7': 600,
            'resnet50': 224,
            'resnet101': 224,
            'vit_b_16': 224,
            'vit_l_16': 224,
        }
        
        # 选择并加载预训练模型
        self.model_name = model_name
        self.build_model(num_classes, pretrained)
        
        # 将模型移动到设备
        self.model = self.model.to(self.device)
        
        # 定义损失函数和优化器 - 使用带权重衰减的AdamW
        self.criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
        self.optimizer = optim.AdamW(self.model.parameters(), lr=learning_rate, weight_decay=1e-4)
        
        # 定义学习率调度器 - 使用更有效的学习率调度策略
        self.scheduler = CosineAnnealingLR(self.optimizer, T_max=20, eta_min=learning_rate/100)
        
        # 获取当前模型的推荐图像尺寸
        img_size = self.get_model_image_size()
        
        # 定义数据转换 - 使用更强的数据增强
        self.data_transforms = {
            'train': transforms.Compose([
                transforms.Resize((img_size, img_size)),  # 调整为模型推荐的输入大小
                transforms.RandomHorizontalFlip(p=0.5),
                transforms.RandomVerticalFlip(p=0.3),
                transforms.RandomRotation(30),
                transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1),
                transforms.RandomAffine(degrees=10, translate=(0.1, 0.1), scale=(0.9, 1.1)),
                transforms.RandomPerspective(distortion_scale=0.2, p=0.3),
                transforms.RandomGrayscale(p=0.05),
                transforms.RandomApply([transforms.GaussianBlur(3, sigma=(0.1, 2.0))], p=0.2),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
                transforms.RandomErasing(p=0.2, scale=(0.02, 0.1)),
            ]),
            'val': transforms.Compose([
                transforms.Resize((img_size, img_size)),  # 调整为模型推荐的输入大小
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
            ]),
        }

    def build_model(self, num_classes, pretrained):
        """构建指定的模型架构"""
        try:
            # 尝试使用新版本的PyTorch加载模型
            if self.model_name.startswith('efficientnet'):
                # EfficientNet系列
                model_func = getattr(models, self.model_name)
                weights_param = 'DEFAULT' if pretrained else None
                self.model = model_func(weights=weights_param)
                # 修改分类器 - 增加dropout和一个额外的全连接层
                num_ftrs = self.model.classifier[1].in_features
                self.model.classifier = nn.Sequential(
                    nn.Dropout(p=0.3),  # 添加dropout以减少过拟合
                    nn.Linear(num_ftrs, 512),
                    nn.BatchNorm1d(512),
                    nn.ReLU(),
                    nn.Dropout(p=0.4),
                    nn.Linear(512, num_classes)
                )
            elif self.model_name.startswith('resnet'):
                # ResNet系列
                model_func = getattr(models, self.model_name)
                weights_param = 'DEFAULT' if pretrained else None
                self.model = model_func(weights=weights_param)
                # 修改分类器
                num_ftrs = self.model.fc.in_features
                self.model.fc = nn.Linear(num_ftrs, num_classes)
            elif self.model_name.startswith('vit'):
                # Vision Transformer系列
                model_func = getattr(models, self.model_name)
                weights_param = 'DEFAULT' if pretrained else None
                self.model = model_func(weights=weights_param)
                # 修改分类器
                num_ftrs = self.model.heads.head.in_features
                self.model.heads.head = nn.Linear(num_ftrs, num_classes)
            else:
                raise ValueError(f"不支持的模型: {self.model_name}")
            
        except (AttributeError, ImportError) as e:
            try:
                # 尝试兼容旧版本的PyTorch
                if self.model_name.startswith('efficientnet'):
                    # 尝试使用中间版本的PyTorch
                    model_weights_name = f"{self.model_name.replace('_', '_').title().replace('_', '')}_Weights"
                    weights_class = getattr(models, model_weights_name)
                    model_func = getattr(models, self.model_name)
                    self.model = model_func(weights=weights_class.DEFAULT if pretrained else None)
                    # 修改分类器 - 增加dropout和一个额外的全连接层
                    num_ftrs = self.model.classifier[1].in_features
                    self.model.classifier = nn.Sequential(
                        nn.Dropout(p=0.3),  # 添加dropout以减少过拟合
                        nn.Linear(num_ftrs, 512),
                        nn.BatchNorm1d(512),
                        nn.ReLU(),
                        nn.Dropout(p=0.4),
                        nn.Linear(512, num_classes)
                    )
                elif self.model_name.startswith('resnet'):
                    # 尝试使用中间版本的PyTorch
                    model_weights_name = f"{self.model_name.title()}_Weights"
                    weights_class = getattr(models, model_weights_name)
                    model_func = getattr(models, self.model_name)
                    self.model = model_func(weights=weights_class.DEFAULT if pretrained else None)
                    # 修改分类器
                    num_ftrs = self.model.fc.in_features
                    self.model.fc = nn.Linear(num_ftrs, num_classes)
                elif self.model_name.startswith('vit'):
                    # 尝试使用中间版本的PyTorch
                    model_weights_name = f"{self.model_name.replace('_', '').title()}_Weights"
                    weights_class = getattr(models, model_weights_name)
                    model_func = getattr(models, self.model_name)
                    self.model = model_func(weights=weights_class.DEFAULT if pretrained else None)
                    # 修改分类器
                    num_ftrs = self.model.heads.head.in_features
                    self.model.heads.head = nn.Linear(num_ftrs, num_classes)
                else:
                    raise ValueError(f"不支持的模型: {self.model_name}")
            except:
                # 尝试使用最旧版本的PyTorch
                if self.model_name.startswith('efficientnet'):
                    model_func = getattr(models, self.model_name)
                    self.model = model_func(pretrained=pretrained)
                    # 修改分类器 - 增加dropout和一个额外的全连接层
                    num_ftrs = self.model.classifier[1].in_features
                    self.model.classifier = nn.Sequential(
                        nn.Dropout(p=0.3),  # 添加dropout以减少过拟合
                        nn.Linear(num_ftrs, 512),
                        nn.BatchNorm1d(512),
                        nn.ReLU(),
                        nn.Dropout(p=0.4),
                        nn.Linear(512, num_classes)
                    )
                elif self.model_name.startswith('resnet'):
                    model_func = getattr(models, self.model_name)
                    self.model = model_func(pretrained=pretrained)
                    # 修改分类器
                    num_ftrs = self.model.fc.in_features
                    self.model.fc = nn.Linear(num_ftrs, num_classes)
                elif self.model_name.startswith('vit'):
                    # 最旧版本可能不支持ViT，直接改用ResNet50
                    print(f"警告: 当前PyTorch版本可能不支持{self.model_name}，改用resnet50")
                    self.model_name = 'resnet50'
                    self.model = models.resnet50(pretrained=pretrained)
                    num_ftrs = self.model.fc.in_features
                    self.model.fc = nn.Linear(num_ftrs, num_classes)
                else:
                    raise ValueError(f"不支持的模型: {self.model_name}")
                    
        print(f"使用{self.model_name}模型")
        return self.model
    
    def get_model_image_size(self):
        """获取当前模型的推荐图像尺寸"""
        if self.model_name in self.model_image_size:
            return self.model_image_size[self.model_name]
        else:
            # 默认使用224x224
            return 224
    
    def load_data(self, train_csv, val_csv, batch_size=32):
        """
        加载训练和验证数据
        """
        # 创建数据集
        train_dataset = EyeDiseaseDataset(train_csv, transform=self.data_transforms['train'])
        val_dataset = EyeDiseaseDataset(val_csv, transform=self.data_transforms['val'])
        
        # 创建数据加载器 - 增加批量大小和工作线程
        self.train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, num_workers=4, pin_memory=True)
        self.val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, num_workers=4, pin_memory=True)
        
        print(f"训练集大小: {len(train_dataset)}")
        print(f"验证集大小: {len(val_dataset)}")
        
        return self.train_loader, self.val_loader
    
    def train(self, epochs=15, save_dir='models'):
        """
        训练模型 - 使用混合精度训练加速和更先进的训练策略
        """
        # 确保保存目录存在
        os.makedirs(save_dir, exist_ok=True)
        
        # 初始化跟踪最佳模型的变量
        best_val_loss = float('inf')
        best_val_acc = 0.0
        best_model_path = os.path.join(save_dir, 'best_eye_disease_model.pth')
        best_acc_model_path = os.path.join(save_dir, 'best_acc_eye_disease_model.pth')
        
        # 早停参数 - 增加耐心值
        patience = 10
        no_improve_epochs = 0
        
        # 获取初始学习率
        init_lr = self.optimizer.param_groups[0]['lr']
        
        # 初始化记录训练过程的列表
        train_losses = []
        val_losses = []
        train_accs = []
        val_accs = []
        
        # 使用混合精度训练
        try:
            from torch.cuda.amp import GradScaler, autocast
            scaler = GradScaler()
            use_amp = True
            print("启用自动混合精度训练")
        except ImportError:
            use_amp = False
            print("不支持自动混合精度训练")
        
        # 学习率热身阶段
        warmup_epochs = 2
        
        for epoch in range(epochs):
            print(f"Epoch {epoch+1}/{epochs}")
            print('-' * 10)
            
            # 热身学习率调整
            if epoch < warmup_epochs:
                # 线性增加学习率从 init_lr/10 到 init_lr
                lr = init_lr / 10 + (init_lr - init_lr / 10) * epoch / warmup_epochs
                for param_group in self.optimizer.param_groups:
                    param_group['lr'] = lr
                print(f"热身学习率: {lr:.6f}")
            
            # 训练阶段
            self.model.train()
            running_loss = 0.0
            running_corrects = 0
            
            for inputs, labels in self.train_loader:
                inputs = inputs.to(self.device)
                labels = labels.to(self.device)
                
                # 清零梯度
                self.optimizer.zero_grad()
                
                # 混合精度训练
                if use_amp:
                    with autocast():
                        # 前向传播
                        outputs = self.model(inputs)
                        _, preds = torch.max(outputs, 1)
                        loss = self.criterion(outputs, labels)
                    
                    # 反向传播和优化
                    scaler.scale(loss).backward()
                    # 梯度裁剪，防止梯度爆炸
                    scaler.unscale_(self.optimizer)
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                    scaler.step(self.optimizer)
                    scaler.update()
                else:
                    # 前向传播
                    outputs = self.model(inputs)
                    _, preds = torch.max(outputs, 1)
                    loss = self.criterion(outputs, labels)
                    
                    # 反向传播和优化
                    loss.backward()
                    # 梯度裁剪，防止梯度爆炸
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                    self.optimizer.step()
                
                # 统计
                running_loss += loss.item() * inputs.size(0)
                running_corrects += torch.sum(preds == labels.data)
            
            epoch_loss = running_loss / len(self.train_loader.dataset)
            epoch_acc = running_corrects.double() / len(self.train_loader.dataset)
            train_losses.append(epoch_loss)
            train_accs.append(epoch_acc.item())
            
            print(f"训练损失: {epoch_loss:.4f} 准确率: {epoch_acc:.4f}")
            
            # 验证阶段
            val_metrics = self.evaluate(self.val_loader, is_validation=True)
            epoch_loss = val_metrics['loss']
            epoch_acc = val_metrics['accuracy']
            val_losses.append(epoch_loss)
            val_accs.append(epoch_acc)
            
            print(f"验证损失: {epoch_loss:.4f} 准确率: {epoch_acc:.4f}")
            print(f"验证F1分数: {val_metrics['macro_f1']:.4f}")
            
            # 在热身期后使用学习率调度器
            if epoch >= warmup_epochs:
                self.scheduler.step()
            
            current_lr = self.optimizer.param_groups[0]['lr']
            print(f"当前学习率: {current_lr:.6f}")
            
            # 保存最佳模型 (基于损失)
            improved = False
            if epoch_loss < best_val_loss:
                best_val_loss = epoch_loss
                torch.save(self.model.state_dict(), best_model_path)
                print(f"保存了具有最佳验证损失的模型: {best_val_loss:.4f}")
                improved = True
            
            # 保存最佳准确率模型
            if epoch_acc > best_val_acc:
                best_val_acc = epoch_acc
                torch.save(self.model.state_dict(), best_acc_model_path)
                print(f"保存了具有最佳验证准确率的模型: {best_val_acc:.4f}")
                improved = True
            
            # 早停检查
            if not improved:
                no_improve_epochs += 1
                if no_improve_epochs >= patience:
                    print(f"早停: {patience}轮内未改善验证性能")
                    break
            else:
                no_improve_epochs = 0
        
        # 绘制训练过程
        self._plot_training(train_losses, val_losses, train_accs, val_accs, save_dir)
        
        # 返回最佳模型路径
        return best_model_path
    
    def _plot_training(self, train_losses, val_losses, train_accs, val_accs, save_dir):
        """
        绘制训练和验证的损失与准确率曲线
        """
        plt.figure(figsize=(12, 5))
        
        # 绘制损失曲线
        plt.subplot(1, 2, 1)
        plt.plot(train_losses, label='训练损失')
        plt.plot(val_losses, label='验证损失')
        plt.xlabel('轮次')
        plt.ylabel('损失')
        plt.title('训练和验证损失')
        plt.legend()
        
        # 绘制准确率曲线
        plt.subplot(1, 2, 2)
        plt.plot(train_accs, label='训练准确率')
        plt.plot(val_accs, label='验证准确率')
        plt.xlabel('轮次')
        plt.ylabel('准确率')
        plt.title('训练和验证准确率')
        plt.legend()
        
        plt.tight_layout()
        plt.savefig(os.path.join(save_dir, 'training_curves.png'))
        plt.close()
    
    def evaluate(self, data_loader, is_validation=False):
        """
        评估模型性能
        """
        self.model.eval()
        running_loss = 0.0
        running_corrects = 0
        all_labels = []
        all_preds = []
        
        with torch.no_grad():
            for inputs, labels in data_loader:
                inputs = inputs.to(self.device)
                labels = labels.to(self.device)
                
                # 前向传播
                outputs = self.model(inputs)
                _, preds = torch.max(outputs, 1)
                loss = self.criterion(outputs, labels)
                
                # 收集预测和标签
                all_labels.extend(labels.cpu().numpy())
                all_preds.extend(preds.cpu().numpy())
                
                # 统计
                running_loss += loss.item() * inputs.size(0)
                running_corrects += torch.sum(preds == labels.data)
        
        epoch_loss = running_loss / len(data_loader.dataset)
        epoch_acc = running_corrects.double() / len(data_loader.dataset)
        
        # 如果是验证阶段，只返回基本指标
        if is_validation:
            from sklearn.metrics import f1_score
            macro_f1 = f1_score(all_labels, all_preds, average='macro')
            return {
                'loss': epoch_loss,
                'accuracy': epoch_acc.item(),
                'macro_f1': macro_f1
            }
        
        # 计算混淆矩阵和分类报告
        from sklearn.metrics import confusion_matrix, classification_report
        cm = confusion_matrix(all_labels, all_preds)
        report = classification_report(all_labels, all_preds, 
                                      target_names=[disease_categories[i] for i in range(len(disease_categories))],
                                      output_dict=True)
        
        # 绘制混淆矩阵
        plt.figure(figsize=(12, 10))
        sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                   xticklabels=[disease_categories[i] for i in range(len(disease_categories))],
                   yticklabels=[disease_categories[i] for i in range(len(disease_categories))])
        plt.ylabel('真实标签')
        plt.xlabel('预测标签')
        plt.title('混淆矩阵')
        plt.tight_layout()
        plt.savefig('confusion_matrix.png')
        plt.close()
        
        return epoch_acc.item(), report, cm
    
    def load_model(self, model_path):
        """
        加载预训练模型
        """
        try:
            self.model.load_state_dict(torch.load(model_path, map_location=self.device))
            self.model.eval()
            print(f"从 {model_path} 加载模型")
        except Exception as e:
            print(f"加载模型时出错: {str(e)}")
            print("使用未训练的模型继续...")
    
    def predict(self, image_path):
        """
        对单张图像进行预测
        """
        # 加载并预处理图像
        image = Image.open(image_path).convert('RGB')
        transform = self.data_transforms['val']
        image_tensor = transform(image).unsqueeze(0).to(self.device)
        
        # 进行预测
        self.model.eval()
        with torch.no_grad():
            outputs = self.model(image_tensor)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)[0]
            predicted_class = torch.argmax(probabilities).item()
        
        # 获取预测结果和概率
        predicted_label = disease_categories[predicted_class]
        probability = probabilities[predicted_class].item()
        
        # 获取所有类别的概率
        all_probs = {}
        for i, prob in enumerate(probabilities):
            all_probs[disease_categories[i]] = prob.item()
        
        return {
            'predicted_label': predicted_label,
            'probability': probability,
            'all_probabilities': all_probs
        }