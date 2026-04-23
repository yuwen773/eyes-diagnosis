# gRPC 诊断服务重构 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Java-Flask HTTP 诊断调用替换为 gRPC 直传图片 + Hash 缓存，精简 Python 代码。

**Architecture:** Java 通过 gRPC protobuf 直接传输图片字节给 Python 推理服务，消除中间 COS 下载环节。Python 端从 300+ 行 Flask 应用精简为 ~120 行 gRPC Server。Java 端增加 SHA-256 图片哈希缓存避免重复推理。

**Tech Stack:** gRPC (Java: grpc-netty-shaded/grpc-protobuf/grpc-stub, Python: grpcio/grpcio-tools), protobuf-maven-plugin, Spring Boot 3.5.6, PyTorch EfficientNet-B4

---

## Task 1: 数据库迁移 — 新增 image_hash 列

**Files:**
- Modify: `src/main/resources/db/schema.sql` (末尾追加 DDL)

**Step 1: 添加 DDL**

在 `src/main/resources/db/schema.sql` 文件末尾追加：

```sql
-- gRPC 诊断重构：新增图片哈希字段用于缓存去重
ALTER TABLE t_diagnosis ADD COLUMN image_hash VARCHAR(64) NULL COMMENT '图片SHA-256哈希';
CREATE INDEX idx_image_hash ON t_diagnosis(image_hash);
```

**Step 2: 执行 DDL**

在 MySQL 中执行上述 SQL，为 t_diagnosis 表添加 image_hash 列和索引。

**Step 3: 验证**

```sql
DESCRIBE t_diagnosis;
-- 确认 image_hash 列存在
```

**Step 4: Commit**

```bash
git add src/main/resources/db/schema.sql
git commit -m "feat(db): 添加 t_diagnosis.image_hash 字段用于缓存去重"
```

---

## Task 2: 添加 gRPC Maven 依赖和 protobuf 插件

**Files:**
- Modify: `pom.xml`

**Step 1: 在 `<properties>` 中添加 gRPC 版本号**

在 `pom.xml` 的 `<properties>` 块中追加：

```xml
<grpc.version>1.71.0</grpc.version>
<protobuf.version>4.30.2</protobuf.version>
```

**Step 2: 在 `<dependencies>` 中添加 gRPC 依赖**

在 `pom.xml` 的 `<dependencies>` 块中追加（在 dashscope-sdk-java 依赖之后）：

```xml
<!-- gRPC -->
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-netty-shaded</artifactId>
    <version>${grpc.version}</version>
</dependency>
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-protobuf</artifactId>
    <version>${grpc.version}</version>
</dependency>
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-stub</artifactId>
    <version>${grpc.version}</version>
</dependency>
<dependency>
    <groupId>com.google.protobuf</groupId>
    <artifactId>protobuf-java</artifactId>
    <version>${protobuf.version}</version>
</dependency>
<dependency>
    <groupId>org.apache.tomcat</groupId>
    <artifactId>annotations-api</artifactId>
    <version>6.0.53</version>
    <scope>provided</scope>
</dependency>
```

**Step 3: 在 `<build><plugins>` 中添加 protobuf-maven-plugin**

在 `spring-boot-maven-plugin` 之前添加：

```xml
<plugin>
    <groupId>org.xolstice.maven.plugins</groupId>
    <artifactId>protobuf-maven-plugin</artifactId>
    <version>0.6.1</version>
    <configuration>
        <protocArtifact>com.google.protobuf:protoc:${protobuf.version}:exe:${os.detected.classifier}</protocArtifact>
        <pluginId>grpc-java</pluginId>
        <pluginArtifact>io.grpc:protoc-gen-grpc-java:${grpc.version}:exe:${os.detected.classifier}</pluginArtifact>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>compile</goal>
                <goal>compile-custom</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

**Step 4: 验证 Maven 能正常解析**

```bash
mvn dependency:resolve -q
```

Expected: BUILD SUCCESS

**Step 5: Commit**

```bash
git add pom.xml
git commit -m "feat(deps): 添加 gRPC 和 protobuf Maven 依赖"
```

---

## Task 3: 创建 Proto 文件并生成 Java Stub

**Files:**
- Create: `src/main/proto/diagnosis.proto`

**Step 1: 创建 proto 目录和文件**

```bash
mkdir -p src/main/proto
```

创建 `src/main/proto/diagnosis.proto`：

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

**Step 2: 生成 Java Stub**

```bash
mvn compile -q
```

Expected: `target/generated-sources/protobuf/` 下生成：
- `com/csust/eyediagnosis/grpc/Diagnosis.java` (protobuf 消息类)
- `com/csust/eyediagnosis/grpc/DiagnosisServiceGrpc.java` (gRPC Stub)

**Step 3: 验证生成文件存在**

```bash
ls target/generated-sources/protobuf/java/com/csust/eyediagnosis/grpc/
```

Expected: 看到 `Diagnosis.java` 和 `DiagnosisServiceGrpc.java`

**Step 4: Commit**

```bash
git add src/main/proto/diagnosis.proto
git commit -m "feat(proto): 添加诊断服务 protobuf 定义"
```

---

## Task 4: Java 端 — 修改 Diagnosis 实体 + Mapper

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/model/entity/Diagnosis.java` (添加 imageHash 字段)
- Modify: `src/main/resources/mapper/DiagnosisMapper.xml` (添加 imageHash 映射)
- Modify: `src/main/java/com/csust/eyediagnosis/mapper/DiagnosisMapper.java` (添加 hash 查询)

**Step 1: Diagnosis.java 添加 imageHash 字段**

在 `Diagnosis.java` 的 `isDelete` 字段之前添加：

```java
/**
 * 图片哈希 (SHA-256)
 */
private String imageHash;
```

**Step 2: DiagnosisMapper.xml 添加映射**

在 `<resultMap>` 中 `isDelete` 之前添加：

```xml
<result property="imageHash" column="imageHash" />
```

在 `<sql id="Base_Column_List">` 中 `isDelete` 之前添加 `imageHash`：

```sql
id,url,userId,result,confidence,recommendations,
details,severity,reexamineStatus,picSize,picWidth,picHeight,
picScale,picFormat,createTime,imageHash,isDelete
```

**Step 3: DiagnosisMapper.java 添加 hash 查询方法**

在 `DiagnosisMapper` 接口中添加：

```java
@Select("SELECT * FROM t_diagnosis WHERE image_hash = #{imageHash} AND isDelete = 0 LIMIT 1")
Diagnosis selectByImageHash(String imageHash);
```

**Step 4: 编译验证**

```bash
mvn compile -q
```

Expected: BUILD SUCCESS

**Step 5: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/model/entity/Diagnosis.java \
        src/main/resources/mapper/DiagnosisMapper.xml \
        src/main/java/com/csust/eyediagnosis/mapper/DiagnosisMapper.java
git commit -m "feat(entity): Diagnosis 实体添加 imageHash 字段和 Mapper 查询方法"
```

---

## Task 5: Java 端 — 创建 GrpcConfig 配置类

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/config/GrpcConfig.java`

**Step 1: 创建 GrpcConfig**

```java
package com.csust.eyediagnosis.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@Data
@ConfigurationProperties(prefix = "diagnosis.grpc")
public class GrpcConfig {
    private String host = "127.0.0.1";
    private int port = 50051;
    private int deadlineMs = 10000;
}
```

**Step 2: 更新 application-local.yml 配置**

将 `application-local.yml` 中的：

```yaml
diagnosis:
  python:
    python-url: http://127.0.0.1:5000/upload
```

替换为：

```yaml
diagnosis:
  grpc:
    host: 127.0.0.1
    port: 50051
    deadline-ms: 10000
```

**Step 3: 编译验证**

```bash
mvn compile -q
```

**Step 4: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/config/GrpcConfig.java \
        src/main/resources/application-local.yml
git commit -m "feat(config): 添加 GrpcConfig 替代 PythonConfig"
```

---

## Task 6: Java 端 — 创建 DiagnosisGrpcClient

**Files:**
- Create: `src/main/java/com/csust/eyediagnosis/grpc/DiagnosisGrpcClient.java`

**Step 1: 创建 gRPC 客户端**

```java
package com.csust.eyediagnosis.grpc;

import com.csust.eyediagnosis.config.GrpcConfig;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.StatusRuntimeException;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Slf4j
@Component
public class DiagnosisGrpcClient {

    private final GrpcConfig grpcConfig;
    private ManagedChannel channel;
    private DiagnosisServiceGrpc.DiagnosisServiceBlockingStub blockingStub;

    public DiagnosisGrpcClient(GrpcConfig grpcConfig) {
        this.grpcConfig = grpcConfig;
    }

    @PostConstruct
    public void init() {
        channel = ManagedChannelBuilder
                .forAddress(grpcConfig.getHost(), grpcConfig.getPort())
                .usePlaintext()
                .build();
        blockingStub = DiagnosisServiceGrpc.newBlockingStub(channel);
    }

    public DiagnosisResponse diagnose(byte[] imageData, String imageFormat) {
        DiagnosisRequest request = DiagnosisRequest.newBuilder()
                .setImageData(com.google.protobuf.ByteString.copyFrom(imageData))
                .setImageFormat(imageFormat)
                .build();
        try {
            return blockingStub
                    .withDeadlineAfter(grpcConfig.getDeadlineMs(), TimeUnit.MILLISECONDS)
                    .diagnose(request);
        } catch (StatusRuntimeException e) {
            log.error("gRPC diagnosis failed: {}", e.getStatus().getDescription(), e);
            throw new RuntimeException("诊断服务调用失败: " + e.getStatus().getDescription(), e);
        }
    }

    @PreDestroy
    public void shutdown() {
        if (channel != null && !channel.isShutdown()) {
            channel.shutdown();
            try {
                channel.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                channel.shutdownNow();
            }
        }
    }
}
```

**Step 2: 编译验证**

```bash
mvn compile -q
```

Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/grpc/DiagnosisGrpcClient.java
git commit -m "feat(grpc): 添加 DiagnosisGrpcClient 封装 gRPC 调用"
```

---

## Task 7: Java 端 — 重写 DiagnosisServiceImpl.doDiagnosis()

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/service/DiagnosisService.java` (接口方法签名)
- Modify: `src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java` (核心逻辑)

**Step 1: 修改 DiagnosisService 接口**

将 `doDiagnosis` 方法签名从：

```java
DiagnosisResultVO doDiagnosis(DiagnosisDTO diagnosisDTO);
```

改为：

```java
DiagnosisResultVO doDiagnosis(MultipartFile file, User loginUser);
```

同时删除不再需要的 `import`：`DiagnosisDTO`

**Step 2: 重写 DiagnosisServiceImpl.doDiagnosis()**

在 `DiagnosisServiceImpl` 中：

1. 删除 `PythonConfig` 注入，添加 `DiagnosisGrpcClient` 注入
2. 替换 `doDiagnosis` 方法：

```java
@Resource
private DiagnosisGrpcClient diagnosisGrpcClient;

@Override
public DiagnosisResultVO doDiagnosis(MultipartFile file, User loginUser) {
    try {
        byte[] imageBytes = file.getBytes();
        String imageFormat = file.getContentType();

        // 1. 计算图片 hash 缓存
        String imageHash = DigestUtils.md5DigestAsHex(imageBytes);
        Diagnosis cached = diagnosisMapper.selectByImageHash(imageHash);
        if (cached != null && cached.getResult() != null) {
            DiagnosisResultVO vo = DiagnosisResultVO.objToVo(cached);
            return vo;
        }

        // 2. gRPC 调用 Python 推理
        com.csust.eyediagnosis.grpc.DiagnosisResponse grpcResponse =
                diagnosisGrpcClient.diagnose(imageBytes, imageFormat);

        // 3. 异步上传 COS
        String imageUrl = null;
        try {
            String uploadPrefix = String.format("public/%s", loginUser.getId());
            UploadPictureDetail detail = fileManager.uploadPicture(file, uploadPrefix);
            imageUrl = detail.getUrl();
        } catch (Exception e) {
            log.error("COS upload failed", e);
        }

        // 4. 构建诊断结果
        DiagnosisResultVO vo = new DiagnosisResultVO();
        String predictedLabel = grpcResponse.getPredictedLabel();
        vo.setResult(DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(predictedLabel));
        vo.setDetails(grpcResponse.getDescription());
        vo.setProbability(grpcResponse.getProbability());
        vo.setConfidence((double) grpcResponse.getReliabilityScore());
        vo.setRecommendations(DiagnosisRecommendationEnum.getRecommendationByEnglishLabel(predictedLabel));
        vo.setUrl(imageUrl);
        vo.setCreateTime(now());

        List<String> severityList = Arrays.asList("normal", "mild", "moderate", "severe");
        vo.setSeverity(severityList.get(new Random().nextInt(severityList.size())));

        List<Disease> diseases = grpcResponse.getTopPredictionsList().stream()
                .map(pred -> {
                    Disease d = new Disease();
                    d.setName(pred.getLabel());
                    d.setProbability(pred.getProbability());
                    return d;
                })
                .collect(Collectors.toList());
        vo.setOtherDisease(diseases);

        // 5. 保存到数据库
        Diagnosis diagnosis = DiagnosisResultVO.voToObj(vo);
        diagnosis.setUserId(loginUser.getId());
        diagnosis.setImageHash(imageHash);
        if (imageUrl != null) {
            diagnosis.setUrl(imageUrl);
        }
        this.save(diagnosis);
        vo.setId(diagnosis.getId());

        return vo;
    } catch (Exception e) {
        throw new RuntimeException("诊断失败: " + e.getMessage(), e);
    }
}
```

注意需添加 import：
```java
import com.csust.eyediagnosis.grpc.DiagnosisGrpcClient;
import com.csust.eyediagnosis.grpc.DiagnosisResponse;
import org.springframework.util.DigestUtils;
```

删除不再需要的 import：
```java
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.csust.eyediagnosis.config.PythonConfig;
import com.csust.eyediagnosis.model.dto.diagnosis.DiagnosisDTO;
import static com.csust.eyediagnosis.constant.PythonConstant.*;
import java.net.HttpURLConnection;
```

**Step 3: 编译验证**

```bash
mvn compile -q
```

Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/service/DiagnosisService.java \
        src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java
git commit -m "feat(diagnosis): 重写 doDiagnosis 使用 gRPC + hash 缓存"
```

---

## Task 8: Java 端 — 修改 DiagnosisController

**Files:**
- Modify: `src/main/java/com/csust/eyediagnosis/controller/DiagnosisController.java`

**Step 1: 修改 doDiagnosis 端点**

将 `DiagnosisController.doDiagnosis()` 从：

```java
@PostMapping("/diagnosis")
@AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
public BaseResponse<DiagnosisResultVO> doDiagnosis(@RequestBody DiagnosisDTO diagnosisDTO){
    if(diagnosisDTO.getImageUrl()==null){
        throw new BusinessException(ErrorCode.PARAMS_ERROR);
    }
    DiagnosisResultVO diagnosisResultVO = diagnosisService.doDiagnosis(diagnosisDTO);
    return ResultUtils.success(diagnosisResultVO);
}
```

改为：

```java
@PostMapping("/diagnosis")
@AuthCheck(mustRole = AuthConstant.DEFAULT_ROLE)
public BaseResponse<DiagnosisResultVO> doDiagnosis(
        @RequestPart("file") MultipartFile file,
        HttpServletRequest request) {
    if (file.isEmpty()) {
        throw new BusinessException(ErrorCode.PARAMS_ERROR, "请上传诊断图片");
    }
    User loginUser = userService.getLoginUser(request);
    DiagnosisResultVO diagnosisResultVO = diagnosisService.doDiagnosis(file, loginUser);
    return ResultUtils.success(diagnosisResultVO);
}
```

删除不再需要的 import：`DiagnosisDTO`

**Step 2: 编译验证**

```bash
mvn compile -q
```

**Step 3: Commit**

```bash
git add src/main/java/com/csust/eyediagnosis/controller/DiagnosisController.java
git commit -m "feat(controller): doDiagnosis 改为接收 MultipartFile 直传图片"
```

---

## Task 9: Java 端 — 删除旧文件

**Files:**
- Delete: `src/main/java/com/csust/eyediagnosis/config/PythonConfig.java`
- Delete: `src/main/java/com/csust/eyediagnosis/constant/PythonConstant.java`

**Step 1: 确认无其他引用**

```bash
grep -r "PythonConfig\|PythonConstant" src/main/java/ --include="*.java" -l
```

Expected: 仅剩 PythonConfig.java 和 PythonConstant.java 自身（DiagnosisServiceImpl 已在 Task 7 中移除引用）

**Step 2: 删除文件**

```bash
git rm src/main/java/com/csust/eyediagnosis/config/PythonConfig.java
git rm src/main/java/com/csust/eyediagnosis/constant/PythonConstant.java
```

**Step 3: 编译验证**

```bash
mvn compile -q
```

Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git commit -m "refactor: 删除 PythonConfig 和 PythonConstant（已由 gRPC 替代）"
```

---

## Task 10: Python 端 — 创建 gRPC Server

**Files:**
- Create: `algorithm/diagnosis.proto` (与 Java 端 proto 相同)
- Create: `algorithm/grpc_server.py`

**Step 1: 在 algorithm/ 目录创建 proto 文件**

复制 `src/main/proto/diagnosis.proto` 到 `algorithm/diagnosis.proto`。

**Step 2: 生成 Python gRPC Stub**

```bash
cd algorithm
pip install grpcio grpcio-tools
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. diagnosis.proto
```

Expected: 生成 `diagnosis_pb2.py` 和 `diagnosis_pb2_grpc.py`

**Step 3: 创建 grpc_server.py**

```python
import grpc
from concurrent import futures
import tempfile
import os
import logging
from pathlib import Path

import diagnosis_pb2
import diagnosis_pb2_grpc
from eye_disease_model import EyeDiseaseModel, disease_categories

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DISEASE_DESCRIPTIONS = {
    "normal": "正常眼底图像，未发现明显异常。视网膜血管走行正常，视盘边界清晰，黄斑区结构正常。",
    "amd": "年龄相关性黄斑变性（AMD）是一种常见的老 年性眼病，主要影响黄斑区，导致中心视力下降。早期表现为视网膜色素上皮改变，晚期可出现脉络膜新生血管或地图样萎缩。",
    "cataract": "白内障是晶状体混浊导致的视力下降疾病。常见症状包括视物模糊、色觉改变、眩光等。根据混浊部位可分为皮质性、核性和后囊下白内障。",
    "diabetes": "糖尿病视网膜病变是糖尿病的常见微血管并发症。早期表现为微血管瘤、出血点，后期可出现新生血管、玻璃体出血，严重者可导致失明。",
    "glaucoma": "青光眼是一组以视神经萎缩和视野缺损为特征的疾病。主要危险因素包括眼压升高、近视、家族史等。早期常无症状，晚期可导致不可逆性视力丧失。",
    "hypertension": "高血压视网膜病变是全身高血压在眼部的表现。早期可见视网膜动脉变细、反光增强，严重者可出现视网膜出血、渗出及视乳头水肿。",
    "myopia": "近视眼眼底改变主要表现为视盘倾斜、视网膜脉络膜萎缩、后巩膜葡萄肿等。高度近视者发生视网膜脱离、黄斑出血等并发症的风险增加。",
    "other": "眼底图像存在异常改变，但无法明确归类为特定疾病。建议进一步检查确诊。",
}


def calculate_reliability(all_probabilities):
    sorted_probs = sorted(all_probabilities, reverse=True)
    if len(sorted_probs) < 2:
        return 50
    gap = sorted_probs[0] - sorted_probs[1]
    if gap > 0.5:
        return 95
    elif gap > 0.3:
        return 85
    elif gap > 0.2:
        return 75
    elif gap > 0.1:
        return 65
    else:
        return 50


class DiagnosisServicer(diagnosis_pb2_grpc.DiagnosisServiceServicer):

    def __init__(self):
        self.model = EyeDiseaseModel(model_name='efficientnet_b4')
        self._load_model()

    def _load_model(self):
        model_paths = [
            'models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth',
            'models/best_acc_eye_disease_model.pth',
            'models/best_eye_disease_model.pth',
        ]
        for path in model_paths:
            if os.path.exists(path):
                self.model.load_model(path)
                logger.info(f"Model loaded from {path}")
                return
        logger.warning("No model weights found, using untrained model")

    def Diagnose(self, request, context):
        try:
            image_data = request.image_data
            if not image_data:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("No image data provided")
                return diagnosis_pb2.DiagnosisResponse()

            suffix = '.jpg'
            if 'png' in (request.image_format or '').lower():
                suffix = '.png'

            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(image_data)
                temp_path = f.name

            try:
                result = self.model.predict(temp_path)
                predicted_label = result['predicted_label']
                probability = result['probability'] * 100
                all_probs = result['all_probabilities']

                reliability = calculate_reliability(all_probs)
                description = DISEASE_DESCRIPTIONS.get(predicted_label, "")

                top_3 = sorted(
                    [(disease_categories[i], p) for i, p in enumerate(all_probs)],
                    key=lambda x: x[1], reverse=True
                )[:3]

                return diagnosis_pb2.DiagnosisResponse(
                    predicted_label=predicted_label,
                    probability=probability,
                    reliability_score=reliability,
                    description=description,
                    top_predictions=[
                        diagnosis_pb2.DiseasePrediction(label=label, probability=prob * 100)
                        for label, prob in top_3
                    ],
                )
            finally:
                os.unlink(temp_path)

        except Exception as e:
            logger.error(f"Diagnosis failed: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return diagnosis_pb2.DiagnosisResponse()


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    diagnosis_pb2_grpc.add_DiagnosisServiceServicer_to_server(
        DiagnosisServicer(), server
    )
    server.add_insecure_port('0.0.0.0:50051')
    server.start()
    logger.info("gRPC Diagnosis Server started on 0.0.0.0:50051")
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
```

**Step 4: 更新 requirements.txt**

替换 `algorithm/requirements.txt` 为：

```
torch>=1.7.0
torchvision>=0.8.0
numpy>=1.19.0
Pillow>=8.0.0
grpcio>=1.60.0
grpcio-tools>=1.60.0
```

**Step 5: 测试 Python gRPC Server 启动**

```bash
cd algorithm
python grpc_server.py
```

Expected: 输出 `gRPC Diagnosis Server started on 0.0.0.0:50051`

Ctrl+C 停止。

**Step 6: Commit**

```bash
git add algorithm/diagnosis.proto algorithm/grpc_server.py algorithm/requirements.txt \
        algorithm/diagnosis_pb2.py algorithm/diagnosis_pb2_grpc.py
git commit -m "feat(python): 创建 gRPC 诊断服务替代 Flask"
```

---

## Task 11: Python 端 — 清理冗余文件

**Files:**
- Delete: `algorithm/backend/` (整个目录)
- Delete: `algorithm/templates/` (整个目录)
- Delete: `algorithm/__pycache__/` (整个目录)
- Delete: `algorithm/.idea/` (整个目录)
- Delete: `algorithm/schema.sql`
- Delete: `algorithm/user_database.db`
- Delete: `algorithm/README.pdf`

**Step 1: 确认要保留的文件**

保留以下文件：
- `algorithm/eye_disease_model.py` — 核心模型
- `algorithm/grpc_server.py` — 新 gRPC 服务
- `algorithm/diagnosis.proto` — 协议定义
- `algorithm/requirements.txt` — 更新后的依赖
- `algorithm/train_model.py` — 训练脚本（保留但不部署）
- `algorithm/evaluate_model.py` — 评估脚本
- `algorithm/prepare_data.py` — 数据准备
- `algorithm/README.md` — 文档
- `algorithm/models/` — 模型权重

**Step 2: 删除冗余文件**

```bash
cd algorithm
git rm -r backend/
git rm -r templates/
git rm -r __pycache__/
git rm schema.sql user_database.db README.pdf
```

注意：如果 `.idea/` 目录已跟踪，也执行 `git rm -r .idea/`。添加到 `.gitignore`：
```
__pycache__/
.idea/
*.pyc
*.db
```

**Step 3: Commit**

```bash
git commit -m "refactor(python): 清理冗余文件，精简 algorithm 目录"
```

---

## Task 12: 端到端集成测试

**前提：** Task 1-11 全部完成

**Step 1: 启动 Python gRPC Server**

```bash
cd algorithm
python grpc_server.py
```

Expected: `gRPC Diagnosis Server started on 0.0.0.0:50051`

**Step 2: 启动 Spring Boot 后端**

```bash
mvn spring-boot:run
```

Expected: 应用在 8081 端口启动

**Step 3: 测试诊断接口**

```bash
curl -X POST http://localhost:8081/api/diagnosis/diagnosis \
  -H "Cookie: SESSION=<your-session>" \
  -F "file=@test_image.jpg"
```

Expected: 返回 `BaseResponse` JSON，包含诊断结果。

验证：
- 首次上传：走 gRPC 调用 Python 推理
- 再次上传相同图片：命中 hash 缓存，直接返回（更快）

**Step 4: 测试错误场景**

- Python 服务未启动时调用 → 返回友好错误
- 上传空文件 → 返回参数错误

**Step 5: 最终 Commit**

```bash
git add -A
git commit -m "chore: gRPC 诊断服务重构完成，集成测试通过"
```

---

## 文件变更总览

| Task | 文件 | 操作 |
|------|------|------|
| 1 | `src/main/resources/db/schema.sql` | 修改 |
| 2 | `pom.xml` | 修改 |
| 3 | `src/main/proto/diagnosis.proto` | 新增 |
| 4 | `Diagnosis.java`, `DiagnosisMapper.xml`, `DiagnosisMapper.java` | 修改 |
| 5 | `GrpcConfig.java`, `application-local.yml` | 新增/修改 |
| 6 | `DiagnosisGrpcClient.java` | 新增 |
| 7 | `DiagnosisService.java`, `DiagnosisServiceImpl.java` | 修改 |
| 8 | `DiagnosisController.java` | 修改 |
| 9 | `PythonConfig.java`, `PythonConstant.java` | 删除 |
| 10 | `algorithm/grpc_server.py`, `algorithm/diagnosis.proto`, `requirements.txt` | 新增/修改 |
| 11 | `algorithm/backend/`, `algorithm/templates/` 等 | 删除 |
| 12 | 集成测试 | 验证 |
