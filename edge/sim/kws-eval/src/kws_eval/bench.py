"""Resource benchmark: sustained real-time streaming, CPU cores / RSS / temperature.

Intended for the Jetson Orin NX re-test (``kws-eval bench``); also works on any x86 box.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from kws_eval.audio import SAMPLE_RATE
from kws_eval.runner import ResourceStats, load_16k, read_temperature_c, run_many
from kws_eval.sherpa import SherpaConfig, SherpaEngine


@dataclass(frozen=True)
class BenchPoint:
    label: str
    threads: int
    audio_s: float
    cpu_cores: float
    realtime_factor: float
    peak_rss_mb: float
    max_chunk_ms: float
    temp_start_c: float | None
    temp_max_c: float | None


def _looped(samples: np.ndarray, seconds: float) -> list[tuple[str, np.ndarray]]:
    repeats = max(1, int(np.ceil(seconds * SAMPLE_RATE / samples.size)))
    return [(f"loop{i}", samples) for i in range(repeats)]


def bench_config(cfg: SherpaConfig, wav: Path, seconds: float) -> BenchPoint:
    """Stream ``wav`` (looped to ``seconds``) through a fresh engine and measure resources."""
    engine = SherpaEngine(cfg)
    try:
        samples = load_16k(wav)
        start_temp = read_temperature_c()
        _, stats = run_many(engine, _looped(samples, seconds))
    finally:
        engine.close()
    return _point(cfg, stats, start_temp)


def _point(cfg: SherpaConfig, stats: ResourceStats, start_temp: float | None) -> BenchPoint:
    return BenchPoint(
        label=cfg.label,
        threads=cfg.num_threads,
        audio_s=stats.audio_s,
        cpu_cores=stats.cpu_cores,
        realtime_factor=stats.realtime_factor,
        peak_rss_mb=stats.peak_rss_mb,
        max_chunk_ms=stats.max_chunk_wall_s * 1000,
        temp_start_c=start_temp,
        temp_max_c=max(stats.temperatures_c, default=None),
    )


def run_bench(
    base: SherpaConfig, wav: Path, seconds: float, thread_counts: tuple[int, ...], out: Path
) -> list[BenchPoint]:
    points: list[BenchPoint] = []
    for threads in thread_counts:
        cfg = SherpaConfig(**{**base.__dict__, "num_threads": threads})
        points.append(bench_config(cfg, wav, seconds))
        time.sleep(1.0)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([asdict(p) for p in points], indent=1), encoding="utf-8")
    return points
