import os
import torch
import pandas as pd
import numpy as np
import argparse
import time
from eye_disease_model import EyeDiseaseModel
from prepare_data import create_dataset_csv

def create_sample_dataset(full_csv_path, sample_csv_path, sample_ratio=0.3):
    """创建小样本数据集以加速训练"""
    if os.path.exists(sample_csv_path):
        print(f"使用已存在的样本数据集: {sample_csv_path}")
        return
    
    if not os.path.exists(full_csv_path):
        print(f"原始数据集不存在: {full_csv_path}")
        return
    
    # 读取原始数据集
    df = pd.read_csv(full_csv_path)
    
    # 对每个类别进行分层抽样
    labels = df['label'].unique()
    sampled_dfs = []
    
    for label in labels:
        label_df = df[df['label'] == label]
        # 确保每个类至少有1个样本
        n_samples = max(1, int(len(label_df) * sample_ratio))
        sampled_df = label_df.sample(n=n_samples, random_state=42)
        sampled_dfs.append(sampled_df)
    
    # 合并所有抽样数据
    sample_df = pd.concat(sampled_dfs, ignore_index=True)
    
    # 保存样本数据集
    os.makedirs(os.path.dirname(sample_csv_path), exist_ok=True)
    sample_df.to_csv(sample_csv_path, index=False)
    
    print(f"创建了样本数据集: {sample_csv_path}，共{len(sample_df)}条记录")
    print(f"类别分布: {sample_df['label'].value_counts().to_dict()}")

def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='眼科疾病分类模型训练脚本')
    parser.add_argument('--model', type=str, default='efficientnet_b4',
                        choices=['efficientnet_b0', 'efficientnet_b1', 'efficientnet_b2', 
                                'efficientnet_b3', 'efficientnet_b4', 'efficientnet_b5',
                                'resnet50', 'resnet101', 'vit_b_16', 'vit_l_16'],
                        help='选择要使用的模型架构')
    parser.add_argument('--batch-size', type=int, default=12, help='训练批量大小')
    parser.add_argument('--epochs', type=int, default=25, help='训练轮数')
    parser.add_argument('--lr', type=float, default=0.0005, help='初始学习率')
    parser.add_argument('--sample-ratio', type=float, default=0.5, help='数据抽样比例')
    parser.add_argument('--use-full-data', action='store_true', help='使用完整数据集而非样本数据集')
    parser.add_argument('--freeze', action='store_true', help='冻结特征提取层')
    parser.add_argument('--output-dir', type=str, default='models', help='模型保存目录')
    return parser.parse_args()

def main():
    # 解析命令行参数
    args = parse_args()
    
    # 创建输出目录
    os.makedirs(args.output_dir, exist_ok=True)
    
    # 获取当前时间作为模型ID
    model_id = time.strftime("%Y%m%d_%H%M%S")
    model_output_dir = os.path.join(args.output_dir, f"{args.model}_{model_id}")
    os.makedirs(model_output_dir, exist_ok=True)
    
    # 检查数据集CSV文件是否存在，如果不存在则创建
    if not os.path.exists('data/train_dataset.csv') or not os.path.exists('data/val_dataset.csv'):
        print("数据集CSV文件不存在，正在创建...")
        create_dataset_csv()
    
    # 创建小样本数据集（如果需要）
    if not args.use_full_data:
        print("\n创建小样本数据集以加速训练...")
        create_sample_dataset('data/train_dataset.csv', 'data/train_sample.csv', sample_ratio=args.sample_ratio)
        create_sample_dataset('data/val_dataset.csv', 'data/val_sample.csv', sample_ratio=args.sample_ratio)
    
    # 创建模型实例
    print(f"\n初始化模型 {args.model}...")
    model = EyeDiseaseModel(
        num_classes=8, 
        pretrained=True, 
        learning_rate=args.lr,
        model_name=args.model
    )
    
    # 加载数据
    print("\n加载训练和验证数据...")
    train_csv = 'data/train_dataset.csv' if args.use_full_data else 'data/train_sample.csv'
    val_csv = 'data/val_dataset.csv' if args.use_full_data else 'data/val_sample.csv'
    
    train_loader, val_loader = model.load_data(
        train_csv=train_csv,
        val_csv=val_csv,
        batch_size=args.batch_size
    )
    
    # 是否冻结特征提取层
    if args.freeze:
        print("\n阶段1: 冻结特征提取层，只训练分类层...")
        # 根据不同模型架构冻结不同的层
        if args.model.startswith('efficientnet'):
            for param in model.model.features.parameters():
                param.requires_grad = False
        elif args.model.startswith('resnet'):
            # 冻结除最后一个块以外的所有层
            for name, param in model.model.named_parameters():
                if not name.startswith('layer4') and not name.startswith('fc'):
                    param.requires_grad = False
        elif args.model.startswith('vit'):
            # 仅训练头部和最后几个Transformer块
            for name, param in model.model.named_parameters():
                if not name.startswith('encoder.layers.11') and not name.startswith('heads'):
                    param.requires_grad = False
        
        # 训练分类层
        print("\n开始训练分类层...")
        model.train(epochs=5, save_dir=model_output_dir)
        
        # 然后解冻并微调整个网络
        print("\n阶段2: 解冻所有层并进行微调...")
        for param in model.model.parameters():
            param.requires_grad = True
        
        # 降低学习率进行微调
        for param_group in model.optimizer.param_groups:
            param_group['lr'] = args.lr / 10
    
    # 训练/微调整个网络
    print("\n开始" + ("微调" if args.freeze else "训练") + "整个网络...")
    best_model_path = model.train(epochs=args.epochs, save_dir=model_output_dir)
    
    # 加载最佳模型并在验证集上评估
    print("\n加载最佳模型并评估...")
    model.load_model(best_model_path)
    
    # 创建测试数据加载器（这里使用验证集作为测试集）
    test_acc, report, cm = model.evaluate(val_loader)
    
    # 输出分类报告
    print("\n分类报告:")
    for cls_name, metrics in report.items():
        if isinstance(metrics, dict):
            print(f"{cls_name}:")
            print(f"  精确率: {metrics['precision']:.4f}")
            print(f"  召回率: {metrics['recall']:.4f}")
            print(f"  F1分数: {metrics['f1-score']:.4f}")
            print(f"  支持度: {metrics['support']}")
    
    print(f"\n测试准确率: {test_acc:.4f}")
    print("\n训练完成！最佳模型已保存到:", best_model_path)
    
    # 保存训练配置和结果摘要到文件
    result_summary = {
        'model': args.model,
        'batch_size': args.batch_size,
        'epochs': args.epochs,
        'learning_rate': args.lr,
        'use_full_data': args.use_full_data,
        'sample_ratio': args.sample_ratio if not args.use_full_data else 1.0,
        'freeze_feature_extraction': args.freeze,
        'test_accuracy': test_acc,
        'best_model_path': best_model_path
    }
    
    # 保存结果摘要
    import json
    with open(os.path.join(model_output_dir, 'training_summary.json'), 'w') as f:
        json.dump(result_summary, f, indent=4)
    
    print(f"训练结果摘要已保存到: {os.path.join(model_output_dir, 'training_summary.json')}")

if __name__ == "__main__":
    main()