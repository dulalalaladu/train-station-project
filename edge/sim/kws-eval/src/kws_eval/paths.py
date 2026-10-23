"""Cache / output locations. Nothing large is ever written inside the git tree except ``.cache``."""

from __future__ import annotations

import os
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def project_root() -> Path:
    return _PROJECT_ROOT


def cache_dir() -> Path:
    """Downloaded models, noise samples and synthesised corpora (git-ignored)."""
    root = Path(os.environ.get("KWS_EVAL_HOME", _PROJECT_ROOT / ".cache"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def results_dir() -> Path:
    out = Path(os.environ.get("KWS_EVAL_RESULTS", _PROJECT_ROOT / "results"))
    out.mkdir(parents=True, exist_ok=True)
    return out
