from __future__ import annotations

from dataclasses import dataclass, field
import time


@dataclass
class NarrationResult:
    text: str
    priority: str  # "urgent" | "normal" | "low"
    timestamp: float = field(default_factory=time.time)


@dataclass
class AudioChunk:
    data: bytes  # raw MP3 bytes
    text: str  # the narration text (for captions/debugging)
    priority: str  # "urgent" | "normal" | "low"
    timestamp: float = field(default_factory=time.time)
