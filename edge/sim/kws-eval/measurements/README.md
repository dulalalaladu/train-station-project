# Measured runs (T-006)

Committed copies of `results/report.md` from sweeps that back the T-006 numbers.
Run outputs themselves (`results*/`, including the multi-MB `sweep.json` with every
per-clip detection) stay git-ignored — regenerate them with `uv run kws-eval sweep`.

| file | grid | date | engine builds covered |
|---|---|---|---|
| [`2026-10-23-quick-grid.md`](./2026-10-23-quick-grid.md) | `--grid quick` | 2026-10-23 | sherpa-zh-en chunk8-int8 x 4 tunings (boost/threshold) |
| [`2026-10-23-variants-grid.md`](./2026-10-23-variants-grid.md) | `--grid variants` | 2026-10-23 | sherpa-zh-en chunk8-int8, chunk16-int8, chunk8-fp32 |

## Conditions — read before quoting any number

* **Laptop x86-64 CPU run, not the Jetson Orin NX.** CPU-cores-at-real-time and peak RSS are
  therefore indicative only; the target-hardware numbers come from `jetson/run_bench.sh`.
* **Speech is TTS** (MeloTTS + icefall-AISHELL-3 for Mandarin, Piper-LibriTTS-R for English).
  The per-voice-bank table in each report shows how much the result depends on the voice; real
  dialect pronunciation (歇倒, 莫动) and shouted/Lombard speech are not represented.
* **Noise `white` and `yard` are synthetic**; `yard` is a proxy, not a recording of a Chinese
  railway yard. `esc` uses public ESC-50 clips.
* **Only 0.67 h of keyword-free audio** per run, so the false-alarm rate cannot yet support the
  "< 1 false alarm/h at 95 %" claim — that needs 3.0 h with zero events (see the wake-word
  gating section of each report).

## What the runs show

Best configuration measured (`chunk8-fp32/s3-t0.15/thr1`) reaches **40.2 % recall clean and
12.3 % at SNR 0 dB** on the plan keyword list. That is far below a usable offline-command
threshold, and recall is very uneven per keyword (`歇倒`, `Halt`, `巡一圈` sit at 0 %). The
dominant causes to rule out before drawing a candidate decision are TTS-vs-real-speech mismatch
and the keyword-boost/threshold operating point, not the model build — the three shipped builds
differ by under 5 points.

Nothing here is a decision record. The candidate A/B decision and the Jetson re-test plan belong
in `docs/adr/0006-offline-kws.md`, which is still to be written.
