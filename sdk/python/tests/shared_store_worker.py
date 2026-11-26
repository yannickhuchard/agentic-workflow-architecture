"""
One host in a process of its own, for the shared store tests of both SDKs:
python3 shared_store_worker.py <plan.json>, with sdk/python on PYTHONPATH.

The plan names the store, the host, the events it is given in order, how often
it lets time pass, and which activities are slow. When a slow activity begins
the worker writes "HOLDING" on a line, so that a test can stop it in the middle
of that operation. At the end it writes one line of JSON: what it accepted,
what failed, and what its ticks did.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from awa.runtime.postgres_store import open_runtime_store
from awa.types import ActorType
from tests.shared_store_load import LoadActor


def main() -> None:
    with open(sys.argv[1], encoding="utf-8") as handle:
        plan = json.load(handle)

    def holding(_: str) -> None:
        sys.stdout.write("HOLDING\n")
        sys.stdout.flush()

    actor = LoadActor(plan.get("slow"), holding)
    options = {"host_id": plan["host_id"]}
    if plan.get("lease_ms"):
        options["lease_ms"] = plan["lease_ms"]
    runtime = open_runtime_store(plan["url"], engine={"actors": {t: actor for t in ActorType}, "sleep": lambda ms: None}, **options)
    accepted, refused, failures, timed_out, stalled = [], [], [], 0, 0
    for n, event in enumerate(plan["queue"]):
        try:
            (accepted if runtime.publish(event)["accepted"] else refused).append(event["id"])
        except Exception as error:  # noqa: BLE001 - reported, not raised: the test decides
            failures.append({"id": event["id"], "error": str(error)})
        if plan.get("tick_every") and n % plan["tick_every"] == 0:
            result = runtime.tick()
            timed_out += len(result["timed_out_runs"])
            stalled += len(result["stalled_journeys"])
    runtime.close()
    sys.stdout.write(json.dumps({"host_id": plan["host_id"], "accepted": accepted, "refused": refused, "failures": failures,
                                 "timed_out": timed_out, "stalled": stalled}) + "\n")


if __name__ == "__main__":
    main()
