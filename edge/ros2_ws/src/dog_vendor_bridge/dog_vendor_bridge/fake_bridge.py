"""In-memory bridge used by unit tests and by dog-sim style rigs. Touches no hardware or SDK.

This is a test double: its knobs (`start_gate`, `stop_errors`, ...) are plain mutable attributes so
tests can inject hangs and failures. Production code must never import it.
"""

from __future__ import annotations

import threading
import time
from typing import ClassVar, Dict, List, Mapping, Optional, Tuple

from .models import (
    ActionKind,
    BridgeConfig,
    FollowCommand,
    GoToCommand,
    ReturnHomeCommand,
    SpeedCommand,
    StartPatrolCommand,
    StopMode,
    Support,
    TaskPhase,
    TurnCommand,
    VendorSnapshot,
)
from .vendor_bridge_base import ActionContext, VendorBridgeBase

Call = Tuple[str, object]


class FakeVendorBridge(VendorBridgeBase):
    VENDOR = "fake"
    CAPABILITIES: ClassVar[Mapping[ActionKind, Support]] = {kind: Support.FULL for kind in ActionKind}

    def __init__(self, config: Optional[BridgeConfig] = None) -> None:
        super().__init__(config)
        self._calls: List[Call] = []
        self._calls_lock = threading.Lock()
        self._gates: List[threading.Event] = []
        self._snapshot_value = VendorSnapshot()
        self.start_entered = threading.Event()
        self.start_gate: Optional[threading.Event] = None
        self.start_gate_timeout_s = 5.0
        self.stop_gate: Optional[threading.Event] = None
        self.start_delay_s = 0.0
        self.start_error: Optional[BaseException] = None
        self.stop_errors: Dict[StopMode, BaseException] = {}
        self.connect_error: Optional[BaseException] = None
        self.state_error: Optional[BaseException] = None

    # ------------------------------------------------------------- test controls
    @property
    def calls(self) -> List[Call]:
        with self._calls_lock:
            return list(self._calls)

    def new_gate(self) -> threading.Event:
        gate = threading.Event()
        self._gates.append(gate)
        return gate

    def release_gates(self) -> None:
        for gate in self._gates:
            gate.set()

    def set_snapshot(self, snapshot: VendorSnapshot) -> None:
        self._snapshot_value = snapshot

    def finish(self, task_id: str, phase: TaskPhase) -> None:
        self._complete_task(task_id, phase)

    # ------------------------------------------------------------------- hooks
    def _record(self, name: str, arg: object) -> None:
        with self._calls_lock:
            self._calls.append((name, arg))

    def _start(self, name: str, command_id: str) -> None:
        self._record(name, command_id)
        self.start_entered.set()
        if self.start_delay_s:
            time.sleep(self.start_delay_s)
        if self.start_gate is not None:
            self.start_gate.wait(self.start_gate_timeout_s)
        if self.start_error is not None:
            raise self.start_error

    def _do_connect(self) -> None:
        if self.connect_error is not None:
            raise self.connect_error

    def _do_disconnect(self) -> None:
        self._record("disconnect", None)

    def _do_stop(self, mode: StopMode) -> None:
        self._record("stop", mode)
        if self.stop_gate is not None:
            self.stop_gate.wait(5.0)
        error = self.stop_errors.get(mode)
        if error is not None:
            raise error

    def _do_cancel_task(self, task_id: str) -> None:
        self._record("cancel", task_id)

    def _read_state(self) -> VendorSnapshot:
        if self.state_error is not None:
            raise self.state_error
        return self._snapshot_value

    def _do_go_to(self, cmd: GoToCommand, ctx: ActionContext) -> None:
        self._start("go_to", cmd.command_id)

    def _do_start_patrol(self, cmd: StartPatrolCommand, ctx: ActionContext) -> None:
        self._start("start_patrol", cmd.command_id)

    def _do_return_home(self, cmd: ReturnHomeCommand, ctx: ActionContext) -> None:
        self._start("return_home", cmd.command_id)

    def _do_follow(self, cmd: FollowCommand, ctx: ActionContext) -> None:
        self._start("follow", cmd.command_id)

    def _do_turn(self, cmd: TurnCommand, ctx: ActionContext) -> None:
        self._start("turn", cmd.command_id)

    def _do_speed(self, cmd: SpeedCommand) -> None:
        self._start("speed", cmd.command_id)
