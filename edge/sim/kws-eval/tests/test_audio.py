import numpy as np
import pytest

from kws_eval import audio


def _tone(seconds=1.0, freq=440.0, amp=0.5):
    t = np.arange(int(seconds * audio.SAMPLE_RATE)) / audio.SAMPLE_RATE
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_wav_roundtrip(tmp_path):
    x = _tone()
    path = tmp_path / "a" / "x.wav"
    audio.write_wav(path, x)
    y, rate = audio.read_wav(path)
    assert rate == audio.SAMPLE_RATE
    assert y.shape == x.shape
    assert np.max(np.abs(x - y)) < 1e-3


def test_read_wav_rejects_non_16bit(tmp_path):
    import wave

    path = tmp_path / "bad.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(16000)
        w.writeframes(b"\x00" * 100)
    with pytest.raises(ValueError, match="16-bit"):
        audio.read_wav(path)


def test_resample_length_and_identity():
    x = _tone(1.0)
    assert audio.resample(x, 16000, 16000) is x or np.array_equal(audio.resample(x, 16000), x)
    assert abs(audio.resample(x, 16000, 8000).size - 8000) <= 2


def test_pitch_shift_changes_duration_inversely():
    x = _tone(1.0)
    assert audio.pitch_shift(x, 1.0) is x
    assert abs(audio.pitch_shift(x, 1.25).size - int(x.size / 1.25)) <= 2
    with pytest.raises(ValueError):
        audio.pitch_shift(x, 0.0)


def test_mix_at_snr_hits_requested_level():
    speech = _tone(1.0, amp=0.3)
    noise = np.random.default_rng(0).standard_normal(speech.size).astype(np.float32)
    for snr in (10.0, 0.0):
        mixed = audio.mix_at_snr(speech, noise, snr, (0, speech.size))
        # the mix may be globally rescaled to avoid clipping; project that gain out first
        gain = float(np.dot(mixed, speech) / np.dot(speech, speech))
        residual = mixed - gain * speech
        measured = 20 * np.log10(audio.rms(gain * speech) / audio.rms(residual))
        assert measured == pytest.approx(snr, abs=0.2)


def test_mix_at_snr_degenerate_inputs_return_copy():
    speech = _tone(0.2)
    out = audio.mix_at_snr(speech, np.zeros_like(speech), 5.0, (0, speech.size))
    assert np.array_equal(out, speech) and out is not speech


def test_active_span_and_active_rms_ignore_silence():
    x = np.concatenate([np.zeros(8000, np.float32), _tone(0.5), np.zeros(8000, np.float32)])
    start, end = audio.active_span(x)
    assert 7800 <= start <= 8200 and 15800 <= end <= 16200
    assert audio.active_rms(x) == pytest.approx(audio.rms(_tone(0.5)), rel=0.05)
    assert audio.active_span(np.zeros(100, np.float32)) == (0, 100)


def test_normalise_peak():
    x = _tone(amp=0.1)
    assert np.max(np.abs(audio.normalise_peak(x, 0.7))) == pytest.approx(0.7, abs=1e-4)
    z = np.zeros(10, np.float32)
    assert audio.normalise_peak(z) is z
