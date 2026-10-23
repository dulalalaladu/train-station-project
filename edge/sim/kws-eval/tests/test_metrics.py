import math

import pytest

from kws_eval import metrics
from kws_eval.engine import Detection
from kws_eval.keywords import KEYWORDS
from kws_eval.manifest import PositiveClip
from kws_eval.runner import StreamRun


def _clip(keyword="停下", intent="STOP", snr=None, onset=1.0, offset=1.6):
    return PositiveClip(
        file="x.wav",
        keyword=keyword,
        intent=intent,
        lang="zh",
        speaker=1,
        speed=1.0,
        pitch=1.0,
        noise="none" if snr is None else "white",
        snr_db=snr,
        onset_s=onset,
        offset_s=offset,
        duration_s=3.0,
    )


def _run(*dets, duration=3.0):
    return StreamRun("x.wav", duration, tuple(Detection(k, t) for k, t in dets), 0.1, 0.1, 0.01)


def test_hit_inside_window_with_latency():
    res = metrics.score_positive(_clip(), _run(("停下", 1.9)))
    assert res.hit and res.intent_hit and res.wrong == ()
    assert res.latency_s == pytest.approx(0.3)


def test_detection_after_window_is_a_miss():
    res = metrics.score_positive(
        _clip(), _run(("停下", 1.6 + metrics.HIT_WINDOW_AFTER_END_S + 0.1))
    )
    assert not res.hit and res.latency_s is None


def test_substitution_within_intent_counts_for_intent_recall_only():
    res = metrics.score_positive(_clip(), _run(("站住", 1.8)))
    assert not res.hit and res.intent_hit and res.wrong == ("站住",)


def test_substitution_across_intents_is_wrong():
    res = metrics.score_positive(_clip(), _run(("回巢", 1.8)))
    assert not res.hit and not res.intent_hit and res.wrong == ("回巢",)


def test_aggregate_by_snr_and_latency_stats():
    results = [
        metrics.score_positive(_clip(snr=10.0), _run(("停下", 1.8))),
        metrics.score_positive(_clip(snr=10.0), _run()),
        metrics.score_positive(_clip(snr=0.0), _run(("停下", 2.2))),
    ]
    rows = {r.key: r for r in metrics.aggregate(results, lambda r: str(r.clip.snr_db))}
    assert rows["10.0"].n == 2 and rows["10.0"].recall == 0.5
    assert rows["0.0"].recall == 1.0
    lat = metrics.latency_stats(results)
    assert lat.n == 2 and lat.median_s == pytest.approx(0.4) and lat.max_s == pytest.approx(0.6)
    assert math.isnan(metrics.latency_stats([]).median_s)


def test_recall_row_empty_is_nan():
    assert math.isnan(metrics.RecallRow("k", 0, 0, 0).recall)


def test_false_alarms_counts_per_keyword_and_hours():
    runs = [
        _run(("停下", 10.0), ("小铁小铁", 20.0), duration=1800.0),
        _run(("停下", 5.0), duration=1800.0),
    ]
    fa = metrics.false_alarms(runs, KEYWORDS)
    assert fa.per_keyword["停下"] == 2 and fa.per_keyword["小铁小铁"] == 1
    assert fa.total == 3 and fa.hours == pytest.approx(1.0)
    assert fa.per_hour == pytest.approx(3.0)
    assert fa.global_times_s[-1] == ("停下", 1805.0)
    assert fa.upper_bound_per_hour() > fa.per_hour


def test_poisson_upper_matches_known_values():
    assert metrics.poisson_upper(0) == pytest.approx(2.996, abs=0.01)
    assert metrics.poisson_upper(1) == pytest.approx(4.744, abs=0.01)
    assert metrics.hours_needed_for_bound(1.0) == pytest.approx(2.996, abs=0.01)


def test_gated_false_alarms_requires_wake_before_command():
    timeline = (("小铁小铁", 100.0), ("停下", 102.0), ("回巢", 120.0), ("停下", 50.0))
    assert metrics.gated_false_alarms(timeline, "小铁小铁", 5.0) == 1
    assert metrics.gated_false_alarms(timeline, "小铁小铁", 30.0) == 2


def test_modelled_gated_rate():
    assert metrics.modelled_gated_rate_per_hour(2.0, 3.0, 5.0) == pytest.approx(6 * 5 / 3600)
