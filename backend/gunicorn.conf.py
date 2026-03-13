# gunicorn.conf.py
import multiprocessing
import os

# Server socket
bind = "0.0.0.0:8000"
backlog = 2048

# Worker processes
# 2 * cores + 1 is a standard recommendation
# For 2 vCPU, we use 4 workers to handle I/O bound tasks (database/API calls)
workers = 4
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 60
keepalive = 2

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

def post_fork(server, worker):
    """
    Called just after a worker has been forked.
    We ensure the SQLAlchemy engine is disposed so each worker 
    creates its own fresh connection pool.
    """
    from app.core.database import engine
    import asyncio
    
    server.log.info("Worker spawned (pid: %s)", worker.pid)
    
    # Synchronous dispose is safe here
    engine.sync_engine.dispose()
