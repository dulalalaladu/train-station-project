"""Candidate B: sherpa-onnx streaming zipformer keyword spotter (zh + en)."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from kws_eval.audio import SAMPLE_RATE
from kws_eval.engine import Detection, EngineUnavailableError
from kws_eval.keywords import (
    KEYWORDS,
    KeywordSpec,
    KeywordTuning,
    keyword_file_lines,
    load_phone_lexicon,
    load_token_table,
)

_TAIL_SECONDS = 0.66


@dataclass(frozen=True)
class SherpaConfig:
    model_dir: Path
    chunk: int = 8  # model ships chunk-8 and chunk-16 variants
    int8: bool = True
    num_threads: int = 1
    max_active_paths: int = 4
    num_trailing_blanks: int = 1
    default_tuning: KeywordTuning = KeywordTuning()
    tuning: tuple[tuple[str, KeywordTuning], ...] = ()
    provider: str = "cpu"  # "cuda" on Jetson with a CUDA build of onnxruntime

    @property
    def label(self) -> str:
        prec = "int8" if self.int8 else "fp32"
        return (
            f"sherpa-zh-en/chunk{self.chunk}-{prec}/s{self.default_tuning.score:g}"
            f"-t{self.default_tuning.threshold:g}/thr{self.num_threads}"
        )


def _model_file(cfg: SherpaConfig, kind: str) -> Path:
    suffix = ".int8.onnx" if cfg.int8 and kind != "decoder" else ".onnx"
    path = cfg.model_dir / f"{kind}-epoch-13-avg-2-chunk-{cfg.chunk}-left-64{suffix}"
    if not path.is_file():
        raise EngineUnavailableError(f"missing model file {path} - run `kws-eval fetch`")
    return path


class _Session:
    def __init__(self, spotter, stream) -> None:  # noqa: ANN001  (sherpa types are untyped)
        self._spotter = spotter
        self._stream = stream
        self._fed = 0

    def _drain(self) -> list[Detection]:
        found: list[Detection] = []
        while self._spotter.is_ready(self._stream):
            self._spotter.decode_stream(self._stream)
            hit = self._spotter.get_result(self._stream)
            if hit:
                found.append(Detection(hit, self._fed / SAMPLE_RATE))
                self._spotter.reset_stream(self._stream)
        return found

    def feed(self, chunk: np.ndarray) -> list[Detection]:
        self._stream.accept_waveform(SAMPLE_RATE, chunk.astype(np.float32, copy=False))
        self._fed += chunk.size
        return self._drain()

    def flush(self) -> list[Detection]:
        tail = np.zeros(int(_TAIL_SECONDS * SAMPLE_RATE), dtype=np.float32)
        self._stream.accept_waveform(SAMPLE_RATE, tail)
        self._stream.input_finished()
        return self._drain()


class SherpaEngine:
    """Builds a ``KeywordSpotter`` for the full §4.3.4 keyword table."""

    def __init__(self, cfg: SherpaConfig, specs: tuple[KeywordSpec, ...] = KEYWORDS) -> None:
        import sherpa_onnx  # imported lazily so unit tests need no native wheel

        self.cfg = cfg
        self.name = cfg.label
        encoder, decoder, joiner = (_model_file(cfg, k) for k in ("encoder", "decoder", "joiner"))
        self._keywords_file = self._write_keywords(specs)
        self._spotter = sherpa_onnx.KeywordSpotter(
            tokens=str(cfg.model_dir / "tokens.txt"),
            encoder=str(encoder),
            decoder=str(decoder),
            joiner=str(joiner),
            keywords_file=str(self._keywords_file),
            num_threads=cfg.num_threads,
            max_active_paths=cfg.max_active_paths,
            keywords_score=cfg.default_tuning.score,
            keywords_threshold=cfg.default_tuning.threshold,
            num_trailing_blanks=cfg.num_trailing_blanks,
            provider=cfg.provider,
        )

    def _write_keywords(self, specs: tuple[KeywordSpec, ...]) -> Path:
        table = load_token_table(self.cfg.model_dir / "tokens.txt")
        lexicon = load_phone_lexicon(self.cfg.model_dir / "en.phone")
        lines = keyword_file_lines(
            specs, table, lexicon, dict(self.cfg.tuning), self.cfg.default_tuning
        )
        handle = tempfile.NamedTemporaryFile(  # noqa: SIM115  (kept for the engine lifetime)
            "w", suffix=".txt", delete=False, encoding="utf-8"
        )
        with handle:
            handle.write("\n".join(lines) + "\n")
        return Path(handle.name)

    def open_stream(self) -> _Session:
        return _Session(self._spotter, self._spotter.create_stream())

    def close(self) -> None:
        self._keywords_file.unlink(missing_ok=True)
