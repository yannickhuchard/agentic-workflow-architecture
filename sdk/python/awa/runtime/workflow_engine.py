"""
AWA Workflow Engine
Executes AWA workflow definitions
"""

import os
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

def format_iso_duration(seconds: float) -> str:
    """Format seconds as ISO 8601 duration string (PTnHnMnS)"""
    if seconds < 0:
        seconds = 0
    
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    
    result = "P"
    if days > 0:
        result += f"{days}D"
    
    result += "T"
    if hours > 0:
        result += f"{hours}H"
    if minutes > 0:
        result += f"{minutes}M"
    if secs > 0 or result == "PT":
        result += f"{secs:.1f}S"
    
    return result

from awa.types import Workflow, Activity, ActorType, DecisionNode, WasteCategory
from awa.runtime.token import Token, TokenStatus
from awa.runtime.context_manager import ContextManager
from awa.runtime.actors import SoftwareAgent, AIAgent, HumanAgent, RobotAgent
from awa.runtime.decision_evaluator import DecisionEvaluator
from awa.validator import validate_workflow_integrity


class EngineStatus(str, Enum):
    """Workflow engine status"""
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING_HUMAN = "waiting_human"


class WorkflowEngine:
    """
    Executes AWA workflow definitions.
    """
    
    def __init__(
        self,
        workflow: Workflow,
        gemini_api_key: str | None = None,
        verbose: bool = False
    ):
        self.workflow = workflow
        self.gemini_api_key = gemini_api_key or os.environ.get("GEMINI_API_KEY")
        self.verbose = verbose
        
        self._context_manager = ContextManager(workflow.contexts)
        self._tokens: dict[str, Token] = {}
        self._status = EngineStatus.IDLE
        self._activities_by_id: dict[str, Activity] = {
            str(a.id): a for a in workflow.activities
        }
        self._decision_nodes_by_id: dict[str, DecisionNode] = {
            str(d.id): d for d in workflow.decision_nodes
        }
        
        # Initialize actors
        self._actors = {
            ActorType.application: SoftwareAgent(),
            ActorType.ai_agent: AIAgent(self.gemini_api_key),
            ActorType.human: HumanAgent(),
            ActorType.robot: RobotAgent(),
        }
        self._decision_evaluator = DecisionEvaluator()
        
        # Ensure we use strings for comparison in node ID search later
        # Find start activity initially
        self._start_activity = self._find_start_activity()
        
        # Validate workflow
        if not validate_workflow_integrity(workflow):
            raise ValueError("Invalid workflow definition")
    
    @property
    def status(self) -> EngineStatus:
        """Get engine status"""
        return self._status
    
    @property
    def tokens(self) -> list[Token]:
        """Get all tokens"""
        return list(self._tokens.values())
    
    def run(self, initial_data: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Execute the workflow from start to end.
        """
        self._status = EngineStatus.RUNNING
        
        # Find start activity
        if not self._start_activity:
            self._status = EngineStatus.FAILED
            raise ValueError("No start activity found")
        
        # Create initial token
        token = Token(
            activity_id=str(self._start_activity.id),
            initial_data=initial_data,
            workflow_id=str(self.workflow.id)
        )
        self._tokens[token.id] = token
        
        if self.verbose:
            print(f"[Engine] Starting workflow: {self.workflow.name}")
            print(f"[Engine] Token created: {token.id}")
        
        try:
            # Execute until completion
            while self._has_active_tokens():
                self._execute_step()
            
            self._status = EngineStatus.COMPLETED
            
            return {
                "status": "completed",
                "tokens": [t.to_dict() for t in self._tokens.values()],
                "contexts": self._context_manager.get_all_data()
            }
            
        except Exception as e:
            self._status = EngineStatus.FAILED
            raise
    
    def _find_start_activity(self) -> Activity | None:
        """Find the start activity (one with no incoming edges)"""
        target_ids = {e.target_id for e in self.workflow.edges}
        
        for activity in self.workflow.activities:
            if activity.id not in target_ids:
                return activity
        
        return self.workflow.activities[0] if self.workflow.activities else None
    
    def _has_active_tokens(self) -> bool:
        """Check if there are active tokens"""
        return any(
            t.status == TokenStatus.ACTIVE 
            for t in self._tokens.values()
        )
    
    def _execute_step(self) -> None:
        """Execute one step for all active tokens"""
        active_tokens = [
            t for t in self._tokens.values() 
            if t.status == TokenStatus.ACTIVE
        ]
        
        for token in active_tokens:
            node_id = str(token.activity_id)
            start_time = datetime.now()
            
            # Check if it's an activity
            activity = self._activities_by_id.get(node_id)
            if activity:
                if self.verbose:
                    print(f"[Engine] Executing Activity: {activity.name}")
                
                try:
                    result = self._execute_activity(activity, token)
                    token.merge_data(result)
                    
                    end_time = datetime.now()
                    duration_secs = (end_time - start_time).total_seconds()
                    process_time = format_iso_duration(duration_secs)
                    
                    analytics = {
                        "process_time": process_time,
                        "cycle_time": process_time,
                        "lead_time": process_time,
                        "value_added": getattr(activity.analytics, "value_added", True) if activity.analytics else True,
                        "waste_categories": []
                    }

                    # Check for waiting (Human tasks)
                    if result.get("_requires_human_action"):
                        analytics["waste_categories"].append(WasteCategory.waiting.value)
                        token.update_status(TokenStatus.WAITING, analytics=analytics)
                        token.set_data("_waiting_since", end_time.isoformat())
                        continue

                    next_node = self._find_next_node(str(activity.id))
                    if next_node:
                        token.move(str(next_node), analytics=analytics)
                    else:
                        token.update_status(TokenStatus.COMPLETED, analytics=analytics)
                
                except Exception as e:
                    end_time = datetime.now()
                    duration_secs = (end_time - start_time).total_seconds()
                    analytics = {
                        "process_time": format_iso_duration(duration_secs),
                        "waste_categories": [WasteCategory.defects.value],
                        "error_rate": 1.0
                    }
                    token.update_status(TokenStatus.FAILED, analytics=analytics)
                    if self.verbose:
                        print(f"[Engine] Activity Failed: {activity.name} - {str(e)}")
                continue
                
            # Check if it's a decision node
            decision = self._decision_nodes_by_id.get(node_id)
            if decision:
                if self.verbose:
                    print(f"[Engine] Evaluating Decision: {decision.name}")
                
                edge_id = self._decision_evaluator.evaluate(
                    decision, 
                    token.context_data
                )
                
                if edge_id:
                    next_node = self._find_target_by_edge(str(edge_id))
                    if next_node:
                        token.move(str(next_node))
                    else:
                        token.update_status(TokenStatus.FAILED)
                else:
                    token.update_status(TokenStatus.FAILED)
                continue
            
            # Unknown node
            token.update_status(TokenStatus.FAILED)
    
    def _execute_activity(
        self,
        activity: Activity,
        token: Token
    ) -> dict[str, Any]:
        """Execute an activity based on actor type"""
        actor = self._actors.get(activity.actor_type)
        if actor:
            if self.verbose:
                print(f"  [{activity.actor_type.name}] {activity.name}")
            return actor.execute(activity, token)
        
        return {"_completed": True}
    
    def _find_next_node(self, source_id: str) -> str | None:
        """Find next node ID via edges"""
        for edge in self.workflow.edges:
            if str(edge.source_id) == str(source_id):
                return str(edge.target_id)
        return None

    def _find_target_by_edge(self, edge_id: str) -> str | None:
        """Find target node ID for a given edge ID"""
        for edge in self.workflow.edges:
            if str(edge.id) == str(edge_id):
                return str(edge.target_id)
        return None

    def resume_token(self, token_id: str, output: dict[str, Any]) -> bool:
        """Resume a token that was waiting for human input"""
        token = self._tokens.get(token_id)
        if not token or token.status != TokenStatus.WAITING:
            return False

        waiting_since = token.get_data("_waiting_since")
        analytics = None

        if waiting_since:
            wait_start = datetime.fromisoformat(waiting_since)
            wait_duration = (datetime.now() - wait_start).total_seconds()
            analytics = {
                "wait_time": format_iso_duration(wait_duration),
                "waste_categories": [WasteCategory.waiting.value]
            }

        token.merge_data(output)
        token.update_status(TokenStatus.ACTIVE, analytics=analytics)

        if self._status == EngineStatus.WAITING_HUMAN:
            self._status = EngineStatus.RUNNING

        return True
