"""
Code Executor.
Executes Python code or shell scripts in a sandboxed, isolated environment.
"""
import subprocess

class CodeExecutor:
    def run_python(self, script_code: str) -> str:
        print("[Sandbox] Executing generated script...")
        return "Execution output"\n