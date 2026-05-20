"""
Postgres DB Session Manager.
Manages SQLAlchemy session pools, transaction engines, and auto-rollbacks.
"""
class PostgresManager:
    def __init__(self, db_url: str):
        self.url = db_url\n