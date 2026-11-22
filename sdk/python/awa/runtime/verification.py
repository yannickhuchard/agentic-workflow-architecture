"""
AWA Verification Engine (specification section 7)

Verifies an activity's outcome against its acceptance criteria, failing
closed: an outcome that is not verified as `pass` is rejected.
"""

import time
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from awa.runtime.expression import evaluate_expression
from awa.runtime.journal import hash_payload
from awa.types import Activity, VerificationPolicy

# A verifier judges an outcome: (activity, inputs, outcome, policy) -> one result per criterion,
# in the order of policy.criteria, each {"passed": bool, "evidence": str, "confidence": float}.
Verifier = Callable[[Activity, dict[str, Any], dict[str, Any], VerificationPolicy], list[dict[str, Any]]]

VerificationRecord = dict[str, Any]


class VerificationEngine:
    """
    `schema_only` policies are evaluated here, deterministically. `ai_judge` and
    `custom` policies need a verifier registered under that mode name; without
    one, verification raises and the caller records the verdict `error`. A
    weaker mode is never substituted for the one the policy names.
    """

    def __init__(self, verifiers: dict[str, Verifier] | None = None, simulate: bool = False) -> None:
        self.verifiers = dict(verifiers or {})
        self.simulate = simulate

    def verify(self, activity: Activity, inputs: dict[str, Any], outcome: dict[str, Any], attempt: int) -> VerificationRecord:
        policy = activity.verification
        if policy is None or not policy.enabled:
            raise ValueError("Verification called on an activity without an enabled verification policy")

        started = time.time()
        if self.simulate:
            results = [self._result(c, True, "Simulated pass", 1.0) for c in policy.criteria]
            judged = {"criteria_results": results, "overall_score": 1.0, "verdict": "pass",
                      "feedback": "Simulation mode: verification automatically passed"}
        elif policy.mode == "schema_only":
            judged = self._verdict(self._verify_expressions(policy, outcome), policy)
        elif policy.mode in self.verifiers:
            judged = self._verdict(self._verify_with(self.verifiers[policy.mode], activity, inputs, outcome, policy), policy)
        else:
            raise RuntimeError(f'Verification mode "{policy.mode}" has no verifier registered with this engine')

        return {
            "id": str(uuid4()),
            "activity_id": str(activity.id),
            "attempt": attempt,
            "verdict": judged["verdict"],
            "criteria_results": judged["criteria_results"],
            "overall_score": judged["overall_score"],
            "feedback": judged["feedback"],
            "verified_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "duration_ms": int((time.time() - started) * 1000),
            "output_hash": self.compute_output_hash(outcome),
        }

    @staticmethod
    def _result(criterion: Any, passed: bool, evidence: str, confidence: float) -> dict[str, Any]:
        return {"criterion_id": str(criterion.id), "criterion_name": criterion.name,
                "passed": passed, "evidence": evidence, "confidence": confidence}

    def _verify_expressions(self, policy: VerificationPolicy, outcome: dict[str, Any]) -> list[dict[str, Any]]:
        results = []
        for criterion in policy.criteria:
            if criterion.expression:
                try:
                    passed = evaluate_expression(criterion.expression, outcome)
                    evidence = f'Expression "{criterion.expression}" evaluated to {"true" if passed else "false"}'
                except Exception as error:
                    passed, evidence = False, f"Expression evaluation error: {error}"
            else:
                # Fail closed: a criterion that cannot be checked deterministically is not met
                passed, evidence = False, "Criterion has no expression; schema_only mode cannot evaluate it"
            results.append(self._result(criterion, passed, evidence, 1.0))
        return results

    def _verify_with(self, verifier: Verifier, activity: Activity, inputs: dict[str, Any],
                     outcome: dict[str, Any], policy: VerificationPolicy) -> list[dict[str, Any]]:
        answers = verifier(activity, inputs, outcome, policy)
        if not isinstance(answers, list):
            answers = []  # a response that cannot be read yields fail for every criterion
        results = []
        for index, criterion in enumerate(policy.criteria):
            answer = answers[index] if index < len(answers) and isinstance(answers[index], dict) else {}
            results.append(self._result(
                criterion,
                answer.get("passed") is True,
                str(answer.get("evidence") or "No evidence provided by the verifier"),
                float(answer.get("confidence", 0.5 if answer else 0)),
            ))
        return results

    @staticmethod
    def _verdict(results: list[dict[str, Any]], policy: VerificationPolicy) -> dict[str, Any]:
        """Pass when every required criterion passes and the weighted score reaches the threshold (7.2)"""
        required_pass = all(result["passed"] for result, criterion in zip(results, policy.criteria) if criterion.required)
        total = sum(criterion.weight for criterion in policy.criteria)
        score = sum(c.weight for r, c in zip(results, policy.criteria) if r["passed"]) / total if total > 0 else 0.0
        failed = [r for r in results if not r["passed"]]
        feedback = ("The following criteria were not met:\n"
                    + "\n".join(f"- {r['criterion_name']}: {r['evidence']}" for r in failed)) if failed else ""
        return {
            "criteria_results": results,
            "overall_score": score,
            "verdict": "pass" if required_pass and score >= policy.pass_threshold else "fail",
            "feedback": feedback,
        }

    @staticmethod
    def compute_output_hash(outcome: dict[str, Any]) -> str:
        """SHA-256 of the outcome's canonical JSON (7.5)"""
        return hash_payload(outcome)

    @staticmethod
    def generate_corrective_feedback(record: VerificationRecord) -> str:
        """The failed criteria and their evidence, for the agent's next attempt (7.4)"""
        lines = [f"VERIFICATION FAILED (attempt {record['attempt']}, score: {record['overall_score'] * 100:.0f}%)", ""]
        for result in record["criteria_results"]:
            lines.append(f"{'PASS' if result['passed'] else 'FAIL'} - {result['criterion_name']}: {result['evidence']}")
        if record.get("feedback"):
            lines += ["", "Corrective instructions:", record["feedback"]]
        return "\n".join(lines)
