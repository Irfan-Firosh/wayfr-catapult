"""
wayfr FastAPI application factory.
"""

from __future__ import annotations

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from api.routes import health, hazards, homes, navigation, scan, sessions, verify
from api.ws_handler import ws_endpoint
from core.errors import WayfrError, wayfr_error_handler, generic_error_handler
from core.logging import configure_logging

configure_logging(debug=False)


def create_app() -> FastAPI:
    app = FastAPI(
        title="wayfr API",
        version="0.1.0",
        description="Real-time AI navigation for visually impaired — wayfr backend",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Tighten before production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # REST routes
    app.include_router(health.router)
    app.include_router(sessions.router)
    app.include_router(hazards.router)
    app.include_router(verify.router)
    app.include_router(scan.router)
    app.include_router(homes.router)
    app.include_router(navigation.router)

    # WebSocket
    @app.websocket("/ws/{session_id}")
    async def websocket_route(websocket: WebSocket, session_id: str):
        await ws_endpoint(websocket, session_id)

    # Error handlers
    app.add_exception_handler(WayfrError, wayfr_error_handler)
    app.add_exception_handler(Exception, generic_error_handler)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
