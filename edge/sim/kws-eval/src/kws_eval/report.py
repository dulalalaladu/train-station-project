"""Markdown / JSON rendering of evaluation results.

Headline numbers (summary, noise matrix, per intent, voices) cover the plan's §4.3.4 keyword
list only; the extra candidate aliases appear in the per-keyword table, marked ``(extra)``.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from kws_eval.evaluate import EvalResult
from kws_eval.keywords import ALL_KEYWORDS, CORE_INTENTS, WAKE_NAMES
from kws_eval.metrics import (
    ClipResult,
    hours_needed_for_bound,
    modelled_gated_rate_per_hour,
)

GATES = {"recall": 0.95, "fa_per_hour": 1.0, "cpu_cores": 1.0}
CONDITIONS = ("clean", "10 dB", "5 dB", "0 dB")


def _pct(value: float) -> str:
    return "n/a" if math.isnan(value) else f"{100 * value:.1f}%"


def _cond(r: ClipResult) -> str:
    c = r.clip
    return "clean" if c.snr_db is None else f"{c.snr_db:g} dB"


def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def _rate(rows: list[ClipResult]) -> float:
    return sum(r.hit for r in rows) / len(rows) if rows else math.nan


def core_results(res: EvalResult) -> list[ClipResult]:
    return res.core_clips


SUMMARY_HEADER = [
    "config",
    "recall clean",
    "recall SNR10",
    "recall SNR5",
    "recall SNR0",
    "false alarms, core list (neg. set)",
    "latency after keyword end ms (med / p95)",
    "CPU cores @RT",
    "peak RSS MB",
]


def summary_row(res: EvalResult) -> list[str]:
    rows = core_results(res)
    noisy = [r for r in rows if r.clip.snr_db is not None]
    fa, lat = res.false_alarm, res.latency
    core_fa = res.core_false_alarms
    return [
        res.label,
        _pct(_rate([r for r in rows if r.clip.snr_db is None])),
        _pct(_rate([r for r in noisy if r.clip.snr_db >= 10])),
        _pct(_rate([r for r in noisy if r.clip.snr_db == 5])),
        _pct(_rate([r for r in noisy if r.clip.snr_db == 0])),
        f"{core_fa} ({core_fa / fa.hours:.1f}/h; all keywords {fa.total})",
        f"{lat.median_s * 1000:.0f} / {lat.p95_s * 1000:.0f}",
        f"{res.negative_resources.cpu_cores:.3f}",
        f"{res.negative_resources.peak_rss_mb:.0f}",
    ]


def summary_table(results: list[EvalResult]) -> str:
    return _table(SUMMARY_HEADER, [summary_row(r) for r in results])


def per_keyword_table(res: EvalResult) -> str:
    by_kw: dict[str, dict[str, list[bool]]] = {}
    for r in res.clip_results:
        by_kw.setdefault(r.clip.keyword, {c: [] for c in CONDITIONS})[_cond(r)].append(r.hit)
    rows = []
    for spec in ALL_KEYWORDS:
        cells = by_kw.get(spec.name, {})
        recalls = [
            _pct(sum(cells[c]) / len(cells[c])) if cells.get(c) else "n/a" for c in CONDITIONS
        ]
        n = sum(len(v) for v in cells.values())
        label = f"{spec.text} (extra)" if spec.extra else spec.text
        fa = str(res.false_alarm.per_keyword.get(spec.name, 0))
        rows.append([label, spec.intent, str(n), *recalls, fa])
    header = ["keyword", "intent", "clips", *[f"recall {c}" for c in CONDITIONS], "false alarms"]
    return _table(header, rows)


def keyword_matrix(results: list[EvalResult]) -> str:
    """Recall at SNR >= 5 dB (noisy clips only) per keyword for every configuration."""
    header = ["keyword", *[r.label.split("/", 1)[-1] for r in results]]
    rows = []
    for spec in ALL_KEYWORDS:
        cells = []
        for res in results:
            hits = [
                r
                for r in res.clip_results
                if r.clip.keyword == spec.name and (r.clip.snr_db or 0) >= 5
            ]
            cells.append(_pct(_rate(hits)))
        rows.append([f"{spec.text}{' (extra)' if spec.extra else ''}", *cells])
    fa_row = ["false alarms (all keywords)", *[str(r.false_alarm.total) for r in results]]
    return _table(header, [*rows, fa_row])


def _cell(key: tuple[str, str], cells: dict[tuple[str, str], list[bool]]) -> str:
    hits = cells.get(key)
    return _pct(sum(hits) / len(hits)) if hits else "n/a"


def noise_matrix(res: EvalResult) -> str:
    cells: dict[tuple[str, str], list[bool]] = {}
    for r in core_results(res):
        if r.clip.snr_db is not None:
            cells.setdefault((r.clip.noise, _cond(r)), []).append(r.hit)
    noises = sorted({k[0] for k in cells})
    snrs = ("10 dB", "5 dB", "0 dB")
    rows = [[n, *[_cell((n, s), cells) for s in snrs]] for n in noises]
    return _table(["noise \\ SNR", *snrs], rows)


def voice_table(res: EvalResult) -> str:
    """Clean-condition recall per synthetic voice - shows how TTS-dependent the numbers are."""
    cells: dict[tuple[str, str], list[bool]] = {}
    for r in core_results(res):
        source = (r.clip.voice or "?").split(":", 1)[0]
        cells.setdefault((source, _cond(r)), []).append(r.hit)
    sources = sorted({k[0] for k in cells})
    rows = [[s, *[_cell((s, c), cells) for c in CONDITIONS]] for s in sources]
    return _table(["voice bank", *CONDITIONS], rows)


def intent_table(res: EvalResult) -> str:
    rows = []
    for row in res.recall_by(lambda r: r.clip.intent):
        tag = "core" if row.key in CORE_INTENTS else "wake"
        rows.append([row.key, tag, str(row.n), _pct(row.recall), _pct(row.intent_recall)])
    return _table(
        ["intent", "role", "clips", "recall (exact keyword)", "recall (any keyword of intent)"],
        rows,
    )


def gating_section(res: EvalResult, window_s: float) -> str:
    fa = res.false_alarm
    wake_n = sum(fa.per_keyword.get(n, 0) for n in WAKE_NAMES)
    cmd_n = fa.total - wake_n
    per_h = (lambda n: n / fa.hours) if fa.hours else (lambda n: math.nan)
    model = modelled_gated_rate_per_hour(per_h(wake_n), per_h(cmd_n), window_s)
    need = hours_needed_for_bound(GATES["fa_per_hour"])
    return (
        f"- observed false alarms: wake words {wake_n}, commands {cmd_n} in {fa.hours:.2f} h\n"
        f"- measured wake→command pairs within {window_s:g} s: **{res.gated_false_alarms}**\n"
        f"- independent-Poisson model of the gated rate: {model:.4f} /h\n"
        f"- hours of keyword-free audio with ZERO events needed to claim <1/h at 95 %: "
        f"**{need:.1f} h** (this run: {fa.hours:.2f} h)"
    )


def result_to_json(res: EvalResult) -> dict:
    fa = res.false_alarm
    return {
        "label": res.label,
        "negative_hours": fa.hours,
        "false_alarms": fa.per_keyword,
        "false_alarm_total": fa.total,
        "false_alarm_events": [{"keyword": k, "t": t} for k, t in fa.global_times_s],
        "gated_false_alarms": res.gated_false_alarms,
        "latency_ms": {
            "median": res.latency.median_s * 1000,
            "p95": res.latency.p95_s * 1000,
            "max": res.latency.max_s * 1000,
        },
        "cpu_cores_realtime": res.negative_resources.cpu_cores,
        "realtime_factor": res.negative_resources.realtime_factor,
        "peak_rss_mb": res.negative_resources.peak_rss_mb,
        "max_chunk_ms": res.negative_resources.max_chunk_wall_s * 1000,
        "temperature_c_max": max(res.negative_resources.temperatures_c, default=None),
        "clips": [
            {
                "file": r.clip.file,
                "keyword": r.clip.keyword,
                "voice": r.clip.voice,
                "noise": r.clip.noise,
                "snr_db": r.clip.snr_db,
                "hit": r.hit,
                "intent_hit": r.intent_hit,
                "wrong": list(r.wrong),
                "latency_s": r.latency_s,
            }
            for r in res.clip_results
        ],
    }


def write_json(path: Path, results: list[EvalResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [result_to_json(r) for r in results]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def full_report(results: list[EvalResult], chosen: EvalResult, window_s: float) -> str:
    parts = [
        "## Configuration sweep (plan keyword list)",
        summary_table(results),
        "## Recall at SNR >= 5 dB per keyword and configuration",
        keyword_matrix(results),
        f"## Per-keyword results - {chosen.label}",
        per_keyword_table(chosen),
        "## Noise type x SNR (recall, plan keyword list)",
        noise_matrix(chosen),
        "## Voice bank (recall, plan keyword list)",
        voice_table(chosen),
        "## Per intent",
        intent_table(chosen),
        "## Wake-word gating",
        gating_section(chosen, window_s),
    ]
    return "\n\n".join(parts) + "\n"
