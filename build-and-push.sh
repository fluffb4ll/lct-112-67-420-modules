#!/usr/bin/env bash

# ==============================================================================
# Скрипт сборки и публикации Docker-контейнеров проекта
# Модули: ai, backend, frontend
# ==============================================================================

set -eo pipefail

# Цвета для вывода в консоль
RED='\030[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Значения по умолчанию
REGISTRY="${DOCKER_REGISTRY:-}"
TAG="${IMAGE_TAG:-latest}"
PUSH=true
PLATFORM=""
DRY_RUN=false
MODULES=("ai" "backend" "frontend")

show_help() {
    cat << EOF
Использование: $0 [ОПЦИИ]

Скрипт собирает Docker-образы всех модулей репозитория (ai, backend, frontend) 
и опционально пушит их в Docker Registry.

ОПЦИИ:
  -r, --registry REGISTRY   Адрес/префикс реестра (например: ghcr.io/username, myuser, cr.yandex/crpXXX)
  -t, --tag TAG             Тег для собираемых образов (по умолчанию: latest)
  -m, --modules "MOD1 MOD2" Список модулей для сборки (по умолчанию: "ai backend frontend")
  -p, --push                Отправить образы в реестр после сборки (включено по умолчанию)
  --no-push                 Только собрать образы, не отправлять в реестр
  --platform PLATFORM       Целевая платформа для buildx (например: linux/amd64,linux/arm64)
  --dry-run                 Вывести команды без их реального выполнения
  -h, --help                Показать это справочное сообщение

ПРИМЕРЫ:
  1. Локальная сборка без отправки в реестр:
     $0 --no-push

  2. Сборка и пуш в GitHub Container Registry с тегом v1.0.0:
     $0 -r ghcr.io/myorg -t v1.0.0

  3. Сборка конкретного модуля для ARM64 и AMD64:
     $0 -r myregistry.com/dds -m "backend" --platform linux/amd64,linux/arm64
EOF
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Парсинг аргументов командной строки
while [[ $# -gt 0 ]]; do
    case "$1" in
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -m|--modules)
            read -r -a MODULES <<< "$2"
            shift 2
            ;;
        -p|--push)
            PUSH=true
            shift
            ;;
        --no-push)
            PUSH=false
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Неизвестный параметр: $1"
            show_help
            exit 1
            ;;
    esac
done

# Проверка рабочей директории (должна содержать каталоги ai, backend, frontend)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}=====================================================${NC}"
echo -e "${CYAN}     Сборка и публикация Docker контейнеров         ${NC}"
echo -e "${CYAN}=====================================================${NC}"
echo -e "Реестр (Registry): ${YELLOW}${REGISTRY:-<локальный Docker>}${NC}"
echo -e "Тег (Tag):         ${YELLOW}${TAG}${NC}"
echo -e "Пуш в реестр:      ${YELLOW}${PUSH}${NC}"
echo -e "Модули:            ${YELLOW}${MODULES[*]}${NC}"
if [ -n "$PLATFORM" ]; then
    echo -e "Платформы:         ${YELLOW}${PLATFORM}${NC}"
fi
echo -e "${CYAN}=====================================================${NC}\n"

# Проверяем доступность docker
if ! command -v docker &> /dev/null && [ "$DRY_RUN" = false ]; then
    log_error "Docker не установлен или недоступен в PATH."
    exit 1
fi

BUILT_IMAGES=()

for module in "${MODULES[@]}"; do
    if [ ! -d "$module" ]; then
        log_error "Директория модуля '$module' не найдена!"
        exit 1
    fi

    if [ ! -f "$module/Dockerfile" ]; then
        log_error "Dockerfile в директории '$module' не найден!"
        exit 1
    fi

    # Формируем имя образа
    if [ -n "$REGISTRY" ]; then
        # Убираем слэш в конце реестра, если есть
        CLEAN_REGISTRY="${REGISTRY%/}"
        FULL_IMAGE_NAME="${CLEAN_REGISTRY}/dds-${module}:${TAG}"
    else
        FULL_IMAGE_NAME="dds-${module}:${TAG}"
    fi

    log_info "=== Начинаем сборку модуля: ${module} ==="
    log_info "Имя образа: ${FULL_IMAGE_NAME}"

    if [ -n "$PLATFORM" ]; then
        # Использование buildx для мультиплатформенной сборки
        BUILD_CMD="docker buildx build --platform ${PLATFORM} -t ${FULL_IMAGE_NAME} ./${module}"
        if [ "$PUSH" = true ] && [ -n "$REGISTRY" ]; then
            BUILD_CMD="${BUILD_CMD} --push"
        else
            BUILD_CMD="${BUILD_CMD} --load"
        fi
    else
        # Стандартная сборка docker build
        BUILD_CMD="docker build -t ${FULL_IMAGE_NAME} ./${module}"
    fi

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} Executing: $BUILD_CMD"
    else
        log_info "Запуск команды: $BUILD_CMD"
        eval "$BUILD_CMD"
        log_success "Модуль '$module' успешно собран!"
    fi

    # Пуш для обычного docker build (если buildx без --push)
    if [ "$PUSH" = true ] && [ -z "$PLATFORM" ]; then
        if [ -z "$REGISTRY" ]; then
            log_warn "Реестр не указан. Пуш пропущен для $FULL_IMAGE_NAME (образ сохранен локально)."
        else
            PUSH_CMD="docker push ${FULL_IMAGE_NAME}"
            if [ "$DRY_RUN" = true ]; then
                echo -e "${YELLOW}[DRY-RUN]${NC} Executing: $PUSH_CMD"
            else
                log_info "Отправка образа в реестр: ${PUSH_CMD}"
                eval "$PUSH_CMD"
                log_success "Образ '${FULL_IMAGE_NAME}' успешно отправлен!"
            fi
        fi
    fi

    BUILT_IMAGES+=("$FULL_IMAGE_NAME")
    echo ""
done

echo -e "${CYAN}=====================================================${NC}"
echo -e "${GREEN}  Сборка всех модулей успешно завершена!             ${NC}"
echo -e "${CYAN}=====================================================${NC}"
echo -e "Собраны следующие образы:"
for img in "${BUILT_IMAGES[@]}"; do
    echo -e " - ${GREEN}${img}${NC}"
done
echo -e "${CYAN}=====================================================${NC}"
