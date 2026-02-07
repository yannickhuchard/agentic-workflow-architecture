"""
AWA Decision Evaluator
Evaluates decision tables and rules
"""

from typing import Any
from awa.types import DecisionNode, DecisionTable, DecisionRule


class DecisionEvaluator:
    """Evaluates decision tables to determine the next path in a workflow."""
    
    def evaluate(
        self,
        node: DecisionNode,
        context_data: dict[str, Any]
    ) -> str | None:
        """
        Evaluate a decision node against provided context data.
        Returns the ID of the winning edge, or the default edge ID.
        """
        table = node.decision_table
        
        # Check rules in order
        for rule in table.rules:
            if self._evaluate_rule(rule, table, context_data):
                return rule.output_edge_id
        
        # Return default if no rule matches
        return node.default_output_edge_id
    
    def _evaluate_rule(
        self,
        rule: DecisionRule,
        table: DecisionTable,
        context_data: dict[str, Any]
    ) -> bool:
        """Evaluate a single rule."""
        # Simple implementation: all input entries must match context data
        # In a real implementation, this would handle complex expressions
        for i, entry in enumerate(rule.input_entries):
            if i >= len(table.inputs):
                break
                
            input_col = table.inputs[i]
            context_val = context_data.get(input_col.name)
            
            # Simple equality check for now
            if str(context_val) != str(entry):
                return False
                
        return True
