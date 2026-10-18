#!/usr/bin/env bash
# Разовый замер LLM-судьи доклада (run_judge_bench.py) на стенде временным контейнером.
#
# Два прогона: DDS_JUDGE_REPORT_FACTS=0 (как в сервисе) и =1, все ядра (--threads $(nproc)),
# пиковая память — по docker stats. Рабочие контейнеры стенда не останавливаются и не меняются:
# из них только читаются имя образа, том с моделью и путь к модели (docker inspect).
#
# На сервере (рядом лежат ai/src и ai/bench, например клон репозитория):
#     bash ai/bench/stand-bench.sh [--results DIR] [--dry-run]
# С машины разработчика по ssh (копирует ai/src и ai/bench в /tmp/judge-bench на сервере,
# результаты забирает обратно в ./judge-bench-results-*):
#     bash ai/bench/stand-bench.sh --ssh lct-112-user@93.77.165.200 --port 738
#
# Переопределения: IMAGE=dds-ai:latest VOLUME=dds-trainer_ai_models MODEL=/models/llm/model.gguf
# BENCH_MEMORY=3g (лимит памяти контейнера бенча) MIN_FREE_MB=2500 (меньше свободной — отказ).
set -euo pipefail

WORK=/tmp/judge-bench
STAMP=$(date +%Y%m%d-%H%M%S)
RESULTS=""
SSH_TARGET=""
SSH_PORT=22
DRY_RUN=0

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --results) RESULTS=$2; shift 2 ;;
    --ssh) SSH_TARGET=$2; shift 2 ;;
    --port) SSH_PORT=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "неизвестный аргумент: $1" >&2; usage >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
AI_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
if [ ! -f "$AI_ROOT/src/dds_ai/bridge/evaluate.py" ] || [ ! -f "$AI_ROOT/bench/run_judge_bench.py" ]; then
  echo "не найдены ai/src и ai/bench рядом со скриптом ($AI_ROOT)" >&2
  exit 1
fi

# --- режим ssh: скопировать, запустить на сервере, забрать результаты -----------------------
if [ -n "$SSH_TARGET" ]; then
  RESULTS=${RESULTS:-$PWD/judge-bench-results-$STAMP}
  remote_results="judge-bench-results-$STAMP"
  remote_args=(--results "$remote_results")
  [ "$DRY_RUN" = 1 ] && remote_args+=(--dry-run)
  ssh_cmd=(ssh -p "$SSH_PORT" "$SSH_TARGET")
  echo "копирую ai/src и ai/bench в $SSH_TARGET:$WORK/ai"
  COPYFILE_DISABLE=1 tar czf - --no-xattrs --exclude=__pycache__ --exclude='*.pyc' -C "$AI_ROOT" src bench \
    | "${ssh_cmd[@]}" "rm -rf $WORK && mkdir -p $WORK/ai && tar xzf - -C $WORK/ai"
  status=0
  # переменные окружения-переопределения передаются как есть
  "${ssh_cmd[@]}" "IMAGE='${IMAGE:-}' VOLUME='${VOLUME:-}' MODEL='${MODEL:-}' \
    BENCH_MEMORY='${BENCH_MEMORY:-}' MIN_FREE_MB='${MIN_FREE_MB:-}' \
    bash $WORK/ai/bench/stand-bench.sh $(printf '%q ' "${remote_args[@]}")" || status=$?
  mkdir -p "$RESULTS"
  scp -q -P "$SSH_PORT" -r "$SSH_TARGET:$remote_results/." "$RESULTS/" || true
  "${ssh_cmd[@]}" "rm -rf $WORK" || true
  echo "результаты: $RESULTS (на сервере: ~/$remote_results)"
  exit "$status"
fi

# --- режим сервера ---------------------------------------------------------------------------
RESULTS=${RESULTS:-$PWD/judge-bench-results-$STAMP}
mkdir -p "$RESULTS"
RESULTS=$(cd "$RESULTS" && pwd)
# контейнер пишет JSON от своего пользователя (dds), а не от владельца каталога
chmod a+rwx "$RESULTS"

# на стенде docker доступен только через sudo
if ! docker info >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  docker() { sudo -n docker "$@"; }
fi

# копия кода: ai/src и ai/bench в /tmp/judge-bench (если скрипт уже оттуда — как есть)
if [ "$AI_ROOT" != "$WORK/ai" ]; then
  rm -rf "$WORK"
  mkdir -p "$WORK/ai"
  cp -R "$AI_ROOT/src" "$AI_ROOT/bench" "$WORK/ai/"
fi
CONTAINER=""
# shellcheck disable=SC2317  # вызывается из trap
cleanup() {
  if [ -n "$CONTAINER" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# рабочий контейнер ИИ (только чтение настроек)
live=$(docker ps -a --format '{{.Names}}' | grep -E '(^|[-_])dds-ai([-_][0-9]+)?$' | head -n1 || true)
if [ -z "${IMAGE:-}" ]; then
  [ -n "$live" ] && IMAGE=$(docker inspect --format '{{.Config.Image}}' "$live")
  [ -z "${IMAGE:-}" ] && IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '(^|/)dds-ai:' | grep -v ':<none>' | head -n1 || true)
fi
if [ -z "${VOLUME:-}" ]; then
  [ -n "$live" ] && VOLUME=$(docker inspect \
    --format '{{range .Mounts}}{{if eq .Destination "/models"}}{{.Name}}{{end}}{{end}}' "$live")
  [ -z "${VOLUME:-}" ] && VOLUME=$(docker volume ls --format '{{.Name}}' \
    | grep -E '(^|_)ai_models$' | head -n1 || true)
fi
if [ -z "${MODEL:-}" ]; then
  [ -n "$live" ] && MODEL=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "$live" | sed -n 's/^DDS_LLM_MODEL_PATH=//p' | head -n1)
  MODEL=${MODEL:-/models/llm/model.gguf}
fi
BENCH_MEMORY=${BENCH_MEMORY:-3g}
MIN_FREE_MB=${MIN_FREE_MB:-2500}
THREADS=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN)

if [ -z "${IMAGE:-}" ] || [ -z "${VOLUME:-}" ]; then
  echo "не найден образ dds-ai ('${IMAGE:-}') или том с моделью ('${VOLUME:-}'); задайте IMAGE= и VOLUME=" >&2
  exit 1
fi

{
  echo "date: $(date '+%Y-%m-%dT%H:%M:%S%z')"
  echo "host: $(uname -a)"
  echo "cpu: $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ //')"
  echo "nproc: $THREADS"
  if command -v lscpu >/dev/null; then lscpu | grep -E '^(Thread|Core|Socket)' || true; fi
  if command -v free >/dev/null; then free -m; fi
  echo "live container: ${live:-нет}"
  echo "image: $IMAGE ($(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo '?'))"
  echo "volume: $VOLUME"
  echo "model: $MODEL"
  echo "bench memory limit: $BENCH_MEMORY"
} | tee "$RESULTS/env.txt"

if command -v free >/dev/null && [ "$DRY_RUN" = 0 ]; then
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  if [ -n "$avail" ] && [ "$avail" -lt "$MIN_FREE_MB" ]; then
    echo "свободно ${avail} МБ < MIN_FREE_MB=${MIN_FREE_MB}: бенч не запускаю" >&2
    exit 1
  fi
fi

# "1.23GiB / 7.6GiB" -> МиБ
to_mib() {
  awk -v v="${1%% *}" 'BEGIN {
    n = v + 0; u = v; sub(/^[0-9.]+/, "", u)
    f["B"] = 1/1048576; f["KiB"] = 1/1024; f["MiB"] = 1; f["GiB"] = 1024
    f["kB"] = 1000/1048576; f["MB"] = 1e6/1048576; f["GB"] = 1e9/1048576
    printf "%.0f", n * (u in f ? f[u] : 0)
  }'
}

run_bench() {
  local facts=$1 name="judge-bench-$$-facts$1"
  local out="judge-1.5b-facts$facts-c$THREADS"
  local cmd=(docker run --rm --name "$name" --memory "$BENCH_MEMORY"
    -v "$VOLUME:/models:ro" -v "$WORK/ai:/repo/ai:ro" -v "$RESULTS:/out"
    -e PYTHONPATH=/repo/ai/src -e PYTHONDONTWRITEBYTECODE=1 -e "DDS_JUDGE_REPORT_FACTS=$facts"
    --entrypoint python "$IMAGE" /repo/ai/bench/run_judge_bench.py
    --model "$MODEL" --threads "$THREADS" --json "/out/$out.json")
  echo "== DDS_JUDGE_REPORT_FACTS=$facts: ${cmd[*]}"
  if [ "$DRY_RUN" = 1 ]; then return 0; fi

  CONTAINER=$name
  local start peak=0 cur pid status=0
  start=$(date +%s)
  "${cmd[@]}" >"$RESULTS/$out.log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    cur=$(docker stats --no-stream --format '{{.MemUsage}}' "$name" 2>/dev/null || true)
    if [ -n "$cur" ]; then
      cur=$(to_mib "$cur")
      [ "$cur" -gt "$peak" ] && peak=$cur
    fi
    sleep 2
  done
  wait "$pid" || status=$?
  CONTAINER=""
  echo "facts=$facts exit=$status wall=$(($(date +%s) - start))s peak_mem=${peak}MiB" \
    | tee -a "$RESULTS/summary.txt"
  tail -n 30 "$RESULTS/$out.log"
  return "$status"
}

status=0
run_bench 0 || status=$?
run_bench 1 || status=$?
echo "результаты: $RESULTS"
exit "$status"
