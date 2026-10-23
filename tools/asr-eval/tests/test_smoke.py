from asr_eval import PACKAGE_NAME


def test_package_identifies_itself() -> None:
    assert PACKAGE_NAME == "asr-eval"
