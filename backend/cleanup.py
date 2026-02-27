import re

files_to_clean = {
    "../frontend/hooks/useChat.ts": r"console\.log\(",
    "../frontend/lib/api.ts": r"console\.log\(",
    "../frontend/app/sso/page.tsx": r"console\.log\(",
    "app/services/jd_service.py": r"^\s*#\s*print\(",
    "app/routers/jd_routes.py": r"print\(",
    "app/crud/jd_crud.py": r"print\("
}

for fp, pattern in files_to_clean.items():
    try:
        with open(fp, "r") as f:
            lines = f.readlines()
        
        # Keep lines that do NOT match the pattern
        # Be careful with jd_crud/jd_routes to only remove simple print statements, not traceback.print_exc
        new_lines = []
        for line in lines:
            if re.search(pattern, line) and "traceback" not in line:
                continue
            new_lines.append(line)
            
        with open(fp, "w") as f:
            f.writelines(new_lines)
            
        print(f"Cleaned {fp}")
    except Exception as e:
        print(f"Skipped {fp}: {e}")

