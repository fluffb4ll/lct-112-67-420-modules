#!/bin/sh
# Разовая докачка весов в том /models (сервис models в docker-compose.yml).
# Уже скачанное не трогается, поэтому повторный запуск мгновенный, а после первого
# запуска ИИ-контур работает без сети. Без сети при первом запуске — пропускаем:
# ИИ-контур поднимется на правилах, голос — через браузер.
#
#   LLM        — GGUF для llama.cpp (оценка карточек, текст сценариев), по умолчанию Qwen2.5-1.5B
#   whisper    — faster-whisper small (распознавание доклада)
#   piper      — голоса irina (женский) и denis (мужской)
#
# Целостность. У каждого файла известен sha256 (для своей LLM по DDS_LLM_MODEL_URL —
# DDS_LLM_MODEL_SHA256, без него не проверяется; хеш Qwen по умолчанию — только для URL и пути
# по умолчанию). Файл проверяется после скачивания и один раз для уже лежащего в томе; итог
# запоминается в <файл>.sha256 (хеш и размер), чтобы не считать гигабайт при каждом запуске.
# Не совпал уже лежавший файл LLM — он переименовывается в <файл>.bad (это может быть своя
# модель) и скачивается заново; .bad удаляется следующим запуском, когда модель на его месте
# проверена, — том не копит гигабайты, а у хозяина своей модели есть запуск, чтобы её забрать
# (лог об этом пишет). Whisper и голоса — наши файлы: несовпавший удаляется сразу. Не совпал
# только что скачанный — удаляется, следующий запуск скачает снова. Не удалось переименовать
# или переместить — пишем в лог и файл не трогаем.
# DDS_FETCH_VERIFY=0 — не проверять; DDS_FETCH_LLM=0 — не трогать LLM.
# Недокачанный <файл>.part старше суток удаляется: файл на сервере мог смениться, и докачка
# с места обрыва склеила бы две версии. Ответ 416 на докачку (.part не меньше файла на
# сервере) — тоже скачать заново.
set -u

HF=${DDS_HF_BASE:-https://huggingface.co}
DIR=${DDS_MODELS_DIR:-/models}
LLM_DEFAULT=$HF/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
LLM_URL=${DDS_LLM_MODEL_URL:-$LLM_DEFAULT}
LLM_PATH_DEFAULT=$DIR/llm/model.gguf
LLM_PATH=${DDS_LLM_MODEL_PATH:-$LLM_PATH_DEFAULT}
LLM_SHA=${DDS_LLM_MODEL_SHA256:-}
if [ -z "$LLM_SHA" ] && [ "$LLM_URL" = "$LLM_DEFAULT" ] && [ "$LLM_PATH" = "$LLM_PATH_DEFAULT" ]; then
  LLM_SHA=6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e
fi
WHISPER=$HF/Systran/faster-whisper-small/resolve/main
PIPER=$HF/rhasspy/piper-voices/resolve/main/ru/ru_RU
VERIFY=${DDS_FETCH_VERIFY:-1}

size_of() { wc -c <"$1" | tr -d ' '; }

verified() { # dest sha [keep] — файл совпадает с хешем (по отметке или пересчётом)
  [ "$VERIFY" = 1 ] && [ -n "$2" ] || return 0
  mark="$1.sha256"
  if [ -f "$mark" ] && [ "$(cat "$mark")" = "$2 $(size_of "$1")" ]; then
    return 0
  fi
  echo "проверяю sha256 $1"
  if [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ]; then
    echo "$2 $(size_of "$1")" >"$mark"
    return 0
  fi
  rm -f "$mark"
  if [ "${3:-}" = keep ]; then
    echo "sha256 не совпал: $1 — переименовываю в $1.bad (удалится следующим запуском) и скачиваю заново"
    mv -f "$1" "$1.bad" || echo "не удалось переименовать $1 в $1.bad"
  elif [ -n "${3:-}" ]; then
    echo "sha256 не совпал: $1 — удаляю и скачиваю заново"
    rm -f "$1"
  else
    echo "sha256 не совпал у скачанного $1 — удаляю (скачается при следующем запуске)"
    rm -f "$1"
  fi
  return 1
}

download() { # url dest
  mkdir -p "$(dirname "$2")"
  part="$2.part"
  if [ -f "$part" ] && [ -n "$(find "$part" -mmin +1440 2>/dev/null)" ]; then
    echo "старый недокачанный $part — начинаю заново"
    rm -f "$part"
  fi
  echo "скачиваю $1"
  get "$1" "$part"
  rc=$?
  if [ "$rc" = 0 ] && [ "$code" = 416 ]; then
    # curl считает 416 на докачку успехом и не пишет тело: .part не меньше файла на сервере,
    # то есть он либо целый, либо от другой версии — проверить нечем, качаем заново
    echo "докачка $part отклонена сервером (416) — скачиваю заново"
    rm -f "$part"
    get "$1" "$part"
    rc=$?
    [ "$code" = 416 ] && rc=22
  fi
  if [ "$rc" = 0 ]; then
    if mv -f "$part" "$2"; then
      return 0
    fi
    echo "не удалось переместить $part в $2 — пропускаю"
    return 1
  fi
  echo "не скачалось: $1 — пропускаю (докачается при следующем запуске)"
  return 1
}

get() { # url part — в $code HTTP-код (000 у file://)
  # обрыв посреди большого файла (curl: 56) — повторяем и докачиваем с места обрыва;
  # недокачанный .part остаётся, следующий запуск продолжит его
  code=$(curl -fL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20 \
    -C - -o "$2" -w '%{http_code}' "$1")
}

fetch() { # url dest [sha256 [keep]] — keep: несовпавший лежавший файл отложить в .bad
  sha=${3:-}
  if [ -s "$2" ]; then
    if verified "$2" "$sha" "${4:-drop}"; then
      if [ -e "$2.bad" ]; then
        echo "$2 проверен — удаляю $2.bad, отложенный прошлым запуском"
        rm -f "$2.bad"
      fi
      return 0
    fi
    if [ -e "$2" ]; then
      echo "$2 не совпал и не отложен — не скачиваю поверх"
      return 0
    fi
  fi
  download "$1" "$2" && verified "$2" "$sha"
  return 0
}

[ "${DDS_FETCH_LLM:-1}" = 1 ] && fetch "$LLM_URL" "$LLM_PATH" "$LLM_SHA" keep

fetch "$WHISPER/model.bin" "$DIR/whisper-small/model.bin" \
  3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671
fetch "$WHISPER/config.json" "$DIR/whisper-small/config.json" \
  b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828
fetch "$WHISPER/tokenizer.json" "$DIR/whisper-small/tokenizer.json" \
  fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab
fetch "$WHISPER/vocabulary.txt" "$DIR/whisper-small/vocabulary.txt" \
  34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913

voice() { # имя ext sha256
  fetch "$PIPER/$1/medium/ru_RU-$1-medium.$2" "$DIR/piper/ru_RU-$1-medium.$2" "$3"
}
voice irina onnx 8ff38212d23da300bbe3705c645e6e5b9475f0bfde01558eb17813e22acaaaaa
voice irina onnx.json c2ec28bb38e2b59e93b959b3e40348c1afebbd272f30fed5d41205d08e98a9d7
voice denis onnx 15fab56e11a097858ee115545d0f697fc2a316c41a291a5362349fb870411b0a
voice denis onnx.json 831c860dac0b5073eaa81610a0a638ec23d90a6cf8e5f871b4485c2cec3767c8

# ИИ-контур работает под uid 10001 (ai/Dockerfile); владельца тома выставляет и сервис models
chown -R 10001 "$DIR" 2>/dev/null
exit 0
