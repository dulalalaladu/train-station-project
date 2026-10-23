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
TUNINGS_QUICK = ((1.5, 0.25), (3.0, 0.15), (4.0, 0.08), (5.0, 0.04))
TUNINGS_FULL = (
    (1.0, 0.25),
    (1.5, 0.25),
    (2.0, 0.15),
    (3.0, 0.15),
    (3.0, 0.08),
    (4.0, 0.08),
    (5.0, 0.04),
)
MODEL_VARIANTS = ((8, True), (16, True), (8, False))  # (chunk, int8)
GRIDS = ("quick", "variants", "full")


def grid(kind: str, model_dir: Path) -> list[SherpaConfig]:
    """``quick``: chunk-8 int8 over four tunings; ``variants``: the three shipped model builds at
    one tuning; ``full``: every model build x every tuning."""
    if kind not in GRIDS:
        raise ValueError(f"unknown grid {kind!r}; choose from {GRIDS}")
    if kind == "variants":
        combos = [(c, i8, KeywordTuning(3.0, 0.15)) for c, i8 in MODEL_VARIANTS]
    else:
        tunings = TUNINGS_QUICK if kind == "quick" else TUNINGS_FULL
        models = MODEL_VARIANTS[:1] if kind == "quick" else MODEL_VARIANTS
        combos = [(c, i8, KeywordTuning(s, t)) for c, i8 in models for s, t in tunings]
    return [SherpaConfig(model_dir, chunk=c, int8=i8, default_tuning=t) for c, i8, t in combos]


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


FA_PENALTY_PER_HOUR = 0.005  # recall points lost per false alarm/h when no config meets the gate


def mean_noisy_recall(res: EvalResult, min_snr: float = 5.0) -> float:
    """Recall over noisy plan-list clips at SNR >= ``min_snr`` dB."""
    rows = [r for r in res.core_clips if r.clip.snr_db is not None and r.clip.snr_db >= min_snr]
    return sum(r.hit for r in rows) / len(rows) if rows else 0.0


def core_fa_per_hour(res: EvalResult) -> float:
    hours = res.false_alarm.hours
    return res.core_false_alarms / hours if hours else float("inf")


def choose(results: list[EvalResult], fa_limit_per_hour: float = 1.0) -> EvalResult:
    """Pick the headline configuration.

    Best SNR>=5 dB recall among configs meeting the false-alarm gate; if none does, the best
    recall after a small false-alarm penalty (so a deaf-but-quiet config does not win by default).
    """
    ok = [r for r in results if core_fa_per_hour(r) < fa_limit_per_hour]
    if ok:
        return max(ok, key=mean_noisy_recall)
    return max(
        results, key=lambda r: mean_noisy_recall(r) - FA_PENALTY_PER_HOUR * core_fa_per_hour(r)
    )
