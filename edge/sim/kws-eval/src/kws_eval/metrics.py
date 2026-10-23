"""Scoring: recall (strict / intent level), false alarms per hour, latency, two-hit gating."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from statistics import median

from kws_eval.engine import Detection
from kws_eval.keywords import KeywordSpec, keyword_by_name
from kws_eval.manifest import PositiveClip
from kws_eval.runner import StreamRun

# A detection counts for a positive clip when it fires between the keyword onset and this many
# seconds after the keyword ends (covers the model's trailing-blank latency).
HIT_WINDOW_AFTER_END_S = 1.5


@dataclass(frozen=True)
class ClipResult:
    clip: PositiveClip
    hit: bool  # the expected keyword fired inside the window
    intent_hit: bool  # any keyword of the expected intent fired inside the window
    wrong: tuple[str, ...]  # other keywords that fired inside the window
    latency_s: float | None  # first expected-keyword firing minus keyword end


def score_positive(clip: PositiveClip, run: StreamRun) -> ClipResult:
    lo, hi = clip.onset_s, clip.offset_s + HIT_WINDOW_AFTER_END_S
    inside = [d for d in run.detections if lo <= d.audio_time <= hi]
    expected = [d for d in inside if d.keyword == clip.keyword]
    same_intent = [d for d in inside if _intent_of(d.keyword) == clip.intent]
    wrong = tuple(sorted({d.keyword for d in inside if d.keyword != clip.keyword}))
    latency = min(d.audio_time for d in expected) - clip.offset_s if expected else None
    return ClipResult(clip, bool(expected), bool(same_intent), wrong, latency)


def _intent_of(name: str) -> str:
    return keyword_by_name(name).intent


@dataclass(frozen=True)
class RecallRow:
    key: str
    n: int
    hits: int
    intent_hits: int

    @property
    def recall(self) -> float:
        return self.hits / self.n if self.n else math.nan

    @property
    def intent_recall(self) -> float:
        return self.intent_hits / self.n if self.n else math.nan


def aggregate(results: list[ClipResult], key_fn) -> list[RecallRow]:  # noqa: ANN001
    """Group results by ``key_fn(ClipResult)`` and compute recall rows (sorted by key)."""
    groups: dict[str, list[ClipResult]] = defaultdict(list)
    for result in results:
        groups[key_fn(result)].append(result)
    return [
        RecallRow(key, len(rows), sum(r.hit for r in rows), sum(r.intent_hit for r in rows))
        for key, rows in sorted(groups.items())
    ]


@dataclass(frozen=True)
class LatencyStats:
    n: int
    median_s: float
    p95_s: float
    max_s: float


def latency_stats(results: list[ClipResult]) -> LatencyStats:
    values = sorted(r.latency_s for r in results if r.latency_s is not None)
    if not values:
        return LatencyStats(0, math.nan, math.nan, math.nan)
    p95 = values[min(len(values) - 1, math.ceil(0.95 * len(values)) - 1)]
    return LatencyStats(len(values), median(values), p95, values[-1])


@dataclass(frozen=True)
class FalseAlarmReport:
    hours: float
    per_keyword: dict[str, int]
    events: tuple[Detection, ...]  # stream-local times; `offsets` below makes them global
    global_times_s: tuple[tuple[str, float], ...]

    @property
    def total(self) -> int:
        return sum(self.per_keyword.values())

    @property
    def per_hour(self) -> float:
        return self.total / self.hours if self.hours else math.nan

    def upper_bound_per_hour(self, confidence: float = 0.95) -> float:
        """One-sided Poisson upper bound on the true rate given ``total`` events observed."""
        return poisson_upper(self.total, confidence) / self.hours if self.hours else math.nan


def false_alarms(runs: list[StreamRun], specs: tuple[KeywordSpec, ...]) -> FalseAlarmReport:
    counts = {s.name: 0 for s in specs}
    events: list[Detection] = []
    timeline: list[tuple[str, float]] = []
    offset = 0.0
    for run in runs:
        for det in run.detections:
            counts[det.keyword] = counts.get(det.keyword, 0) + 1
            events.append(det)
            timeline.append((det.keyword, offset + det.audio_time))
        offset += run.duration_s
    hours = sum(r.duration_s for r in runs) / 3600.0
    return FalseAlarmReport(hours, counts, tuple(events), tuple(timeline))


def poisson_upper(k: int, confidence: float = 0.95) -> float:
    """Exact (Garwood) one-sided upper limit for a Poisson mean given ``k`` observed events."""
    target = 1.0 - confidence
    lo, hi = 0.0, 10.0 + 10.0 * k
    for _ in range(80):
        mid = (lo + hi) / 2
        cdf = sum(math.exp(-mid) * mid**i / math.factorial(i) for i in range(k + 1))
        lo, hi = (mid, hi) if cdf > target else (lo, mid)
    return (lo + hi) / 2


def hours_needed_for_bound(target_per_hour: float, confidence: float = 0.95) -> float:
    """Observation hours with ZERO false alarms needed to claim ``< target_per_hour``."""
    return poisson_upper(0, confidence) / target_per_hour


def gated_false_alarms(
    timeline: tuple[tuple[str, float], ...], wake: str | tuple[str, ...], window_s: float
) -> int:
    """Count command detections that follow a wake-word detection within ``window_s``.

    This is the measured (not modelled) false-alarm count of the "wake word + command" rule on
    the negative corpus; commands = every keyword that is not a wake word.
    """
    wakes = (wake,) if isinstance(wake, str) else tuple(wake)
    wake_times = [t for name, t in timeline if name in wakes]
    return sum(
        1
        for name, t in timeline
        if name not in wakes and any(0.0 < t - w <= window_s for w in wake_times)
    )


def modelled_gated_rate_per_hour(
    wake_per_hour: float, command_per_hour: float, window_s: float
) -> float:
    """Expected gated false alarms/h assuming independent Poisson arrivals."""
    return wake_per_hour * command_per_hour * window_s / 3600.0
