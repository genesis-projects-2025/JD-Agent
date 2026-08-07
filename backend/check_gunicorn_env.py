# check_gunicorn_env.py
import subprocess
import os

def check_live_gunicorn_env():
    print("="*60)
    print("🔍 UPGRADED LIVE GUNICORN/UVICORN ENVIRONMENT DIAGNOSTIC")
    print("="*60)
    
    try:
        # Find pids of running gunicorn or uvicorn processes
        cmd = "pgrep -f 'gunicorn|uvicorn'"
        output = subprocess.check_output(cmd, shell=True).decode().strip()
        pids = [p for p in output.split("\n") if p]
    except subprocess.CalledProcessError:
        print("❌ No active Gunicorn or Uvicorn processes found running in background.")
        return

    print(f"Found {len(pids)} running Gunicorn/Uvicorn processes: PIDs = {pids}\n")
    
    env_vars_to_check = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "GEMINI_API_KEY"]
    
    for pid in pids:
        environ_file = f"/proc/{pid}/environ"
        cmdline_file = f"/proc/{pid}/cmdline"
        status_file = f"/proc/{pid}/status"
        
        if not os.path.exists(environ_file):
            continue
            
        try:
            # 1. Read command line
            cmdline = ""
            if os.path.exists(cmdline_file):
                with open(cmdline_file, "rb") as f:
                    cmdline_raw = f.read()
                cmdline = cmdline_raw.replace(b"\x00", b" ").decode('utf-8', errors='ignore').strip()
            
            # 2. Read Parent PID (PPID)
            ppid = "Unknown"
            if os.path.exists(status_file):
                with open(status_file, "r") as f:
                    for line in f:
                        if line.startswith("PPid:"):
                            ppid = line.split()[1].strip()
                            break
                            
            # 3. Read parent command line if possible
            parent_cmdline = "Unknown"
            parent_cmdline_file = f"/proc/{ppid}/cmdline"
            if ppid != "Unknown" and os.path.exists(parent_cmdline_file):
                with open(parent_cmdline_file, "rb") as f:
                    p_cmdline_raw = f.read()
                parent_cmdline = p_cmdline_raw.replace(b"\x00", b" ").decode('utf-8', errors='ignore').strip()

            with open(environ_file, "rb") as f:
                raw_env = f.read()
                
            env_pairs = raw_env.split(b"\x00")
            env_dict = {}
            for pair in env_pairs:
                if b"=" in pair:
                    try:
                        k, v = pair.split(b"=", 1)
                        env_dict[k.decode('utf-8', errors='ignore')] = v.decode('utf-8', errors='ignore')
                    except Exception:
                        pass
            
            print(f"--- Process PID: {pid} (Parent PPID: {ppid}) ---")
            print(f"  Command: {cmdline}")
            print(f"  Parent:  {parent_cmdline}")
            
            has_keys = True
            for var in env_vars_to_check:
                val = env_dict.get(var)
                if val:
                    masked = val[:8] + "..." + val[-6:] if len(val) > 14 else "set but too short"
                    print(f"  ✅ {var}: Loaded ({masked})")
                else:
                    print(f"  ❌ {var}: MISSING / NOT LOADED!")
                    has_keys = False
            
            if has_keys:
                print(f"  🎉 PID {pid} has successfully loaded all Langfuse configurations!")
            else:
                print(f"  ⚠️ PID {pid} is running without Langfuse active.")
                
        except PermissionError:
            print(f"❌ Permission Denied reading details for PID {pid}. Please run with sudo.")
        except Exception as e:
            print(f"❌ Error inspecting PID {pid}: {e}")
        print("-" * 60)

if __name__ == "__main__":
    check_live_gunicorn_env()
