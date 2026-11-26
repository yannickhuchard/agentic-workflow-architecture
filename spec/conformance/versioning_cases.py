"""
Conformance cases of level `versioning` (specification section 25), called from generate.py.

A case gives two or more versions of one workflow. Most are played by a host step by step:
versions are registered, runs started and brought to a point at rest, a migration is planned,
refused or applied, and the run continued to its end. Where a run must be in a state that a host
cannot be brought to by steps (in the middle of an activity), the case gives the run's `state`
instead and the plan is checked against it, without a host.
"""

START = "2026-05-04T09:00:00Z"


def versioning_cases(Case, uid) -> list[dict]:
    cases = []

    def workflow(case_id, version, build):
        c = Case(case_id, "versioning", "25", "")
        build(c)
        w = c.build()["workflow"]
        w["name"], w["version"] = "Claim", version
        return w

    def node(case_id, name):
        return uid(case_id, name)

    def emit(case_id, spec, description, workflows, steps=None, expect=None, actors=None, journeys=None, state=None, migrate=None):
        case = {"id": case_id, "level": "versioning", "spec": spec, "description": description, "start": START, "workflows": workflows}
        if journeys:
            case["journeys"] = journeys
        if actors:
            case["actors"] = actors
        if state is not None:
            case["state"], case["migrate"] = state, migrate
        else:
            case["steps"] = steps
        case["expect"] = expect or {}
        cases.append(case)

    REVIEW = {"Register": {"output": {"claim_id": "CLM-1"}}, "Review": {"waits": True}, "Settle": {"output": {"paid": True}},
              "Notify": {"output": {"notified": True}}, "Archive": {"output": {"archived": True}}}

    def review_flow(*after):
        """Register, a person reviews, settle; then the activities named, in sequence"""
        def build(c):
            c.act("Register").act("Review", "human").act("Settle").edge("Register", "Review").edge("Review", "Settle")
            previous = "Settle"
            for name in after:
                c.act(name).edge(previous, name)
                previous = name
        return build

    def documents_flow(event_node="Documents", *after):
        """Register, wait for the claim's documents at the event node named, settle; then the activities named"""
        def build(c):
            c.act("Register").act("Settle")
            c.event(event_node, "message", name="documents.uploaded", correlation_key="claim_id")
            c.edge("Register", event_node).edge(event_node, "Settle")
            previous = "Settle"
            for name in after:
                c.act(name).edge(previous, name)
                previous = name
        return build

    # ---- 25.1: a run keeps its version ----------------------------------------------------
    cid = "versioning-runs-keep-the-version-they-started-on"
    v1, v2 = workflow(cid, "1.0.0", review_flow()), workflow(cid, "2.0.0", review_flow("Notify"))
    journey = {"id": uid(cid, "journey"), "name": "Claim", "version": "1.0.0", "subject": {"name": "customer", "key": "customer_id"},
               "stages": [{"id": "open", "name": "Open", "workflows": [v1["id"]]}],
               "triggers": [{"event": "claim.submitted", "starts_journey": True, "start_workflow": v1["id"]}]}
    emit(cid, "25.1", "A run is bound to the version it started on. Once a newer version is registered, runs already under way go on, and finish, on their own version, also after the host restarts; new runs, those a journey's trigger starts among them, start on the newest. A run started with a version named starts on that one.",
         [v1, v2], actors=REVIEW, journeys=[journey], steps=[
             {"register": "1.0.0"},
             {"publish": {"type": "claim.submitted", "data": {"customer_id": "c-1"}}, "as": "r1", "expect": {"version": "1.0.0", "status": "waiting_human"}},
             {"register": "2.0.0"},
             {"publish": {"type": "claim.submitted", "data": {"customer_id": "c-2"}}, "as": "r2", "expect": {"version": "2.0.0", "status": "waiting_human"}},
             {"start": {"input": {"customer_id": "c-3"}, "version": "1.0.0"}, "as": "r3", "expect": {"version": "1.0.0"}},
             {"restart": True},
             {"complete": {"run": "r1", "node": "Review", "output": {"approved": True}}},
             {"complete": {"run": "r2", "node": "Review", "output": {"approved": True}}},
             {"complete": {"run": "r3", "node": "Review", "output": {"approved": True}}},
         ], expect={
             "visited": ["Register", "Review", "Register", "Review", "Register", "Review", "Settle", "Settle", "Notify", "Settle"],
             "runs": {"r1": {"status": "completed", "version": "1.0.0", "journal_excludes": ["run.migrated"]},
                      "r2": {"status": "completed", "version": "2.0.0"},
                      "r3": {"status": "completed", "version": "1.0.0"}},
         })

    cid = "versioning-host-refuses-to-start-without-a-version-a-run-needs"
    v1, v2 = workflow(cid, "1.0.0", review_flow()), workflow(cid, "2.0.0", review_flow("Notify"))
    emit(cid, "25.1", "A host that keeps a run of a version it has not registered refuses to start, and changes nothing; given the version, it takes the run up on it.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"restart": {"versions": ["2.0.0"]}, "expect": {"refused": True}},
             {"restart": {"versions": ["1.0.0", "2.0.0"]}},
             {"complete": {"run": "r1", "node": "Review", "output": {}}},
         ], expect={"runs": {"r1": {"status": "completed", "version": "1.0.0"}}, "visited": ["Register", "Review", "Settle"]})

    # ---- 25.3: migration --------------------------------------------------------------------
    cid = "versioning-identity-migration"
    v1, v2 = workflow(cid, "1.0.0", review_flow()), workflow(cid, "2.0.0", lambda c: (
        c.act("Register").act("Review", "human").act("Archive").act("Settle").edge("Register", "Review").edge("Review", "Archive").edge("Archive", "Settle")))
    emit(cid, "25.3", "Where the new version keeps the node ids, a plan that maps nothing moves a run at rest by the identity mapping: the token waits on at the same node, now of the new version. The migration is one journal event; the run goes on, after a restart too, on the new version.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {}}, "expect": {
                 "applied": True, "dry_run": False, "refusals": [], "status": "waiting_human", "run_version": "2.0.0", "data_changes": [],
                 "tokens": [{"from": "Review", "to": "Review", "wait": "human", "outcome": "kept"}]}},
             {"restart": True},
             {"complete": {"run": "r1", "node": "Review", "output": {"approved": True}}},
         ], expect={
             "visited": ["Register", "Review", "Archive", "Settle"],
             "runs": {"r1": {"status": "completed", "version": "2.0.0",
                             "journal": ["run.started", "token.waiting", "run.migrated", "token.resumed", "activity.completed", "run.completed"],
                             "journal_count": {"run.migrated": 1},
                             "journal_contains": [{"type": "run.migrated", "data": {"from_version": "1.0.0", "to_version": "2.0.0", "nodes": {},
                                                                                    "tokens": [{"from_node_id": node(cid, "Review"), "to_node_id": node(cid, "Review"), "wait": "human", "outcome": "kept"}]}}]}},
         })

    cid = "versioning-mapped-migration"
    v1, v2 = workflow(cid, "1.0.0", documents_flow()), workflow(cid, "2.0.0", documents_flow("Papers", "Notify"))
    emit(cid, "25.3", "A plan maps a node the new version replaced to its replacement. A token waiting for a business event moves to a node that waits for the same event with the same correlation; the event then reaches it there, and the run finishes on the new version.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1", "expect": {"status": "waiting_event"}},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {"to_version": "2.0.0", "nodes": {node(cid, "Documents"): node(cid, "Papers")}}}, "expect": {
                 "applied": True, "refusals": [], "status": "waiting_event", "run_version": "2.0.0",
                 "tokens": [{"from": "Documents", "to": "Papers", "wait": "event", "outcome": "kept"}]}},
             {"publish": {"type": "documents.uploaded", "data": {"claim_id": "CLM-1"}}},
         ], expect={
             "visited": ["Register", "Settle", "Notify"],
             "runs": {"r1": {"status": "completed", "version": "2.0.0",
                             "journal_contains": [{"type": "run.migrated", "data": {"nodes": {node(cid, "Documents"): node(cid, "Papers")}}},
                                                  {"type": "event.received", "node_id": node(cid, "Papers")}]}},
         })

    cid = "versioning-data-transformation"
    v1 = workflow(cid, "1.0.0", review_flow())
    v2 = workflow(cid, "2.0.0", lambda c: (
        c.act("Register").act("Review", "human").act("Fast track").act("Settle")
        .edge("Register", "Review").edge("Review", "Fast track", condition="priority == true").edge("Review", "Settle", is_default=True)))
    emit(cid, "25.3", "A plan's data changes apply to every live token, in order: a value set, a value copied from a path, the result of a condition expression, a property removed. One whose condition does not hold, or whose source is missing, changes nothing. The journal records each change; the new version routes on the new data.",
         [v1, v2], actors={**REVIEW, "Register": {"output": {"claim_id": "CLM-1", "amount": 1500, "legacy_code": "X1"}}}, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {"data": [
                 {"set": "currency", "value": "EUR"},
                 {"set": "total", "from": "amount"},
                 {"set": "priority", "expression": "amount > 1000"},
                 {"remove": "legacy_code"},
                 {"set": "discount", "value": 10, "when": "amount < 100"},
                 {"set": "copied", "from": "nothing.here"},
             ]}}, "expect": {"applied": True, "refusals": [], "data_changes": [
                 {"path": "currency", "change": "set", "value": "EUR"},
                 {"path": "total", "change": "set", "value": 1500},
                 {"path": "priority", "change": "set", "value": True},
                 {"path": "legacy_code", "change": "removed"},
             ]}},
             {"complete": {"run": "r1", "node": "Review", "output": {"approved": True}}},
         ], expect={
             "visited": ["Register", "Review", "Fast track"],
             "runs": {"r1": {"status": "completed", "version": "2.0.0", "data": {"currency": "EUR", "total": 1500, "priority": True, "amount": 1500},
                             "data_absent": ["legacy_code", "discount", "copied"],
                             "journal_contains": [{"type": "run.migrated", "data": {"data_changes": [
                                 {"path": "currency", "change": "set", "value": "EUR"}, {"path": "total", "change": "set", "value": 1500},
                                 {"path": "priority", "change": "set", "value": True}, {"path": "legacy_code", "change": "removed", "previous": "X1"}]}}]}},
         })

    cid = "versioning-refuses-an-unmapped-token"
    v1 = workflow(cid, "1.0.0", documents_flow())
    v2 = workflow(cid, "2.0.0", lambda c: c.act("Register").act("Settle").edge("Register", "Settle"))
    emit(cid, "25.3", "A token waits at a node the new version does not have, and the plan does not say where it goes: the migration is refused, naming the token, and nothing changes. The run goes on and finishes on its own version.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {}}, "expect": {"applied": False, "refusals": ["unmapped_token"], "run_version": "1.0.0", "run_status": "waiting_event"}},
             {"publish": {"type": "documents.uploaded", "data": {"claim_id": "CLM-1"}}},
         ], expect={"visited": ["Register", "Settle"], "runs": {"r1": {"status": "completed", "version": "1.0.0", "journal_excludes": ["run.migrated"]}}})

    cid = "versioning-refuses-when-a-waiting-human-task-loses-its-node"
    v1 = workflow(cid, "1.0.0", review_flow())
    v2 = workflow(cid, "2.0.0", lambda c: (
        c.act("Register").act("Automated review", "ai_agent").act("Settle").edge("Register", "Automated review").edge("Automated review", "Settle")))
    emit(cid, "25.3", "A person's task waits at a node the new version replaced by an agent's. Unmapped, the token has nowhere to go; mapped to the agent's activity, the person's task would mean nothing there. Both are refused. A plan that restarts the token withdraws the task: the token starts afresh at the new node and the run goes on at once.",
         [v1, v2], actors={**REVIEW, "Automated review": {"output": {"approved": True}}}, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {}}, "expect": {"applied": False, "refusals": ["unmapped_token"], "run_version": "1.0.0"}},
             {"migrate": {"run": "r1", "plan": {"nodes": {node(cid, "Review"): node(cid, "Automated review")}}},
              "expect": {"applied": False, "refusals": ["wait_incompatible"], "run_version": "1.0.0", "run_status": "waiting_human"}},
             {"migrate": {"run": "r1", "plan": {"nodes": {node(cid, "Review"): node(cid, "Automated review")}, "restart": [node(cid, "Review")]}},
              "expect": {"applied": True, "refusals": [], "run_version": "2.0.0", "status": "completed",
                         "tokens": [{"from": "Review", "to": "Automated review", "wait": "human", "outcome": "restarted"}]}},
         ], expect={
             "visited": ["Register", "Review", "Automated review", "Settle"],
             "runs": {"r1": {"status": "completed", "version": "2.0.0", "journal_count": {"run.migrated": 1},
                             "journal_contains": [{"type": "run.migrated", "data": {"restart": [node(cid, "Review")]}}]}},
         })

    cid = "versioning-refuses-a-run-in-the-middle-of-an-activity"
    v1 = workflow(cid, "1.0.0", lambda c: (
        c.act("Register").act("Assess", "ai_agent").act("Settle").edge("Register", "Assess").edge("Assess", "Settle")))
    v2 = workflow(cid, "2.0.0", lambda c: (
        c.act("Register").act("Assess", "ai_agent").act("Settle").act("Notify").edge("Register", "Assess").edge("Assess", "Settle").edge("Settle", "Notify")))
    emit(cid, "25.2", "A run with a token in the middle of an activity is not at rest. Even with the identity mapping, its migration is refused, naming the token and the activity.",
         [v1, v2], state={"version": "1.0.0", "status": "running", "tokens": [{"id": "6f7c1a52-2f0e-4c35-9d55-0c0c1f0b1a01", "node": "Assess", "status": "active", "data": {"claim_id": "CLM-1"}}]},
         migrate={"plan": {"to_version": "2.0.0"}}, expect={"refusals": ["run_in_activity"], "refused_tokens": ["6f7c1a52-2f0e-4c35-9d55-0c0c1f0b1a01"]})

    cid = "versioning-a-timer-is-a-position-at-rest"

    def timed(*after):
        def build(c):
            c.act("Register").act("Settle").event("Cool off", "timer", duration="P1D").edge("Register", "Cool off").edge("Cool off", "Settle")
            for name in after:
                c.act(name).edge("Settle", name)
        return build
    v1, v2 = workflow(cid, "1.0.0", timed()), workflow(cid, "2.0.0", timed("Notify"))
    emit(cid, "25.2", "A token at a timer whose due time is fixed waits for time to pass: the run is at rest and moves by the identity mapping, keeping the due time.",
         [v1, v2], state={"version": "1.0.0", "status": "running", "tokens": [
             {"id": "6f7c1a52-2f0e-4c35-9d55-0c0c1f0b1a02", "node": "Cool off", "status": "active", "data": {"claim_id": "CLM-1"}, "waits": {"kind": "timer", "due_at": "2026-05-05T09:00:00.000Z"}}]},
         migrate={"plan": {"to_version": "2.0.0"}}, expect={"refusals": [], "tokens": [{"from": "Cool off", "to": "Cool off", "wait": "timer", "outcome": "kept"}],
                                                          "timers": {"6f7c1a52-2f0e-4c35-9d55-0c0c1f0b1a02": "2026-05-05T09:00:00.000Z"}})

    cid = "versioning-dry-run-changes-nothing"
    v1, v2 = workflow(cid, "1.0.0", review_flow()), workflow(cid, "2.0.0", review_flow("Archive"))
    emit(cid, "25.3", "A dry run reports what a migration would do, token by token, and changes nothing: the run stays on its version, and its journal does not record it.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {"data": [{"set": "currency", "value": "EUR"}]}, "dry_run": True}, "expect": {
                 "applied": False, "dry_run": True, "refusals": [], "status": "waiting_human", "run_version": "1.0.0",
                 "tokens": [{"from": "Review", "to": "Review", "wait": "human", "outcome": "kept"}],
                 "data_changes": [{"path": "currency", "change": "set", "value": "EUR"}]}},
             {"complete": {"run": "r1", "node": "Review", "output": {}}},
         ], expect={"visited": ["Register", "Review", "Settle"],
                    "runs": {"r1": {"status": "completed", "version": "1.0.0", "data_absent": ["currency"], "journal_excludes": ["run.migrated"]}}})

    cid = "versioning-refusal-names-every-reason"
    v1, v2 = workflow(cid, "1.0.0", review_flow()), workflow(cid, "2.0.0", review_flow("Archive"))
    emit(cid, "25.3", "A plan is checked whole before anything changes, and every reason it cannot be applied is named: a version the run is not on, a node the old version does not have, a node the new one does not have, a property reserved to the engine, a condition that is not one. A version not registered, and the version the run is already on, are refused too.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"migrate": {"run": "r1", "plan": {"from_version": "0.9.0", "nodes": {node(cid, "Nowhere"): node(cid, "Review"), node(cid, "Review"): node(cid, "Elsewhere")},
                                                "data": [{"set": "_secret", "value": 1}, {"set": "flag", "expression": "amount >"}]}},
              "expect": {"applied": False, "refusals": ["invalid_assignment", "invalid_assignment", "unknown_source", "unknown_target", "wrong_version"], "run_version": "1.0.0"}},
             {"migrate": {"run": "r1", "plan": {"to_version": "3.0.0"}}, "expect": {"applied": False, "refusals": ["unknown_version"]}},
             {"migrate": {"run": "r1", "plan": {"to_version": "1.0.0"}}, "expect": {"applied": False, "refusals": ["same_version"]}},
             {"complete": {"run": "r1", "node": "Review", "output": {}}},
             {"migrate": {"run": "r1", "plan": {}}, "expect": {"applied": False, "refusals": ["run_ended"]}},
         ], expect={"runs": {"r1": {"status": "completed", "version": "1.0.0", "journal_excludes": ["run.migrated"]}}})

    # ---- 25.4: compatibility ----------------------------------------------------------------
    cid = "versioning-classifies-positions"
    v1 = workflow(cid, "1.0.0", lambda c: (
        c.act("Register").act("Review", "human").act("Settle")
        .event("Documents", "message", name="documents.uploaded", correlation_key="claim_id").event("Cool off", "timer", duration="PT1H")
        .edge("Register", "Review").edge("Review", "Documents").edge("Documents", "Cool off").edge("Cool off", "Settle")))
    v2 = workflow(cid, "2.0.0", lambda c: (
        c.act("Register").act("Review", "human").act("Settle")
        .event("Papers", "message", name="documents.uploaded", correlation_key="claim_id")
        .edge("Register", "Review").edge("Review", "Papers").edge("Papers", "Settle")))
    emit(cid, "25.4", "Two versions compared position by position. A position whose node the new version keeps, with a wait that keeps its meaning, is compatible. One whose node is gone, where another node of the new version would keep the wait, needs a mapping, and the candidates are named. One that no node of the new version can keep is impossible. A plan that maps the first and restarts the second makes every position compatible. A run at a compatible position can be moved, whatever the other positions are.",
         [v1, v2], actors=REVIEW, steps=[
             {"register": "1.0.0"},
             {"start": {}, "as": "r1"},
             {"register": "2.0.0"},
             {"check": {"to_version": "2.0.0"}, "expect": {
                 "automatic": False,
                 "positions": [{"node": "Review", "wait": "human", "class": "compatible", "to": "Review"},
                               {"node": "Documents", "wait": "event", "class": "needs_mapping", "candidates": ["Papers"]},
                               {"node": "Cool off", "wait": "timer", "class": "impossible"}],
                 "runs": [{"run": "r1", "migratable": True}]}},
             {"check": {"to_version": "2.0.0", "plan": {"nodes": {node(cid, "Documents"): node(cid, "Papers"), node(cid, "Cool off"): node(cid, "Settle")}, "restart": [node(cid, "Cool off")]}},
              "expect": {"automatic": True,
                         "positions": [{"node": "Review", "wait": "human", "class": "compatible", "to": "Review", "outcome": "kept"},
                                       {"node": "Documents", "wait": "event", "class": "compatible", "to": "Papers", "outcome": "kept"},
                                       {"node": "Cool off", "wait": "timer", "class": "compatible", "to": "Settle", "outcome": "restarted"}],
                         "runs": [{"run": "r1", "migratable": True}]}},
         ], expect={"runs": {"r1": {"status": "waiting_human", "version": "1.0.0"}}})

    return cases
