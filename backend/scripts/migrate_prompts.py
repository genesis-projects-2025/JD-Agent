# backend/scripts/migrate_prompts.py
import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
sys.path.append(str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

from langfuse import Langfuse
from app.agents import prompts

def migrate():
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    base_url = os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com")

    if not public_key or not secret_key:
        print("Error: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set in your environment or backend/.env file.")
        print("Please check backend/.env and provide your API keys.")
        sys.exit(1)

    print(f"Connecting to Langfuse at {base_url}...")
    try:
        langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=base_url
        )
        # Verify connection
        langfuse.auth_check()
        print("Successfully authenticated with Langfuse.")
    except Exception as e:
        print(f"Connection/Auth check failed: {e}")
        sys.exit(1)

    prompts_to_migrate = [
        {"name": "jd-generation-prompt", "prompt": prompts.JD_GENERATION_PROMPT, "type": "text"},
        {"name": "critic-engine-prompt", "prompt": prompts.CRITIC_PROMPT, "type": "text"},
        {"name": "extraction-engine-prompt", "prompt": prompts.EXTRACTION_PROMPT, "type": "text"},
        {"name": "gap-detector-prompt", "prompt": prompts.GAP_DETECTOR_PROMPT, "type": "text"},
        {"name": "kra-kpi-interview-prompt", "prompt": prompts.KRA_KPI_SYSTEM_PROMPT, "type": "text"},
        {"name": "kra-suggestion-prompt", "prompt": prompts.KRA_SUGGESTION_PROMPT, "type": "text"},
        {"name": "kpi-suggestion-prompt", "prompt": prompts.KPI_SUGGESTION_PROMPT, "type": "text"},
    ]

    print(f"Found {len(prompts_to_migrate)} prompts to migrate.")
    for p in prompts_to_migrate:
        name = p["name"]
        print(f"Uploading prompt '{name}'...")
        try:
            langfuse.create_prompt(
                name=name,
                type=p["type"],
                prompt=p["prompt"],
                labels=["production"]
            )
            print(f"Successfully uploaded '{name}' as production.")
        except Exception as e:
            print(f"Failed to upload '{name}': {e}")

    print("Prompt migration completed!")

if __name__ == "__main__":
    migrate()
