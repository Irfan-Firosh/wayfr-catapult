"""
Session lifecycle management.
Per-session objects (Scene3D, ContextTracker) are created here and stored in memory.
"""

from __future__ import annotations

import asyncio
import secrets
from typing import Any

from core.logging import get_logger
from models.session import SessionContext, SessionStatus
from services.narration.context_tracker import ContextTracker
from services.scene3d import Scene3D, make_scene3d

logger = get_logger(__name__)


class _SessionState:
    __slots__ = ("ctx", "scene3d", "context_tracker", "ws")

    def __init__(self, ctx: SessionContext) -> None:
        self.ctx = ctx
        self.scene3d: Scene3D = make_scene3d()
        self.context_tracker: ContextTracker = ContextTracker()
        self.ws: Any = None  # holds the WebSocket connection


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, _SessionState] = {}
        self._lock = asyncio.Lock()

    async def create(self, session_id: str | None = None) -> SessionContext:
        sid = session_id or secrets.token_hex(3).upper()  # e.g. "A3F9B2"
        ctx = SessionContext(session_id=sid)
        state = _SessionState(ctx)
        async with self._lock:
            self._sessions[sid] = state
        logger.info("session_created", session_id=sid)
        return ctx

    async def get(self, session_id: str) -> _SessionState | None:
        return self._sessions.get(session_id)

    async def get_ctx(self, session_id: str) -> SessionContext | None:
        state = self._sessions.get(session_id)
        return state.ctx if state else None

    async def get_scene3d(self, session_id: str) -> Scene3D | None:
        state = self._sessions.get(session_id)
        return state.scene3d if state else None

    async def get_tracker(self, session_id: str) -> ContextTracker | None:
        state = self._sessions.get(session_id)
        return state.context_tracker if state else None

    async def attach_ws(self, session_id: str, ws: Any) -> None:
        state = self._sessions.get(session_id)
        if state:
            state.ws = ws

    async def detach_ws(self, session_id: str) -> None:
        state = self._sessions.get(session_id)
        if state:
            state.ws = None
            state.ctx.status = SessionStatus.ENDED

    async def end(self, session_id: str) -> None:
        async with self._lock:
            state = self._sessions.pop(session_id, None)
        if state:
            state.ctx.status = SessionStatus.ENDED
            logger.info("session_ended", session_id=session_id)

    async def list_active(self) -> list[str]:
        return [
            sid for sid, state in self._sessions.items() if state.ctx.status == SessionStatus.ACTIVE
        ]


session_manager = SessionManager()
