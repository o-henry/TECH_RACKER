#!/bin/sh
set -eu

python -m app.wait_for_db

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi

if [ "${RUN_SEED:-true}" = "true" ]; then
  python -m app.cli seed
fi

exec "$@"
