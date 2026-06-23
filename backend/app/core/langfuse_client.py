# backend/app/core/langfuse_client.py
import logging
import re
from langfuse import Langfuse
from app.core.config import settings

logger = logging.getLogger(__name__)

# Initialize client if keys are present
langfuse_client = None
if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
    try:
        langfuse_client = Langfuse(
            public_key=settings.LANGFUSE_PUBLIC_KEY,
            secret_key=settings.LANGFUSE_SECRET_KEY,
            host=settings.LANGFUSE_BASE_URL
        )
        logger.info("Langfuse client initialized successfully.")
    except Exception as e:
        logger.warning(f"Failed to initialize Langfuse client: {e}")
else:
    logger.info("Langfuse credentials not set. Using local fallbacks for prompts.")


def compile_local_template(template: str, **kwargs) -> str:
    """Helper to compile a mustache-style prompt template locally."""
    def replace(match):
        key = match.group(1).strip()
        val = kwargs.get(key)
        return str(val) if val is not None else ""
        
    return re.sub(r'\{\{([^{}]+)\}\}', replace, template)


def get_compiled_prompt(name: str, fallback_template: str, **kwargs) -> str:
    """Fetch prompt from Langfuse (production label) and compile it.
    Falls back to compiling the local fallback template if Langfuse is unavailable.
    """
    if langfuse_client:
        try:
            # Fetch prompt from Langfuse
            prompt_obj = langfuse_client.get_prompt(name, label="production")
            # Langfuse compile substitutes variables and returns the string
            compiled = prompt_obj.compile(**kwargs)
            logger.info(f"Fetched and compiled prompt '{name}' from Langfuse.")
            return compiled
        except Exception as e:
            logger.warning(f"Error fetching prompt '{name}' from Langfuse: {e}. Falling back to local template.")
    
    # Fallback compilation
    return compile_local_template(fallback_template, **kwargs)
