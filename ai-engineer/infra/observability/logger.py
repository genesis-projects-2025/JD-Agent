"""
Structured Agent Logger.
Ensures uniform formatting, severity levels, and tags across agent threads.
"""
import logging

class AgentLogger:
    def __init__(self, name: str):
        self.logger = logging.getLogger(name)

    def info(self, msg: str, **kwargs):
        self.logger.info(f"{msg} | meta={kwargs}")\n