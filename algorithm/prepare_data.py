import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split

# 定义数据集目录
dataset_dir = 'dataset'

# 定义疾病类别映射
disease_categories = {
    'normal': 0,
    'amd': 1,
    'cataract': 2,
    'diabetes': 3,
    'glaucoma': 4,
    'hypertension': 5,
    'myopia': 6,
    'other': 7
}

def create_dataset_csv():
    """
    创建数据集CSV文件，包含图像路径和标签
    """
    print("开始创建数据集CSV文件...")
    
    # 存储所有图像路径和标签
    image_paths = []
    labels = []
    
    # 遍历所有疾病类别目录
    for disease in disease_categories.keys():
        disease_dir = os.path.join(dataset_dir, disease)
        
        # 检查目录是否存在
        if not os.path.exists(disease_dir):
            print(f"警告: {disease_dir} 目录不存在，跳过")
            continue
        
        # 获取该疾病类别的所有图像
        for img_name in os.listdir(disease_dir):
            if img_name.endswith(('.jpg', '.jpeg', '.png')):
                # 使用正斜杠作为路径分隔符，确保跨平台兼容性
                img_path = os.path.join(dataset_dir, disease, img_name).replace('\\', '/')
                image_paths.append(img_path)
                labels.append(disease_categories[disease])
    
    # 创建数据框
    df = pd.DataFrame({
        'image_path': image_paths,
        'label': labels
    })
    
    # 打印每个类别的图像数量
    print("\n各类别图像数量:")
    for disease, label in disease_categories.items():
        count = len(df[df['label'] == label])
        print(f"{disease}: {count}")
    
    # 分割为训练集和验证集
    train_df, val_df = train_test_split(df, test_size=0.2, stratify=df['label'], random_state=42)
    
    # 确保输出目录存在
    os.makedirs('data', exist_ok=True)
    
    # 保存为CSV文件
    train_df.to_csv('data/train_dataset.csv', index=False)
    val_df.to_csv('data/val_dataset.csv', index=False)
    
    print(f"\n训练集大小: {len(train_df)}")
    print(f"验证集大小: {len(val_df)}")
    print("数据集CSV文件已创建完成!")

if __name__ == "__main__":
    create_dataset_csv()