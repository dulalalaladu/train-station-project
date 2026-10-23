"""Shared fixtures: a connected fake bridge with short timeouts so tests stay fast."""

from __future__ import annotations

import pytest

from dog_vendor_bridge.fake_bridge import FakeVendorBridge
from dog_vendor_bridge.models import BridgeConfig, Position, Waypoint


@pytest.fixture
def waypoint() -> Waypoint:
    return Waypoint(waypoint_id="A", position=Position(x_m=1.0, y_m=2.0))


@pytest.fixture
def config() -> BridgeConfig:
    return BridgeConfig(accept_timeout_s=0.5, stop_budget_s=0.1)


@pytest.fixture
def fake(config: BridgeConfig) -> FakeVendorBridge:
    bridge = FakeVendorBridge(config)
    bridge.connect()
    yield bridge
    bridge.release_gates()
    bridge.disconnect()
