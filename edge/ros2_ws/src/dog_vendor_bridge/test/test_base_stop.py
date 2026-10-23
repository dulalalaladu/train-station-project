"""STOP priority semantics: <=100 ms, never blocked by other actions, preempts, escalates."""

from __future__ import annotations

import threading
import time

import pytest

from dog_vendor_bridge.errors import BridgeError
from dog_vendor_bridge.fake_bridge import FakeVendorBridge
from dog_vendor_bridge.models import (
    BridgeConfig,
    BridgeErrorCode,
    GoToCommand,
    StopMode,
    TaskPhase,
    TurnCommand,
    TurnDirection,
)


def test_stop_meets_budget_and_cancels_running_task(fake, waypoint):
    fake.go_to(GoToCommand(command_id="c1", target=waypoint))

    result = fake.stop()

    assert result.ok and result.within_budget
    assert result.latency_ms < 100
    assert result.mode_used is StopMode.SOFT
    assert result.cancelled_task_id == "c1"
    assert fake.get_state().task.phase is TaskPhase.CANCELLED


def test_stop_without_running_task_is_ok(fake):
    result = fake.stop()
    assert result.ok and result.cancelled_task_id is None


def test_stop_is_attempted_even_when_not_connected(config):
    bridge = FakeVendorBridge(config)  # never connected
    result = bridge.stop()
    assert ("stop", StopMode.SOFT) in bridge.calls
    assert result.ok


def test_stop_is_not_blocked_by_a_hung_action(fake, waypoint):
    fake.start_gate = fake.new_gate()
    fake.start_gate_timeout_s = 5.0
    outcome: dict = {}

    def submit() -> None:
        outcome["result"] = fake.go_to(GoToCommand(command_id="c1", target=waypoint))

    worker = threading.Thread(target=submit, daemon=True)
    worker.start()
    assert fake.start_entered.wait(2.0)

    t0 = time.monotonic()
    result = fake.stop()
    elapsed_ms = (time.monotonic() - t0) * 1000

    assert result.ok and result.within_budget
    assert elapsed_ms < 100
    fake.release_gates()
    worker.join(3.0)
    assert not worker.is_alive()


def test_action_that_starts_during_stop_is_rejected_and_stopped_again(fake, waypoint):
    fake.start_gate = fake.new_gate()
    outcome: dict = {}

    def submit() -> None:
        outcome["result"] = fake.go_to(GoToCommand(command_id="c1", target=waypoint))

    worker = threading.Thread(target=submit, daemon=True)
    worker.start()
    assert fake.start_entered.wait(2.0)

    assert fake.stop().ok
    fake.release_gates()  # vendor start now "completes" after the stop
    worker.join(3.0)

    result = outcome["result"]
    assert not result.accepted
    assert result.error.code is BridgeErrorCode.PREEMPTED_BY_STOP
    stops = [c for c in fake.calls if c[0] == "stop"]
    assert len(stops) == 2  # the explicit one + the re-stop after the late start


def test_hung_vendor_stop_returns_at_budget_with_timeout(fake):
    fake.stop_gate = fake.new_gate()

    t0 = time.monotonic()
    result = fake.stop()
    elapsed = time.monotonic() - t0

    assert not result.ok and not result.within_budget
    assert result.error.code is BridgeErrorCode.TIMEOUT
    assert result.error.result_unknown is True
    assert elapsed < 0.1 + 0.15  # budget + scheduling slack, never the 5 s gate


def test_second_stop_is_not_queued_behind_a_hung_first_stop(fake):
    fake.stop_gate = fake.new_gate()
    t0 = time.monotonic()
    fake.stop()
    fake.stop()
    assert time.monotonic() - t0 < 2 * (0.1 + 0.15)
    assert len([c for c in fake.calls if c[0] == "stop"]) == 2


def test_failed_soft_stop_escalates_to_hard_when_enabled(waypoint):
    bridge = FakeVendorBridge(BridgeConfig(escalate_stop_to_hard=True))
    bridge.connect()
    bridge.stop_errors = {StopMode.SOFT: BridgeError(BridgeErrorCode.VENDOR_FAULT, "soft stop refused")}

    result = bridge.stop()

    assert result.ok and result.mode_used is StopMode.HARD
    assert [c for c in bridge.calls if c[0] == "stop"] == [("stop", StopMode.SOFT), ("stop", StopMode.HARD)]


def test_failed_soft_stop_does_not_escalate_by_default(fake):
    fake.stop_errors = {StopMode.SOFT: BridgeError(BridgeErrorCode.VENDOR_FAULT, "soft stop refused")}
    result = fake.stop()
    assert not result.ok
    assert result.error.code is BridgeErrorCode.VENDOR_FAULT
    assert [c for c in fake.calls if c[0] == "stop"] == [("stop", StopMode.SOFT)]


def test_explicit_hard_stop_uses_hard_mode(fake):
    result = fake.stop(StopMode.HARD)
    assert result.ok and result.mode_used is StopMode.HARD
    assert ("stop", StopMode.HARD) in fake.calls


def test_stop_cannot_be_overridden_by_vendor_bridges():
    with pytest.raises(TypeError, match="stop"):

        class Sneaky(FakeVendorBridge):  # noqa: F841
            def stop(self, mode=StopMode.SOFT):  # type: ignore[override]
                raise AssertionError("must never be reachable")


def test_actions_after_stop_are_accepted_again(fake, waypoint):
    fake.go_to(GoToCommand(command_id="c1", target=waypoint))
    fake.stop()
    result = fake.go_to(GoToCommand(command_id="c2", target=waypoint))
    assert result.accepted
    assert fake.get_state().task.task_id == "c2"


def test_concurrent_actions_and_stops_do_not_deadlock(fake, waypoint):
    stop_results = []

    def spam_actions() -> None:
        for i in range(15):
            fake.go_to(GoToCommand(command_id=f"g{threading.get_ident()}-{i}", target=waypoint))
            fake.turn(TurnCommand(command_id=f"t{threading.get_ident()}-{i}", direction=TurnDirection.LEFT))

    def spam_stops() -> None:
        for _ in range(30):
            stop_results.append(fake.stop())

    threads = [threading.Thread(target=spam_actions, daemon=True) for _ in range(6)]
    threads.append(threading.Thread(target=spam_stops, daemon=True))
    for t in threads:
        t.start()
    for t in threads:
        t.join(10.0)

    assert not any(t.is_alive() for t in threads)
    assert len(stop_results) == 30 and all(r.ok for r in stop_results)
