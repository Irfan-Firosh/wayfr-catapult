"""
WebSocket endpoint — /ws/{session_id}

Handles frame ingestion, runs the full vision pipeline, sends audio back.
Protocol defined in docs/BACKEND.md.
"""

from __future__ import annotations

import base64
import json
import time

from fastapi import WebSocket, WebSocketDisconnect

from core.logging import get_logger
from models.session import GPSCoord
from services.hazard_map import hazard_map
from services.narration.priority import select_top_item
from services.narration.synthesizer import narration_synthesizer
from services.narration.tts import tts_service
from services.session_manager import session_manager
from services.vision.pipeline import process_frame

logger = get_logger(__name__)


async def ws_endpoint(websocket: WebSocket, session_id: str) -> None:
    """Main WebSocket handler. Called by the FastAPI router."""
    await websocket.accept()

    # Ensure session exists (create if browser opened ws directly)
    state = await session_manager.get(session_id)
    if state is None:
        await session_manager.create(session_id=session_id)
        state = await session_manager.get(session_id)

    await session_manager.attach_ws(session_id, websocket)
    ctx = state.ctx
    scene3d = state.scene3d
    tracker = state.context_tracker

    logger.info("ws_connected", session_id=session_id)
    await _send(websocket, {"type": "session_update", "status": "active", "timestamp": time.time()})

    try:
        async for raw in _iter_messages(websocket):
            msg_type = raw.get("type")

            if msg_type == "ping":
                await _send(
                    websocket, {"type": "pong", "timestamp": raw.get("timestamp", time.time())}
                )
                continue

            if msg_type == "command":
                ctx.pending_voice_command = raw.get("command")
                continue

            if msg_type == "frame":
                frame_b64: str | None = raw.get("data")
                if not frame_b64:
                    continue

                # Update GPS if provided
                if gps_data := raw.get("gps"):
                    ctx.gps = GPSCoord(
                        lat=gps_data["lat"],
                        lng=gps_data["lng"],
                        accuracy=gps_data.get("accuracy", 0.0),
                    )

                frame_bytes = base64.b64decode(frame_b64)
                hazard_alerts = await hazard_map.get_nearby(ctx.gps)

                try:
                    vision_result = await process_frame(
                        frame_bytes=frame_bytes,
                        session_ctx=ctx,
                        scene3d=scene3d,
                        hazard_alerts=hazard_alerts,
                    )
                except Exception as exc:
                    logger.error("pipeline_error", session_id=session_id, error=str(exc))
                    continue

                # Send detected objects to dashboard 3D viewer
                if vision_result.detected_objects:
                    await _send(
                        websocket,
                        {
                            "type": "detections",
                            "objects": [
                                {
                                    "label": o.label,
                                    "x": o.x_3d or 0,
                                    "y": o.y_3d or 0,
                                    "z": o.z_3d if o.z_3d is not None else 1.5,
                                    "urgency": o.urgency,
                                    "confidence": o.confidence,
                                    "distance_m": o.distance_m,
                                }
                                for o in vision_result.detected_objects
                            ],
                        },
                    )

                # Send hazard alerts if any high-severity ones appeared
                for alert in hazard_alerts:
                    if alert.severity in ("critical", "high"):
                        await _send(
                            websocket,
                            {
                                "type": "hazard_alert",
                                "hazard": {
                                    "type": alert.label,
                                    "severity": alert.severity,
                                    "distance_m": alert.distance_m,
                                    "direction": alert.direction,
                                    "description": alert.description,
                                    "verified_count": alert.verified_count,
                                },
                            },
                        )

                # Build narration
                description, priority = select_top_item(vision_result)
                if description and tracker.should_narrate(description):
                    narration = await narration_synthesizer.synthesize(description, priority)
                    if narration:
                        ctx.recent_narrations.append(narration.text)
                        if len(ctx.recent_narrations) > 20:
                            ctx.recent_narrations.pop(0)

                        audio = await tts_service.synthesize(narration)
                        if audio:
                            await _send(
                                websocket,
                                {
                                    "type": "audio",
                                    "data": base64.b64encode(audio.data).decode(),
                                    "priority": audio.priority,
                                    "text": audio.text,
                                    "timestamp": time.time(),
                                },
                            )

    except WebSocketDisconnect:
        logger.info("ws_disconnected", session_id=session_id)
    except Exception as exc:
        logger.error("ws_error", session_id=session_id, error=str(exc))
    finally:
        await session_manager.detach_ws(session_id)


async def _iter_messages(ws: WebSocket):
    """Yield parsed JSON messages from the WebSocket."""
    while True:
        try:
            text = await ws.receive_text()
            yield json.loads(text)
        except WebSocketDisconnect:
            return
        except json.JSONDecodeError as exc:
            logger.warning("invalid_json", error=str(exc))
            continue


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception as exc:
        logger.warning("ws_send_failed", error=str(exc))
