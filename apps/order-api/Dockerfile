FROM eclipse-temurin:21-jre
WORKDIR /app
COPY build/libs/order-api.jar app.jar
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
