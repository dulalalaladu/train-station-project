"""Keyword table (plan §4.3.4) and sherpa-onnx keyword-file generation.

The zh-en zipformer KWS model uses ``phone+ppinyin`` tokens: CMU phones for English words
(``en.phone`` lexicon shipped with the model) and pinyin split into initial / toned final for
Chinese characters. We re-implement the small amount of ``sherpa_onnx.text2token`` logic that we
need so that the bench does not depend on ``sentencepiece``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from pypinyin import pinyin
from pypinyin.contrib.tone_convert import to_finals_tone, to_initials

_CJK_WORD = re.compile(r"^[一-鿿]+$")

# Intent codes follow docs/seed/command-lexicon.v1.json.
WAKE = "WAKE"
STOP = "STOP"
RETURN_HOME = "RETURN_HOME"
FOLLOW_ME = "FOLLOW_ME"
START_PATROL = "START_PATROL"


@dataclass(frozen=True)
class KeywordSpec:
    """One spotted phrase. ``text`` is what the TTS speaks and what the engine reports."""

    text: str
    lang: str  # "zh" | "en"
    intent: str
    is_wake: bool = False

    @property
    def name(self) -> str:
        """Engine-facing label (no spaces; sherpa-onnx uses ``@name`` in the keyword file)."""
        return self.text.replace(" ", "_")


KEYWORDS: tuple[KeywordSpec, ...] = (
    KeywordSpec("停下", "zh", STOP),
    KeywordSpec("站住", "zh", STOP),
    KeywordSpec("莫动", "zh", STOP),
    KeywordSpec("歇倒", "zh", STOP),
    KeywordSpec("Stop", "en", STOP),
    KeywordSpec("Halt", "en", STOP),
    KeywordSpec("回巢", "zh", RETURN_HOME),
    KeywordSpec("回去充电", "zh", RETURN_HOME),
    KeywordSpec("回基地", "zh", RETURN_HOME),
    KeywordSpec("Return to base", "en", RETURN_HOME),
    KeywordSpec("跟我走", "zh", FOLLOW_ME),
    KeywordSpec("跟着我", "zh", FOLLOW_ME),
    KeywordSpec("Follow me", "en", FOLLOW_ME),
    KeywordSpec("开始巡检", "zh", START_PATROL),
    KeywordSpec("巡一圈", "zh", START_PATROL),
    KeywordSpec("Start patrol", "en", START_PATROL),
    KeywordSpec("小铁小铁", "zh", WAKE, is_wake=True),
)

CORE_INTENTS: tuple[str, ...] = (STOP, RETURN_HOME, FOLLOW_ME, START_PATROL)


def keyword_by_name(name: str) -> KeywordSpec:
    for spec in KEYWORDS:
        if spec.name == name:
            return spec
    raise KeyError(f"unknown keyword name: {name!r}")


def load_token_table(tokens_path: Path) -> dict[str, int]:
    table: dict[str, int] = {}
    for line in tokens_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) == 2:
            table[parts[0]] = int(parts[1])
    return table


def load_phone_lexicon(lexicon_path: Path) -> dict[str, tuple[str, ...]]:
    lexicon: dict[str, tuple[str, ...]] = {}
    for line in lexicon_path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) >= 2:
            lexicon[parts[0]] = tuple(parts[1:])
    return lexicon


def _hanzi_to_ppinyin(word: str) -> list[str]:
    tokens: list[str] = []
    for syllable in (item[0] for item in pinyin(word)):
        initial = to_initials(syllable, strict=False)
        final = to_finals_tone(syllable, strict=False)
        if not initial and not final:
            tokens.append(syllable)
            continue
        if initial:
            tokens.append(initial)
        if final:
            tokens.append(final)
    return tokens


def tokenize(
    text: str, token_table: dict[str, int], lexicon: dict[str, tuple[str, ...]]
) -> list[str]:
    """Return model tokens for ``text`` or raise ``ValueError`` on any out-of-vocabulary token."""
    out: list[str] = []
    for raw in _split_words(text):
        word = raw.upper()
        if word in lexicon:
            out.extend(lexicon[word])
        elif _CJK_WORD.fullmatch(raw):
            out.extend(_hanzi_to_ppinyin(raw))
        else:
            raise ValueError(f"word {raw!r} of {text!r} is neither in the lexicon nor CJK")
    missing = [tok for tok in out if tok not in token_table]
    if missing:
        raise ValueError(f"tokens {missing} of {text!r} are not in tokens.txt")
    return out


def _split_words(text: str) -> list[str]:
    """Split on whitespace; a CJK run containing no spaces stays one word."""
    return text.split()


@dataclass(frozen=True)
class KeywordTuning:
    """Per-keyword boosting score and trigger threshold (sherpa-onnx ``:score #threshold``)."""

    score: float = 1.5
    threshold: float = 0.25


def keyword_file_lines(
    specs: tuple[KeywordSpec, ...],
    token_table: dict[str, int],
    lexicon: dict[str, tuple[str, ...]],
    tuning: dict[str, KeywordTuning] | None = None,
    default: KeywordTuning | None = None,
) -> list[str]:
    """Render one sherpa-onnx keywords-file line per spec."""
    fallback = default or KeywordTuning()
    lines: list[str] = []
    for spec in specs:
        toks = tokenize(spec.text, token_table, lexicon)
        tune = (tuning or {}).get(spec.name, fallback)
        lines.append(f"{' '.join(toks)} :{tune.score:g} #{tune.threshold:g} @{spec.name}")
    return lines
