@echo off

call .\mvnw clean package -DskipTests && (
	docker buildx build --platform linux/arm64,linux/amd64/v3 -t ghcr.io/fluffb4ll/lct112-backend:latest --push .
) || (
	echo Maven build failed!
)

pause
