# backend/app/core/langfuse_client.py
import logging
import os
import re
from contextlib import contextmanager
from typing import Generator, List, Optional, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

# Synchronize settings to os.environ for Langfuse SDK auto-configuration
if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
    os.environ["LANGFUSE_PUBLIC_KEY"] = settings.LANGFUSE_PUBLIC_KEY
    os.environ["LANGFUSE_SECRET_KEY"] = settings.LANGFUSE_SECRET_KEY
    if settings.LANGFUSE_BASE_URL:
        os.environ["LANGFUSE_BASE_URL"] = settings.LANGFUSE_BASE_URL
        os.environ["LANGFUSE_HOST"] = settings.LANGFUSE_BASE_URL

# Safe Langfuse Imports (supports v2, v3, v4 and missing package gracefully)
_has_get_client = False
_has_langfuse_v2 = False
_has_callback_handler = False

try:
    from langfuse import get_client, propagate_attributes
    _has_get_client = True
except ImportError:
    try:
        from langfuse import Langfuse
        _has_langfuse_v2 = True
    except ImportError:
        logger.warning("Langfuse package not installed or incompatible version.")

try:
    from langfuse.langchain import CallbackHandler
    _has_callback_handler = True
except ImportError:
    CallbackHandler = None


# Initialize client if keys are present
langfuse_client = None
if settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
    try:
        if _has_get_client:
            langfuse_client = get_client()
            logger.info("Langfuse client (v3+) initialized successfully.")
        elif _has_langfuse_v2:
            langfuse_client = Langfuse(
                public_key=settings.LANGFUSE_PUBLIC_KEY,
                secret_key=settings.LANGFUSE_SECRET_KEY,
                host=settings.LANGFUSE_BASE_URL,
            )
            logger.info("Langfuse client (v2) initialized successfully.")
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


def get_compiled_prompt(prompt_name: str, fallback_template: str, **kwargs) -> str:
    """Fetch prompt from Langfuse (production label) and compile it.
    Falls back to compiling the local fallback template if Langfuse is unavailable.
    """
    client = langfuse_client
    if not client and settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        try:
            if _has_get_client:
                client = get_client()
            elif _has_langfuse_v2:
                client = Langfuse(
                    public_key=settings.LANGFUSE_PUBLIC_KEY,
                    secret_key=settings.LANGFUSE_SECRET_KEY,
                    host=settings.LANGFUSE_BASE_URL,
                )
        except Exception:
            client = None

    if client:
        try:
            # Fetch prompt from Langfuse
            prompt_obj = client.get_prompt(prompt_name, label="production")
            # Langfuse compile substitutes variables and returns the string
            compiled = prompt_obj.compile(**kwargs)
            logger.info(f"Fetched and compiled prompt '{prompt_name}' from Langfuse.")
            return compiled
        except Exception as e:
            logger.warning(f"Error fetching prompt '{prompt_name}' from Langfuse: {e}. Falling back to local template.")
    
    # Fallback compilation
    return compile_local_template(fallback_template, **kwargs)


@contextmanager
def langfuse_tracing_context(
    trace_name: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
    metadata: Optional[dict] = None,
) -> Generator[List[Any], None, None]:
    """Context manager for Langfuse tracing with LangChain."""
    if _has_callback_handler and settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        try:
            if _has_get_client:
                with propagate_attributes(
                    trace_name=trace_name,
                    session_id=str(session_id) if session_id else None,
                    user_id=str(user_id) if user_id else None,
                    tags=tags,
                    metadata=metadata,
                ):
                    handler = CallbackHandler()
                    yield [handler]
                    return
            elif _has_langfuse_v2:
                handler = CallbackHandler(
                    public_key=settings.LANGFUSE_PUBLIC_KEY,
                    secret_key=settings.LANGFUSE_SECRET_KEY,
                    host=settings.LANGFUSE_BASE_URL,
                    session_id=str(session_id) if session_id else None,
                    user_id=str(user_id) if user_id else None,
                    tags=tags,
                )
                yield [handler]
                return
        except Exception as e:
            logger.warning(f"Failed to initialize Langfuse tracing context: {e}")
    yield []


def get_langfuse_callback_handler(
    trace_name: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Optional[Any]:
    """Retrieve a Langfuse callback handler for LangChain if credentials are set."""
    if _has_callback_handler and settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        try:
            if _has_get_client:
                class CustomV4CallbackHandler(CallbackHandler):
                    def __init__(self, trace_name_val=None, session_id_val=None, user_id_val=None, tags_val=None):
                        self._cm = propagate_attributes(
                            trace_name=trace_name_val,
                            session_id=str(session_id_val) if session_id_val else None,
                            user_id=str(user_id_val) if user_id_val else None,
                            tags=tags_val,
                        )
                        self._cm.__enter__()
                        super().__init__()

                    def __del__(self):
                        try:
                            if hasattr(self, "_cm") and self._cm:
                                self._cm.__exit__(None, None, None)
                        except Exception:
                            pass

                return CustomV4CallbackHandler(
                    trace_name_val=trace_name,
                    session_id_val=session_id,
                    user_id_val=user_id,
                    tags_val=tags,
                )
            elif _has_langfuse_v2:
                return CallbackHandler(
                    public_key=settings.LANGFUSE_PUBLIC_KEY,
                    secret_key=settings.LANGFUSE_SECRET_KEY,
                    host=settings.LANGFUSE_BASE_URL,
                    session_id=str(session_id) if session_id else None,
                    user_id=str(user_id) if user_id else None,
                    tags=tags,
                )
        except Exception as e:
            logger.warning(f"Failed to initialize Langfuse CallbackHandler: {e}")
    return None
