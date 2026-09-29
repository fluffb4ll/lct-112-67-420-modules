# Многоэтапная сборка (Multi-stage build) для HTTP бэкенда (Spring Boot)

# Этап 1: Сборка приложения через Maven Wrapper
FROM eclipse-temurin:25-jdk-alpine AS builder

WORKDIR /app

# Кэшируем зависимости Maven
COPY .mvn/ .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B || true

# Копируем исходный код и собираем JAR
COPY src ./src
RUN ./mvnw clean package -DskipTests

# Этап 2: Финальный образ для запуска
FROM eclipse-temurin:25-jre-alpine

WORKDIR /app

RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

COPY --from=builder /app/target/*.jar app.jar

ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+UseG1GC"

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
