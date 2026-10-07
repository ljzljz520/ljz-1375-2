import os, sys, tempfile
os.environ["TEAHORSE_DB"] = tempfile.mktemp(prefix="teahorse_test_", suffix=".db")
os.environ["ADMIN_TOKEN"] = "test-token"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from backend.main import app

ADMIN = {"X-Admin-Token": "test-token"}

@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="session")
def admin():
    return ADMIN

def sid(client, code):
    ss = client.get("/api/stations").json()["stations"]
    return next(s["id"] for s in ss if s["code"] == code)

def seg_id(client, from_code, to_code):
    ss = client.get("/api/stations").json()["stations"]
    f = next(s["id"] for s in ss if s["code"] == from_code)
    t = next(s["id"] for s in ss if s["code"] == to_code)
    return next(g["id"] for g in client.get("/api/segments").json()["segments"]
                if g["from_station"] == f and g["to_station"] == t)
