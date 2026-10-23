"""Run one engine configuration over the whole corpus and summarise it."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from kws_eval.engine import KeywordEngine
from kws_eval.keywords import KEYWORDS, WAKE
from kws_eval.manifest import Manifest
from kws_eval.metrics import (
    ClipResult,
    FalseAlarmReport,
    LatencyStats,
    RecallRow,
    aggregate,
    false_alarms,
    gated_false_alarms,
    latency_stats,
    score_positive,
)
from kws_eval.runner import ResourceStats, load_16k, run_many

log = logging.getLogger(__name__)

GATE_WINDOW_S = 5.0


@dataclass(frozen=True)
class EvalResult:
    label: str
    clip_results: tuple[ClipResult, ...]
    false_alarm: FalseAlarmReport
    gated_false_alarms: int
    positive_resources: ResourceStats
    negative_resources: ResourceStats

    def recall_by(self, key_fn) -> list[RecallRow]:  # noqa: ANN001
        return aggregate(list(self.clip_results), key_fn)

    @property
    def latency(self) -> LatencyStats:
        return latency_stats(list(self.clip_results))


def evaluate(
    engine: KeywordEngine, manifest: Manifest, corpus_dir: Path, label: str | None = None
) -> EvalResult:
    pos_items = ((c.file, load_16k(corpus_dir / c.file)) for c in manifest.positives)
    pos_runs, pos_res = run_many(engine, pos_items)
    results = tuple(score_positive(c, r) for c, r in zip(manifest.positives, pos_runs, strict=True))
    neg_items = ((c.file, load_16k(corpus_dir / c.file)) for c in manifest.negatives)
    neg_runs, neg_res = run_many(engine, neg_items)
    fa = false_alarms(neg_runs, KEYWORDS)
    gated = gated_false_alarms(fa.global_times_s, WAKE, GATE_WINDOW_S)
    log.info(
        "%s: %d clips, %d false alarms in %.2f h", engine.name, len(results), fa.total, fa.hours
    )
    return EvalResult(label or engine.name, results, fa, gated, pos_res, neg_res)
