"""Engine-neutral streaming interface so candidate A (iFlytek) can plug in on the Jetson."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


class EngineUnavailableError(RuntimeError):
    """Raised when an engine's native SDK / model is not present on this machine."""


@dataclass(frozen=True)
class Detection:
    """A keyword firing. ``audio_time`` is the stream position (s) at which it was reported."""

    keyword: str
    audio_time: float


class StreamSession(Protocol):
    """One continuous audio stream. Feed 16 kHz mono float32 chunks, collect detections."""

    def feed(self, chunk: np.ndarray) -> list[Detection]: ...

    def flush(self) -> list[Detection]:
        """Signal end of input (pads tail silence) and return the remaining detections."""
        ...


class KeywordEngine(Protocol):
    name: str

    def open_stream(self) -> StreamSession: ...
