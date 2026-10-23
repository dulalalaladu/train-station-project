"""Unit tests for the vendor-bridge pydantic models (boundary validation, immutability)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from dog_vendor_bridge.models import (
    ActionKind,
    BridgeConfig,
    FollowCommand,
    GoToCommand,
    Position,
    RobotState,
    SpeedChange,
    SpeedCommand,
    SpeedLevel,
    StartPatrolCommand,
    TurnCommand,
    TurnDirection,
    Waypoint,
)


def _wp(wp_id: str = "A") -> Waypoint:
    return Waypoint(waypoint_id=wp_id, position=Position(x_m=1.0, y_m=2.0))


def test_models_are_frozen():
    wp = _wp()
    with pytest.raises(ValidationError):
        wp.waypoint_id = "B"  # type: ignore[misc]


def test_extra_fields_are_rejected():
    with pytest.raises(ValidationError):
        GoToCommand(command_id="c1", target=_wp(), surprise=1)  # type: ignore[call-arg]


def test_command_id_must_be_non_empty():
    with pytest.raises(ValidationError):
        GoToCommand(command_id="", target=_wp())


def test_go_to_speed_limit_bounds():
    GoToCommand(command_id="c1", target=_wp(), speed_limit_mps=1.0)
    with pytest.raises(ValidationError):
        GoToCommand(command_id="c1", target=_wp(), speed_limit_mps=0)
    with pytest.raises(ValidationError):
        GoToCommand(command_id="c1", target=_wp(), speed_limit_mps=9.0)


def test_patrol_requires_waypoints_or_vendor_route():
    with pytest.raises(ValidationError):
        StartPatrolCommand(command_id="c1", route_id="r1")
    StartPatrolCommand(command_id="c1", route_id="r1", waypoints=(_wp("A"), _wp("B")))
    StartPatrolCommand(command_id="c1", route_id="r1", vendor_route_ref="default")


def test_turn_angle_range():
    TurnCommand(command_id="c1", direction=TurnDirection.LEFT)
    assert TurnCommand(command_id="c1", direction=TurnDirection.RIGHT).angle_deg == 90.0
    for bad in (0, -5, 181):
        with pytest.raises(ValidationError):
            TurnCommand(command_id="c1", direction=TurnDirection.LEFT, angle_deg=bad)


def test_speed_requires_exactly_one_selector():
    SpeedCommand(command_id="c1", change=SpeedChange.FASTER)
    SpeedCommand(command_id="c1", level=SpeedLevel.SLOW)
    with pytest.raises(ValidationError):
        SpeedCommand(command_id="c1")
    with pytest.raises(ValidationError):
        SpeedCommand(command_id="c1", change=SpeedChange.FASTER, level=SpeedLevel.FAST)


def test_follow_distance_bounds():
    assert FollowCommand(command_id="c1").target_distance_m == 1.5
    with pytest.raises(ValidationError):
        FollowCommand(command_id="c1", target_distance_m=0.1)


def test_battery_soc_bounds():
    from dog_vendor_bridge.models import BatteryState

    BatteryState(soc_pct=0)
    BatteryState(soc_pct=100)
    with pytest.raises(ValidationError):
        BatteryState(soc_pct=101)


def test_bridge_config_defaults_match_plan():
    cfg = BridgeConfig()
    assert cfg.stop_budget_s == pytest.approx(0.100)
    assert cfg.accept_timeout_s > cfg.stop_budget_s
    assert cfg.escalate_stop_to_hard is False


def test_bridge_config_rejects_non_positive_budgets():
    with pytest.raises(ValidationError):
        BridgeConfig(stop_budget_s=0)
    with pytest.raises(ValidationError):
        BridgeConfig(accept_timeout_s=-1)


def test_action_kind_covers_the_seven_plan_actions():
    assert {k.value for k in ActionKind} == {
        "go_to",
        "start_patrol",
        "stop",
        "return_home",
        "follow",
        "turn",
        "speed",
    }


def test_robot_state_json_round_trip():
    state = RobotState(ts=1.0, vendor="fake", connected=True)
    assert RobotState.model_validate_json(state.model_dump_json()) == state
