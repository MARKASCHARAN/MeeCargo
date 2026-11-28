import json
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "sample_request.json"


def test_health_endpoint():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["solver"] == "ortools"


def test_sample_fixture_optimizes_valid_route():
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    res = client.post("/optimize", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "OPTIMAL"
    assert [s["stop_code"] for s in data["ordered_stops"]] == ["VAD", "ANA", "NAD", "AMD"]
    assert data["assigned_shipments"] == ["SHIP-1", "SHIP-2", "SHIP-3"]
    assert data["total_distance_meters"] == 42800 + 20500 + 55800
    assert data["estimated_duration_seconds"] > 0


def test_infeasible_capacity_returns_infeasible_status():
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["stops"][3]["demand_weight_kg"] = 5000  # Exceeds 2500 kg vehicle
    res = client.post("/optimize", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "INFEASIBLE"
    assert data["ordered_stops"] == []
    assert "exceeds vehicle capacity" in data["reason"]


def test_infeasible_time_window_returns_infeasible_status():
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    payload["stops"][3]["time_window_min"] = [0, 5]  # Impossible 5-min window to Ahmedabad
    res = client.post("/optimize", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "INFEASIBLE"
    assert data["ordered_stops"] == []
