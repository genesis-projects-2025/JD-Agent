# gunicorn.conf.py
# TUNED for 2 GB RAM EC2 + Aiven PostgreSQL (remote DB, ~5-15 ms latency)

import multiprocessing
import os

# ── Network ──────────────────────────────────────────────────────────────────
bind = "0.0.0.0:8000"
backlog = 1024

# ── Workers ───────────────────────────────────────────────────────────────────
# Rule of thumb: 2 * vCPUs + 1.
# BUT on 2 GB RAM each uvicorn worker uses ~120-200 MB,
# so 4 workers = up to 800 MB just for workers → easy OOM.
# 2 workers is safe and still handles many concurrent async requests
# because uvicorn workers are async internally.
workers = 2
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 500  # async connections per worker

# ── Timeouts ─────────────────────────────────────────────────────────────────
# Gemini API calls take 5-30 s — raise timeout so workers aren't killed mid-LLM
timeout = 120
keepalive = 5
graceful_timeout = 30

# ── Performance ──────────────────────────────────────────────────────────────
# Use RAM-backed /dev/shm for worker temp files (faster than disk)
worker_tmp_dir = "/dev/shm"

# Preload app code before forking workers
# → each worker shares the same Python bytecode in memory (COW)
# → reduces per-worker RAM by ~30-50 MB
preload_app = True

# ── Logging ───────────────────────────────────────────────────────────────────
accesslog = "-"
errorlog = "-"
loglevel = "warning"  # "info" in dev; "warning" in prod reduces I/O


# ── Post-fork hook ────────────────────────────────────────────────────────────
def post_fork(server, worker):
    """
    Called after each worker is forked.
    Dispose the SQLAlchemy engine so every worker gets its own
    fresh connection pool (avoids sharing file descriptors across fork).
    """
    from app.core.database import engine

    server.log.info("Worker spawned (pid: %s)", worker.pid)
    engine.sync_engine.dispose()
