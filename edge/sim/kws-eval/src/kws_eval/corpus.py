"""Positive (keyword) test set: TTS variants x noise types x SNR levels."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from kws_eval.audio import SAMPLE_RATE, active_span, mix_at_snr, pitch_shift, write_wav
from kws_eval.keywords import ALL_KEYWORDS, KeywordSpec
from kws_eval.manifest import PositiveClip
from kws_eval.noise import bed_clips, noise_bed
from kws_eval.tts import TtsSynth, VoiceBank

log = logging.getLogger(__name__)

SPEEDS = (0.85, 1.0, 1.2)
PITCHES = (0.92, 1.0, 1.1)
EDGE_MARGIN_S = 0.05


@dataclass(frozen=True)
class CorpusConfig:
    seed: int = 20261023
    variants_per_keyword: int = 12  # task card: >= 10 per keyword
    snr_levels: tuple[float, ...] = (10.0, 5.0, 0.0)
    synth_noise: tuple[str, ...] = ("white", "yard")
    lead_s: float = 1.0
    tail_s: float = 1.3
    neg_minutes: float = 40.0  # task card: >= 30 minutes without keywords

    def __post_init__(self) -> None:
        if self.variants_per_keyword < 10:
            raise ValueError("task card requires >= 10 variants per keyword")
        if self.neg_minutes < 30:
            raise ValueError("task card requires >= 30 minutes of keyword-free audio")


@dataclass(frozen=True)
class Variant:
    speaker: int
    speed: float
    pitch: float


def variants_for(speakers: tuple[int, ...], count: int) -> list[Variant]:
    """Deterministic, well spread (speaker, speed, pitch) triples; no duplicates."""
    out: list[Variant] = []
    for i in range(count):
        out.append(
            Variant(
                speaker=speakers[i % len(speakers)],
                speed=SPEEDS[i % len(SPEEDS)],
                pitch=PITCHES[(i // len(SPEEDS) + i) % len(PITCHES)],
            )
        )
    return out


def trimmed_utterance(tts: TtsSynth | VoiceBank, text: str, variant: Variant) -> np.ndarray:
    """Synthesise ``text`` and trim leading/trailing silence."""
    raw = tts.synth(text, variant.speaker, variant.speed)
    shifted = pitch_shift(raw, variant.pitch)
    start, end = active_span(shifted)
    margin = int(EDGE_MARGIN_S * SAMPLE_RATE)
    return shifted[max(0, start - margin) : end + margin]


def available_noise(cfg: CorpusConfig) -> tuple[str, ...]:
    """Synthetic kinds plus any sample-based kind that has clips on disk."""
    return cfg.synth_noise + tuple(k for k in ("esc", "custom") if bed_clips(k))


def _frame_clip(cfg: CorpusConfig, utt: np.ndarray) -> tuple[np.ndarray, float, float]:
    lead = np.zeros(int(cfg.lead_s * SAMPLE_RATE), dtype=np.float32)
    tail = np.zeros(int(cfg.tail_s * SAMPLE_RATE), dtype=np.float32)
    peak = float(np.max(np.abs(utt))) or 1.0
    body = (utt / peak * 0.7).astype(np.float32)
    clip = np.concatenate([lead, body, tail])
    return clip, cfg.lead_s, cfg.lead_s + body.size / SAMPLE_RATE


def build_positives(
    cfg: CorpusConfig,
    zh: TtsSynth | VoiceBank,
    en: TtsSynth | VoiceBank,
    out_dir: Path,
    specs: tuple[KeywordSpec, ...] = ALL_KEYWORDS,
) -> list[PositiveClip]:
    """Write every positive clip under ``out_dir/pos`` and return their metadata."""
    clips: list[PositiveClip] = []
    noise_kinds = available_noise(cfg)
    for k_index, spec in enumerate(specs):
        tts = zh if spec.lang == "zh" else en
        for v_index, variant in enumerate(variants_for(tts.speakers, cfg.variants_per_keyword)):
            base, onset, offset = _frame_clip(cfg, trimmed_utterance(tts, spec.text, variant))
            seed = cfg.seed + 1000 * k_index + v_index
            voice = tts.tag(variant.speaker)
            clips.extend(
                _write_conditions(
                    cfg, (spec, variant, voice), (base, onset, offset), seed, out_dir, noise_kinds
                )
            )
    log.info("positives: %d clips", len(clips))
    return clips


def _write_conditions(
    cfg: CorpusConfig,
    who: tuple[KeywordSpec, Variant, str],
    framed: tuple[np.ndarray, float, float],
    seed: int,
    out_dir: Path,
    noise_kinds: tuple[str, ...],
) -> list[PositiveClip]:
    spec, variant, voice = who
    base, onset, offset = framed
    span = (int(onset * SAMPLE_RATE), int(offset * SAMPLE_RATE))
    conditions: list[tuple[str, float | None]] = [("none", None)]
    conditions += [(kind, snr) for kind in noise_kinds for snr in cfg.snr_levels]
    meta: list[PositiveClip] = []
    for c_index, (kind, snr) in enumerate(conditions):
        audio = base
        if kind != "none":
            bed = noise_bed(kind, base.size, seed * 31 + c_index)
            audio = mix_at_snr(base, bed, float(snr), span)
        tag = "clean" if snr is None else f"{kind}_{snr:g}dB"
        rel = f"pos/{spec.name}/s{variant.speaker}_x{variant.speed:g}_p{variant.pitch:g}_{tag}.wav"
        write_wav(out_dir / rel, audio)
        meta.append(
            PositiveClip(
                file=rel,
                keyword=spec.name,
                intent=spec.intent,
                lang=spec.lang,
                speaker=variant.speaker,
                voice=voice,
                speed=variant.speed,
                pitch=variant.pitch,
                noise=kind,
                snr_db=snr,
                onset_s=onset,
                offset_s=offset,
                duration_s=base.size / SAMPLE_RATE,
            )
        )
    return meta
