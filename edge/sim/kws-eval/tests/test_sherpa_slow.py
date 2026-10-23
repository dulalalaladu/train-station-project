"""Integration tests against the real sherpa-onnx model; skipped until `kws-eval fetch` has run."""

import numpy as np
import pytest

from kws_eval import models
from kws_eval.audio import SAMPLE_RATE
from kws_eval.engine import EngineUnavailableError
from kws_eval.keywords import KeywordTuning
from kws_eval.paths import cache_dir
from kws_eval.runner import run_stream
from kws_eval.sherpa import SherpaConfig, SherpaEngine
from kws_eval.tts import TtsSynth, short_espeak_dir

pytestmark = pytest.mark.slow
MODELS = cache_dir() / "models"
KWS_DIR = MODELS / models.KWS_ZH_EN.top_dir
TTS_EN_DIR = MODELS / models.TTS_EN.top_dir
need_kws = pytest.mark.skipif(not KWS_DIR.is_dir(), reason="run `kws-eval fetch` first")
need_tts = pytest.mark.skipif(not TTS_EN_DIR.is_dir(), reason="run `kws-eval fetch` first")


@need_kws
def test_missing_model_file_is_reported_clearly(tmp_path):
    (tmp_path / "tokens.txt").write_text("a 0\n", encoding="utf-8")
    with pytest.raises(EngineUnavailableError, match="missing model file"):
        SherpaEngine(SherpaConfig(tmp_path))


@need_kws
def test_silence_and_noise_produce_no_detection():
    engine = SherpaEngine(SherpaConfig(KWS_DIR, default_tuning=KeywordTuning(3.0, 0.15)))
    try:
        quiet = np.zeros(SAMPLE_RATE * 3, dtype=np.float32)
        noise = np.random.default_rng(0).standard_normal(SAMPLE_RATE * 3).astype(np.float32) * 0.1
        assert run_stream(engine, quiet, "q").detections == ()
        assert run_stream(engine, noise, "n").detections == ()
    finally:
        engine.close()


@need_kws
@need_tts
def test_synthetic_english_keyword_is_spotted_end_to_end():
    synth = TtsSynth.english(TTS_EN_DIR)
    engine = SherpaEngine(SherpaConfig(KWS_DIR, default_tuning=KeywordTuning(3.0, 0.1)))
    try:
        hits = 0
        for speaker in synth.speakers:
            speech = synth.synth("Return to base", speaker)
            pad = np.zeros(SAMPLE_RATE, dtype=np.float32)
            run = run_stream(engine, np.concatenate([pad, speech, pad]), "t")
            hits += any(d.keyword == "Return_to_base" for d in run.detections)
        assert hits >= len(synth.speakers) - 2
    finally:
        engine.close()


def test_short_espeak_dir_keeps_short_paths_and_copies_long_ones(tmp_path):
    short = tmp_path / "espeak-ng-data"
    short.mkdir()
    assert short_espeak_dir(short) == short
    deep = tmp_path / ("d" * 120) / ("e" * 90) / "model" / "espeak-ng-data"
    deep.mkdir(parents=True)
    (deep / "phontab").write_bytes(b"x")
    copied = short_espeak_dir(deep)
    assert copied != deep and (copied / "phontab").read_bytes() == b"x"
