"""Supabase client wrapper."""

from __future__ import annotations

from functools import lru_cache

from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


@lru_cache(maxsize=1)
def get_supabase():
    """Return a Supabase client (cached singleton)."""
    if not settings.supabase_available:
        logger.warning("supabase_not_configured", message="DB operations will be no-ops")
        return None

    from supabase import create_client  # type: ignore

    return create_client(settings.supabase_url, settings.supabase_service_key)
