"""
AWA Operational API Server
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel, Field

from awa.runtime import WorkflowEngine
from awa.runtime.human_task_queue import get_task_queue
from awa.types import Workflow, Activity, ActorType


app = FastAPI(
    title="AWA Operational API",
    description="Operational API for Managing Agentic Workflows",
    version="1.0.0"
)

# --- Models ---

class TaskResponse(BaseModel):
    id: str
    activity_id: str
    workflow_id: str
    status: str
    assignee_id: Optional[str] = None
    created_at: datetime
    data: Dict[str, Any] = Field(default_factory=dict)

class WorkflowRunRequest(BaseModel):
    workflow_data: Dict[str, Any]
    initial_data: Optional[Dict[str, Any]] = None

# --- In-Memory Storage (Simulation) ---

active_workflows = {}

# --- Routes ---

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

@app.post("/workflows/run")
async def run_workflow(request: WorkflowRunRequest):
    try:
        wf = Workflow(**request.workflow_data)
        engine = WorkflowEngine(wf)
        
        # In a real sync execution, this would block
        # For the API, we might want to run it in a background task
        result = engine.run(request.initial_data)
        
        run_id = str(uuid4())
        active_workflows[run_id] = {
            "workflow_id": str(wf.id),
            "status": "completed",
            "result": result
        }
        
        return {
            "run_id": run_id,
            "status": "completed",
            "result": result
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/tasks", response_model=List[TaskResponse])
async def list_tasks(assignee_id: Optional[str] = None):
    queue = get_task_queue()
    tasks = queue.list(assignee_id)
    return [
        {
            "id": t.id,
            "activity_id": t.activity_id,
            "workflow_id": t.workflow_id,
            "status": t.status,
            "assignee_id": t.assignee_id,
            "created_at": t.created_at,
            "data": t.data
        } for t in tasks
    ]

@app.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    queue = get_task_queue()
    task = queue.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "id": task.id,
        "activity_id": task.activity_id,
        "workflow_id": task.workflow_id,
        "status": task.status,
        "assignee_id": task.assignee_id,
        "created_at": task.created_at,
        "data": task.data
    }

@app.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, data: Dict[str, Any] = Body(...)):
    queue = get_task_queue()
    if not queue.complete(task_id, data):
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {"status": "success", "message": "Task completed"}
