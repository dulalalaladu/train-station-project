"""Configuration grid for candidate B and the rule that picks the operating point."""

from __future__ import annotations

import logging
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from kws_eval.evaluate import EvalResult, evaluate
from kws_eval.keywords import KeywordTuning
from kws_eval.manifest import Manifest
from kws_eval.sherpa import SherpaConfig, SherpaEngine

log = logging.getLogger(__name__)

# (boost score, trigger threshold). sherpa-onnx defaults are (1.0, 0.25).
TUNINGS_QUICK = ((1.5, 0.25), (3.0, 0.15), (4.0, 0.08))
TUNINGS_FULL = (
    (1.0, 0.25),
    (1.5, 0.25),
    (2.0, 0.15),
    (3.0, 0.15),
    (3.0, 0.08),
    (4.0, 0.08),
    (5.0, 0.05),
)


def grid(kind: str, model_dir: Path) -> list[SherpaConfig]:
    tunings = TUNINGS_QUICK if kind == "quick" else TUNINGS_FULL
    models = [(8, True)] if kind == "quick" else [(8, True), (16, True), (8, False)]
    return [
        SherpaConfig(model_dir, chunk=chunk, int8=int8, default_tuning=KeywordTuning(s, t))
        for chunk, int8 in models
        for s, t in tunings
    ]


def _run_one(cfg: SherpaConfig, manifest_path: Path, corpus_dir: Path) -> EvalResult:
    engine = SherpaEngine(cfg)
    try:
        return evaluate(engine, Manifest.load(manifest_path), corpus_dir, cfg.label)
    finally:
        engine.close()


def run_sweep(
    configs: list[SherpaConfig], manifest_path: Path, corpus_dir: Path, jobs: int
) -> list[EvalResult]:
    """Evaluate every config. CPU time is per-process, so parallel runs stay comparable."""
    if jobs <= 1:
        return [_run_one(c, manifest_path, corpus_dir) for c in configs]
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(_run_one, c, manifest_path, corpus_dir) for c in configs]
        return [f.result() for f in futures]


def mean_noisy_recall(res: EvalResult, min_snr: float = 5.0) -> float:
    rows = [r for r in res.clip_results if r.clip.snr_db is not None and r.clip.snr_db >= min_snr]
    return sum(r.hit for r in rows) / len(rows) if rows else 0.0


def choose(results: list[EvalResult], fa_limit_per_hour: float = 1.0) -> EvalResult:
    """Best SNR>=5 dB recall among configs meeting the false-alarm gate; else the fewest alarms."""
    ok = [r for r in results if r.false_alarm.per_hour < fa_limit_per_hour]
    if ok:
        return max(ok, key=mean_noisy_recall)
    return min(results, key=lambda r: (r.false_alarm.per_hour, -mean_noisy_recall(r)))
