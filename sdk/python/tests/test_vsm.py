import unittest
from datetime import datetime, timedelta
import time
from uuid import uuid4
from awa.types import Workflow, Activity, ActorType, Edge
from awa.runtime import WorkflowEngine, TokenStatus

class TestVSMAnalytics(unittest.TestCase):
    def setUp(self):
        self.activity1_id = str(uuid4())
        self.activity2_id = str(uuid4())
        
        self.workflow = Workflow(
            id=uuid4(),
            name="VSM Test",
            version="1.0.0",
            activities=[
                Activity(
                    id=self.activity1_id,
                    name="Activity 1",
                    role_id=uuid4(),
                    actor_type=ActorType.human
                ),
                Activity(
                    id=self.activity2_id,
                    name="Activity 2",
                    role_id=uuid4(),
                    actor_type=ActorType.application
                )
            ],
            edges=[
                Edge(
                    id=uuid4(),
                    source_id=self.activity1_id,
                    target_id=self.activity2_id
                )
            ],
            decision_nodes=[],
            contexts=[]
        )

    def test_tracking_process_time(self):
        engine = WorkflowEngine(self.workflow)
        # Mocking or just running as is (SoftwareAgent is mock-like)
        engine.run() # This will run until it needs human input or completes
        
        token = engine.tokens[0]
        # Find exited Activity 1
        exit_entry = next((h for h in token.history if h["action"] == "exited" and h["node_id"] == self.activity1_id), None)
        self.assertIsNotNone(exit_entry)
        self.assertIn("analytics", exit_entry)
        self.assertTrue(exit_entry["analytics"]["process_time"].startswith("PT"))

    def test_value_added_flag(self):
        # Set Activity 2 to non-value-added
        from awa.types import Analytics
        self.workflow.activities[1].analytics = Analytics(value_added=False)
        
        engine = WorkflowEngine(self.workflow)
        engine.run()
        
        token = engine.tokens[0]
        # In Python, update_status is called for completion
        comp_entry = next((h for h in token.history if h["action"] == "status_change:completed"), None)
        self.assertIsNotNone(comp_entry)
        self.assertFalse(comp_entry["analytics"]["value_added"])

if __name__ == "__main__":
    unittest.main()
