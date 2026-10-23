"""Validated (pydantic) manifest describing every synthesised test clip."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NoiseKind = Literal["none", "white", "pink", "yard", "esc", "custom"]


class PositiveClip(BaseModel):
    model_config = ConfigDict(frozen=True)

    file: str
    keyword: str  # KeywordSpec.name
    intent: str
    lang: Literal["zh", "en"]
    speaker: int
    speed: float = Field(gt=0)
    pitch: float = Field(gt=0)
    noise: NoiseKind
    snr_db: float | None
    onset_s: float = Field(ge=0)
    offset_s: float = Field(gt=0)
    duration_s: float = Field(gt=0)


class NegativeClip(BaseModel):
    model_config = ConfigDict(frozen=True)

    file: str
    kind: Literal["speech", "noise", "decoy"]
    duration_s: float = Field(gt=0)
    noise: NoiseKind
    snr_db: float | None
    n_utterances: int = Field(ge=0)


class Manifest(BaseModel):
    model_config = ConfigDict(frozen=True)

    version: int = 1
    seed: int
    tts_model: str
    positives: tuple[PositiveClip, ...]
    negatives: tuple[NegativeClip, ...]

    @property
    def negative_hours(self) -> float:
        return sum(c.duration_s for c in self.negatives) / 3600.0

    def save(self, path: Path) -> None:
        path.write_text(self.model_dump_json(indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> Manifest:
        return cls.model_validate(json.loads(path.read_text(encoding="utf-8")))
