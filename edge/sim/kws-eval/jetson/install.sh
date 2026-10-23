#!/usr/bin/env bash
# T-006 second phase: set up the KWS bench on a Jetson Orin NX (JetPack 6, Ubuntu 22.04, aarch64).
# Usage:  bash jetson/install.sh [--cuda]
#   default  CPU build from the official aarch64 PyPI wheel (recommended for this 3M-parameter model)
#   --cuda   rebuild sherpa-onnx from source against onnxruntime-gpu (only if CPU load is too high)
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$(uname -m)" != "aarch64" ]; then
  echo "warning: this host is $(uname -m), not aarch64 - continuing as a dry run" >&2
fi

# espeak-ng (English TTS data) and audio tools used while building the corpus.
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends python3.10 python3.10-venv curl ca-certificates sox
fi

# uv (https://docs.astral.sh/uv/) - installed to ~/.local/bin
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

uv sync --python 3.10

if [ "${1:-}" = "--cuda" ]; then
  # Official recipe for Jetson / JetPack 6.2 (CUDA 12.6, cuDNN 9):
  #   https://k2-fsa.github.io/sherpa/onnx/install/linux.html  ("GPU (CUDA 12.6, CUDNN9, Linux arm64 ...)")
  # VERIFY the env-var name and ORT version against the docs of the sherpa-onnx tag you build.
  export SHERPA_ONNX_CMAKE_ARGS="-DSHERPA_ONNX_ENABLE_GPU=ON -DSHERPA_ONNX_LINUX_ARM64_GPU_ONNXRUNTIME_VERSION=1.18.1 -DBUILD_SHARED_LIBS=ON"
  uv pip install --no-binary sherpa-onnx --reinstall sherpa-onnx
fi

uv run python - <<'PY'
import platform, sherpa_onnx
print("python", platform.python_version(), "machine", platform.machine(), "sherpa-onnx", sherpa_onnx.__version__)
PY

echo "next:  bash jetson/run_bench.sh"
