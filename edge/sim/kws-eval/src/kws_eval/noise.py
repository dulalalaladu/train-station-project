"""Noise sources for SNR variants.

* ``white`` / ``pink``  - plain synthetic noise.
* ``yard``              - SYNTHETIC PROXY for railway-yard ambience (diesel rumble, wheel/rail
                          clatter, horn bursts, wind, brake squeal). It is NOT a recording; real
                          yard recordings must replace it for the Jetson re-test (``--noise-dir``).
* ``esc``               - optional public-dataset clips (ESC-50: train, engine, wind, siren,
                          helicopter, car horn), fetched on demand; CC BY-NC 3.0, never committed.
"""

from __future__ import annotations

import csv
import functools
import hashlib
import io
import json
import logging
import urllib.request
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

from kws_eval.audio import SAMPLE_RATE, normalise_peak, read_wav, resample, write_wav
from kws_eval.paths import cache_dir

log = logging.getLogger(__name__)

SYNTH_KINDS = ("white", "pink", "yard")
ESC_COMMIT = "33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6"  # pinned (checked 2026-10-23)
ESC_BASE = "https://raw.githubusercontent.com/karolpiczak/ESC-50"
ESC_CLASSES = ("train", "engine", "wind", "siren", "helicopter", "car_horn")


def white(rng: np.random.Generator, n: int) -> np.ndarray:
    raw = rng.standard_normal(n)
    return (raw / np.max(np.abs(raw))).astype(np.float32)


def pink(rng: np.random.Generator, n: int) -> np.ndarray:
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.arange(spectrum.size, dtype=np.float64)
    freqs[0] = 1.0
    shaped = np.fft.irfft(spectrum / np.sqrt(freqs), n)
    return (shaped / np.max(np.abs(shaped))).astype(np.float32)


def _band(x: np.ndarray, lo: float | None, hi: float | None) -> np.ndarray:
    if lo and hi:
        sos = butter(4, [lo, hi], btype="band", fs=SAMPLE_RATE, output="sos")
    elif hi:
        sos = butter(4, hi, btype="low", fs=SAMPLE_RATE, output="sos")
    else:
        sos = butter(4, lo, btype="high", fs=SAMPLE_RATE, output="sos")
    return sosfilt(sos, x)


def _rumble(rng: np.random.Generator, n: int) -> np.ndarray:
    t = np.arange(n) / SAMPLE_RATE
    base = _band(rng.standard_normal(n), None, 180.0)
    hum = sum(
        np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) / k
        for k, f in enumerate((50, 100, 150), 1)
    )
    swell = 0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(0.05, 0.2) * t)
    return (base * 2.0 + hum * 0.5) * swell


def _clatter(rng: np.random.Generator, n: int) -> np.ndarray:
    out = np.zeros(n)
    pos = int(rng.uniform(0, 0.4) * SAMPLE_RATE)
    burst = int(0.12 * SAMPLE_RATE)
    decay = np.exp(-np.arange(burst) / (0.025 * SAMPLE_RATE))
    while pos + burst < n:
        out[pos : pos + burst] += _band(rng.standard_normal(burst), 800.0, 5000.0) * decay
        pos += int(rng.uniform(0.18, 0.55) * SAMPLE_RATE)
    return out * 3.0


def _horn(rng: np.random.Generator, n: int) -> np.ndarray:
    out = np.zeros(n)
    t = np.arange(n) / SAMPLE_RATE
    tone = sum(np.sin(2 * np.pi * f * h * t) / h for f in (311.0, 415.0) for h in (1, 2, 3))
    cursor = int(rng.uniform(1.0, 6.0) * SAMPLE_RATE)
    while cursor < n:
        length = int(rng.uniform(0.8, 2.0) * SAMPLE_RATE)
        env = np.hanning(min(length, n - cursor))
        out[cursor : cursor + env.size] += tone[cursor : cursor + env.size] * env
        cursor += length + int(rng.uniform(6.0, 20.0) * SAMPLE_RATE)
    return out * 0.8


def _squeal(rng: np.random.Generator, n: int) -> np.ndarray:
    out = np.zeros(n)
    cursor = int(rng.uniform(2.0, 8.0) * SAMPLE_RATE)
    while cursor < n:
        length = int(rng.uniform(0.5, 1.5) * SAMPLE_RATE)
        t = np.arange(min(length, n - cursor)) / SAMPLE_RATE
        sweep = np.sin(2 * np.pi * (2200.0 * t + 900.0 * t * t / max(t[-1], 1e-3)))
        out[cursor : cursor + t.size] += sweep * np.hanning(t.size) * 0.5
        cursor += length + int(rng.uniform(8.0, 25.0) * SAMPLE_RATE)
    return out


def yard(rng: np.random.Generator, n: int) -> np.ndarray:
    wind = _band(rng.standard_normal(n), None, 600.0) * 1.2
    mix = _rumble(rng, n) + _clatter(rng, n) + _horn(rng, n) + _squeal(rng, n) + wind
    return (mix / np.max(np.abs(mix))).astype(np.float32)


_SYNTH = {"white": white, "pink": pink, "yard": yard}


def synth_noise(kind: str, seed: int, n_samples: int) -> np.ndarray:
    if kind not in _SYNTH:
        raise ValueError(f"unknown synthetic noise kind {kind!r}; choose from {SYNTH_KINDS}")
    return _SYNTH[kind](np.random.default_rng(seed), n_samples)


def _esc_dir() -> Path:
    return cache_dir() / "noise" / "esc50"


def _http_get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310  (pinned https URL)
        return resp.read()


def fetch_esc50(per_class: int = 8) -> list[Path]:
    """Download ``per_class`` clips of each yard-like ESC-50 class; record digests in a lock."""
    dest = _esc_dir()
    dest.mkdir(parents=True, exist_ok=True)
    meta = _http_get(f"{ESC_BASE}/{ESC_COMMIT}/meta/esc50.csv").decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(meta)))
    lock: dict[str, str] = {}
    paths: list[Path] = []
    for cls in ESC_CLASSES:
        names = sorted(r["filename"] for r in rows if r["category"] == cls)[:per_class]
        for name in names:
            out = dest / name
            if not out.exists():
                data = _http_get(f"{ESC_BASE}/{ESC_COMMIT}/audio/{name}")
                out.write_bytes(data)
            lock[name] = hashlib.sha256(out.read_bytes()).hexdigest()
            paths.append(out)
    (dest / "esc50.lock.json").write_text(json.dumps(lock, indent=2, sort_keys=True), "utf-8")
    log.info("ESC-50: %d clips cached in %s", len(paths), dest)
    return paths


def load_noise_dir(directory: Path) -> list[np.ndarray]:
    """Load every ``*.wav`` in ``directory`` as 16 kHz mono (unreadable files are skipped)."""
    clips: list[np.ndarray] = []
    for path in sorted(directory.glob("*.wav")):
        try:
            data, rate = read_wav(path)
        except (ValueError, EOFError, wave.Error) as exc:
            log.warning("skipping noise file %s: %s", path.name, exc)
            continue
        clips.append(normalise_peak(resample(data, rate), 0.9))
    return clips


def tile_to_length(clips: list[np.ndarray], n_samples: int, rng: np.random.Generator) -> np.ndarray:
    """Concatenate randomly chosen clips until ``n_samples`` is reached."""
    if not clips:
        raise ValueError("no noise clips available")
    pieces: list[np.ndarray] = []
    total = 0
    while total < n_samples:
        clip = clips[int(rng.integers(len(clips)))]
        pieces.append(clip)
        total += clip.size
    return np.concatenate(pieces)[:n_samples].astype(np.float32)


def esc_clips() -> list[np.ndarray]:
    """Cached ESC-50 clips (empty list if ``fetch`` has not downloaded them)."""
    return load_noise_dir(_esc_dir()) if _esc_dir().is_dir() else []


def custom_dir() -> Path:
    """Drop real yard recordings (``*.wav``, any rate, PCM16) here; they become noise ``custom``."""
    return cache_dir() / "noise" / "custom"


def custom_clips() -> list[np.ndarray]:
    return load_noise_dir(custom_dir()) if custom_dir().is_dir() else []


def bed_clips(kind: str) -> list[np.ndarray]:
    """Clips backing a sample-based noise kind (``esc`` or ``custom``)."""
    if kind == "esc":
        return esc_clips()
    if kind == "custom":
        return custom_clips()
    raise ValueError(f"{kind!r} is not a sample-based noise kind")


def noise_bed(kind: str, n_samples: int, seed: int) -> np.ndarray:
    """``n_samples`` of noise of ``kind`` (synthetic or sample-based), deterministic in ``seed``."""
    if kind in ("esc", "custom"):
        return tile_to_length(bed_clips(kind), n_samples, np.random.default_rng(seed))
    bank = _synth_bank(kind)
    if n_samples > bank.size:
        bank = np.tile(bank, -(-n_samples // bank.size))
    start = int(np.random.default_rng(seed).integers(0, bank.size - n_samples + 1))
    return bank[start : start + n_samples].copy()


BANK_SECONDS = 330
BANK_SEED = 7919


@functools.cache
def _synth_bank(kind: str) -> np.ndarray:
    """One long deterministic recording per synthetic kind; clips are random excerpts of it."""
    return synth_noise(kind, BANK_SEED, BANK_SECONDS * SAMPLE_RATE)


def export_noise_preview(path: Path, kind: str, seconds: float = 20.0, seed: int = 0) -> None:
    write_wav(path, synth_noise(kind, seed, int(seconds * SAMPLE_RATE)) * 0.5)
