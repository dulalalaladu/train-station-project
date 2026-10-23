# kws-eval — offline keyword-spotting bench (task T-006)

Evaluation bench for **D-12** (offline core commands recognised on the robot, plan §3.6 / §4.3.4).
It compares

* **Candidate B** — sherpa-onnx streaming zipformer KWS (zh+en), fully runnable today;
* **Candidate A** — iFlytek offline command-word SDK (BNF grammar) — *design only* until the
  vendor ships an aarch64 package (owner action B-2, risk RK-05); see
  [`docs/adr/0006-offline-kws.md`](../../../docs/adr/0006-offline-kws.md).

Results, decision record and the Jetson re-test plan live in that ADR. This directory is the code.
Nothing here is a ROS 2 node (that is T-110) and nothing can move a robot — it only processes wav files.

## One command

```bash
cd edge/sim/kws-eval
uv run kws-eval all            # fetch -> build-corpus -> sweep  (about 45 min on a laptop)
# results/report.md  results/sweep.json
```

Pieces, if you want them separately:

| command | what it does |
|---|---|
| `uv run kws-eval fetch` | downloads the pinned official sherpa-onnx models (KWS + two TTS voices banks) and a few ESC-50 noise clips into `.cache/`, verifies/records SHA-256 |
| `uv run kws-eval build-corpus` | TTS-synthesises 17 phrases x 12 variants (speakers, 0.85–1.2x speed, 0.92–1.1x pitch) x {clean, white/yard/ESC at SNR 10/5/0 dB} and 40 min of keyword-free audio (chatter, near-miss decoys, noise only) |
| `uv run kws-eval sweep [--grid quick\|full] [--jobs N]` | runs sherpa-onnx over the corpus for each (chunk, precision, boost, threshold) point, writes `results/report.md` + `results/sweep.json` |
| `uv run kws-eval bench --seconds 600 --threads 1,2` | sustained real-time load: CPU cores, RSS, temperature (use this on the Jetson) |
| `uv run kws-eval bnf --lang zh` | prints the iFlytek BNF grammar generated from the same keyword table |

Requirements: Python 3.10 (pinned in `.python-version`), [`uv`](https://docs.astral.sh/uv/).
Nothing larger than a few KB is committed; models, noise clips and audio live in `.cache/`
(git-ignored, override with `KWS_EVAL_HOME`). Result files go to `results/` (`KWS_EVAL_RESULTS`).

## Metrics (task card)

* **recall** per keyword and per intent, per condition (clean / SNR 10 / 5 / 0 dB x noise type);
* **false alarms per hour** on the keyword-free set, per keyword, with a 95 % Poisson upper bound;
* **latency** = detection time minus keyword end (audio time), median / p95;
* **CPU** = process CPU-seconds per audio-second (cores needed at real-time rate), peak RSS, and
  temperature where the OS exposes it.

## Noise realism — read this before trusting the numbers

* `white`, `yard` are **synthetic**. `yard` is a proxy (diesel rumble, wheel/rail clatter, horn
  bursts, brake squeal, wind) — it is not a recording of a Chinese railway yard.
* `esc` uses public ESC-50 clips (train, engine, wind, siren, helicopter, car horn), CC BY-NC 3.0,
  fetched at run time, never committed.
* For the real re-test, drop recorded yard noise (`*.wav`, PCM16, any sample rate) into
  `.cache/noise/custom/` and rebuild the corpus; it is picked up as noise kind `custom`.
* Speech is TTS (AISHELL-3 / LibriTTS-R voices). Real dialect pronunciation (歇倒, 莫动) and
  shouted/Lombard speech are *not* represented; collect real recordings (plan §7.5) for sign-off.

## Jetson Orin NX (JetPack 6, aarch64)

```bash
bash jetson/install.sh            # uv + CPU wheel (add --cuda for the source/CUDA build)
bash jetson/run_bench.sh 180      # 3 h of negatives -> enough to claim <1 false alarm/h at 95 %
```

Outputs a timestamped folder under `results/` including `tegrastats.log`.

## Development

```bash
uv run pytest        # unit tests + coverage (>= 80 %)
uv run ruff check src tests && uv run ruff format --check src tests
```

Tests marked `slow` need the downloaded models (`uv run kws-eval fetch` first).
