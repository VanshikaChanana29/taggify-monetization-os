#!/usr/bin/env bash
# Start the API, wait until it answers, then open the website on Render's $PORT.
# Render holds incoming requests until the port opens, so nobody reaches the site
# before the API is ready. If either process stops, the container exits and Render
# restarts it.
set -euo pipefail

for var in DATABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set. Add it in Render → this service → Environment, then redeploy." >&2
    exit 1
  fi
done

cd /app/backend
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 &

python - <<'PY'
import time, urllib.request
for _ in range(120):
    try:
        urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=2)
        break
    except Exception:
        time.sleep(0.5)
else:
    raise SystemExit("API did not start")
PY

cd /app/web
PORT="${PORT:-10000}" HOSTNAME=0.0.0.0 node server.js &

wait -n
exit 1
