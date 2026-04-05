from fastapi import Request
from fastapi.responses import JSONResponse


class WayfrError(Exception):
    def __init__(
        self, message: str, code: str, status_code: int = 400, details: dict | None = None
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class SessionNotFoundError(WayfrError):
    def __init__(self, session_id: str):
        super().__init__(
            message=f"Session '{session_id}' not found",
            code="SESSION_NOT_FOUND",
            status_code=404,
        )


class WorldIDInvalidError(WayfrError):
    def __init__(self, reason: str = "Proof verification failed"):
        super().__init__(message=reason, code="WORLD_ID_INVALID", status_code=422)


class RateLimitExceededError(WayfrError):
    def __init__(self, detail: str = "Too many requests"):
        super().__init__(message=detail, code="RATE_LIMIT_EXCEEDED", status_code=429)


class VisionPipelineError(WayfrError):
    def __init__(self, reason: str = "AI processing failure"):
        super().__init__(message=reason, code="VISION_PIPELINE_ERROR", status_code=500)


class AudioGenerationError(WayfrError):
    def __init__(self, reason: str = "TTS generation failed"):
        super().__init__(message=reason, code="AUDIO_GENERATION_FAILED", status_code=500)


async def wayfr_error_handler(request: Request, exc: WayfrError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message, "code": exc.code, "details": exc.details},
    )


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "INTERNAL_ERROR", "details": {}},
    )
