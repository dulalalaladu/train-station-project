"""Markdown / JSON rendering of evaluation results."""

from __future__ import annotations

import json
import math
from pathlib import Path

from kws_eval.evaluate import EvalResult
from kws_eval.keywords import CORE_INTENTS, KEYWORDS
from kws_eval.metrics import (
    ClipResult,
    hours_needed_for_bound,
    modelled_gated_rate_per_hour,
)

GATES = {"recall": 0.95, "fa_per_hour": 1.0, "cpu_cores": 1.0}


def _pct(value: float) -> str:
    return "n/a" if math.isnan(value) else f"{100 * value:.1f}%"


def _cond(r: ClipResult) -> str:
    c = r.clip
    return "clean" if c.snr_db is None else f"{c.snr_db:g} dB"


def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def summary_row(res: EvalResult) -> list[str]:
    noisy = [r for r in res.clip_results if r.clip.snr_db is not None]
    clean = [r for r in res.clip_results if r.clip.snr_db is None]
    rate = lambda rs: sum(r.hit for r in rs) / len(rs) if rs else math.nan  # noqa: E731
    fa = res.false_alarm
    lat = res.latency
    return [
        res.label,
        _pct(rate(clean)),
        _pct(rate([r for r in noisy if r.clip.snr_db >= 10])),
        _pct(rate([r for r in noisy if r.clip.snr_db == 5])),
        _pct(rate([r for r in noisy if r.clip.snr_db == 0])),
        f"{fa.total} ({fa.per_hour:.1f}/h, ≤{fa.upper_bound_per_hour():.1f}/h@95%)",
        f"{lat.median_s * 1000:.0f} / {lat.p95_s * 1000:.0f}",
        f"{res.negative_resources.cpu_cores:.3f}",
        f"{res.negative_resources.peak_rss_mb:.0f}",
    ]


SUMMARY_HEADER = [
    "config",
    "recall clean",
    "recall SNR10",
    "recall SNR5",
    "recall SNR0",
    "false alarms (neg. set)",
    "latency after keyword end ms (med / p95)",
    "CPU cores @RT",
    "peak RSS MB",
]


def summary_table(results: list[EvalResult]) -> str:
    return _table(SUMMARY_HEADER, [summary_row(r) for r in results])


def per_keyword_table(res: EvalResult) -> str:
    conds = ("clean", "10 dB", "5 dB", "0 dB")
    by_kw: dict[str, dict[str, list[bool]]] = {}
    for r in res.clip_results:
        by_kw.setdefault(r.clip.keyword, {c: [] for c in conds})[_cond(r)].append(r.hit)
    rows = []
    for spec in KEYWORDS:
        cells = by_kw.get(spec.name, {})
        recalls = [_pct(sum(cells[c]) / len(cells[c])) if cells.get(c) else "n/a" for c in conds]
        n = sum(len(v) for v in cells.values())
        rows.append(
            [
                spec.text,
                spec.intent,
                str(n),
                *recalls,
                str(res.false_alarm.per_keyword.get(spec.name, 0)),
            ]
        )
    return _table(
        ["keyword", "intent", "clips", *[f"recall {c}" for c in conds], "false alarms"], rows
    )


def _cell(key: tuple[str, str], cells: dict[tuple[str, str], list[bool]]) -> str:
    hits = cells.get(key)
    return _pct(sum(hits) / len(hits)) if hits else "n/a"


def noise_matrix(res: EvalResult) -> str:
    cells: dict[tuple[str, str], list[bool]] = {}
    for r in res.clip_results:
        if r.clip.snr_db is not None:
            cells.setdefault((r.clip.noise, _cond(r)), []).append(r.hit)
    noises = sorted({k[0] for k in cells})
    snrs = ("10 dB", "5 dB", "0 dB")
    rows = [[n, *[_cell((n, s), cells) for s in snrs]] for n in noises]
    return _table(["noise \\ SNR", *snrs], rows)


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
    wake = fa.per_keyword.get("小铁小铁", 0) / fa.hours if fa.hours else math.nan
    cmds = (fa.total - fa.per_keyword.get("小铁小铁", 0)) / fa.hours if fa.hours else math.nan
    model = modelled_gated_rate_per_hour(wake, cmds, window_s)
    need = hours_needed_for_bound(GATES["fa_per_hour"])
    return (
        f"- observed false alarms: wake word {fa.per_keyword.get('小铁小铁', 0)}, "
        f"commands {fa.total - fa.per_keyword.get('小铁小铁', 0)} in {fa.hours:.2f} h\n"
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
                "noise": r.clip.noise,
                "snr_db": r.clip.snr_db,
                "speaker": r.clip.speaker,
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
        "## Configuration sweep",
        summary_table(results),
        f"## Per-keyword results — {chosen.label}",
        per_keyword_table(chosen),
        "## Noise type x SNR (recall)",
        noise_matrix(chosen),
        "## Per intent",
        intent_table(chosen),
        "## Wake-word gating",
        gating_section(chosen, window_s),
    ]
    return "\n\n".join(parts) + "\n"
