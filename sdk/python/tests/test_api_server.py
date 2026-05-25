"""
Tests for AWA Operational REST API Server
"""

import os
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient

# Mock environment variables for testing auth and server config
os.environ["AUTH_ENABLED"] = "true"
os.environ["JWT_SECRET"] = "super-secret-key-for-testing-12345"
os.environ["API_KEYS"] = "apikey123:admin,operator456:operator"
os.environ["AWA_DATABASE_URL"] = "test_awa_server.db"

from awa.server import app, verify_jwt
from awa.runtime.persistence.db import init_db
from awa.runtime.services.task_service import TaskService


@pytest.fixture(autouse=True)
def setup_server_db():
    """Setup and teardown a clean test SQLite database for server tests."""
    init_db()
    yield
    # Cleanup DB file
    if os.path.exists("test_awa_server.db"):
        try:
            os.remove("test_awa_server.db")
        except PermissionError:
            pass


def test_root_and_health():
    """Test public root and health endpoints."""
    client = TestClient(app)
    
    # Root
    response = client.get("/")
    assert response.status_code == 200
    assert "AWA Operational API" in response.json()["service"]

    # Health
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_key_authentication():
    """Test auth using x-api-key header."""
    client = TestClient(app)
    
    # Missing auth
    response = client.get("/api/v1/tasks")
    assert response.status_code == 401
    
    # Invalid API key
    response = client.get("/api/v1/tasks", headers={"x-api-key": "wrongkey"})
    assert response.status_code == 401

    # Valid API key
    response = client.get("/api/v1/tasks", headers={"x-api-key": "apikey123"})
    assert response.status_code == 200
    assert "tasks" in response.json()


def test_jwt_authentication():
    """Test auth using Bearer JWT token."""
    client = TestClient(app)
    
    # Generate simple test JWT token manually matching our custom signature algorithm
    import time
    import json
    import base64
    import hmac
    import hashlib

    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({
        "sub": "user-jwt-1",
        "role": "admin",
        "permissions": ["*"],
        "exp": (time.time() + 3600) * 1000  # 1 hour expiration in ms
    }).encode()).decode().rstrip("=")
    
    message = f"{header}.{payload}".encode("utf-8")
    sig = hmac.new("super-secret-key-for-testing-12345".encode("utf-8"), message, hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    token = f"{header}.{payload}.{signature}"

    # Verify signature verification utility works
    decoded = verify_jwt(token, "super-secret-key-for-testing-12345")
    assert decoded is not None
    assert decoded["sub"] == "user-jwt-1"

    # Make API request with Bearer token
    response = client.get("/api/v1/tasks", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert "tasks" in response.json()


def test_task_operations_workflow():
    """Test full workflow of task CRUD and action transitions via API."""
    client = TestClient(app)
    headers = {"x-api-key": "apikey123"}

    role_id = uuid4()
    activity_id = uuid4()
    token_id = uuid4()
    workflow_id = uuid4()

    # Pre-seed task directly via TaskService
    task = TaskService.create({
        "activity_id": activity_id,
        "activity_name": "Review Form",
        "token_id": token_id,
        "workflow_id": workflow_id,
        "role_id": role_id,
        "inputs": {"test": "data"},
        "priority": "high"
    })

    # Fetch task via GET
    response = client.get(f"/api/v1/tasks/{task.id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["activity_name"] == "Review Form"

    # Fetch pending tasks
    response = client.get("/api/v1/tasks/pending", headers=headers)
    assert response.status_code == 200
    assert len(response.json()["tasks"]) == 1

    # Assign task
    response = client.post(
        f"/api/v1/tasks/{task.id}/assign",
        json={"user_id": "operator-bob"},
        headers=headers
    )
    assert response.status_code == 200
    assert response.json()["task"]["status"] == "assigned"
    assert response.json()["task"]["assignee_id"] == "operator-bob"

    # Complete task
    response = client.post(
        f"/api/v1/tasks/{task.id}/complete",
        json={"result": {"approved": True, "reviewer_notes": "All documents match"}},
        headers=headers
    )
    assert response.status_code == 200
    assert response.json()["task"]["status"] == "completed"
    assert response.json()["task"]["outputs"] == {"approved": True, "reviewer_notes": "All documents match"}

    # Reject new task
    task2 = TaskService.create({
        "activity_id": activity_id,
        "activity_name": "Review Details",
        "token_id": token_id,
        "workflow_id": workflow_id,
        "role_id": role_id,
        "inputs": {},
    })
    response = client.post(
        f"/api/v1/tasks/{task2.id}/reject",
        json={"reason": "Missing signatures"},
        headers=headers
    )
    assert response.status_code == 200
    assert response.json()["task"]["status"] == "rejected"
    assert response.json()["task"]["outputs"] == {"rejection_reason": "Missing signatures"}

    # Queue Stats
    response = client.get("/api/v1/tasks/queue/stats", headers=headers)
    assert response.status_code == 200
    stats = response.json()
    assert stats["total"] == 2
    assert stats["by_status"]["completed"] == 1
    assert stats["by_status"]["rejected"] == 1
