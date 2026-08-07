# check_gunicorn_env.py
import subprocess
import os

def check_live_gunicorn_env():
    print("="*60)
    print("🔍 LIVE GUNICORN/UVICORN ENVIRONMENT DIAGNOSTIC")
    print("="*60)
    
    try:
        # Find pids of running gunicorn or uvicorn processes
        cmd = "pgrep -f 'gunicorn|uvicorn'"
        output = subprocess.check_output(cmd, shell=True).decode().strip()
        pids = [p for p in output.split("\n") if p]
    except subprocess.CalledProcessError:
        print("❌ No active Gunicorn or Uvicorn processes found running in background.")
        print("👉 Run: sudo systemctl start gunicorn")
        return

    print(f"Found {len(pids)} running Gunicorn/Uvicorn processes: PIDs = {pids}\n")
    
    env_vars_to_check = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "GEMINI_API_KEY"]
    
    for pid in pids:
        environ_file = f"/proc/{pid}/environ"
        if not os.path.exists(environ_file):
            print(f"⚠️ PID {pid}: Cannot access /proc/{pid}/environ (process may have recycled or permission denied). Try running as sudo.")
            continue
            
        try:
            with open(environ_file, "rb") as f:
                raw_env = f.read()
                
            # Environ file has null-byte separated variables (VAR=VAL\x00)
            env_pairs = raw_env.split(b"\x00")
            env_dict = {}
            for pair in env_pairs:
                if b"=" in pair:
                    try:
                        k, v = pair.split(b"=", 1)
                        env_dict[k.decode('utf-8', errors='ignore')] = v.decode('utf-8', errors='ignore')
                    except Exception:
                        pass
            
            print(f"--- Checking Process PID: {pid} ---")
            has_keys = True
            for var in env_vars_to_check:
                val = env_dict.get(var)
                if val:
                    # Obfuscate key for security
                    masked = val[:8] + "..." + val[-6:] if len(val) > 14 else "set but too short"
                    print(f"  ✅ {var}: Loaded ({masked}) (Len: {len(val)})")
                else:
                    print(f"  ❌ {var}: MISSING / NOT LOADED!")
                    has_keys = False
            
            if has_keys:
                print(f"  🎉 PID {pid} has successfully loaded all Langfuse configurations!")
            else:
                print(f"  ⚠️ PID {pid} is running without Langfuse active.")
                
        except PermissionError:
            print(f"❌ Permission Denied reading environment for PID {pid}. Please run with sudo:")
            print(f"   👉 sudo python check_gunicorn_env.py")
        except Exception as e:
            print(f"❌ Error inspecting PID {pid}: {e}")
        print("-" * 50)

if __name__ == "__main__":
    check_live_gunicorn_env()
