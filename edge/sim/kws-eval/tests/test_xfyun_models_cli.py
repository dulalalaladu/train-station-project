import io
import tarfile

import pytest

from kws_eval import cli, models
from kws_eval.engine import EngineUnavailableError
from kws_eval.keywords import KEYWORDS
from kws_eval.xfyun import APPID_ENV, XfyunLocalEngine, XfyunSdkPlan, render_bnf


def test_bnf_contains_every_chinese_keyword_in_valid_structure():
    text = render_bnf(KEYWORDS, lang="zh")
    lines = text.splitlines()
    assert lines[0] == "#BNF+IAT 1.0 UTF-8;"
    assert "!start <cmd_start>;" in lines and "<cmd_start>:[<wake>]<command>;" in lines
    for spec in KEYWORDS:
        if spec.lang == "zh":
            assert spec.text in text
        else:
            assert spec.text not in text
    assert "<wake>:小铁小铁;" in lines


def test_bnf_english_has_no_wake_slot_and_unknown_language_fails():
    text = render_bnf(KEYWORDS, lang="en")
    assert "!slot <wake>;" not in text and "<cmd_start>:<command>;" in text
    assert "Return to base" in text
    with pytest.raises(ValueError):
        render_bnf(KEYWORDS, lang="fr")
    with pytest.raises(ValueError, match="no command keywords"):
        render_bnf(tuple(k for k in KEYWORDS if k.is_wake), lang="zh")


def test_bnf_enforces_vendor_command_length_limit():
    from kws_eval.keywords import STOP, KeywordSpec

    long_cmd = KeywordSpec("停" * 17, "zh", STOP)
    with pytest.raises(ValueError, match="16 characters"):
        render_bnf((long_cmd,), lang="zh")


def test_sdk_plan_uses_documented_parameter_names(tmp_path):
    plan = XfyunSdkPlan(sdk_dir=tmp_path)
    for key in ("engine_type = local", "asr_res_path", "grm_build_path", "sample_rate = 16000"):
        assert key in plan.build_grammar_params
    assert "local_grammar = g1" in plan.session_params("g1")
    assert APPID_ENV in plan.login_params and "appid = $" in plan.login_params


def test_xfyun_engine_reports_unavailable_instead_of_skipping(tmp_path, monkeypatch):
    monkeypatch.delenv(APPID_ENV, raising=False)
    with pytest.raises(EngineUnavailableError, match="not installed"):
        XfyunLocalEngine(XfyunSdkPlan(sdk_dir=tmp_path))


def test_xfyun_engine_stream_not_implemented_even_with_fake_sdk(tmp_path, monkeypatch):
    (tmp_path / "libs" / "aarch64").mkdir(parents=True)
    (tmp_path / "libs" / "aarch64" / "libmsc.so").write_bytes(b"")
    monkeypatch.setenv(APPID_ENV, "dummy")
    engine = XfyunLocalEngine(XfyunSdkPlan(sdk_dir=tmp_path))
    with pytest.raises(EngineUnavailableError):
        engine.open_stream()


def _archive(tmp_path, member_name):
    path = tmp_path / "a.tar.bz2"
    with tarfile.open(path, "w:bz2") as tar:
        info = tarfile.TarInfo(member_name)
        data = b"x"
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return path


def test_safe_extract_rejects_path_traversal(tmp_path):
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(RuntimeError, match="unsafe path"):
        models._safe_extract(_archive(tmp_path, "../evil.txt"), dest)
    models._safe_extract(_archive(tmp_path, "good/file.txt"), dest)
    assert (dest / "good" / "file.txt").read_bytes() == b"x"


def test_verify_detects_checksum_mismatch_and_records_digest(tmp_path, monkeypatch):
    monkeypatch.setenv("KWS_EVAL_HOME", str(tmp_path / "home"))
    archive = tmp_path / "m.tar.bz2"
    archive.write_bytes(b"hello")
    good = models.sha256_file(archive)
    spec = models.ModelSpec("k", "https://example.invalid/x", good, "top")
    assert models._verify(spec, archive) == good
    assert models.locked_digests() == {"k": good}
    bad = models.ModelSpec("k2", "https://example.invalid/x", "0" * 64, "top")
    with pytest.raises(RuntimeError, match="sha256 mismatch"):
        models._verify(bad, archive)
    assert not archive.exists()  # corrupt download is removed


def test_cli_bnf_and_missing_corpus(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("KWS_EVAL_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("KWS_EVAL_RESULTS", str(tmp_path / "res"))
    assert cli.main(["bnf", "--lang", "zh"]) == 0
    assert "#BNF+IAT 1.0 UTF-8;" in capsys.readouterr().out
    out = tmp_path / "g.bnf"
    assert cli.main(["bnf", "--out", str(out)]) == 0 and out.read_text(encoding="utf-8")
    assert cli.main(["sweep"]) == cli.EXIT_USAGE  # no corpus built yet


def test_cli_rejects_corpus_below_task_card_minimums(tmp_path, monkeypatch):
    monkeypatch.setenv("KWS_EVAL_HOME", str(tmp_path / "home"))
    assert cli.main(["build-corpus", "--variants", "5"]) == 1
