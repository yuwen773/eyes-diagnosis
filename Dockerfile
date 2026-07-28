# Backend runtime image (PR-12.4)
# 先在宿主机执行 `mvn -DskipTests package`（protobuf 代码生成需要本机 Maven 环境），
# 再由 docker compose 构建本镜像：只做运行时封装，不在容器内编译。
FROM eclipse-temurin:21-jre

WORKDIR /app

COPY target/eye-diagnosis-*.jar /app/app.jar

ENV JAVA_OPTS="-Xms512m -Xmx1024m" \
    TZ=Asia/Shanghai

EXPOSE 8081

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
