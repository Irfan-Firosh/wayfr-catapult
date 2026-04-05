from fastapi import APIRouter
from pydantic import BaseModel

from core.errors import SessionNotFoundError
from services.session_manager import session_manager

router = APIRouter(prefix="/sessions")


class CreateSessionRequest(BaseModel):
    session_id: str | None = None


@router.post("")
async def create_session(body: CreateSessionRequest | None = None):
    sid = body.session_id if body else None
    ctx = await session_manager.create(session_id=sid)
    return {"session_id": ctx.session_id, "status": ctx.status}


@router.get("/{session_id}")
async def get_session(session_id: str):
    ctx = await session_manager.get_ctx(session_id)
    if ctx is None:
        raise SessionNotFoundError(session_id)
    return {
        "session_id": ctx.session_id,
        "status": ctx.status,
        "frame_count": ctx.frame_count,
    }
