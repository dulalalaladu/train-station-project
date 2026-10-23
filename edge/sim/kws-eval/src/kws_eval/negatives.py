"""Keyword-free audio for false-alarm statistics: chatter, near-miss decoys and pure noise."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from kws_eval.audio import SAMPLE_RATE, active_rms, mix_at_snr_rms, normalise_peak, write_wav
from kws_eval.corpus import CorpusConfig, Variant, available_noise, trimmed_utterance
from kws_eval.manifest import NegativeClip
from kws_eval.noise import SYNTH_KINDS, bed_clips, noise_bed
from kws_eval.sentences import DECOY_EN, DECOY_ZH, SPEECH_EN, SPEECH_ZH
from kws_eval.tts import TtsSynth, VoiceBank

log = logging.getLogger(__name__)

FILE_SECONDS = 300.0  # each negative stream file is ~5 minutes
SHARE = {"speech": 0.50, "noise": 0.25, "decoy": 0.25}
# noise-only files cycle through these (most yard-like first)
NOISE_ONLY_ORDER = ("yard", "esc", "pink", "white")
SPEECH_SNRS = (20.0, 10.0, 5.0)
ZH_SHARE = 0.7
NOISE_ONLY_RMS = 0.06


@dataclass(frozen=True)
class _Plan:
    kind: str
    index: int
    noise: str
    snr_db: float | None


def _random_variant(rng: np.random.Generator, speakers: tuple[int, ...]) -> Variant:
    return Variant(
        speaker=int(rng.choice(speakers)),
        speed=float(rng.uniform(0.85, 1.2)),
        pitch=float(rng.choice((0.92, 1.0, 1.1))),
    )


def _speech_track(
    cfg: CorpusConfig,
    zh: TtsSynth | VoiceBank,
    en: TtsSynth | VoiceBank,
    bank: tuple[tuple[str, ...], tuple[str, ...]],
    seconds: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, int]:
    """Concatenate random utterances separated by 0.4-2.5 s gaps until ``seconds`` is reached."""
    zh_bank, en_bank = bank
    pieces: list[np.ndarray] = []
    total, count = 0, 0
    target = int(seconds * SAMPLE_RATE)
    while total < target:
        use_zh = rng.random() < ZH_SHARE
        tts, texts = (zh, zh_bank) if use_zh else (en, en_bank)
        text = texts[int(rng.integers(len(texts)))]
        utt = normalise_peak(trimmed_utterance(tts, text, _random_variant(rng, tts.speakers)))
        gap = np.zeros(int(rng.uniform(0.4, 2.5) * SAMPLE_RATE), dtype=np.float32)
        pieces.extend([gap, utt])
        total += gap.size + utt.size
        count += 1
    return np.concatenate(pieces)[:target].astype(np.float32), count


def _make_speech_file(cfg, zh, en, plan: _Plan, bank, seed: int) -> tuple[np.ndarray, int]:  # noqa: ANN001
    rng = np.random.default_rng(seed)
    track, count = _speech_track(cfg, zh, en, bank, FILE_SECONDS, rng)
    bed = noise_bed(plan.noise, track.size, seed + 7)
    return mix_at_snr_rms(track, bed, float(plan.snr_db), active_rms(track)), count


def _make_noise_file(plan: _Plan, seed: int) -> np.ndarray:
    bed = noise_bed(plan.noise, int(FILE_SECONDS * SAMPLE_RATE), seed)
    level = float(np.sqrt(np.mean(np.square(bed, dtype=np.float64)))) or 1.0
    return np.clip(bed * (NOISE_ONLY_RMS / level), -1.0, 1.0).astype(np.float32)


def _plans(cfg: CorpusConfig) -> list[_Plan]:
    total_files = max(3, math.ceil(cfg.neg_minutes * 60.0 / FILE_SECONDS))
    sampled = tuple(k for k in ("custom", "esc") if bed_clips(k))
    kinds = tuple(k for k in (*sampled, *NOISE_ONLY_ORDER) if k in SYNTH_KINDS + sampled)
    speech_noise = available_noise(cfg)
    plans: list[_Plan] = []
    for kind, share in SHARE.items():
        for i in range(max(1, round(total_files * share))):
            if kind == "noise":
                plans.append(_Plan(kind, i, kinds[i % len(kinds)], None))
            else:
                snr = SPEECH_SNRS[(i + (1 if kind == "decoy" else 0)) % len(SPEECH_SNRS)]
                plans.append(_Plan(kind, i, speech_noise[i % len(speech_noise)], snr))
    return plans


def build_negatives(
    cfg: CorpusConfig, zh: TtsSynth | VoiceBank, en: TtsSynth | VoiceBank, out_dir: Path
) -> list[NegativeClip]:
    """Write ~``cfg.neg_minutes`` of keyword-free streams under ``out_dir/neg``."""
    clips: list[NegativeClip] = []
    banks = {"speech": (SPEECH_ZH, SPEECH_EN), "decoy": (DECOY_ZH, DECOY_EN)}
    for number, plan in enumerate(_plans(cfg)):
        seed = cfg.seed + 777_000 + number
        if plan.kind == "noise":
            audio, utterances = _make_noise_file(plan, seed), 0
        else:
            audio, utterances = _make_speech_file(cfg, zh, en, plan, banks[plan.kind], seed)
        rel = f"neg/{plan.kind}_{plan.index:02d}_{plan.noise}.wav"
        write_wav(out_dir / rel, audio)
        clips.append(
            NegativeClip(
                file=rel,
                kind=plan.kind,
                duration_s=audio.size / SAMPLE_RATE,
                noise=plan.noise,
                snr_db=plan.snr_db,
                n_utterances=utterances,
            )
        )
        log.info("negative %s (%d utterances)", rel, utterances)
    return clips
