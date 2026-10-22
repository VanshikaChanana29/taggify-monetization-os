#!/usr/bin/env bash
# Start the API, wait until it answers, then open the website on Render's $PORT.
# Render holds incoming requests until the port opens, so nobody reaches the site
# before the API is ready. If either process stops, the container exits and Render
# restarts it.
set -euo pipefail

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
