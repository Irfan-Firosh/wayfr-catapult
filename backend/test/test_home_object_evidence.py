import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image

from api.routes import homes as homes_routes
from core.config import settings
from main import create_app
from services.home_setup.pipeline import (
    _bridge_objects_to_positions,
    _select_object_evidence_records,
    get_legacy_object_evidence_preview,
)


def test_select_object_evidence_prefers_largest_visible_frame() -> None:
    detections_json = {
        "frame_width": 100,
        "frame_height": 100,
        "tracks": [
            {
                "track_id": 7,
                "canonical_label": "door",
                "best_frames": [3, 1],
            }
        ],
        "frames": [
            {
                "frame_idx": 11,
                "sampled_frame_idx": 1,
                "timestamp_sec": 0.5,
                "detections": [
                    {
                        "track_id": 7,
                        "bbox": [1, 2, 20, 30],
                        "mask_quality": 0.95,
                        "mask_area_ratio": 0.06,
                        "bbox_area_ratio": 0.07,
                    }
                ],
            },
            {
                "frame_idx": 33,
                "sampled_frame_idx": 3,
                "timestamp_sec": 1.5,
                "detections": [
                    {
                        "track_id": 7,
                        "bbox": [3, 4, 22, 40],
                        "mask_quality": 0.6,
                        "mask_area_ratio": 0.12,
                        "bbox_area_ratio": 0.14,
                    }
                ],
            },
        ],
    }

    selected = _select_object_evidence_records(detections_json)

    assert selected[7]["sampled_frame_idx"] == 3
    assert selected[7]["source_frame_idx"] == 33
    assert selected[7]["label"] == "door"
    assert selected[7]["mask_area_ratio"] == 0.12


def test_select_object_evidence_penalizes_cropped_frame() -> None:
    detections_json = {
        "frame_width": 100,
        "frame_height": 100,
        "tracks": [
            {
                "track_id": 9,
                "canonical_label": "chair",
                "best_frames": [],
            }
        ],
        "frames": [
            {
                "frame_idx": 40,
                "sampled_frame_idx": 4,
                "timestamp_sec": 2.0,
                "detections": [
                    {
                        "track_id": 9,
                        "bbox": [-10, 10, 80, 90],
                        "mask_quality": 0.9,
                        "mask_area_ratio": 0.2,
                        "bbox_area_ratio": 0.25,
                    }
                ],
            },
            {
                "frame_idx": 50,
                "sampled_frame_idx": 5,
                "timestamp_sec": 2.5,
                "detections": [
                    {
                        "track_id": 9,
                        "bbox": [14, 15, 55, 66],
                        "mask_quality": 0.7,
                        "mask_area_ratio": 0.18,
                        "bbox_area_ratio": 0.19,
                    }
                ],
            },
        ],
    }

    selected = _select_object_evidence_records(detections_json)

    assert selected[9]["sampled_frame_idx"] == 5
    assert selected[9]["source_frame_idx"] == 50
    assert selected[9]["bbox"] == [14.0, 15.0, 55.0, 66.0]


def test_bridge_objects_to_positions_attaches_evidence_metadata() -> None:
    objects = [
        {
            "track_id": 3,
            "label": "lamp",
            "centroid_3d": [1.2, 3.4, 5.6],
            "bbox_3d_min": [1.0, 3.0, 5.0],
            "bbox_3d_max": [1.4, 3.8, 6.0],
            "confidence": 0.92,
            "n_observations": 4,
        }
    ]
    evidence_by_track = {
        3: {
            "image_path": "home-1/track-3.jpg",
            "sampled_frame_idx": 8,
            "source_frame_idx": 120,
            "timestamp_sec": 4.8,
            "bbox": [4, 5, 60, 70],
            "mask_quality": 0.67,
        }
    }

    positions = _bridge_objects_to_positions("home-1", objects, evidence_by_track)

    assert len(positions) == 1
    assert positions[0].track_id == 3
    assert positions[0].evidence_frame is not None
    assert positions[0].evidence_frame.image_path == "home-1/track-3.jpg"
    assert positions[0].evidence_frame.sampled_frame_idx == 8
    assert positions[0].evidence_frame.source_frame_idx == 120
    assert positions[0].evidence_frame.timestamp_sec == 4.8
    assert positions[0].evidence_frame.bbox == [4.0, 5.0, 60.0, 70.0]
    assert positions[0].evidence_frame.mask_quality == 0.67


def test_legacy_object_evidence_route_serves_local_frame(monkeypatch, tmp_path) -> None:
    home_id = "legacy-home"
    track_id = 5
    sampled_frame_idx = 112
    home_dir = tmp_path / home_id
    frames_dir = home_dir / "object_evidence_frames"
    frames_dir.mkdir(parents=True)

    frame_path = frames_dir / f"track-{track_id:04d}-sample-{sampled_frame_idx:05d}.jpg"
    frame_bytes = b"\xff\xd8legacy-jpeg\xff\xd9"
    frame_path.write_bytes(frame_bytes)

    (home_dir / "object_evidence.json").write_text(
        json.dumps(
            {
                "version": 1,
                "tracks": [
                    {
                        "track_id": track_id,
                        "label": "door",
                        "frames": [
                            {
                                "frame_idx": 560,
                                "sampled_frame_idx": sampled_frame_idx,
                                "timestamp_sec": 18.6,
                                "bbox": [1, 2, 3, 4],
                                "mask_quality": 0.95,
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings, "scene_data_dir", str(tmp_path))

    async def fake_get(_home_id: str):
        return SimpleNamespace(id=home_id, status="ready")

    async def fake_get_object_evidence_image(_home_id: str, _track_id: int):
        return None, None

    monkeypatch.setattr(homes_routes.homes_repo, "get", fake_get)
    monkeypatch.setattr(homes_routes, "get_object_evidence_image", fake_get_object_evidence_image)

    client = TestClient(create_app())
    response = client.get(f"/api/homes/{home_id}/object-evidence/{track_id}/frames/{sampled_frame_idx}")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content == frame_bytes


def test_legacy_object_evidence_route_404s_for_missing_sampled_frame(monkeypatch, tmp_path) -> None:
    home_id = "legacy-home"
    track_id = 5
    home_dir = tmp_path / home_id
    home_dir.mkdir(parents=True)

    (home_dir / "object_evidence.json").write_text(
        json.dumps(
            {
                "version": 1,
                "tracks": [
                    {
                        "track_id": track_id,
                        "label": "door",
                        "frames": [
                            {
                                "frame_idx": 560,
                                "sampled_frame_idx": 112,
                                "timestamp_sec": 18.6,
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings, "scene_data_dir", str(tmp_path))

    async def fake_get(_home_id: str):
        return SimpleNamespace(id=home_id, status="ready")

    async def fake_get_object_evidence_image(_home_id: str, _track_id: int):
        return None, None

    monkeypatch.setattr(homes_routes.homes_repo, "get", fake_get)
    monkeypatch.setattr(homes_routes, "get_object_evidence_image", fake_get_object_evidence_image)

    client = TestClient(create_app())
    response = client.get(f"/api/homes/{home_id}/object-evidence/{track_id}/frames/999")

    assert response.status_code == 404


def test_legacy_preview_prefers_largest_visible_frame(tmp_path, monkeypatch) -> None:
    home_id = "legacy-home"
    track_id = 5
    home_dir = tmp_path / home_id
    frames_dir = home_dir / "object_evidence_frames"
    frames_dir.mkdir(parents=True)

    for sampled_frame_idx in (111, 112):
        frame_path = frames_dir / f"track-{track_id:04d}-sample-{sampled_frame_idx:05d}.jpg"
        Image.new("RGB", (100, 100), color=(12, 18, 24)).save(frame_path, format="JPEG")

    (home_dir / "object_evidence.json").write_text(
        json.dumps(
            {
                "version": 1,
                "tracks": [
                    {
                        "track_id": track_id,
                        "label": "door",
                        "frames": [
                            {
                                "frame_idx": 555,
                                "sampled_frame_idx": 111,
                                "timestamp_sec": 18.5,
                                "bbox": [-10, 20, 90, 90],
                                "mask_quality": 0.95,
                            },
                            {
                                "frame_idx": 560,
                                "sampled_frame_idx": 112,
                                "timestamp_sec": 18.6,
                                "bbox": [10, 20, 80, 90],
                                "mask_quality": 0.7,
                            },
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(settings, "scene_data_dir", str(tmp_path))

    preview = get_legacy_object_evidence_preview(home_id, track_id)

    assert preview is not None
    assert preview["sampled_frame_idx"] == 112
