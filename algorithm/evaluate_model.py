import os
import torch
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from torch.utils.data import DataLoader
from torchvision import transforms
from PIL import Image
from sklearn.metrics import confusion_matrix, classification_report, roc_curve, auc
from eye_disease_model import EyeDiseaseModel, EyeDiseaseDataset
import argparse

def load_model(model_path, device):
    """加载训练好的模型"""
    model = EyeDiseaseModel()
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.to(device)
    model.eval()
    return model

def evaluate_model(model, test_loader, device):
    """评估模型性能"""
    all_preds = []
    all_labels = []
    all_probs = []
    correct = 0
    total = 0
    
    with torch.no_grad():
        for images, labels in test_loader:
            images = images.to(device)
            labels = labels.to(device)
            
            outputs = model(images)
            _, predicted = torch.max(outputs.data, 1)
            probs = torch.softmax(outputs, dim=1)
            
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
            
            all_preds.extend(predicted.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())
            all_probs.extend(probs.cpu().numpy())
    
    accuracy = 100 * correct / total
    return accuracy, np.array(all_preds), np.array(all_labels), np.array(all_probs)

def plot_confusion_matrix(y_true, y_pred, classes):
    """绘制混淆矩阵"""
    cm = confusion_matrix(y_true, y_pred)
    plt.figure(figsize=(10, 8))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=classes, yticklabels=classes)
    plt.title('混淆矩阵')
    plt.ylabel('真实标签')
    plt.xlabel('预测标签')
    plt.tight_layout()
    plt.savefig('confusion_matrix.png')
    plt.close()

def plot_roc_curves(y_true, y_probs, classes):
    """绘制ROC曲线"""
    plt.figure(figsize=(10, 8))
    for i in range(len(classes)):
        fpr, tpr, _ = roc_curve(y_true == i, y_probs[:, i])
        roc_auc = auc(fpr, tpr)
        plt.plot(fpr, tpr, label=f'{classes[i]} (AUC = {roc_auc:.2f})')
    
    plt.plot([0, 1], [0, 1], 'k--')
    plt.xlim([0.0, 1.0])
    plt.ylim([0.0, 1.05])
    plt.xlabel('假阳性率')
    plt.ylabel('真阳性率')
    plt.title('各类别的ROC曲线')
    plt.legend(loc="lower right")
    plt.tight_layout()
    plt.savefig('roc_curves.png')
    plt.close()

def plot_class_distribution(y_true, y_pred, classes):
    """绘制类别分布图"""
    plt.figure(figsize=(12, 6))
    
    # 真实分布
    plt.subplot(1, 2, 1)
    sns.countplot(x=y_true)
    plt.title('真实类别分布')
    plt.xticks(range(len(classes)), classes, rotation=45)
    
    # 预测分布
    plt.subplot(1, 2, 2)
    sns.countplot(x=y_pred)
    plt.title('预测类别分布')
    plt.xticks(range(len(classes)), classes, rotation=45)
    
    plt.tight_layout()
    plt.savefig('class_distribution.png')
    plt.close()

def main():
    parser = argparse.ArgumentParser(description='评估眼科疾病诊断模型')
    parser.add_argument('--model_path', type=str, required=True, help='模型文件路径')
    parser.add_argument('--test_data', type=str, required=True, help='测试数据CSV文件路径')
    parser.add_argument('--batch_size', type=int, default=32, help='批次大小')
    args = parser.parse_args()
    
    # 设置设备
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'使用设备: {device}')
    
    # 加载模型
    model = load_model(args.model_path, device)
    print('模型加载成功')
    
    # 准备数据
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    
    test_dataset = EyeDiseaseDataset(args.test_data, transform=transform)
    test_loader = DataLoader(test_dataset, batch_size=args.batch_size, shuffle=False)
    
    # 评估模型
    accuracy, all_preds, all_labels, all_probs = evaluate_model(model, test_loader, device)
    
    # 类别名称
    classes = ['正常', 'AMD', '白内障', '糖尿病视网膜病变', '青光眼', 
               '高血压视网膜病变', '病理性近视', '其他']
    
    # 生成评估报告
    print(f'\n模型准确率: {accuracy:.2f}%')
    print('\n分类报告:')
    print(classification_report(all_labels, all_preds, target_names=classes))
    
    # 绘制可视化图表
    plot_confusion_matrix(all_labels, all_preds, classes)
    plot_roc_curves(all_labels, all_probs, classes)
    plot_class_distribution(all_labels, all_preds, classes)
    
    print('\n评估结果已保存为图片文件:')
    print('- confusion_matrix.png: 混淆矩阵')
    print('- roc_curves.png: ROC曲线')
    print('- class_distribution.png: 类别分布图')

if __name__ == '__main__':
    main() 