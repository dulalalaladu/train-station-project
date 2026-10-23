"""Corpus builders exercised with a fake TTS (no model downloads, small sizes)."""

import numpy as np
import pytest

from kws_eval import corpus, negatives, noise
from kws_eval.audio import SAMPLE_RATE, read_wav
from kws_eval.corpus import CorpusConfig, build_positives
from kws_eval.keywords import KEYWORDS
from kws_eval.manifest import PositiveClip


class FakeTts:
    speakers = (1, 2, 3)

    def synth(self, text, speaker, speed=1.0):
        n = int((0.2 + 0.1 * len(text)) * SAMPLE_RATE / speed)
        t = np.arange(n) / SAMPLE_RATE
        return (0.4 * np.sin(2 * np.pi * (200 + 40 * speaker) * t)).astype(np.float32)


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("KWS_EVAL_HOME", str(tmp_path / "home"))


def test_build_positives_writes_expected_conditions(tmp_path):
    cfg = CorpusConfig(synth_noise=("white",), snr_levels=(10.0, 0.0))
    specs = KEYWORDS[:2]
    clips = build_positives(cfg, FakeTts(), FakeTts(), tmp_path, specs)
    # per variant: clean + white at two SNRs
    assert len(clips) == 2 * cfg.variants_per_keyword * 3
    assert all(isinstance(c, PositiveClip) for c in clips)
    first = clips[0]
    assert first.noise == "none" and first.snr_db is None
    audio, rate = read_wav(tmp_path / first.file)
    assert rate == SAMPLE_RATE and audio.size / rate == pytest.approx(first.duration_s, abs=0.01)
    assert first.offset_s > first.onset_s >= cfg.lead_s - 1e-6
    names = {c.file.rsplit("_", 2)[-2:][0] for c in clips}
    assert names  # file naming carries noise + SNR tags
    assert {c.snr_db for c in clips} == {None, 10.0, 0.0}


def test_noisy_clip_has_requested_snr_over_keyword_span(tmp_path):
    cfg = CorpusConfig(synth_noise=("white",), snr_levels=(5.0,))
    clips = build_positives(cfg, FakeTts(), FakeTts(), tmp_path, KEYWORDS[:1])
    clean = next(c for c in clips if c.snr_db is None and c.speaker == 1 and c.speed == 0.85)
    noisy = next(
        c for c in clips if c.snr_db == 5.0 and c.speaker == 1 and c.speed == 0.85 and c.pitch == 0.92
    )
    x_clean, _ = read_wav(tmp_path / clean.file)
    x_noisy, _ = read_wav(tmp_path / noisy.file)
    lo, hi = int(clean.onset_s * SAMPLE_RATE), int(clean.offset_s * SAMPLE_RATE)
    gain = float(np.dot(x_noisy[lo:hi], x_clean[lo:hi]) / np.dot(x_clean[lo:hi], x_clean[lo:hi]))
    residual = x_noisy[lo:hi] - gain * x_clean[lo:hi]
    snr = 20 * np.log10(np.sqrt(np.mean((gain * x_clean[lo:hi]) ** 2)) / np.sqrt(np.mean(residual**2)))
    assert snr == pytest.approx(5.0, abs=1.0)


def test_available_noise_picks_up_custom_recordings(tmp_path):
    cfg = CorpusConfig()
    assert corpus.available_noise(cfg) == ("white", "yard")
    custom = noise.custom_dir()
    custom.mkdir(parents=True)
    from kws_eval.audio import write_wav

    write_wav(custom / "rec.wav", noise.synth_noise("pink", 1, SAMPLE_RATE) * 0.5)
    assert corpus.available_noise(cfg) == ("white", "yard", "custom")
    bed = noise.noise_bed("custom", SAMPLE_RATE * 3, 1)
    assert bed.size == SAMPLE_RATE * 3
    with pytest.raises(ValueError):
        noise.bed_clips("white")


def test_negative_builder_covers_all_kinds_and_stays_keyword_free_by_construction(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(negatives, "FILE_SECONDS", 6.0)
    monkeypatch.setattr(CorpusConfig, "__post_init__", lambda self: None)
    cfg = CorpusConfig(neg_minutes=0.6)
    clips = negatives.build_negatives(cfg, FakeTts(), FakeTts(), tmp_path)
    assert {c.kind for c in clips} == {"speech", "noise", "decoy"}
    for clip in clips:
        audio, rate = read_wav(tmp_path / clip.file)
        assert audio.size / rate == pytest.approx(6.0, abs=0.01)
        assert (clip.n_utterances == 0) == (clip.kind == "noise")
        assert np.max(np.abs(audio)) <= 1.0


def test_esc_and_dir_loaders_handle_missing_and_bad_files(tmp_path):
    assert noise.esc_clips() == []
    bad = tmp_path / "noise"
    bad.mkdir()
    (bad / "broken.wav").write_bytes(b"not a wav")
    assert noise.load_noise_dir(bad) == []  # unreadable files are skipped, not fatal
