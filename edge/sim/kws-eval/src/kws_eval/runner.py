"""Stream clips through an engine, recording detections, CPU time and memory."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import psutil

from kws_eval.audio import SAMPLE_RATE, read_wav, resample
from kws_eval.engine import Detection, KeywordEngine

DEFAULT_CHUNK_S = 0.1


@dataclass(frozen=True)
class StreamRun:
    """Outcome of pushing one wav through one fresh stream."""

    file: str
    duration_s: float
    detections: tuple[Detection, ...]
    cpu_s: float  # process CPU time spent in this stream (all threads)
    wall_s: float
    max_chunk_wall_s: float


@dataclass
class ResourceStats:
    """Aggregate over many runs of one engine configuration."""

    audio_s: float = 0.0
    cpu_s: float = 0.0
    wall_s: float = 0.0
    peak_rss_mb: float = 0.0
    max_chunk_wall_s: float = 0.0
    temperatures_c: list[float] = field(default_factory=list)

    @property
    def cpu_cores(self) -> float:
        """Average cores used when processing at real-time rate (CPU seconds / audio seconds)."""
        return self.cpu_s / self.audio_s if self.audio_s else 0.0

    @property
    def realtime_factor(self) -> float:
        return self.wall_s / self.audio_s if self.audio_s else 0.0


def load_16k(path: Path) -> np.ndarray:
    data, rate = read_wav(path)
    return resample(data, rate, SAMPLE_RATE)


def run_stream(
    engine: KeywordEngine, samples: np.ndarray, name: str, chunk_s: float = DEFAULT_CHUNK_S
) -> StreamRun:
    """Feed ``samples`` in ``chunk_s`` chunks into a fresh stream, as a mic callback would."""
    session = engine.open_stream()
    step = max(1, int(chunk_s * SAMPLE_RATE))
    found: list[Detection] = []
    worst = 0.0
    cpu0, wall0 = time.process_time(), time.perf_counter()
    for start in range(0, samples.size, step):
        t0 = time.perf_counter()
        found.extend(session.feed(samples[start : start + step]))
        worst = max(worst, time.perf_counter() - t0)
    found.extend(session.flush())
    return StreamRun(
        file=name,
        duration_s=samples.size / SAMPLE_RATE,
        detections=tuple(found),
        cpu_s=time.process_time() - cpu0,
        wall_s=time.perf_counter() - wall0,
        max_chunk_wall_s=worst,
    )


def read_temperature_c() -> float | None:
    """Hottest thermal zone in deg C (Jetson / Linux); ``None`` where unavailable."""
    temps = psutil.sensors_temperatures() if hasattr(psutil, "sensors_temperatures") else {}
    readings = [entry.current for entries in temps.values() for entry in entries]
    return max(readings) if readings else None


def run_many(
    engine: KeywordEngine,
    items: Iterable[tuple[str, np.ndarray]],
    on_progress: Callable[[int], None] | None = None,
    chunk_s: float = DEFAULT_CHUNK_S,
) -> tuple[list[StreamRun], ResourceStats]:
    """Run every ``(name, samples)`` item; return per-item runs and aggregate resources."""
    proc = psutil.Process()
    stats = ResourceStats()
    runs: list[StreamRun] = []
    for index, (name, samples) in enumerate(items, 1):
        run = run_stream(engine, samples, name, chunk_s)
        runs.append(run)
        stats.audio_s += run.duration_s
        stats.cpu_s += run.cpu_s
        stats.wall_s += run.wall_s
        stats.max_chunk_wall_s = max(stats.max_chunk_wall_s, run.max_chunk_wall_s)
        stats.peak_rss_mb = max(stats.peak_rss_mb, proc.memory_info().rss / 1e6)
        temp = read_temperature_c()
        if temp is not None:
            stats.temperatures_c.append(temp)
        if on_progress:
            on_progress(index)
    return runs, stats
