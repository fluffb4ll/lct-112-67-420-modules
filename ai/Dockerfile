# syntax=docker/dockerfile:1
# ИИ-контур тренажёра диспетчера ДДС — HTTP-сервис (docs/ai/deploy.md).
# Контекст сборки — папка ai/:  docker build -t dds-ai ai/
#
# Аргументы:
#   EXTRAS  — дополнительные зависимости через запятую. По умолчанию локальная LLM
#             (llama.cpp), распознавание (faster-whisper) и синтез речи (Piper).
#             EXTRAS="" — лёгкий образ только на правилах, без компилятора.
#   LLAMA_CPU_INDEX — индекс готовых колёс llama.cpp под CPU. Без него pip собирает её из
#             исходников, и это те самые 200–300 секунд на шаге установки. Если индекс
#             недоступен, pip вернётся к сборке из исходников — образ соберётся всё равно.
# Веса моделей в образ не кладутся: их докачивает в том /models сервис models из
# docker-compose.yml (ai/docker/fetch-models.sh); пути задаются DDS_LLM_MODEL_PATH,
# DDS_STT_MODEL, DDS_TTS_VOICE_PATH, DDS_TTS_VOICE_PATH_MALE.

FROM python:3.11-slim

ARG EXTRAS="llm-llamacpp,voice-fasterwhisper,voice-piper"
ARG LLAMA_CPU_INDEX="https://abetlen.github.io/llama-cpp-python/whl/cpu"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DDS_AI_PORT=8090

WORKDIR /app

# Компилятор остаётся как запасной путь: на случай, если готового колеса не нашлось
RUN if [ -n "$EXTRAS" ]; then \
      apt-get update && apt-get install -y --no-install-recommends build-essential cmake \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# llama.cpp — отдельным слоем и готовым колесом. --prefer-binary обязателен: на PyPI лежат
# только исходники, и без него pip возьмёт версию новее колеса и снова пойдёт компилировать.
RUN --mount=type=cache,target=/root/.cache/pip \
    case "$EXTRAS" in *llm-llamacpp*) \
      pip install --prefer-binary --extra-index-url "$LLAMA_CPU_INDEX" "llama-cpp-python>=0.3" ;; \
    esac

# Зависимости ставим до исходников: правка кода не должна тянуть за собой переустановку
# llama.cpp, ctranslate2 и onnxruntime. Пакет ставится в editable-режиме (пути к config/ и
# data/ считаются от исходников), поэтому здесь достаточно пустого пакета-заглушки —
# настоящие файлы лягут следующим слоем на то же место.
COPY pyproject.toml README.md ./
RUN --mount=type=cache,target=/root/.cache/pip \
    mkdir -p src/dds_ai && touch src/dds_ai/__init__.py \
    && pip install --prefer-binary -e ".[service${EXTRAS:+,$EXTRAS}]"

COPY src ./src
COPY config ./config
COPY data ./data

RUN useradd --system --uid 10001 dds && mkdir -p /models && chown dds /models
USER dds

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"DDS_AI_PORT\"]}/health', timeout=4)"

CMD ["python", "-m", "dds_ai.service"]
