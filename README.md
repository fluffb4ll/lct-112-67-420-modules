# Обучающий тренажёр операторов ДДС 112 — Сборка и Деплой (Docker)

Данный репозиторий состоит из трёх изолированных модулей, каждый из которых работает в отдельном Docker-контейнере:

1. **`ai`** — ИИ-контур тренажёра (Python 3.11 / FastAPI / Llama.cpp), порт `8090`.
2. **`backend`** — Основной HTTP-бэкенд (Java 25 / Spring Boot), порт `8080`.
3. **`frontend`** — Веб-интерфейс (React / Vite / Nginx), порт `80`.

Инструкция пользователя приведена в файле [`USER_GUIDE.md`](USER_GUIDE.md)

---

## 🚀 Быстрый старт с Docker Compose

Для запуска всей системы локально используйте эталонный `docker-compose.yml`.

### 1. Подготовка конфигурации
Скопируйте файл переменных окружения:
```bash
cp .env.example .env
```
При необходимости отредактируйте `.env` (например, измените логин/пароль администратора или параметры БД).

### 2. Запуск контейнеров
Запустите все сервисы в фоновом режиме:
```bash
docker compose up -d --build
```

### 3. Доступ к сервисам
- **Фронтенд**: [http://localhost](http://localhost) (порт `80` по умолчанию)
- **Бэкенд API**: [http://localhost:8080](http://localhost:8080)
- **ИИ-сервис**: [http://localhost:8090](http://localhost:8090)
- **База данных PostgreSQL**: `localhost:5432`

---

## 📦 Скрипт сборки и публикации образов (`build-and-push`)

В репозитории заготовлены два эквивалентных скрипта для сборки и отправки (push) всех контейнеров в Docker Registry:
- `build-and-push.sh` — Bash-скрипт (Linux / macOS / CI/CD)
- `build-and-push.py` — Python-скрипт (Кроссплатформенный: Windows / Linux / macOS)

### Основные возможности скриптов:
- Автоматическая сборка образов всех трех модулей (`dds-ai`, `dds-backend`, `dds-frontend`).
- Настройка адреса Docker Registry и тегов.
- Пуш в любой реестр (Docker Hub, GitHub Container Registry `ghcr.io`, Yandex Container Registry, Docker GitLab и др.).
- Поддержка мультиплатформенной сборки `--platform linux/amd64,linux/arm64` через Docker Buildx.
- Выбор отдельных модулей для сборки.

### Варианты использования:

#### 1. Сборка и пуш в Docker Hub:
```bash
./build-and-push.sh --registry docker.io/myusername --tag v1.0.0
```
или на Python:
```bash
python3 build-and-push.py -r docker.io/myusername -t v1.0.0
```

#### 2. Сборка и пуш в GitHub Container Registry (ghcr.io):
```bash
./build-and-push.sh --registry ghcr.io/myorg --tag latest
```

#### 3. Только локальная сборка (без отправки в реестр):
```bash
./build-and-push.sh --no-push
```

#### 4. Сборка конкретного модуля (например, только backend):
```bash
./build-and-push.sh -r myregistry.com/dds -m "backend"
```

#### 5. Мультиархитектурная сборка (AMD64 + ARM64):
```bash
./build-and-push.sh -r ghcr.io/myorg --platform linux/amd64,linux/arm64
```

---

## 🛠️ Архитектура Compose-контейнеров

```
               +-----------------------+
               |   frontend (Nginx)    |  <-- Порт 80 (пользователь)
               +-----------+-----------+
                           | /api proxy
                           v
               +-----------------------+
               |  backend (Spring)     |  <-- Порт 8080
               +-----+-----------+-----+
                     |           |
        JDBC / 5432  v           v  HTTP / 8090
      +---------------+         +---------------+
      |   postgres    |         |   ai (Python) |
      +---------------+         +---------------+
```

### Зависимости и Healthcheck'и
- `postgres`: Ожидает готовности базы данных через `pg_isready`.
- `ai`: Предоставляет healthcheck `/health`.
- `backend`: Запускается строго после того, как `postgres` и `ai` перейдут в состояние `healthy`.
- `frontend`: Запускается после старта `backend` и проксирует `/api` запросы на `http://backend:8080`.
