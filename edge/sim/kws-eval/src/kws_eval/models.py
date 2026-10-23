"""Pinned downloads of official sherpa-onnx pre-trained models (no third-party mirrors).

Every artefact has a pinned URL under ``github.com/k2-fsa/sherpa-onnx/releases``. Where the
release page publishes a SHA-256 we pin it and refuse mismatching files; otherwise the first
download is recorded in ``models.lock.json`` (trust-on-first-use) and verified afterwards.
"""

from __future__ import annotations

import hashlib
import json
import logging
import tarfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from kws_eval.paths import cache_dir

log = logging.getLogger(__name__)

_RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
_CHUNK = 1 << 20


@dataclass(frozen=True)
class ModelSpec:
    key: str
    url: str
    sha256: str | None  # publisher-provided digest, if any
    top_dir: str  # directory the tarball extracts to


KWS_ZH_EN = ModelSpec(
    key="kws-zipformer-zh-en-3M-2025-12-20",
    url=f"{_RELEASES}/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2",
    sha256="68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6",
    top_dir="sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20",
)

# Multi-speaker VITS models used only to synthesise test speech (Kokoro was rejected: ~10x slower
# than real time on the x86 dev laptop). The zh digest is the value observed on first download
# (the release page does not publish one); the en digest is the publisher's.
TTS_ZH = ModelSpec(
    key="tts-vits-icefall-zh-aishell3",
    url=f"{_RELEASES}/tts-models/vits-icefall-zh-aishell3.tar.bz2",
    sha256="ab468db3a3308cdd861495e0db2f25d79418a0c00639f74944c7cdf5dd8c6ec1",
    top_dir="vits-icefall-zh-aishell3",
)

TTS_EN = ModelSpec(
    key="tts-vits-piper-en_US-libritts_r-medium-int8",
    url=f"{_RELEASES}/tts-models/vits-piper-en_US-libritts_r-medium-int8.tar.bz2",
    sha256="7e4552e239988f4896872822b56e99e0e9e00958164e3f6bdf5ee14391fbe829",
    top_dir="vits-piper-en_US-libritts_r-medium-int8",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _lock_path() -> Path:
    return cache_dir() / "models.lock.json"


def _read_lock() -> dict[str, str]:
    path = _lock_path()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _verify(spec: ModelSpec, archive: Path) -> str:
    """Check the archive digest against the pin / lock file; return the digest."""
    actual = sha256_file(archive)
    expected = spec.sha256 or _read_lock().get(spec.key)
    if expected and actual != expected:
        archive.unlink(missing_ok=True)
        raise RuntimeError(f"{spec.key}: sha256 mismatch (expected {expected}, got {actual})")
    _write_lock(spec.key, actual)
    return actual


def _write_lock(key: str, digest: str) -> None:
    lock = {**_read_lock(), key: digest}
    _lock_path().write_text(json.dumps(lock, indent=2, sort_keys=True), encoding="utf-8")


def _safe_extract(archive: Path, dest: Path) -> None:
    dest_root = dest.resolve()
    with tarfile.open(archive, "r:bz2") as tar:
        for member in tar.getmembers():
            target = (dest / member.name).resolve()
            if not target.is_relative_to(dest_root) or member.issym() or member.islnk():
                raise RuntimeError(f"unsafe path in archive {archive.name}: {member.name}")
        tar.extractall(dest)  # noqa: S202  (members validated above)


def fetch_model(spec: ModelSpec) -> Path:
    """Download (if needed), verify and extract ``spec``; return the extracted model directory."""
    models = cache_dir() / "models"
    target = models / spec.top_dir
    archive = models / f"{spec.top_dir}.tar.bz2"
    if target.is_dir() and not archive.exists():
        return target
    models.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        log.info("downloading %s", spec.url)
        urllib.request.urlretrieve(spec.url, archive)  # noqa: S310  (pinned https URL)
    digest = _verify(spec, archive)
    log.info("%s sha256=%s", spec.key, digest)
    if not target.is_dir():
        _safe_extract(archive, models)
    return target


def locked_digests() -> dict[str, str]:
    """Digests of everything fetched so far (for the ADR / report)."""
    return _read_lock()
