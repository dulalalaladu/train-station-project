"""Abstract vendor bridge: the only place vendor SDKs may be touched (D-03, D-04).

Concrete bridges (Unitree Go2, DEEP Robotics X30, fake) subclass `VendorBridgeBase` and implement
the `_do_*` hooks. The base class owns the semantics that must be identical on every platform:
admission checks, one active motion task, accept timeouts, error mapping, task-state tracking and,
above all, the STOP priority guarantee. See CONTRACT.md.
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, ClassVar, Mapping, Optional, Tuple

from ._deadline import DeadlineOutcome, run_with_deadline
from .errors import BridgeError
from .models import (
    ActionKind,
    ActionResult,
    BridgeConfig,
    BridgeErrorCode,
    ErrorInfo,
    FollowCommand,
    GoToCommand,
    ReturnHomeCommand,
    RobotMode,
    RobotState,
    SpeedCommand,
    StartPatrolCommand,
    StopMode,
    StopResult,
    Support,
    TaskPhase,
    TaskState,
    TurnCommand,
    VendorSnapshot,
)

logger = logging.getLogger("dog_vendor_bridge")

TaskListener = Callable[[TaskState], None]


@dataclass
class ActionContext:
    """Handed to start hooks. Long-running vendor work must watch `cancelled`."""

    command_id: str
    kind: ActionKind
    epoch: int
    cancelled: threading.Event = field(default_factory=threading.Event)


class VendorBridgeBase(ABC):
    VENDOR: ClassVar[str] = "unknown"
    CAPABILITIES: ClassVar[Mapping[ActionKind, Support]]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if "stop" in cls.__dict__:
            raise TypeError(f"{cls.__name__} must not override stop(); implement _do_stop() instead")
        caps = getattr(cls, "CAPABILITIES", None)
        if caps is None or set(caps) != set(ActionKind):
            raise TypeError(f"{cls.__name__}.CAPABILITIES must declare every ActionKind")

    def __init__(
        self,
        config: Optional[BridgeConfig] = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._cfg = config or BridgeConfig()
        self._clock = clock
        self._wall = wall_clock
        self._lock = threading.Lock()  # guards the fields below; never held across vendor calls
        self._connected = False
        self._epoch = 0
        self._active: Optional[ActionContext] = None
        self._task: Optional[TaskState] = None
        self._listeners: Tuple[TaskListener, ...] = ()

    # ------------------------------------------------------------------ lifecycle
    def connect(self) -> None:
        try:
            self._do_connect()
        except BridgeError:
            raise
        except Exception as exc:
            logger.exception("vendor connect failed")
            raise BridgeError(BridgeErrorCode.NOT_CONNECTED, "connect failed") from exc
        with self._lock:
            self._connected = True

    def disconnect(self) -> None:
        if self._connected:
            self.stop()
        try:
            self._do_disconnect()
        except Exception:
            logger.exception("vendor disconnect failed")
        with self._lock:
            self._connected = False

    def capabilities(self) -> Mapping[ActionKind, Support]:
        return dict(self.CAPABILITIES)

    def add_task_listener(self, listener: TaskListener) -> None:
        with self._lock:
            self._listeners = self._listeners + (listener,)

    # --------------------------------------------------------------------- actions
    def go_to(self, cmd: GoToCommand) -> ActionResult:
        return self._run_task_action(ActionKind.GO_TO, cmd.command_id, lambda ctx: self._do_go_to(cmd, ctx))

    def start_patrol(self, cmd: StartPatrolCommand) -> ActionResult:
        return self._run_task_action(
            ActionKind.START_PATROL, cmd.command_id, lambda ctx: self._do_start_patrol(cmd, ctx)
        )

    def return_home(self, cmd: ReturnHomeCommand) -> ActionResult:
        return self._run_task_action(
            ActionKind.RETURN_HOME, cmd.command_id, lambda ctx: self._do_return_home(cmd, ctx)
        )

    def follow(self, cmd: FollowCommand) -> ActionResult:
        return self._run_task_action(ActionKind.FOLLOW, cmd.command_id, lambda ctx: self._do_follow(cmd, ctx))

    def turn(self, cmd: TurnCommand) -> ActionResult:
        return self._run_task_action(ActionKind.TURN, cmd.command_id, lambda ctx: self._do_turn(cmd, ctx))

    def speed(self, cmd: SpeedCommand) -> ActionResult:
        """A setting, not a task: does not preempt or replace the running task."""
        t0 = self._clock()
        rejection = self._admit(ActionKind.SPEED)
        if rejection is not None:
            return self._result(cmd.command_id, ActionKind.SPEED, t0, rejection)
        outcome = run_with_deadline(lambda: self._do_speed(cmd), self._cfg.accept_timeout_s, "bridge-speed")
        error = None if outcome.ok else self._error_from(outcome, "speed")
        return self._result(cmd.command_id, ActionKind.SPEED, t0, error)

    def stop(self, mode: StopMode = StopMode.SOFT) -> StopResult:
        """Highest-priority action. Never takes an action lock, never queues behind a vendor call.

        Returns within `stop_budget_s` (plus scheduling slack) even if the vendor call hangs.
        """
        t0 = self._clock()
        cancelled = self._preempt_for_stop()
        used, outcome = mode, self._attempt_stop(mode)
        if not outcome.ok and mode is StopMode.SOFT and self._cfg.escalate_stop_to_hard:
            used, outcome = StopMode.HARD, self._attempt_stop(StopMode.HARD)
        latency_ms = (self._clock() - t0) * 1000.0
        return StopResult(
            ok=outcome.ok,
            mode_requested=mode,
            mode_used=used,
            latency_ms=latency_ms,
            within_budget=outcome.ok and latency_ms <= self._cfg.stop_budget_s * 1000.0,
            cancelled_task_id=cancelled,
            error=None if outcome.ok else self._error_from(outcome, "stop"),
        )

    def get_state(self) -> RobotState:
        with self._lock:
            connected, task = self._connected, self._task
        snap, read_ok = self._snapshot(connected)
        return RobotState(
            ts=self._wall(),
            vendor=self.VENDOR,
            connected=connected and read_ok,
            mode=snap.mode if connected else RobotMode.OFFLINE,
            battery=snap.battery,
            position=snap.position,
            heading_deg=snap.heading_deg,
            attitude=snap.attitude,
            speed_mps=snap.speed_mps,
            speed_level=snap.speed_level,
            localization_ok=snap.localization_ok,
            task=task,
            faults=snap.faults,
        )

    # ----------------------------------------------------------- hooks for subclasses
    @abstractmethod
    def _do_connect(self) -> None: ...

    @abstractmethod
    def _do_disconnect(self) -> None: ...

    @abstractmethod
    def _do_stop(self, mode: StopMode) -> None:
        """Send the vendor stop. Must return as soon as the command is handed to the transport."""

    @abstractmethod
    def _read_state(self) -> VendorSnapshot: ...

    def _do_cancel_task(self, task_id: str) -> None:
        """Cancel a running task before it is replaced. Default: soft stop."""
        self._do_stop(StopMode.SOFT)

    def _do_go_to(self, cmd: GoToCommand, ctx: ActionContext) -> None:
        raise self._unsupported(ActionKind.GO_TO)

    def _do_start_patrol(self, cmd: StartPatrolCommand, ctx: ActionContext) -> None:
        raise self._unsupported(ActionKind.START_PATROL)

    def _do_return_home(self, cmd: ReturnHomeCommand, ctx: ActionContext) -> None:
        raise self._unsupported(ActionKind.RETURN_HOME)

    def _do_follow(self, cmd: FollowCommand, ctx: ActionContext) -> None:
        raise self._unsupported(ActionKind.FOLLOW)

    def _do_turn(self, cmd: TurnCommand, ctx: ActionContext) -> None:
        raise self._unsupported(ActionKind.TURN)

    def _do_speed(self, cmd: SpeedCommand) -> None:
        raise self._unsupported(ActionKind.SPEED)

    def _complete_task(self, task_id: str, phase: TaskPhase, error: Optional[ErrorInfo] = None) -> None:
        """Called by subclasses (any thread) when the vendor reports the task finished."""
        if not phase.is_terminal:
            raise ValueError("_complete_task needs a terminal phase")
        with self._lock:
            ctx = self._active
            if ctx is None or ctx.command_id != task_id:
                return
            state = TaskState(task_id=task_id, kind=ctx.kind, phase=phase, error=error)
            self._task, self._active = state, None
        self._notify(state)

    # ------------------------------------------------------------------- internals
    @staticmethod
    def _unsupported(kind: ActionKind) -> BridgeError:
        return BridgeError(BridgeErrorCode.NOT_SUPPORTED, f"{kind.value} is not supported on this platform")

    def _admit(self, kind: ActionKind) -> Optional[ErrorInfo]:
        if self.CAPABILITIES[kind] is Support.UNSUPPORTED:
            return self._unsupported(kind).to_info()
        with self._lock:
            connected = self._connected
        if not connected:
            return ErrorInfo(code=BridgeErrorCode.NOT_CONNECTED, message="bridge is not connected")
        return None

    def _run_task_action(
        self, kind: ActionKind, command_id: str, start: Callable[[ActionContext], None]
    ) -> ActionResult:
        t0 = self._clock()
        rejection = self._admit(kind)
        if rejection is not None:
            return self._result(command_id, kind, t0, rejection)
        ctx, superseded = self._begin(kind, command_id)
        if superseded is not None:
            self._cancel_superseded(superseded)
        outcome = run_with_deadline(lambda: start(ctx), self._cfg.accept_timeout_s, f"bridge-{kind.value}")
        return self._result(command_id, kind, t0, self._settle(ctx, outcome))

    def _begin(self, kind: ActionKind, command_id: str) -> Tuple[ActionContext, Optional[ActionContext]]:
        with self._lock:
            previous = self._active
            ctx = ActionContext(command_id=command_id, kind=kind, epoch=self._epoch)
            self._active = ctx
            self._task = TaskState(task_id=command_id, kind=kind, phase=TaskPhase.PENDING)
        return ctx, previous

    def _cancel_superseded(self, previous: ActionContext) -> None:
        previous.cancelled.set()
        self._notify(TaskState(task_id=previous.command_id, kind=previous.kind, phase=TaskPhase.CANCELLED))
        outcome = run_with_deadline(
            lambda: self._do_cancel_task(previous.command_id), self._cfg.stop_budget_s, "bridge-cancel"
        )
        if not outcome.ok:
            logger.warning("cancel of superseded task %s did not complete: %s", previous.command_id, outcome)

    def _settle(self, ctx: ActionContext, outcome: DeadlineOutcome) -> Optional[ErrorInfo]:
        """Turn the start hook's outcome into task state; returns the error, if any."""
        if not outcome.ok:
            error = self._error_from(outcome, ctx.kind.value)
            self._fail(ctx, error)
            if outcome.timed_out:
                self.stop()  # the vendor may have started moving: be safe
            return error
        with self._lock:
            stopped = ctx.epoch != self._epoch
            superseded = not stopped and self._active is not ctx
            if not stopped and not superseded:
                self._task = TaskState(task_id=ctx.command_id, kind=ctx.kind, phase=TaskPhase.RUNNING)
                running = self._task
        if stopped:
            self._attempt_stop(StopMode.SOFT)  # the vendor started after a STOP: stop it again
            return ErrorInfo(code=BridgeErrorCode.PREEMPTED_BY_STOP, message="stopped while starting")
        if superseded:
            return ErrorInfo(code=BridgeErrorCode.SUPERSEDED, message="replaced by a newer command")
        self._notify(running)
        return None

    def _fail(self, ctx: ActionContext, error: ErrorInfo) -> None:
        with self._lock:
            if self._active is not ctx:
                return
            state = TaskState(task_id=ctx.command_id, kind=ctx.kind, phase=TaskPhase.FAILED, error=error)
            self._task, self._active = state, None
        self._notify(state)

    def _preempt_for_stop(self) -> Optional[str]:
        with self._lock:
            self._epoch += 1
            ctx, self._active = self._active, None
            if ctx is None:
                return None
            ctx.cancelled.set()
            state = TaskState(task_id=ctx.command_id, kind=ctx.kind, phase=TaskPhase.CANCELLED)
            self._task = state
        self._notify(state)
        return ctx.command_id

    def _attempt_stop(self, mode: StopMode) -> DeadlineOutcome:
        name = f"bridge-stop-{mode.value}"
        return run_with_deadline(lambda: self._do_stop(mode), self._cfg.stop_budget_s, name)

    def _snapshot(self, connected: bool) -> Tuple[VendorSnapshot, bool]:
        if not connected:
            return VendorSnapshot(), True
        outcome = run_with_deadline(self._read_state, self._cfg.state_timeout_s, "bridge-state")
        if outcome.ok:
            return outcome.value, True
        logger.warning("vendor state read failed: %s", "timeout" if outcome.timed_out else outcome.error)
        return VendorSnapshot(faults=("state_read_failed",)), False

    def _error_from(self, outcome: DeadlineOutcome, what: str) -> ErrorInfo:
        if outcome.timed_out:
            return ErrorInfo(
                code=BridgeErrorCode.TIMEOUT,
                message=f"{what}: vendor call exceeded its deadline",
                retryable=True,
                result_unknown=True,
            )
        if isinstance(outcome.error, BridgeError):
            return outcome.error.to_info()
        logger.error("unexpected error in vendor %s hook", what, exc_info=outcome.error)
        return ErrorInfo(code=BridgeErrorCode.INTERNAL, message=f"{what}: internal bridge error")

    def _result(
        self, command_id: str, kind: ActionKind, t0: float, error: Optional[ErrorInfo]
    ) -> ActionResult:
        return ActionResult(
            command_id=command_id,
            kind=kind,
            accepted=error is None,
            error=error,
            latency_ms=(self._clock() - t0) * 1000.0,
        )

    def _notify(self, state: TaskState) -> None:
        with self._lock:
            listeners = self._listeners
        for listener in listeners:
            try:
                listener(state)
            except Exception:
                logger.exception("task listener raised")
