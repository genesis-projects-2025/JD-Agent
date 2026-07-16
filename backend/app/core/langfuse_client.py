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


def get_langfuse_callback_handler(trace_name: str = None, session_id: str = None, user_id: str = None, tags: list[str] = None):
    """Retrieve a Langfuse callback handler for LangChain if credentials are set."""
    if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        try:
            from langfuse.langchain import CallbackHandler
            
            class CustomCallbackHandler(CallbackHandler):
                def __init__(self, trace_name_val=None, session_id_val=None, user_id_val=None, tags_val=None, **kwargs):
                    super().__init__(**kwargs)
                    self._default_trace_name = trace_name_val
                    self._default_session_id = session_id_val
                    self._default_user_id = user_id_val
                    self._default_tags = tags_val

                def _parse_langfuse_trace_attributes(self, *, metadata=None, tags=None):
                    meta_to_use = dict(metadata) if metadata is not None else {}
                    if self._default_trace_name and "langfuse_trace_name" not in meta_to_use:
                        meta_to_use["langfuse_trace_name"] = self._default_trace_name
                    if self._default_session_id and "langfuse_session_id" not in meta_to_use:
                        meta_to_use["langfuse_session_id"] = self._default_session_id
                    if self._default_user_id and "langfuse_user_id" not in meta_to_use:
                        meta_to_use["langfuse_user_id"] = self._default_user_id
                    if self._default_tags and "langfuse_tags" not in meta_to_use:
                        meta_to_use["langfuse_tags"] = self._default_tags
                        
                    tags_to_use = list(tags) if tags is not None else []
                    if self._default_tags and not tags:
                        tags_to_use = self._default_tags
                        
                    return super()._parse_langfuse_trace_attributes(metadata=meta_to_use, tags=tags_to_use)
            
            return CustomCallbackHandler(
                trace_name_val=trace_name,
                session_id_val=session_id,
                user_id_val=user_id,
                tags_val=tags
            )
        except Exception as e:
            logger.warning(f"Failed to initialize Langfuse CallbackHandler: {e}")
    return None

