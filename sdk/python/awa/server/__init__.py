"""
AWA Operational REST API Server
Provides full management of AWA workflows and human-in-the-loop task operations.
"""

import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Body, Header, Request, Depends, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from awa.types import Workflow, HumanTask, ActorType
from awa.runtime import WorkflowEngine, EngineStatus
from awa.runtime.services.task_service import TaskService
from awa.runtime.logger import get_logger

app = FastAPI(
    title="AWA Operational API",
    description="Operational API for Managing Agentic Workflows",
    version="1.0.0"
)

# Enable CORS for Next.js human task interface
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = get_logger()

# --- Config ---
AUTH_ENABLED = os.environ.get("AUTH_ENABLED", "false").lower() == "true"
JWT_SECRET = os.environ.get("JWT_SECRET")
# API Keys mapping: "key1:admin,key2:operator,key3:viewer"
API_KEYS: Dict[str, Dict[str, Any]] = {}
if os.environ.get("API_KEYS"):
    for part in os.environ.get("API_KEYS", "").split(","):
        if ":" in part:
            k, r = part.split(":", 1)
            API_KEYS[k] = {"id": f"user-{k}", "role": r, "permissions": ["*"]}

# --- Background Workflows Storage ---
active_engines: Dict[str, WorkflowEngine] = {}

# --- Pydantic Models for Requests ---
class WorkflowRunRequest(BaseModel):
    filePath: Optional[str] = None
    apiKey: Optional[str] = None
    workflow_data: Optional[Dict[str, Any]] = None
    initial_data: Optional[Dict[str, Any]] = None

class AssignTaskRequest(BaseModel):
    user_id: str
    assigner_id: Optional[str] = None
    assigner_type: Optional[str] = None

class CompleteTaskRequest(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)

class RejectTaskRequest(BaseModel):
    reason: str

# --- JWT helpers ---
def base64url_decode(s: str) -> bytes:
    padding = '=' * (4 - (len(s) % 4))
    return base64.urlsafe_b64decode(s + padding)

def verify_jwt(token: str, secret: str) -> Optional[Dict[str, Any]]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b64, payload_b64, signature = parts

        secret_bytes = secret.encode('utf-8')
        message = f"{header_b64}.{payload_b64}".encode('utf-8')

        expected_sig = hmac.new(secret_bytes, message, hashlib.sha256).digest()
        expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode('utf-8').rstrip('=')

        if signature != expected_sig_b64:
            logger.warn("JWT signature verification failed")
            return None

        payload = json.loads(base64url_decode(payload_b64).decode('utf-8'))

        if "exp" in payload:
            # Check expiration in milliseconds
            if payload["exp"] < (time.time() * 1000):
                logger.warn(f"JWT token expired for sub: {payload.get('sub')}")
                return None

        return payload
    except Exception as e:
        logger.error(f"JWT verification error: {e}")
        return None

# --- Auth Middleware/Dependency ---
async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None)
) -> Optional[Dict[str, Any]]:
    # Generate correlation ID for request tracing
    correlation_id = request.headers.get("x-correlation-id") or f"{int(time.time() * 1000)}-{str(uuid4())[:8]}"
    logger.set_correlation_id(correlation_id)

    if not AUTH_ENABLED:
        return {"id": "dev-user", "role": "admin", "permissions": ["*"]}

    # Try API key verification
    if x_api_key and x_api_key in API_KEYS:
        user = API_KEYS[x_api_key]
        logger.debug(f"API key authentication successful: {user['id']}")
        return user

    # Try JWT verification
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        if not JWT_SECRET:
            logger.error("JWT secret not configured")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication not properly configured"
            )

        payload = verify_jwt(token, JWT_SECRET)
        if payload:
            user = {
                "id": payload.get("sub"),
                "role": payload.get("role"),
                "permissions": payload.get("permissions", ["*"])
            }
            logger.debug(f"JWT authentication successful: {user['id']}")
            return user

    logger.warn("Authentication failed")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized. Valid API key or JWT token required"
    )

# --- Rate Limiting Cache ---
rate_limits: Dict[str, Dict[str, Any]] = {}
RATE_LIMIT_WINDOW = 60 # seconds
RATE_LIMIT_MAX = 100

def rate_limiter(request: Request, user: Optional[Dict[str, Any]] = Depends(get_current_user)):
    key = user.get("id") if user else request.client.host if request.client else "anonymous"
    now = time.time()

    record = rate_limits.get(key)
    if not record or record["reset_at"] < now:
        record = {"count": 0, "reset_at": now + RATE_LIMIT_WINDOW}
        rate_limits[key] = record

    record["count"] += 1

    if record["count"] > RATE_LIMIT_MAX:
        logger.warn(f"Rate limit exceeded for key: {key}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too Many Requests"
        )


# --- Basic Routes ---

@app.get("/")
async def root():
    return {
        "service": "AWA Operational API",
        "status": "active",
        "version": "1.0.0"
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# --- Workflow Routes ---

@app.post("/api/v1/workflows/run", dependencies=[Depends(rate_limiter)])
async def run_workflow(
    request: WorkflowRunRequest,
    user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        wf_data = None

        if request.filePath:
            if not os.path.exists(request.filePath):
                raise HTTPException(status_code=404, detail=f"Workflow file not found: {request.filePath}")
            with open(request.filePath, "r", encoding="utf-8") as f:
                wf_data = json.load(f)
        elif request.workflow_data:
            wf_data = request.workflow_data
        else:
            raise HTTPException(status_code=400, detail="Either filePath or workflow_data is required")

        wf = Workflow(**wf_data)
        
        apiKey = request.apiKey or os.environ.get("GEMINI_API_KEY")
        engine = WorkflowEngine(wf, gemini_api_key=apiKey, options={"user_id": user.get("id")})
        
        run_id = str(uuid4())
        active_engines[run_id] = engine

        # Start execution in the background
        import asyncio
        async def run_background():
            try:
                await asyncio.to_thread(engine.run, request.initial_data)
            except Exception as bg_err:
                logger.error(f"Background engine execution failed for run {run_id}", bg_err)

        asyncio.create_task(run_background())

        return {
            "runId": run_id,
            "status": "running",
            "message": "Workflow started"
        }
    except Exception as e:
        logger.error("Failed to run workflow", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/workflows/run/{run_id}", dependencies=[Depends(rate_limiter)])
async def get_workflow_status(
    run_id: str,
    user: Dict[str, Any] = Depends(get_current_user)
):
    engine = active_engines.get(run_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    
    return {
        "runId": run_id,
        "status": engine.status.value,
        "tokens": [t.to_dict() for t in engine.tokens]
    }


# --- Human Task Routes ---

@app.get("/api/v1/tasks", dependencies=[Depends(rate_limiter)])
async def list_tasks(
    role_id: Optional[str] = None,
    assignee_id: Optional[str] = None,
    status: Optional[str] = None,
    workflow_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        filters = {}
        if role_id:
            filters["role_id"] = role_id
        if assignee_id:
            filters["assignee_id"] = assignee_id
        if status:
            filters["status"] = status
        if workflow_id:
            filters["workflow_id"] = workflow_id

        tasks = TaskService.list(filters)
        return {
            "tasks": [t.dict() for t in tasks],
            "total": len(tasks)
        }
    except Exception as e:
        logger.error("Failed to list tasks", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/tasks/pending", dependencies=[Depends(rate_limiter)])
async def list_pending_tasks(
    role_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        if role_id:
            tasks = TaskService.get_pending_by_role(role_id)
        else:
            tasks = TaskService.list({"status": "pending"})
            
        return {
            "tasks": [t.dict() for t in tasks],
            "total": len(tasks)
        }
    except Exception as e:
        logger.error("Failed to get pending tasks", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/tasks/{task_id}", dependencies=[Depends(rate_limiter)])
async def get_task(
    task_id: str,
    user: Dict[str, Any] = Depends(get_current_user)
):
    task = TaskService.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.dict()


@app.post("/api/v1/tasks/{task_id}/assign", dependencies=[Depends(rate_limiter)])
async def assign_task(
    task_id: str,
    request: AssignTaskRequest,
    user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        task = TaskService.assign(
            task_id,
            request.user_id,
            request.assigner_id,
            request.assigner_type
        )
        return {
            "message": "Task assigned",
            "task": task.dict()
        }
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Failed to assign task {task_id}", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/tasks/{task_id}/complete", dependencies=[Depends(rate_limiter)])
async def complete_task(
    task_id: str,
    request: CompleteTaskRequest,
    user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        task = TaskService.complete(task_id, request.result)
        
        # Resume the engine if it was active and waiting in memory
        for engine in active_engines.values():
            if engine.status == EngineStatus.WAITING_HUMAN:
                # Find matching waiting token
                for token in engine.tokens:
                    if token.status.value == "waiting" and token.context_data.get("_human_task_id") == task_id:
                        engine.resume_token(token.id, request.result)
                        break

        return {
            "message": "Task completed",
            "task": task.dict()
        }
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Failed to complete task {task_id}", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/tasks/{task_id}/reject", dependencies=[Depends(rate_limiter)])
async def reject_task(
    task_id: str,
    request: RejectTaskRequest,
    user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        task = TaskService.reject(task_id, request.reason)
        
        # Resume the engine as failed/rejected if waiting
        for engine in active_engines.values():
            if engine.status == EngineStatus.WAITING_HUMAN:
                for token in engine.tokens:
                    if token.status.value == "waiting" and token.context_data.get("_human_task_id") == task_id:
                        # Fail the token with rejection reason
                        engine.resume_token(token.id, {"rejection_reason": request.reason, "_failed": True})
                        break

        return {
            "message": "Task rejected",
            "task": task.dict()
        }
    except ValueError as val_err:
        raise HTTPException(status_code=404, detail=str(val_err))
    except Exception as e:
        logger.error(f"Failed to reject task {task_id}", e)
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/tasks/queue/stats", dependencies=[Depends(rate_limiter)])
async def get_queue_stats(user: Dict[str, Any] = Depends(get_current_user)):
    try:
        all_tasks = TaskService.list()
        
        stats = {
            "total": len(all_tasks),
            "by_status": {
                "pending": len([t for t in all_tasks if t.status == "pending"]),
                "assigned": len([t for t in all_tasks if t.status == "assigned"]),
                "in_progress": len([t for t in all_tasks if t.status == "in_progress"]),
                "completed": len([t for t in all_tasks if t.status == "completed"]),
                "rejected": len([t for t in all_tasks if t.status == "rejected"]),
            },
            "by_priority": {
                "critical": len([t for t in all_tasks if t.priority == "critical"]),
                "high": len([t for t in all_tasks if t.priority == "high"]),
                "normal": len([t for t in all_tasks if t.priority == "normal"]),
                "low": len([t for t in all_tasks if t.priority == "low"]),
            }
        }
        return stats
    except Exception as e:
        logger.error("Failed to get task queue stats", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- Journeys and measures (specification sections 19 and 21) ---
# Behind the same authentication and rate limit as the routes above.

from awa.server.journeys import journey_router, measures_router, set_journey_runtime  # noqa: E402,F401

app.include_router(journey_router, prefix="/api/v1/journeys", dependencies=[Depends(rate_limiter)])
app.include_router(measures_router, prefix="/api/v1/measures", dependencies=[Depends(rate_limiter)])
