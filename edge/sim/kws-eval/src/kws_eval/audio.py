"""Small, dependency-light audio helpers (16 kHz mono float32 everywhere)."""

from __future__ import annotations

import wave
from math import gcd
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

SAMPLE_RATE = 16000
_EPS = 1e-12


def write_wav(path: Path, samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Read a PCM16 wav file; multi-channel input is averaged to mono."""
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError(f"{path}: only 16-bit PCM wav is supported")
        channels = wav.getnchannels()
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())
    data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def resample(samples: np.ndarray, src_rate: int, dst_rate: int = SAMPLE_RATE) -> np.ndarray:
    if src_rate == dst_rate:
        return samples.astype(np.float32, copy=False)
    divisor = gcd(src_rate, dst_rate)
    out = resample_poly(samples, dst_rate // divisor, src_rate // divisor)
    return out.astype(np.float32)


def pitch_shift(samples: np.ndarray, factor: float) -> np.ndarray:
    """Raise (``factor > 1``) or lower pitch by resampling; duration changes by ``1/factor``.

    Pitch and tempo move together, which is exactly the "different pitch, slightly different
    speed" variation the corpus wants (no time-stretch artefacts).
    """
    if factor <= 0:
        raise ValueError("pitch factor must be positive")
    if abs(factor - 1.0) < 1e-6:
        return samples
    scale = 1000
    up, down = scale, int(round(scale * factor))
    shifted = resample_poly(samples, up, down)
    return shifted.astype(np.float32)


def rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


def active_span(samples: np.ndarray, frame: int = 160, floor_db: float = -40.0) -> tuple[int, int]:
    """Return (start, end) sample indices of the region louder than ``floor_db`` below peak."""
    if samples.size < frame:
        return 0, samples.size
    n_frames = samples.size // frame
    energy = np.sqrt(np.mean(samples[: n_frames * frame].reshape(n_frames, frame) ** 2, axis=1))
    peak = energy.max()
    if peak <= _EPS:
        return 0, samples.size
    loud = np.nonzero(energy >= peak * 10 ** (floor_db / 20.0))[0]
    return int(loud[0] * frame), int((loud[-1] + 1) * frame)


def active_rms(samples: np.ndarray, frame: int = 160, floor_db: float = -40.0) -> float:
    """RMS over only the frames within ``floor_db`` of the loudest frame (speech-active level)."""
    if samples.size < frame:
        return rms(samples)
    n_frames = samples.size // frame
    frames = samples[: n_frames * frame].reshape(n_frames, frame).astype(np.float64)
    energy = np.sqrt(np.mean(frames**2, axis=1))
    keep = energy >= energy.max() * 10 ** (floor_db / 20.0)
    return float(np.sqrt(np.mean(frames[keep] ** 2))) if keep.any() else 0.0


def mix_at_snr(
    speech: np.ndarray, noise: np.ndarray, snr_db: float, speech_span: tuple[int, int]
) -> np.ndarray:
    """Return ``speech + g*noise`` where SNR is measured over ``speech_span`` only.

    ``noise`` must be at least as long as ``speech``. Inputs are not modified.
    """
    start, end = speech_span
    return mix_at_snr_rms(speech, noise, snr_db, rms(speech[start:end]))


def mix_at_snr_rms(
    speech: np.ndarray, noise: np.ndarray, snr_db: float, speech_rms: float
) -> np.ndarray:
    """Like :func:`mix_at_snr` with the reference speech level given directly."""
    noise_seg = noise[: speech.size]
    noise_rms = rms(noise_seg)
    if noise_rms <= _EPS or speech_rms <= _EPS:
        return speech.copy()
    gain = speech_rms / (noise_rms * 10 ** (snr_db / 20.0))
    mixed = speech + gain * noise_seg
    peak = float(np.max(np.abs(mixed)))
    return mixed / peak * 0.95 if peak > 0.99 else mixed.astype(np.float32)


def normalise_peak(samples: np.ndarray, peak: float = 0.7) -> np.ndarray:
    current = float(np.max(np.abs(samples))) if samples.size else 0.0
    if current <= _EPS:
        return samples
    return (samples * (peak / current)).astype(np.float32)
