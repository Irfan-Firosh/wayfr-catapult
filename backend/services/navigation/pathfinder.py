"""
A* pathfinding on a 2D occupancy grid built from 3D object positions.

Coordinate convention: x = left/right, z = forward/back (depth).
The occupancy grid covers [-HALF_SIZE, +HALF_SIZE] metres in both axes.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np

from models.home import ObjectPosition, Waypoint

# Grid parameters
CELL_SIZE = 0.25   # metres per cell
GRID_CELLS = 80    # 80×80 cells = 20m×20m
HALF_M = CELL_SIZE * GRID_CELLS / 2  # 10 metres from origin
OBSTACLE_PADDING = 1  # cells of padding around each object bbox


def _world_to_grid(x: float, z: float) -> tuple[int, int]:
    col = int((x + HALF_M) / CELL_SIZE)
    row = int((z + HALF_M) / CELL_SIZE)
    col = max(0, min(GRID_CELLS - 1, col))
    row = max(0, min(GRID_CELLS - 1, row))
    return row, col


def _grid_to_world(row: int, col: int) -> tuple[float, float]:
    x = col * CELL_SIZE - HALF_M + CELL_SIZE / 2
    z = row * CELL_SIZE - HALF_M + CELL_SIZE / 2
    return x, z


def build_occupancy_grid(objects: list[ObjectPosition]) -> np.ndarray:
    """Return a boolean grid (True = occupied/obstacle)."""
    grid = np.zeros((GRID_CELLS, GRID_CELLS), dtype=bool)

    for obj in objects:
        if obj.bbox_min and obj.bbox_max:
            x_min, _, z_min = obj.bbox_min
            x_max, _, z_max = obj.bbox_max
        else:
            x_min = obj.x - 0.3
            z_min = obj.z - 0.3
            x_max = obj.x + 0.3
            z_max = obj.z + 0.3

        r0, c0 = _world_to_grid(x_min, z_min)
        r1, c1 = _world_to_grid(x_max, z_max)

        r0 = max(0, r0 - OBSTACLE_PADDING)
        c0 = max(0, c0 - OBSTACLE_PADDING)
        r1 = min(GRID_CELLS - 1, r1 + OBSTACLE_PADDING)
        c1 = min(GRID_CELLS - 1, c1 + OBSTACLE_PADDING)

        grid[r0 : r1 + 1, c0 : c1 + 1] = True

    return grid


def astar(
    grid: np.ndarray,
    start: tuple[int, int],
    goal: tuple[int, int],
) -> list[tuple[int, int]]:
    """A* on grid. Returns list of (row, col) from start to goal, or [] if no path."""
    if grid[goal[0], goal[1]]:
        # Goal is inside obstacle — find nearest free cell
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                nr, nc = goal[0] + dr, goal[1] + dc
                if 0 <= nr < GRID_CELLS and 0 <= nc < GRID_CELLS and not grid[nr, nc]:
                    goal = (nr, nc)
                    break
            else:
                continue
            break

    def h(a: tuple[int, int], b: tuple[int, int]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1])

    open_heap: list[tuple[float, tuple[int, int]]] = []
    heapq.heappush(open_heap, (0.0, start))
    came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    g_score: dict[tuple[int, int], float] = {start: 0.0}

    directions = [
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (-1, 1), (1, -1), (1, 1),
    ]
    diag_cost = math.sqrt(2)

    while open_heap:
        _, current = heapq.heappop(open_heap)
        if current == goal:
            # Reconstruct path
            path: list[tuple[int, int]] = []
            node: tuple[int, int] | None = current
            while node is not None:
                path.append(node)
                node = came_from[node]
            path.reverse()
            return path

        for dr, dc in directions:
            nr, nc = current[0] + dr, current[1] + dc
            if not (0 <= nr < GRID_CELLS and 0 <= nc < GRID_CELLS):
                continue
            if grid[nr, nc]:
                continue
            move_cost = diag_cost if (dr != 0 and dc != 0) else 1.0
            tentative_g = g_score[current] + move_cost
            neighbor = (nr, nc)
            if tentative_g < g_score.get(neighbor, float("inf")):
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g
                f = tentative_g + h(neighbor, goal)
                heapq.heappush(open_heap, (f, neighbor))

    return []  # no path found


def _simplify_path(path: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Remove collinear intermediate points (keep direction changes only)."""
    if len(path) <= 2:
        return path
    result = [path[0]]
    for i in range(1, len(path) - 1):
        dr1 = path[i][0] - path[i - 1][0]
        dc1 = path[i][1] - path[i - 1][1]
        dr2 = path[i + 1][0] - path[i][0]
        dc2 = path[i + 1][1] - path[i][1]
        if (dr1, dc1) != (dr2, dc2):
            result.append(path[i])
    result.append(path[-1])
    return result


def plan_route(
    objects: list[ObjectPosition],
    current_x: float,
    current_z: float,
    target_label: str,
) -> tuple[list[Waypoint], ObjectPosition | None]:
    """
    Find a route from (current_x, current_z) to the nearest object matching target_label.
    Returns (waypoints, target_object). waypoints is empty if no path or target not found.
    """
    # Find closest object with matching label
    label_lower = target_label.lower().strip()
    candidates = [o for o in objects if label_lower in o.label.lower()]
    if not candidates:
        return [], None

    target = min(
        candidates,
        key=lambda o: math.hypot(o.x - current_x, o.z - current_z),
    )

    grid = build_occupancy_grid(objects)
    start = _world_to_grid(current_x, current_z)
    goal = _world_to_grid(target.x, target.z)

    if start == goal:
        return [], target

    raw_path = astar(grid, start, goal)
    if not raw_path:
        # Fallback: straight line waypoints
        raw_path = [start, goal]

    simplified = _simplify_path(raw_path)

    waypoints: list[Waypoint] = []
    cumulative = 0.0
    prev_x, prev_z = current_x, current_z
    for row, col in simplified[1:]:
        wx, wz = _grid_to_world(row, col)
        seg = math.hypot(wx - prev_x, wz - prev_z)
        cumulative += seg
        waypoints.append(Waypoint(x=round(wx, 2), z=round(wz, 2), distance_m=round(seg, 2)))
        prev_x, prev_z = wx, wz

    return waypoints, target
