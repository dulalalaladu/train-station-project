"""Action-path tests for VendorBridgeBase using the fake bridge."""

from __future__ import annotations

import time
from typing import Mapping

import pytest

from dog_vendor_bridge.errors import BridgeError
from dog_vendor_bridge.fake_bridge import FakeVendorBridge
from dog_vendor_bridge.models import (
    ActionKind,
    BatteryState,
    BridgeConfig,
    BridgeErrorCode,
    FollowCommand,
    GoToCommand,
    ReturnHomeCommand,
    RobotMode,
    SpeedChange,
    SpeedCommand,
    StartPatrolCommand,
    StopMode,
    Support,
    TaskPhase,
    TaskState,
    TurnCommand,
    TurnDirection,
    VendorSnapshot,
)
from dog_vendor_bridge.vendor_bridge_base import VendorBridgeBase


def _go_to(cmd_id: str, waypoint) -> GoToCommand:
    return GoToCommand(command_id=cmd_id, target=waypoint)


def test_go_to_accepted_sets_running_task(fake, waypoint):
    result = fake.go_to(_go_to("c1", waypoint))

    assert result.accepted and result.error is None
    assert result.kind is ActionKind.GO_TO and result.command_id == "c1"
    task = fake.get_state().task
    assert task is not None
    assert (task.task_id, task.kind, task.phase) == ("c1", ActionKind.GO_TO, TaskPhase.RUNNING)


@pytest.mark.parametrize(
    "build",
    [
        lambda wp: ("go_to", GoToCommand(command_id="x", target=wp)),
        lambda wp: ("start_patrol", StartPatrolCommand(command_id="x", route_id="r", waypoints=(wp,))),
        lambda wp: ("return_home", ReturnHomeCommand(command_id="x")),
        lambda wp: ("follow", FollowCommand(command_id="x")),
        lambda wp: ("turn", TurnCommand(command_id="x", direction=TurnDirection.LEFT)),
        lambda wp: ("speed", SpeedCommand(command_id="x", change=SpeedChange.SLOWER)),
    ],
)
def test_every_action_is_dispatched_to_its_hook(fake, waypoint, build):
    name, cmd = build(waypoint)
    result = getattr(fake, name)(cmd)
    assert result.accepted
    assert (name, "x") in fake.calls


def test_completion_updates_state_and_notifies_listener(fake, waypoint):
    seen: list[TaskState] = []
    fake.add_task_listener(seen.append)

    fake.go_to(_go_to("c1", waypoint))
    fake.finish("c1", TaskPhase.SUCCEEDED)

    assert [t.phase for t in seen] == [TaskPhase.RUNNING, TaskPhase.SUCCEEDED]
    assert fake.get_state().task.phase is TaskPhase.SUCCEEDED


def test_completion_for_unknown_task_is_ignored(fake, waypoint):
    fake.go_to(_go_to("c1", waypoint))
    fake.finish("other", TaskPhase.SUCCEEDED)
    assert fake.get_state().task.phase is TaskPhase.RUNNING


def test_late_completion_after_terminal_state_is_ignored(fake, waypoint):
    fake.go_to(_go_to("c1", waypoint))
    fake.finish("c1", TaskPhase.FAILED)
    fake.finish("c1", TaskPhase.SUCCEEDED)
    assert fake.get_state().task.phase is TaskPhase.FAILED


def test_listener_exception_does_not_break_the_bridge(fake, waypoint):
    def boom(_: TaskState) -> None:
        raise RuntimeError("listener bug")

    fake.add_task_listener(boom)
    assert fake.go_to(_go_to("c1", waypoint)).accepted


def test_new_motion_action_preempts_running_task(fake, waypoint):
    seen: list[TaskState] = []
    fake.add_task_listener(seen.append)
    fake.go_to(_go_to("c1", waypoint))

    result = fake.turn(TurnCommand(command_id="c2", direction=TurnDirection.LEFT))

    assert result.accepted
    assert ("cancel", "c1") in fake.calls
    phases = [(t.task_id, t.phase) for t in seen]
    assert ("c1", TaskPhase.CANCELLED) in phases
    assert fake.get_state().task.task_id == "c2"


def test_unconnected_bridge_rejects_actions(config, waypoint):
    bridge = FakeVendorBridge(config)
    result = bridge.go_to(_go_to("c1", waypoint))
    assert not result.accepted
    assert result.error.code is BridgeErrorCode.NOT_CONNECTED
    assert bridge.calls == []


def test_unsupported_capability_is_rejected_before_reaching_vendor(config, waypoint):
    class NoFollow(FakeVendorBridge):
        CAPABILITIES: Mapping[ActionKind, Support] = {
            **FakeVendorBridge.CAPABILITIES,
            ActionKind.FOLLOW: Support.UNSUPPORTED,
        }

    bridge = NoFollow(config)
    bridge.connect()
    result = bridge.follow(FollowCommand(command_id="c1"))
    assert result.error.code is BridgeErrorCode.NOT_SUPPORTED
    assert ("follow", "c1") not in bridge.calls
    assert bridge.capabilities()[ActionKind.FOLLOW] is Support.UNSUPPORTED


def test_subclass_must_declare_all_capabilities():
    with pytest.raises(TypeError, match="CAPABILITIES"):

        class Incomplete(FakeVendorBridge):  # noqa: F841
            CAPABILITIES: Mapping[ActionKind, Support] = {ActionKind.STOP: Support.FULL}


def test_vendor_error_is_mapped_into_result(fake, waypoint):
    fake.start_error = BridgeError(
        BridgeErrorCode.VENDOR_FAULT, "nav module down", retryable=True, vendor_code="41746"
    )
    result = fake.go_to(_go_to("c1", waypoint))
    assert not result.accepted
    assert result.error.code is BridgeErrorCode.VENDOR_FAULT
    assert result.error.retryable and result.error.vendor_code == "41746"
    assert fake.get_state().task.phase is TaskPhase.FAILED


def test_unexpected_exception_becomes_internal_error(fake, waypoint):
    fake.start_error = RuntimeError("sdk crashed")
    result = fake.go_to(_go_to("c1", waypoint))
    assert result.error.code is BridgeErrorCode.INTERNAL
    assert "sdk crashed" not in (result.error.message or "")


def test_accept_timeout_reports_unknown_result_and_issues_safety_stop(waypoint):
    bridge = FakeVendorBridge(BridgeConfig(accept_timeout_s=0.15, stop_budget_s=0.1))
    bridge.connect()
    bridge.start_gate = bridge.new_gate()
    try:
        result = bridge.go_to(_go_to("c1", waypoint))
        assert not result.accepted
        assert result.error.code is BridgeErrorCode.TIMEOUT
        assert result.error.result_unknown is True
        assert ("stop", StopMode.SOFT) in bridge.calls
        assert bridge.get_state().task.phase is TaskPhase.FAILED
    finally:
        bridge.release_gates()


def test_get_state_merges_vendor_snapshot(fake):
    fake.set_snapshot(VendorSnapshot(battery=BatteryState(soc_pct=80), mode=RobotMode.IDLE))
    state = fake.get_state()
    assert state.vendor == "fake" and state.connected
    assert state.battery.soc_pct == 80
    assert state.mode is RobotMode.IDLE


def test_get_state_survives_vendor_read_failure(fake, caplog):
    fake.state_error = BridgeError(BridgeErrorCode.TIMEOUT, "no reply")
    with caplog.at_level("WARNING"):
        state = fake.get_state()
    assert state.connected is False
    assert "state_read_failed" in state.faults
    assert any("state" in r.message.lower() for r in caplog.records)


def test_disconnect_marks_state_disconnected(fake):
    fake.disconnect()
    assert fake.get_state().connected is False


def test_connect_failure_is_a_bridge_error(config):
    bridge = FakeVendorBridge(config)
    bridge.connect_error = BridgeError(BridgeErrorCode.NOT_CONNECTED, "no route")
    with pytest.raises(BridgeError) as info:
        bridge.connect()
    assert info.value.code is BridgeErrorCode.NOT_CONNECTED


def test_action_latency_is_reported(fake, waypoint):
    fake.start_delay_s = 0.05
    t0 = time.monotonic()
    result = fake.go_to(_go_to("c1", waypoint))
    assert result.latency_ms >= 40
    assert result.latency_ms <= (time.monotonic() - t0) * 1000 + 5


class _MinimalBridge(VendorBridgeBase):
    """Implements only the abstract hooks; every action falls back to NOT_SUPPORTED."""

    VENDOR = "minimal"
    CAPABILITIES: Mapping[ActionKind, Support] = {kind: Support.PARTIAL for kind in ActionKind}

    def __init__(self, config=None, *, connect_exc=None, disconnect_exc=None):
        super().__init__(config)
        self._connect_exc, self._disconnect_exc = connect_exc, disconnect_exc
        self.stops = []

    def _do_connect(self):
        if self._connect_exc:
            raise self._connect_exc

    def _do_disconnect(self):
        if self._disconnect_exc:
            raise self._disconnect_exc

    def _do_stop(self, mode):
        self.stops.append(mode)

    def _read_state(self):
        return VendorSnapshot()


def test_default_hooks_report_not_supported(config, waypoint):
    bridge = _MinimalBridge(config)
    bridge.connect()
    calls = [
        bridge.go_to(_go_to("c1", waypoint)),
        bridge.start_patrol(StartPatrolCommand(command_id="c2", route_id="r", vendor_route_ref="x")),
        bridge.return_home(ReturnHomeCommand(command_id="c3")),
        bridge.follow(FollowCommand(command_id="c4")),
        bridge.turn(TurnCommand(command_id="c5", direction=TurnDirection.LEFT)),
        bridge.speed(SpeedCommand(command_id="c6", change=SpeedChange.FASTER)),
    ]
    assert all(r.error.code is BridgeErrorCode.NOT_SUPPORTED for r in calls)


def test_default_cancel_hook_is_a_soft_stop(config, waypoint):
    class Starts(_MinimalBridge):
        def _do_go_to(self, cmd, ctx):
            return None

        def _do_turn(self, cmd, ctx):
            return None

    bridge = Starts(config)
    bridge.connect()
    bridge.go_to(_go_to("c1", waypoint))
    bridge.turn(TurnCommand(command_id="c2", direction=TurnDirection.LEFT))
    assert bridge.stops == [StopMode.SOFT]


def test_connect_wraps_unexpected_exceptions(config):
    bridge = _MinimalBridge(config, connect_exc=OSError("boom"))
    with pytest.raises(BridgeError) as info:
        bridge.connect()
    assert info.value.code is BridgeErrorCode.NOT_CONNECTED


def test_disconnect_survives_vendor_failure(config):
    bridge = _MinimalBridge(config, disconnect_exc=OSError("boom"))
    bridge.connect()
    bridge.disconnect()
    assert bridge.get_state().connected is False


def test_complete_task_rejects_non_terminal_phase(fake):
    with pytest.raises(ValueError):
        fake.finish("c1", TaskPhase.RUNNING)


def test_error_info_serialises_for_the_wire(fake, waypoint):
    fake.start_error = BridgeError(BridgeErrorCode.VENDOR_FAULT, "x", vendor_code="41746")
    result = fake.go_to(_go_to("c1", waypoint))
    assert '"vendor_fault"' in result.model_dump_json()


def test_get_state_does_not_hang_on_a_stuck_vendor_read(config):
    import threading
    import time

    from dog_vendor_bridge.models import BridgeConfig

    gate = threading.Event()

    class Slow(_MinimalBridge):
        def _read_state(self):
            gate.wait(5.0)
            return VendorSnapshot()

    bridge = Slow(BridgeConfig(state_timeout_s=0.1))
    bridge.connect()
    t0 = time.monotonic()
    state = bridge.get_state()
    gate.set()
    assert time.monotonic() - t0 < 0.5
    assert state.connected is False and "state_read_failed" in state.faults
