"""Test doubles: an engine that 'detects' a keyword whenever a loud chunk is fed."""

from __future__ import annotations

import numpy as np

from kws_eval.audio import SAMPLE_RATE
from kws_eval.engine import Detection


class _FakeSession:
    def __init__(self, keyword: str, threshold: float) -> None:
        self._keyword = keyword
        self._threshold = threshold
        self._fed = 0
        self._armed = True

    def feed(self, chunk: np.ndarray) -> list[Detection]:
        self._fed += chunk.size
        loud = float(np.max(np.abs(chunk))) > self._threshold if chunk.size else False
        if loud and self._armed:
            self._armed = False
            return [Detection(self._keyword, self._fed / SAMPLE_RATE)]
        if not loud:
            self._armed = True
        return []

    def flush(self) -> list[Detection]:
        return []


class FakeEngine:
    name = "fake"

    def __init__(self, keyword: str = "停下", threshold: float = 0.2) -> None:
        self._keyword = keyword
        self._threshold = threshold

    def open_stream(self) -> _FakeSession:
        return _FakeSession(self._keyword, self._threshold)
