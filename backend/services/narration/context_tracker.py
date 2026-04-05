"""
Deduplication tracker — prevents the same narration from being repeated within
the configured window (default 5s).
"""

from __future__ import annotations

import time
from collections import deque

from core.config import settings


class ContextTracker:
    def __init__(self, window_s: float | None = None) -> None:
        self._window = window_s if window_s is not None else settings.narration_dedup_window_s
        self._recent: deque[tuple[str, float]] = deque()

    def should_narrate(self, text: str) -> bool:
        now = time.time()
        self._prune(now)
        for recent_text, _ in self._recent:
            if self._similarity(text, recent_text) > 0.8:
                return False
        self._recent.append((text, now))
        return True

    def _prune(self, now: float) -> None:
        while self._recent and now - self._recent[0][1] > self._window:
            self._recent.popleft()

    @staticmethod
    def _similarity(a: str, b: str) -> float:
        a_tokens = set(a.lower().split())
        b_tokens = set(b.lower().split())
        if not a_tokens or not b_tokens:
            return 0.0
        return len(a_tokens & b_tokens) / max(len(a_tokens), len(b_tokens))
