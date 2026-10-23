"""``kws-eval`` command line.

Typical flow (one command reproduces everything):  ``uv run kws-eval all``
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from kws_eval import models, noise
from kws_eval.corpus import CorpusConfig, build_positives
from kws_eval.keywords import KEYWORDS
from kws_eval.manifest import Manifest
from kws_eval.negatives import build_negatives
from kws_eval.paths import cache_dir, results_dir
from kws_eval.tts import TtsSynth

log = logging.getLogger("kws_eval")
EXIT_USAGE = 2


def _corpus_dir() -> Path:
    return cache_dir() / "corpus"


def _manifest_path() -> Path:
    return _corpus_dir() / "manifest.json"


def _kws_dir() -> Path:
    return cache_dir() / "models" / models.KWS_ZH_EN.top_dir


def cmd_fetch(args: argparse.Namespace) -> int:
    for spec in (models.KWS_ZH_EN, models.TTS_ZH, models.TTS_EN):
        log.info("model ready: %s", models.fetch_model(spec))
    if not args.no_esc:
        try:
            noise.fetch_esc50(args.esc_per_class)
        except OSError as exc:
            log.warning("ESC-50 unavailable (%s); continuing with synthetic noise only", exc)
    log.info("sha256 lock: %s", models.locked_digests())
    return 0


def cmd_build_corpus(args: argparse.Namespace) -> int:
    cfg = CorpusConfig(
        seed=args.seed, variants_per_keyword=args.variants, neg_minutes=args.neg_minutes
    )
    mdir = cache_dir() / "models"
    zh = TtsSynth.chinese(mdir / models.TTS_ZH.top_dir, args.threads)
    en = TtsSynth.english(mdir / models.TTS_EN.top_dir, args.threads)
    out = _corpus_dir()
    positives = build_positives(cfg, zh, en, out)
    negatives = build_negatives(cfg, zh, en, out)
    manifest = Manifest(
        seed=cfg.seed,
        tts_model=f"{models.TTS_ZH.key}+{models.TTS_EN.key}",
        positives=tuple(positives),
        negatives=tuple(negatives),
    )
    manifest.save(_manifest_path())
    log.info("corpus: %d positives, %.2f h of negatives", len(positives), manifest.negative_hours)
    return 0


def cmd_sweep(args: argparse.Namespace) -> int:
    from kws_eval.report import full_report, write_json
    from kws_eval.sweep import choose, grid, run_sweep

    if not _manifest_path().exists():
        log.error("no corpus yet - run `kws-eval build-corpus`")
        return EXIT_USAGE
    configs = grid(args.grid, _kws_dir())
    results = run_sweep(configs, _manifest_path(), _corpus_dir(), args.jobs)
    chosen = choose(results)
    out = results_dir()
    write_json(out / "sweep.json", results)
    report = full_report(results, chosen, window_s=5.0)
    (out / "report.md").write_text(report, encoding="utf-8")
    sys.stdout.write(report)
    log.info("selected operating point: %s", chosen.label)
    return 0


def cmd_bench(args: argparse.Namespace) -> int:
    from kws_eval.bench import run_bench
    from kws_eval.keywords import KeywordTuning
    from kws_eval.sherpa import SherpaConfig

    neg = Manifest.load(_manifest_path()).negatives[0].file
    base = SherpaConfig(
        _kws_dir(),
        chunk=args.chunk,
        int8=not args.fp32,
        provider=args.provider,
        default_tuning=KeywordTuning(args.score, args.threshold),
    )
    threads = tuple(int(t) for t in args.threads.split(","))
    points = run_bench(
        base, _corpus_dir() / neg, args.seconds, threads, results_dir() / "bench.json"
    )
    for p in points:
        sys.stdout.write(
            f"{p.label}: {p.cpu_cores:.3f} cores @RT, RTF {p.realtime_factor:.3f}, "
            f"RSS {p.peak_rss_mb:.0f} MB, temp {p.temp_start_c}->{p.temp_max_c} C\n"
        )
    return 0


def cmd_bnf(args: argparse.Namespace) -> int:
    from kws_eval.xfyun import render_bnf

    text = render_bnf(KEYWORDS, lang=args.lang)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


def cmd_all(args: argparse.Namespace) -> int:
    for step, ns in (
        (cmd_fetch, argparse.Namespace(no_esc=args.no_esc, esc_per_class=8)),
        (
            cmd_build_corpus,
            argparse.Namespace(
                seed=args.seed, variants=12, neg_minutes=args.neg_minutes, threads=2
            ),
        ),
        (cmd_sweep, argparse.Namespace(grid=args.grid, jobs=args.jobs)),
    ):
        code = step(ns)
        if code:
            return code
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kws-eval", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("fetch", help="download pinned models and optional ESC-50 noise clips")
    p.add_argument("--no-esc", action="store_true", help="skip the public ESC-50 noise clips")
    p.add_argument("--esc-per-class", type=int, default=8)
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("build-corpus", help="synthesise positives and keyword-free negatives")
    p.add_argument("--seed", type=int, default=CorpusConfig.seed)
    p.add_argument("--variants", type=int, default=12, help="clips per keyword (>= 10)")
    p.add_argument("--neg-minutes", type=float, default=40.0, help="keyword-free audio (>= 30)")
    p.add_argument("--threads", type=int, default=2)
    p.set_defaults(func=cmd_build_corpus)

    p = sub.add_parser("sweep", help="evaluate sherpa-onnx configurations, write results/")
    p.add_argument("--grid", choices=("quick", "full"), default="quick")
    p.add_argument("--jobs", type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2)))
    p.set_defaults(func=cmd_sweep)

    p = sub.add_parser("bench", help="sustained streaming CPU / RSS / temperature benchmark")
    p.add_argument("--seconds", type=float, default=300.0)
    p.add_argument("--threads", default="1,2", help="comma separated onnxruntime thread counts")
    p.add_argument("--chunk", type=int, choices=(8, 16), default=8)
    p.add_argument("--fp32", action="store_true")
    p.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
    p.add_argument("--score", type=float, default=3.0)
    p.add_argument("--threshold", type=float, default=0.15)
    p.set_defaults(func=cmd_bench)

    p = sub.add_parser("bnf", help="print the iFlytek BNF grammar for candidate A")
    p.add_argument("--lang", choices=("zh", "en"), default="zh")
    p.add_argument("--out")
    p.set_defaults(func=cmd_bnf)

    p = sub.add_parser("all", help="fetch + build-corpus + sweep (reproduces the ADR table)")
    p.add_argument("--grid", choices=("quick", "full"), default="quick")
    p.add_argument("--jobs", type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2)))
    p.add_argument("--seed", type=int, default=CorpusConfig.seed)
    p.add_argument("--neg-minutes", type=float, default=40.0)
    p.add_argument("--no-esc", action="store_true")
    p.set_defaults(func=cmd_all)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except (ValueError, RuntimeError) as exc:
        log.error("%s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
