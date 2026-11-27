---
name: show
description: Show an AWA workflow as a graph with the AWA MCP server, with its actors, decisions, events and the data that moves between activities. Use when the user asks to show, draw, explain or review an .awa.json workflow.
argument-hint: "<workflow file>"
disable-model-invocation: true
---

# Show an AWA workflow

Arguments: $ARGUMENTS

1. Read the workflow file named. If none is named, use the `.awa.json` file open in the editor, or ask for one.
2. Call the `show_workflow` tool of the `awa` MCP server with the parsed JSON as `workflow`. The server takes documents inline: pass the content, never a path.
3. Clients that support MCP Apps open the workflow view. In every client, answer from the tool's summary: the counts of activities, decisions, events and roles, who does what (human, AI agent, robot, application), and which data each decision reads.
4. If the tool reports that the document is not a valid workflow, call `validate_document` and report its problems instead.
