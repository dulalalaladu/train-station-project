"""Vendor-neutral data model for the dog vendor bridge (see CONTRACT.md).

Everything here is immutable (frozen pydantic models) and validated at the boundary.
No vendor SDK types may appear in this module.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


# --------------------------------------------------------------------------- enums
class ActionKind(str, Enum):
    GO_TO = "go_to"
    START_PATROL = "start_patrol"
    STOP = "stop"
    RETURN_HOME = "return_home"
    FOLLOW = "follow"
    TURN = "turn"
    SPEED = "speed"


class Support(str, Enum):
    """How completely a platform implements an action (see ADR-0007 capability matrix)."""

    FULL = "full"
    PARTIAL = "partial"
    UNSUPPORTED = "unsupported"


class StopMode(str, Enum):
    SOFT = "soft"  # decelerate to a standing halt (Go2 StopMove / X30 cancel-task)
    HARD = "hard"  # immediate motor damping; the robot may sit/fall


class TurnDirection(str, Enum):
    LEFT = "left"
    RIGHT = "right"


class SpeedChange(str, Enum):
    FASTER = "faster"
    SLOWER = "slower"


class SpeedLevel(str, Enum):
    SLOW = "slow"
    NORMAL = "normal"
    FAST = "fast"


class RobotMode(str, Enum):
    UNKNOWN = "unknown"
    OFFLINE = "offline"
    IDLE = "idle"
    MOVING = "moving"
    NAVIGATING = "navigating"
    PATROLLING = "patrolling"
    FOLLOWING = "following"
    RETURNING = "returning"
    CHARGING = "charging"
    DAMPED = "damped"
    FAULT = "fault"


class TaskPhase(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in (TaskPhase.SUCCEEDED, TaskPhase.FAILED, TaskPhase.CANCELLED)


class BridgeErrorCode(str, Enum):
    NOT_SUPPORTED = "not_supported"
    NOT_CONNECTED = "not_connected"
    TIMEOUT = "timeout"
    INVALID_ARGUMENT = "invalid_argument"
    VENDOR_FAULT = "vendor_fault"
    LOCALIZATION_LOST = "localization_lost"
    LOW_BATTERY = "low_battery"
    PREEMPTED_BY_STOP = "preempted_by_stop"
    SUPERSEDED = "superseded"
    INTERNAL = "internal"


# ------------------------------------------------------------------ geometry / state
class Position(_Frozen):
    x_m: float
    y_m: float
    z_m: float = 0.0
    frame: str = "station_local"


class Attitude(_Frozen):
    roll_deg: float
    pitch_deg: float
    yaw_deg: float


class Waypoint(_Frozen):
    """A target resolved by the caller (cloud config); the bridge never looks waypoints up."""

    waypoint_id: str = Field(min_length=1, max_length=64)
    position: Position
    heading_deg: Optional[float] = None
    vendor_ref: Optional[str] = Field(default=None, max_length=128)


class BatteryState(_Frozen):
    soc_pct: Optional[float] = Field(default=None, ge=0, le=100)
    charging: Optional[bool] = None
    voltage_v: Optional[float] = Field(default=None, ge=0)


class ErrorInfo(_Frozen):
    code: BridgeErrorCode
    message: str = ""
    retryable: bool = False
    result_unknown: bool = False  # True: the vendor may or may not have acted; query state first
    vendor_code: Optional[str] = None


class TaskState(_Frozen):
    task_id: str
    kind: ActionKind
    phase: TaskPhase
    error: Optional[ErrorInfo] = None
    detail: Optional[str] = None


class VendorSnapshot(_Frozen):
    """What a concrete bridge reports from the robot; the base adds task/connection data."""

    mode: RobotMode = RobotMode.UNKNOWN
    battery: BatteryState = BatteryState()
    position: Optional[Position] = None
    heading_deg: Optional[float] = None
    attitude: Optional[Attitude] = None
    speed_mps: Optional[float] = None
    speed_level: Optional[SpeedLevel] = None
    localization_ok: Optional[bool] = None
    faults: Tuple[str, ...] = ()


class RobotState(_Frozen):
    ts: float  # wall-clock epoch seconds
    vendor: str
    connected: bool
    mode: RobotMode = RobotMode.UNKNOWN
    battery: BatteryState = BatteryState()
    position: Optional[Position] = None
    heading_deg: Optional[float] = None
    attitude: Optional[Attitude] = None
    speed_mps: Optional[float] = None
    speed_level: Optional[SpeedLevel] = None
    localization_ok: Optional[bool] = None
    task: Optional[TaskState] = None
    faults: Tuple[str, ...] = ()


# ------------------------------------------------------------------------ commands
class _Command(_Frozen):
    command_id: str = Field(min_length=1, max_length=64)


class GoToCommand(_Command):
    target: Waypoint
    speed_limit_mps: Optional[float] = Field(default=None, gt=0, le=5.0)


class StartPatrolCommand(_Command):
    route_id: str = Field(min_length=1, max_length=64)
    waypoints: Tuple[Waypoint, ...] = ()
    vendor_route_ref: Optional[str] = Field(default=None, max_length=128)
    loop: bool = False

    @model_validator(mode="after")
    def _needs_a_route(self) -> "StartPatrolCommand":
        if not self.waypoints and not self.vendor_route_ref:
            raise ValueError("start_patrol needs waypoints or vendor_route_ref")
        return self


class ReturnHomeCommand(_Command):
    home: Optional[Waypoint] = None  # None: use the vendor's own dock / charging point


class FollowCommand(_Command):
    target_distance_m: float = Field(default=1.5, ge=0.5, le=5.0)


class TurnCommand(_Command):
    direction: TurnDirection
    angle_deg: float = Field(default=90.0, gt=0, le=180)


class SpeedCommand(_Command):
    change: Optional[SpeedChange] = None
    level: Optional[SpeedLevel] = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "SpeedCommand":
        if (self.change is None) == (self.level is None):
            raise ValueError("speed needs exactly one of change / level")
        return self


# -------------------------------------------------------------------------- results
class ActionResult(_Frozen):
    command_id: str
    kind: ActionKind
    accepted: bool
    error: Optional[ErrorInfo] = None
    latency_ms: float = Field(default=0.0, ge=0)


class StopResult(_Frozen):
    ok: bool
    mode_requested: StopMode
    mode_used: StopMode
    latency_ms: float = Field(ge=0)
    within_budget: bool
    cancelled_task_id: Optional[str] = None
    error: Optional[ErrorInfo] = None


# --------------------------------------------------------------------------- config
class BridgeConfig(_Frozen):
    accept_timeout_s: float = Field(default=2.0, gt=0)
    stop_budget_s: float = Field(default=0.100, gt=0)
    state_timeout_s: float = Field(default=0.5, gt=0)
    escalate_stop_to_hard: bool = False
