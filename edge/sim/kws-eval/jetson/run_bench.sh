#!/usr/bin/env bash
# Re-run the identical T-006 evaluation on the Jetson and record CPU / temperature.
# Usage:  bash jetson/run_bench.sh [NEG_MINUTES]      (default 180 = enough for a <1/h claim)
#
# Safe by design: audio files only, nothing here sends a command to the robot.
set -euo pipefail

cd "$(dirname "$0")/.."
NEG_MINUTES="${1:-180}"
OUT="results/jetson-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

# Pin clocks so numbers are comparable between runs (needs sudo; skip if unavailable).
if command -v nvpmodel >/dev/null 2>&1; then
  { sudo nvpmodel -q; sudo jetson_clocks --show; } >"$OUT/power-state.txt" 2>&1 || true
fi

# Background capture of system-wide CPU/GPU/thermal state while the benchmark runs.
if command -v tegrastats >/dev/null 2>&1; then
  tegrastats --interval 1000 >"$OUT/tegrastats.log" &
  TEGRA_PID=$!
  trap 'kill "$TEGRA_PID" 2>/dev/null || true' EXIT
fi

uv run kws-eval fetch
uv run kws-eval build-corpus --neg-minutes "$NEG_MINUTES"
KWS_EVAL_RESULTS="$OUT" uv run kws-eval sweep --grid quick --jobs 1
# Sustained real-time load for the CPU / temperature numbers (10 minutes per thread setting).
KWS_EVAL_RESULTS="$OUT" uv run kws-eval bench --seconds 600 --threads 1,2

echo "results in $OUT  (report.md, sweep.json, bench.json, tegrastats.log)"
