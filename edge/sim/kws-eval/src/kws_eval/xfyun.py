"""Candidate A (iFlytek offline command-word SDK): integration DESIGN only.

No SDK package is available yet (owner action B-2 / RK-05), so this module provides
  * ``render_bnf`` - the BNF grammar generated from the same keyword table the sherpa-onnx
                     candidate uses, so both engines are evaluated on identical vocabularies;
  * ``XfyunSdkPlan`` - the exact MSC parameters we expect to pass (``engine_type=local`` ...);
  * ``XfyunLocalEngine`` - a ``KeywordEngine`` placeholder that raises ``EngineUnavailableError``
                     until ``libmsc.so`` (aarch64) is present, so the bench reports "not run"
                     instead of silently skipping candidate A.

Parameter names are taken from the vendor's public docs (checked 2026-10-23):
https://www.xfyun.cn/doc/asr/commandWord/Linux-SDK.html and
https://www.xfyun.cn/doc/mscapi/Windows&Linux/wlapi.html. The BNF syntax itself is NOT in those
pages (they point to a forum guide) and the resource file name is from tutorials; both are marked
CONFIRM and must be verified against the package the vendor sends.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from kws_eval.engine import EngineUnavailableError, StreamSession
from kws_eval.keywords import KEYWORDS, WAKE, KeywordSpec

APPID_ENV = "XFYUN_OFFLINE_APPID"  # SDK AppID; read from the environment, never from a file
MAX_COMMAND_HANZI = 16  # "命令词最大长度为16个汉字" (vendor Linux SDK page)


def render_bnf(
    specs: tuple[KeywordSpec, ...] = KEYWORDS, grammar_name: str = "railvoice", lang: str = "zh"
) -> str:
    """Render an iFlytek ``#BNF+IAT 1.0 UTF-8`` grammar for the given language's keywords.

    Two flat slots (no slot-in-slot nesting, which the vendor samples do not show): ``<wake>`` and
    ``<command>``; the start rule is ``[<wake>]<command>`` so the wake word is optional here.
    Mapping a recognised word back to its intent is done in code from the keyword table, and the
    gating policy (wake word / double hit) is applied by ``dog_vad_kws``, not by the recogniser.
    """
    chosen = [s for s in specs if s.lang == lang]
    if not chosen:
        raise ValueError(f"no keywords for language {lang!r}")
    too_long = [s.text for s in chosen if lang == "zh" and len(s.text) > MAX_COMMAND_HANZI]
    if too_long:
        raise ValueError(f"vendor limit is {MAX_COMMAND_HANZI} characters per command: {too_long}")
    wake = [s.text for s in chosen if s.intent == WAKE]
    commands = [s.text for s in chosen if s.intent != WAKE]
    if not commands:
        raise ValueError(f"no command keywords for language {lang!r}")
    lines = ["#BNF+IAT 1.0 UTF-8;", f"!grammar {grammar_name};"]
    lines += ["!slot <wake>;"] if wake else []
    lines += ["!slot <command>;", "!start <cmd_start>;"]
    lines += [f"<cmd_start>:{'[<wake>]' if wake else ''}<command>;"]
    lines += [f"<wake>:{'|'.join(wake)};"] if wake else []
    lines += [f"<command>:{'|'.join(commands)};"]
    return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class XfyunSdkPlan:
    """MSC offline command-word flow parameters (CONFIRM against the vendor package)."""

    # Extracted Linux SDK: include/, libs/libmsc.so, bin/ (resources + msc/msc.cfg), samples/.
    # The resource file name below (common.jet) comes from third-party tutorials - CONFIRM.
    sdk_dir: Path
    build_dir: Path = Path("/var/lib/railvoice/xfyun/grm_build")  # grm_build_path (writable)
    resource: str = "bin/msc/res/asr/common.jet"
    asr_threshold: int = 50  # 0-100, "only results above this confidence are returned"

    @property
    def _res(self) -> str:
        return f"fo|{self.sdk_dir / self.resource}"

    @property
    def login_params(self) -> str:
        """MSPLogin(NULL, NULL, params): ``appid`` is mandatory; the value comes from the env."""
        return f"appid = ${APPID_ENV}, engine_start = asr, asr_res_path = {self._res}"

    @property
    def build_grammar_params(self) -> str:
        return (
            f"engine_type = local, asr_res_path = {self._res}, sample_rate = 16000, "
            f"grm_build_path = {self.build_dir}"
        )

    def session_params(self, grammar_id: str) -> str:
        return (
            f"engine_type = local, asr_res_path = {self._res}, sample_rate = 16000, "
            f"grm_build_path = {self.build_dir}, local_grammar = {grammar_id}, "
            f"asr_threshold = {self.asr_threshold}, result_type = json, result_encoding = UTF-8"
        )


class XfyunLocalEngine:
    name = "xfyun-offline-command-word"

    def __init__(self, plan: XfyunSdkPlan) -> None:
        self.plan = plan
        lib = plan.sdk_dir / "libs"
        if not any(lib.glob("**/libmsc.so")) or not os.environ.get(APPID_ENV):
            raise EngineUnavailableError(
                "iFlytek offline SDK not installed (needs libmsc.so for this CPU architecture and "
                f"{APPID_ENV}); see docs/adr/0006-offline-kws.md section 'Candidate A'"
            )

    def open_stream(self) -> StreamSession:
        raise EngineUnavailableError("native binding not implemented until the SDK is available")
