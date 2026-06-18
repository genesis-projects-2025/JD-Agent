#!/bin/bash
# Run uvicorn in development mode, watching ONLY app/ directory
# This prevents the venv/ reload loop
set -e

# Activate venv if present
if [ -d "venv_dev.nosync" ]; then
  source venv_dev.nosync/bin/activate
elif [ -d "venv.nosync" ]; then
  source venv.nosync/bin/activate
elif [ -d "venv" ]; then
  source venv/bin/activate
fi

echo "Starting JD-Agent backend (dev mode)..."
echo "Watching: app/ directory only (venv excluded)"

uvicorn app.main:app \
  --reload \
  --reload-dir app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info
