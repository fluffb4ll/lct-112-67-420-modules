# Фронтенд тренажёра ДДС: собирается Vite'ом и раздаётся nginx'ом.
# Тот же nginx проксирует /api на бэкенд, чтобы фронт и бэк были на одном адресе —
# иначе браузер не сохранит куку AUTH_TOKEN (она httpOnly + SameSite=Lax).
#
#   docker build -t dds-frontend .
#   docker run -p 8081:80 -e BACKEND_URL=http://backend:8080 dds-frontend
#
# Под Raspberry Pi: docker buildx build --platform linux/arm64 -t dds-frontend .

FROM node:22-alpine AS build
WORKDIR /app

# зависимости отдельным слоем: пересобираются только при изменении package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

# Адрес бэкенда — без слеша на конце (иначе nginx срежет /api из пути).
# В docker compose это имя сервиса бэкенда, например http://backend:8080
ENV BACKEND_URL=http://backend:8080
# подставлять в шаблоне только эту переменную, переменные самого nginx ($host, $uri) не трогать
ENV NGINX_ENVSUBST_FILTER=BACKEND_URL

COPY --from=build /app/dist /usr/share/nginx/html
# Шаблон: штатный entrypoint nginx подставит в него BACKEND_URL при старте контейнера
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
