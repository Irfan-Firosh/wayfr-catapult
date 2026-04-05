"""
Convert a list of Waypoints + current heading into plain-English navigation instructions.

Heading convention: 0 rad = facing +Z (forward), positive = turning left (CCW).
"""

from __future__ import annotations

import math

from models.home import Waypoint

_TURN_THRESHOLD = math.radians(25)   # < 25° = "go straight"
_SHARP_THRESHOLD = math.radians(100)  # > 100° = "turn around"


def _angle_diff(a: float, b: float) -> float:
    """Signed difference b - a, normalised to (-π, π]."""
    diff = (b - a + math.pi) % (2 * math.pi) - math.pi
    return diff


def _bearing(from_x: float, from_z: float, to_x: float, to_z: float) -> float:
    """Bearing from (from_x, from_z) toward (to_x, to_z) in radians."""
    dx = to_x - from_x
    dz = to_z - from_z
    return math.atan2(dx, dz)


def _describe_turn(delta: float) -> str:
    abs_delta = abs(delta)
    if abs_delta < _TURN_THRESHOLD:
        return ""
    if abs_delta >= _SHARP_THRESHOLD:
        return "turn around"
    if abs_delta < math.radians(60):
        side = "left" if delta > 0 else "right"
        return f"bear {side}"
    side = "left" if delta > 0 else "right"
    return f"turn {side}"


def waypoints_to_instructions(
    waypoints: list[Waypoint],
    start_x: float,
    start_z: float,
    heading_rad: float = 0.0,
) -> list[str]:
    """
    Generate step-by-step instructions from a list of waypoints.

    Args:
        waypoints: sequence of (x, z, distance_m) waypoints.
        start_x, start_z: current position.
        heading_rad: current facing direction in radians.

    Returns:
        List of instruction strings, ending with "You have arrived."
    """
    if not waypoints:
        return ["You have arrived."]

    instructions: list[str] = []
    current_heading = heading_rad
    prev_x, prev_z = start_x, start_z

    # Accumulate straight segments between turns
    accumulated_distance = 0.0

    for wp in waypoints:
        bearing = _bearing(prev_x, prev_z, wp.x, wp.z)
        turn_desc = _describe_turn(_angle_diff(current_heading, bearing))

        if turn_desc:
            # Flush accumulated straight distance first
            if accumulated_distance >= 0.5:
                instructions.append(f"Go straight {accumulated_distance:.0f} {'meter' if accumulated_distance == 1 else 'meters'}.")
                accumulated_distance = 0.0
            instructions.append(f"{turn_desc.capitalize()}.")
            current_heading = bearing

        accumulated_distance += wp.distance_m
        prev_x, prev_z = wp.x, wp.z

    # Flush remaining straight distance
    if accumulated_distance >= 0.5:
        instructions.append(f"Go straight {accumulated_distance:.0f} {'meter' if accumulated_distance == 1 else 'meters'}.")

    instructions.append("You have arrived.")
    return instructions
