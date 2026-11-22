# AWA Workflows & Journeys: support

Publisher: **Yannick Huchard** ([GitHub profile](https://github.com/yannickhuchard)).

Use the [issues of this repository](https://github.com/yannickhuchard/agentic-workflow-architecture/issues) for questions, defects and requests. Support is best effort; no response time is promised.

When you report a problem, give the client and its version, the tool you called, what you expected and what happened, and the smallest document that shows it. Use made-up data: do not post personal data, credentials or confidential documents. For a security problem, ask in an issue for a private channel without describing the weakness.

## First steps

Ask your client:

> Load the AWA claims example and walk me through one customer's journey.

The journey view opens with three journeys and six fictional customers. Then try, with a document of your own pasted into the conversation:

> Validate this AWA workflow, then show it as a graph with the data that moves.

> Simulate a run of this AWA workflow and replay the path it takes.

## Common questions

**The embedded view does not appear.** The view needs a client that supports MCP Apps. Without it the tools still answer in text. Check that the plugin is connected and that your client is up to date.

**A simulated run fails with NO_ROUTE or CONTRACT_VIOLATION.** A simulated activity returns no business data unless you script it. Ask the assistant to supply `simulated_outputs` for the activities named in the failure: the fields that conditions, decision tables and outcome contracts read.

**A run stays "waiting for an event".** The workflow waits for a business event. Give the event in `events`, or ask for waits to be allowed to time out.

**No journey starts.** A journey begins with an event that one of its triggers marks `starts_journey`, and the event's data must carry the property that identifies the subject (the journey's `subject.key`, for example `customer_id`).

**"The document is refused: it is … kB as JSON."** One document may be up to 400 kB, a portfolio export up to 900 kB, and a whole request to a hosted server up to 1 MB.

**Can it run my workflow for real, call my APIs or read a file or address?** No. The service only simulates, takes documents inline, and stores nothing. To execute workflows, use the AWA SDK and command line in this repository on your own systems.

**Where is my data?** Nowhere on the server once the call has returned. See the [privacy notice](PRIVACY.md).

## More

- [AWA specification](../../../docs/specification.md)
- [Server documentation](../README.md)
- [Terms of use](TERMS.md)
