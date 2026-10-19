#!/bin/sh
# Разовая докачка весов в том /models (сервис models в docker-compose.yml).
# Уже скачанное не трогается, поэтому повторный запуск мгновенный, а после первого
# запуска ИИ-контур работает без сети. Без сети при первом запуске — пропускаем:
# ИИ-контур поднимется на правилах, голос — через браузер.
#
#   LLM        — GGUF для llama.cpp (оценка карточек, текст сценариев), по умолчанию Qwen2.5-1.5B
#   whisper    — faster-whisper small (распознавание доклада)
#   piper      — голоса irina (женский) и denis (мужской)
set -u

HF=https://huggingface.co
DIR=/models
LLM_URL=${DDS_LLM_MODEL_URL:-$HF/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf}
LLM_PATH=${DDS_LLM_MODEL_PATH:-$DIR/llm/model.gguf}
WHISPER=$HF/Systran/faster-whisper-small/resolve/main
PIPER=$HF/rhasspy/piper-voices/resolve/main/ru/ru_RU

fetch() { # url dest
  [ -s "$2" ] && return 0
  mkdir -p "$(dirname "$2")"
  echo "скачиваю $1"
  # обрыв посреди большого файла (curl: 56) — повторяем и докачиваем с места обрыва;
  # недокачанный .part остаётся, следующий запуск продолжит его
  if curl -fL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20 \
    -C - -o "$2.part" "$1"; then
    mv "$2.part" "$2"
  else
    echo "не скачалось: $1 — пропускаю (докачается при следующем запуске)"
  fi
}

[ "${DDS_FETCH_LLM:-1}" = 1 ] && fetch "$LLM_URL" "$LLM_PATH"
for f in model.bin config.json tokenizer.json vocabulary.txt; do
  fetch "$WHISPER/$f" "$DIR/whisper-small/$f"
done
for v in irina denis; do
  for ext in onnx onnx.json; do
    fetch "$PIPER/$v/medium/ru_RU-$v-medium.$ext" "$DIR/piper/ru_RU-$v-medium.$ext"
  done
done

# ИИ-контур работает под uid 10001 (ai/Dockerfile); владельца тома выставляет и сервис models
chown -R 10001 "$DIR" 2>/dev/null
exit 0
