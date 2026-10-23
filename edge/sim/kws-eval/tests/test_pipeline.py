"""runner -> metrics -> evaluate -> report, end to end with a fake engine and tiny wav files."""

import json

import numpy as np
import pytest
from fakes import FakeEngine

from kws_eval import report, runner, sweep
from kws_eval.audio import SAMPLE_RATE, write_wav
from kws_eval.evaluate import evaluate
from kws_eval.manifest import Manifest, NegativeClip, PositiveClip


def _wav_with_burst(path, burst_at=1.0, seconds=3.0, amp=0.5):
    x = np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
    if burst_at is not None:
        start = int(burst_at * SAMPLE_RATE)
        x[start : start + 1600] = amp
    write_wav(path, x)


def _positive(file, snr=None):
    return PositiveClip(
        file=file, keyword="停下", intent="STOP", lang="zh", speaker=1, speed=1.0, pitch=1.0,
        noise="none" if snr is None else "white", snr_db=snr, onset_s=0.9, offset_s=1.3,
        duration_s=3.0,
    )  # fmt: skip


@pytest.fixture()
def corpus(tmp_path):
    _wav_with_burst(tmp_path / "p_clean.wav")
    _wav_with_burst(tmp_path / "p_snr0.wav", burst_at=None)  # engine misses this one
    _wav_with_burst(tmp_path / "n0.wav", burst_at=2.0, seconds=6.0)
    manifest = Manifest(
        seed=0,
        tts_model="fake",
        positives=(_positive("p_clean.wav"), _positive("p_snr0.wav", snr=0.0)),
        negatives=(
            NegativeClip(
                file="n0.wav", kind="speech", duration_s=6.0, noise="white", snr_db=10.0,
                n_utterances=1,
            ),
        ),
    )  # fmt: skip
    manifest.save(tmp_path / "manifest.json")
    return tmp_path, manifest


def test_run_stream_records_detection_time_and_resources():
    x = np.zeros(SAMPLE_RATE * 2, dtype=np.float32)
    x[SAMPLE_RATE : SAMPLE_RATE + 800] = 0.9
    run = runner.run_stream(FakeEngine(), x, "x")
    assert [d.keyword for d in run.detections] == ["停下"]
    assert 1.0 <= run.detections[0].audio_time <= 1.2
    assert run.duration_s == pytest.approx(2.0) and run.cpu_s >= 0 and run.wall_s > 0


def test_run_many_aggregates_resources():
    items = [("a", np.zeros(SAMPLE_RATE, np.float32)), ("b", np.zeros(SAMPLE_RATE, np.float32))]
    seen = []
    runs, stats = runner.run_many(FakeEngine(), items, on_progress=seen.append)
    assert len(runs) == 2 and seen == [1, 2]
    assert stats.audio_s == pytest.approx(2.0) and stats.peak_rss_mb > 0
    assert stats.cpu_cores >= 0 and stats.realtime_factor >= 0
    assert runner.ResourceStats().cpu_cores == 0.0


def test_evaluate_and_report(corpus):
    tmp, manifest = corpus
    res = evaluate(FakeEngine(), manifest, tmp)
    assert [r.hit for r in res.clip_results] == [True, False]
    assert res.false_alarm.total == 1 and res.false_alarm.hours == pytest.approx(6 / 3600)

    md = report.full_report([res], res, window_s=5.0)
    for heading in ("Configuration sweep", "Per-keyword results", "Noise type x SNR", "Per intent"):
        assert heading in md
    assert "停下" in md and "100.0%" in md

    report.write_json(tmp / "out" / "r.json", [res])
    data = json.loads((tmp / "out" / "r.json").read_text(encoding="utf-8"))
    assert data[0]["false_alarm_total"] == 1 and len(data[0]["clips"]) == 2


def test_choose_prefers_recall_among_configs_under_the_false_alarm_gate(corpus):
    tmp, manifest = corpus
    quiet = evaluate(FakeEngine(threshold=0.99), manifest, tmp, "quiet")  # 0 FA, 0 recall
    loud = evaluate(FakeEngine(threshold=0.2), manifest, tmp, "loud")  # 1 FA in 6 s -> >1/h
    assert sweep.choose([quiet, loud]).label == "quiet"
    assert sweep.choose([loud]).label == "loud"  # nothing meets the gate: penalised recall wins
    assert sweep.mean_noisy_recall(loud) == 0.0  # the only noisy clip is the missed one


def test_core_views_exclude_extra_keywords(corpus):
    tmp, manifest = corpus
    extra = _positive("p_clean.wav").model_copy(update={"keyword": "别动"})
    mixed = manifest.model_copy(update={"positives": (*manifest.positives, extra)})
    res = evaluate(FakeEngine(), mixed, tmp)
    assert len(res.clip_results) == 3 and len(res.core_clips) == 2
    assert res.core_false_alarms == res.false_alarm.total  # only the core keyword fired
    assert "别动 (extra)" in report.per_keyword_table(res)
    assert "voice bank" in report.voice_table(res)
    assert "别动" in report.keyword_matrix([res])


def test_grid_sizes(tmp_path):
    assert len(sweep.grid("quick", tmp_path)) == len(sweep.TUNINGS_QUICK)
    assert len(sweep.grid("full", tmp_path)) == 3 * len(sweep.TUNINGS_FULL)
    assert len(sweep.grid("variants", tmp_path)) == 3
    with pytest.raises(ValueError, match="unknown grid"):
        sweep.grid("huge", tmp_path)
