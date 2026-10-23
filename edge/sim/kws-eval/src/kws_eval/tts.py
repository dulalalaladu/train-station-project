"""Offline TTS (official sherpa-onnx VITS models) used to synthesise test audio.

* Chinese: icefall VITS trained on AISHELL-3 (174 Mandarin speakers).
* English: Piper VITS trained on LibriTTS-R (904 US-English speakers).

Caveat recorded in the ADR: synthetic speech is a proxy. It cannot produce real dialects
(歇倒 / 莫动 are spoken with Mandarin pronunciation) nor real Lombard-effect shouting.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import numpy as np

from kws_eval.audio import SAMPLE_RATE, resample
from kws_eval.engine import EngineUnavailableError

# Speaker ids spread across each model's speaker table (genders mix naturally).
ZH_SPEAKERS: tuple[int, ...] = (3, 28, 51, 77, 102, 130, 160)
EN_SPEAKERS: tuple[int, ...] = (5, 120, 300, 480, 650, 800, 890)


def _require(model_dir: Path, names: tuple[str, ...]) -> None:
    missing = [n for n in names if not (model_dir / n).exists()]
    if missing:
        raise EngineUnavailableError(f"{model_dir} lacks {missing} - run `kws-eval fetch`")


ESPEAK_PATH_LIMIT = 200  # espeak-ng keeps data paths in a 230-byte buffer and fails silently


def short_espeak_dir(data_dir: Path) -> Path:
    """Return ``data_dir`` or, when its path is too long for espeak-ng, a short-path copy.

    Deep checkouts (typical for agent workspaces on Windows) exceed espeak-ng's path buffer and
    the failure shows up as ``Error processing file '/usr/share/espeak-ng-data\\phontab'``.
    """
    if len(str(data_dir)) <= ESPEAK_PATH_LIMIT:
        return data_dir
    for base in (Path(tempfile.gettempdir()), Path.home(), Path(data_dir.anchor)):
        target = base / "kws-eval-espeak" / data_dir.parent.name / data_dir.name
        if len(str(target)) <= ESPEAK_PATH_LIMIT:
            if not target.exists():
                shutil.copytree(data_dir, target)
            return target
    raise RuntimeError(f"cannot find a short location for {data_dir}; set KWS_EVAL_HOME shorter")


def _build(sherpa_onnx, vits, rule_fsts: str, num_threads: int):  # noqa: ANN001, ANN202
    model = sherpa_onnx.OfflineTtsModelConfig(vits=vits, num_threads=num_threads, provider="cpu")
    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=model, rule_fsts=rule_fsts))


class TtsSynth:
    """One language-specific speaker bank; ``synth`` returns 16 kHz mono float32."""

    def __init__(self, tts, speakers: tuple[int, ...]) -> None:  # noqa: ANN001
        self._tts = tts
        self.speakers = speakers

    @classmethod
    def chinese(cls, model_dir: Path, num_threads: int = 2) -> TtsSynth:
        import sherpa_onnx

        _require(model_dir, ("model.onnx", "lexicon.txt", "tokens.txt"))
        vits = sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(model_dir / "model.onnx"),
            lexicon=str(model_dir / "lexicon.txt"),
            tokens=str(model_dir / "tokens.txt"),
        )
        fsts = ",".join(str(model_dir / f) for f in ("phone.fst", "date.fst", "number.fst"))
        return cls(_build(sherpa_onnx, vits, fsts, num_threads), ZH_SPEAKERS)

    @classmethod
    def english(cls, model_dir: Path, num_threads: int = 2) -> TtsSynth:
        import sherpa_onnx

        onnx = next(model_dir.glob("*.onnx"), None)
        if onnx is None:
            raise EngineUnavailableError(f"{model_dir} has no .onnx - run `kws-eval fetch`")
        _require(model_dir, ("tokens.txt", "espeak-ng-data"))
        vits = sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(onnx),
            tokens=str(model_dir / "tokens.txt"),
            data_dir=str(short_espeak_dir(model_dir / "espeak-ng-data")),
        )
        return cls(_build(sherpa_onnx, vits, "", num_threads), EN_SPEAKERS)

    def synth(self, text: str, speaker: int, speed: float = 1.0) -> np.ndarray:
        audio = self._tts.generate(text, sid=speaker, speed=speed)
        samples = np.asarray(audio.samples, dtype=np.float32)
        if samples.size == 0:
            raise RuntimeError(f"TTS produced no audio for {text!r} (sid={speaker})")
        return resample(samples, audio.sample_rate, SAMPLE_RATE)
