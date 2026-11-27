---
name: validate
description: Validate an AWA workflow or journey document with the AWA MCP server and explain each problem in plain words. Use when the user asks to check, validate or lint an .awa.json workflow or a .journey.json journey.
argument-hint: "<workflow or journey file> [workflow files a journey refers to]"
disable-model-invocation: true
metadata:
  internal: true
---

# Validate an AWA document

Arguments: $ARGUMENTS

1. Read the file named first. If no file is named, use the AWA document open in the editor, or ask for one. AWA workflows usually end in `.awa.json`, journeys in `.journey.json`.
2. Call the `validate_document` tool of the `awa` MCP server with the parsed JSON as `document`. The server takes documents inline: pass the content, never a path or an address.
3. For a journey, also read the workflow documents it refers to (the other files named, or the `.awa.json` files beside it whose `id` the journey names) and pass them as `workflows`.
4. Report the result: valid or not, then each problem with where it is, in the order the tool gives them. For each problem, propose the smallest change to the file that fixes it, and make the change only if the user asks.

If the `awa` tools are not available, say that the AWA MCP server is not connected and point to `docs/guides/connect-ai-assistants.md` in the AWA repository.
