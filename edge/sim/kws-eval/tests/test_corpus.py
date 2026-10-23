import numpy as np
import pytest

from kws_eval import noise
from kws_eval.corpus import CorpusConfig, Variant, variants_for
from kws_eval.keywords import KEYWORDS
from kws_eval.manifest import Manifest, NegativeClip, PositiveClip
from kws_eval.negatives import FILE_SECONDS, _plans
from kws_eval.sentences import DECOY_EN, DECOY_ZH, SPEECH_EN, SPEECH_ZH


def test_config_enforces_task_card_minimums():
    with pytest.raises(ValueError, match="10 variants"):
        CorpusConfig(variants_per_keyword=9)
    with pytest.raises(ValueError, match="30 minutes"):
        CorpusConfig(neg_minutes=29)


def test_variants_are_unique_and_cover_speeds_and_pitches():
    vs = variants_for((1, 2, 3, 4, 5, 6, 7), 12)
    assert len(vs) == 12 and len(set(vs)) == 12
    assert {v.speed for v in vs} == {0.85, 1.0, 1.2}
    assert {v.pitch for v in vs} == {0.92, 1.0, 1.1}
    assert all(isinstance(v, Variant) for v in vs)


def test_negative_sentences_never_contain_a_real_keyword():
    banks = SPEECH_ZH + SPEECH_EN + DECOY_ZH + DECOY_EN
    for sentence in banks:
        lowered = sentence.lower()
        for kw in KEYWORDS:
            assert kw.text.lower() not in lowered, f"{sentence!r} contains {kw.text!r}"


@pytest.mark.parametrize("minutes", [30.0, 40.0, 60.0])
def test_negative_plan_reaches_requested_duration(minutes):
    plans = _plans(CorpusConfig(neg_minutes=minutes))
    assert len(plans) * FILE_SECONDS >= minutes * 60.0 - 1e-6
    assert {p.kind for p in plans} == {"speech", "noise", "decoy"}
    assert all(p.snr_db is None for p in plans if p.kind == "noise")


def test_synth_noise_is_deterministic_and_bounded():
    for kind in noise.SYNTH_KINDS:
        a = noise.synth_noise(kind, 7, 16000)
        b = noise.synth_noise(kind, 7, 16000)
        assert np.array_equal(a, b) and a.shape == (16000,)
        assert np.max(np.abs(a)) <= 1.0001
    with pytest.raises(ValueError):
        noise.synth_noise("brown", 0, 10)


def test_tile_to_length_and_empty():
    clips = [np.ones(100, np.float32)]
    out = noise.tile_to_length(clips, 250, np.random.default_rng(0))
    assert out.size == 250
    with pytest.raises(ValueError):
        noise.tile_to_length([], 10, np.random.default_rng(0))


def test_manifest_roundtrip_and_validation(tmp_path):
    pos = PositiveClip(
        file="a.wav",
        keyword="停下",
        intent="STOP",
        lang="zh",
        speaker=1,
        speed=1.0,
        pitch=1.0,
        noise="white",
        snr_db=5.0,
        onset_s=1.0,
        offset_s=1.5,
        duration_s=3.0,
    )
    neg = NegativeClip(
        file="n.wav", kind="speech", duration_s=3600.0, noise="yard", snr_db=10.0, n_utterances=3
    )
    m = Manifest(seed=1, tts_model="t", positives=(pos,), negatives=(neg,))
    m.save(tmp_path / "m.json")
    again = Manifest.load(tmp_path / "m.json")
    assert again == m and again.negative_hours == pytest.approx(1.0)
    with pytest.raises(ValueError):
        PositiveClip(**{**pos.model_dump(), "speed": 0.0})
