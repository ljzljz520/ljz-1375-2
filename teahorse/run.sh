#!/usr/bin/env bash
cd "$(dirname "$0")"
export ADMIN_TOKEN="${ADMIN_TOKEN:-admin-dev-token}"
exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
