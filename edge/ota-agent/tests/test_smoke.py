from ota_agent import PACKAGE_NAME


def test_package_identifies_itself() -> None:
    assert PACKAGE_NAME == "ota-agent"
