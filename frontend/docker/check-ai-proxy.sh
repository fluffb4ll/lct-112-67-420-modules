#!/usr/bin/env bash
# Проверка nginx фронта для /ai/: вход через auth_request, белый список путей, лимиты.
# Поднимает изолированно (своя docker-сеть, порт 127.0.0.1:18081) nginx с docker/nginx.conf.template
# и две заглушки: бэкенд (/api/auth/check: кука AUTH_TOKEN, начинающаяся с 900d, — 204, иначе 401)
# и ИИ-контур (200 на всё, в ответе — путь, который до него дошёл). После проверки всё удаляется.
#
#   bash frontend/docker/check-ai-proxy.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${CHECK_PORT:-18081}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:1.27-alpine}"
STUB_IMAGE="${STUB_IMAGE:-python:3.12-alpine}"
ID="ddscheck$$"
NET="$ID-net"
TMP="$(mktemp -d)"
BASE="http://127.0.0.1:$PORT"

cleanup() {
  docker rm -f "$ID-nginx" "$ID-backend" "$ID-ai" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

cat >"$TMP/stub.py" <<'EOF'
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROLE = sys.argv[1]

class H(BaseHTTPRequestHandler):
    def _reply(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        if ROLE == "backend":
            if self.path != "/api/auth/check":
                return self._reply(404)
            if self.command != "GET":  # как Spring на GET-маппинге
                return self._reply(405)
            if n:  # подзапрос auth_request не должен тащить тело (запись STT)
                return self._reply(400)
            cookies = dict(c.strip().split("=", 1) for c in (self.headers.get("Cookie") or "").split(";") if "=" in c)
            return self._reply(204 if cookies.get("AUTH_TOKEN", "").startswith("900d") else 401)
        self._reply(200, f"{self.command} {self.path} {n}".encode())

    do_GET = do_POST = _handle

    def log_message(self, *a):
        pass

ThreadingHTTPServer(("0.0.0.0", int(sys.argv[2])), H).serve_forever()
EOF

docker network create "$NET" >/dev/null || exit 1
docker run -d --name "$ID-backend" --network "$NET" --network-alias backend -v "$TMP/stub.py:/stub.py:ro" \
  "$STUB_IMAGE" python /stub.py backend 8080 >/dev/null || exit 1
docker run -d --name "$ID-ai" --network "$NET" --network-alias ai -v "$TMP/stub.py:/stub.py:ro" \
  "$STUB_IMAGE" python /stub.py ai 8090 >/dev/null || exit 1
docker run -d --name "$ID-nginx" --network "$NET" -p "127.0.0.1:$PORT:80" \
  -e BACKEND_URL=http://backend:8080 -e AI_URL=http://ai:8090 -e 'NGINX_ENVSUBST_FILTER=^(BACKEND_URL|AI_URL)$' \
  -v "$HERE/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro" "$NGINX_IMAGE" >/dev/null || exit 1

for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200 ] && break
  sleep 0.5
done
docker exec "$ID-nginx" nginx -t 2>&1 | sed 's/^/nginx -t: /'

FAILS=0
# check <ожидаемый код> <описание> <аргументы curl...>
check() {
  local want="$1" what="$2"; shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [ "$got" = "$want" ]; then echo "OK    $got  $what"; else echo "FAIL  $got (ждали $want)  $what"; FAILS=$((FAILS + 1)); fi
}
# запросы подряд; печатает коды через пробел
burst() {
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do curl -s -o /dev/null -w '%{http_code} ' "$@"; done
}
# лимит на адрес (50 r/s, burst 100) общий для всех проверок — даём ему восстановиться
rest() { sleep 2.5; }

# кука входа — UUID, как у бэкенда; заглушка бэкенда пускает те, что начинаются на 900d
GOOD='Cookie: AUTH_TOKEN=900d0000-0000-0000-0000-000000000001'
BAD='Cookie: AUTH_TOKEN=00000000-0000-0000-0000-000000000000'
JSON='Content-Type: application/json'

echo "== вход"
check 401 "GET  /ai/v1/voice без куки"                 "$BASE/ai/v1/voice"
check 401 "GET  /ai/v1/voice с чужой кукой"            -H "$BAD" "$BASE/ai/v1/voice"
check 401 "POST /ai/v1/tts без куки"                   -X POST -H "$JSON" -d '{"text":"т"}' "$BASE/ai/v1/tts"
check 401 "POST /ai/v1/tts с чужой кукой"              -X POST -H "$JSON" -H "$BAD" -d '{"text":"т"}' "$BASE/ai/v1/tts"
check 401 "POST /ai/v1/stt без куки"                   -X POST -H "$BAD" --data-binary 'x' "$BASE/ai/v1/stt"
check 401 "POST /ai/v1/scenarios/compose без куки"     -X POST -H "$JSON" -d '{}' "$BASE/ai/v1/scenarios/compose"
check 200 "GET  /ai/v1/voice после входа"              -H "$GOOD" "$BASE/ai/v1/voice"
check 200 "POST /ai/v1/tts после входа"                -X POST -H "$JSON" -H "$GOOD" -d '{"text":"т"}' "$BASE/ai/v1/tts"
check 200 "POST /ai/v1/stt после входа"                -X POST -H "$GOOD" --data-binary 'x' "$BASE/ai/v1/stt?hints=a,b"
check 200 "POST /ai/v1/scenarios/compose после входа"  -X POST -H "$JSON" -H "$GOOD" -d '{}' "$BASE/ai/v1/scenarios/compose"
check 204 "GET  /api/auth/check через /api"            -H "$GOOD" "$BASE/api/auth/check"
check 200 "GET  / (статика без входа)"                 "$BASE/"
seen="$(curl -s -X POST -H "$GOOD" --data-binary 'xyz' "$BASE/ai/v1/stt?hints=a,b")"
if [ "$seen" = "POST /v1/stt?hints=a,b 3" ]; then echo "OK    ИИ-контур получил: $seen"; else echo "FAIL  ИИ-контур получил: $seen"; FAILS=$((FAILS + 1)); fi

rest
echo "== только то, что зовёт фронт"
check 404 "/ai/health"                                 -H "$GOOD" "$BASE/ai/health"
check 404 "/ai/api/v1/ai/evaluate"                     -X POST -H "$GOOD" -d '{}' "$BASE/ai/api/v1/ai/evaluate"
check 404 "/ai/v1/attempts"                            -X POST -H "$GOOD" -d '{}' "$BASE/ai/v1/attempts"
check 404 "/ai/v1/contracts без входа"                 "$BASE/ai/v1/contracts"

rest
echo "== размер записи STT"
head -c 9000000 /dev/zero >"$TMP/9m"
head -c 11000000 /dev/zero >"$TMP/11m"
head -c 2000000 /dev/zero >"$TMP/2m"
check 200 "POST /ai/v1/stt 9 МБ"                       -X POST -H "$GOOD" --data-binary "@$TMP/9m" "$BASE/ai/v1/stt"
check 413 "POST /ai/v1/stt 11 МБ"                      -X POST -H "$GOOD" --data-binary "@$TMP/11m" "$BASE/ai/v1/stt"
check 413 "POST /ai/v1/tts 2 МБ"                       -X POST -H "$GOOD" -H "$JSON" --data-binary "@$TMP/2m" "$BASE/ai/v1/tts"

# лимит: в выводе ровно столько 200, сколько пропускает burst+1, дальше 429
limit() {
  local what="$1" want_ok="$2" n="$3"; shift 3
  rest
  local codes ok tooMany
  codes="$(burst "$n" "$@")"
  ok="$(grep -o 200 <<<"$codes" | wc -l | tr -d ' ')"
  tooMany="$(grep -o 429 <<<"$codes" | wc -l | tr -d ' ')"
  if [ "$ok" -ge "$want_ok" ] && [ "$ok" -le $((want_ok + 1)) ] && [ "$tooMany" -gt 0 ]; then
    echo "OK    $what: $codes"
  else
    echo "FAIL  $what (ждали ~$want_ok×200, затем 429): $codes"; FAILS=$((FAILS + 1))
  fi
}

echo "== лимиты"
limit "compose, 16 подряд (20 r/m, burst 12)" 13 16 -X POST -H "$JSON" -H 'Cookie: AUTH_TOKEN=900d0000-0000-0000-0000-00000000c0de' -d '{}' "$BASE/ai/v1/scenarios/compose"
limit "tts, 20 подряд (2 r/s, burst 10)" 11 20 -X POST -H "$JSON" -H 'Cookie: AUTH_TOKEN=900d0000-0000-0000-0000-0000000000a1' -d '{"text":"т"}' "$BASE/ai/v1/tts"
rest
check 200 "compose другим пользователем не упирается в чужой лимит" -X POST -H "$JSON" -H 'Cookie: AUTH_TOKEN=900d0000-0000-0000-0000-0000000000b2' -d '{}' "$BASE/ai/v1/scenarios/compose"
rest
codes="$(burst 30 -H "$BAD" "$BASE/ai/v1/voice")"
if grep -q 429 <<<"$codes" && ! grep -qv -e 401 -e 429 <<<"$(tr ' ' '\n' <<<"$codes" | grep .)"; then
  echo "OK    перебор без входа, 30 подряд: $codes"
else
  echo "FAIL  перебор без входа (ждали 401, затем 429): $codes"; FAILS=$((FAILS + 1))
fi
rest
# «пришло 401, затем 429» — ни одного другого кода
only401then429() {
  local what="$1" codes="$2"
  if grep -q 429 <<<"$codes" && ! tr ' ' '\n' <<<"$codes" | grep . | grep -qv -e 401 -e 429; then
    echo "OK    $what: $codes"
  else
    echo "FAIL  $what (ждали 401, затем 429): $codes"; FAILS=$((FAILS + 1))
  fi
}
only401then429 "мусорная кука (не UUID) — лимит на адрес, 30 подряд" "$(burst 30 -H 'Cookie: AUTH_TOKEN=garbage' "$BASE/ai/v1/voice")"
rest
# перебор случайных UUID-кук: у каждой свой лимит, держит только общий лимит на адрес (50 r/s, burst 100)
codes="$(seq 1 400 | xargs -P 16 -I{} sh -c 'printf "%s " "$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: AUTH_TOKEN=$(printf "%08x-0000-0000-0000-000000000000" {})" "$0/ai/v1/voice")"' "$BASE")"
summary="$(tr ' ' '\n' <<<"$codes" | grep . | sort | uniq -c | tr -s ' ' | tr '\n' ',')"
only401then429 "перебор случайных UUID-кук, 400 параллельно — итог по кодам [$summary]" "$codes" | sed -E 's/: [0-9 ]+$//'
rest
# повторный вход даёт новый токен — лимит генерации на адрес (60 r/m, burst 30) всё равно держит
codes="$(for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H "$JSON" -H "Cookie: AUTH_TOKEN=$(printf '900d%04x-0000-0000-0000-000000000000' "$i")" -d '{}' "$BASE/ai/v1/scenarios/compose"; done)"
if grep -q 200 <<<"$codes" && grep -q 429 <<<"$codes"; then echo "OK    compose, 40 разных входов с одного адреса: $codes"; else echo "FAIL  compose, 40 разных входов (ждали 200, затем 429): $codes"; FAILS=$((FAILS + 1)); fi

echo
if [ "$FAILS" = 0 ]; then echo "ВСЁ ОК"; else echo "ПРОВАЛОВ: $FAILS"; fi
exit "$FAILS"
