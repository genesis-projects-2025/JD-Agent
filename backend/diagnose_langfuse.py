# backend/diagnose_langfuse.py
import os
import sys
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("LangfuseDiagnostic")

def run_diagnostics():
    print("=" * 70)
    print("LANGFUSE PRODUCTION DIAGNOSTIC TOOL")
    print("=" * 70)

    # 1. Check Python Version & Path
    print(f"\n[1] Runtime Context:")
    print(f"  Python Version: {sys.version}")
    print(f"  Current Directory: {os.getcwd()}")

    # 2. Check Environment Variables
    pub_key = os.environ.get("LANGFUSE_PUBLIC_KEY")
    sec_key = os.environ.get("LANGFUSE_SECRET_KEY")
    base_url = os.environ.get("LANGFUSE_BASE_URL") or os.environ.get("LANGFUSE_HOST")

    print(f"\n[2] Environment Variables:")
    print(f"  LANGFUSE_PUBLIC_KEY: {pub_key[:10]}... (Len: {len(pub_key)})" if pub_key else "  LANGFUSE_PUBLIC_KEY: MISSING")
    print(f"  LANGFUSE_SECRET_KEY: {sec_key[:10]}... (Len: {len(sec_key)})" if sec_key else "  LANGFUSE_SECRET_KEY: MISSING")
    print(f"  LANGFUSE_BASE_URL  : {base_url}" if base_url else "  LANGFUSE_BASE_URL  : MISSING (Defaults to cloud.langfuse.com)")

    if not pub_key or not sec_key:
        print("\n❌ ERROR: Langfuse keys are missing from this process environment.")
        print("   If you set them in a .env file, ensure your web server process (Gunicorn/PM2) is loading that file,")
        print("   or export them directly in your shell system-wide.")
        return

    # 3. Try to import and instantiate Langfuse
    print(f"\n[3] SDK Initialization:")
    try:
        from langfuse import Langfuse
        print("  Import successful!")
        lf = Langfuse(
            public_key=pub_key,
            secret_key=sec_key,
            host=base_url or "https://cloud.langfuse.com"
        )
        print("  SDK client instantiated successfully.")
    except Exception as e:
        print(f"  ❌ ERROR instantiating SDK client: {e}")
        return

    # 4. Perform API Authenticated Handshake Test
    print(f"\n[4] Connection & API Authentication Handshake:")
    try:
        # A simple lightweight fetch or trace creation to verify auth
        trace = lf.trace(name="diagnostic-test-trace")
        print("  Successfully initiated a trace payload locally.")
        lf.flush()
        print("  Handshake successful (Keys are valid!).")
    except Exception as e:
        print(f"  ❌ ERROR: Authentication handshake failed: {e}")
        print("   This means your API keys are invalid or mismatched for this host.")
        return

    # 5. Fetch and Query Specific Prompts
    print(f"\n[5] Fetching Specific Prompts:")
    prompts_to_test = ["kra-suggestion-prompt", "kpi-suggestion-prompt"]
    for p_name in prompts_to_test:
        print(f"  Querying for prompt: '{p_name}' with label 'production'...")
        try:
            prompt_obj = lf.get_prompt(p_name, label="production")
            print(f"    ✅ SUCCESS! Retrieved '{p_name}'.")
            print(f"    Version: {prompt_obj.version}")
            print(f"    Prompt length: {len(prompt_obj.prompt)} characters.")
        except Exception as e:
            print(f"    ❌ FAILED: {e}")
            print("     Make sure you have:")
            print(f"      1. Created a prompt named exactly '{p_name}' in this project.")
            print("      2. Promoted / labeled the specific version with 'production' (all lowercase).")

    print("\n" + "=" * 70)
    print("DIAGNOSTIC TEST COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    run_diagnostics()
