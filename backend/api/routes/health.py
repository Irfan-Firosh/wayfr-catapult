from fastapi import APIRouter
from core.config import settings
from services.session_manager import session_manager

router = APIRouter()


@router.get("/health")
async def health():
    active = await session_manager.list_active()
    return {
        "status": "ok",
        "active_sessions": len(active),
        "capabilities": {
            "rcac_vlm": settings.rcac_available,
            "genai_llm": settings.genai_available,
            "gemini": settings.gemini_available,
            "cartesia_tts": settings.cartesia_available,
            "supabase": settings.supabase_available,
            "redis": settings.redis_available,
        },
    }
