# AWA Workflows & Journeys: privacy

Publisher: **Yannick Huchard**. Plugin: **AWA Workflows & Journeys** (`awa-workflows`), an MCP server for the open standard Agentic Workflow Architecture. Updated 22 November 2026.

This notice describes what the server in this repository does with data. It applies to a deployment run by the publisher. Someone else who runs their own copy is responsible for their deployment.

> **To confirm before submission.** No public deployment exists yet. The hosting provider, its region and its log retention are not chosen, and this notice gives no private contact address. The sections marked *to confirm* must be completed by the publisher once the service is hosted.

## What the server receives

When a conversation uses one of the tools, the client sends the tool's arguments to the server: AWA workflow and journey documents, business events with their data, the outputs you script for simulated activities, and a portfolio export if you give one. These may contain whatever you put in them. Do not put personal data, credentials or confidential documents in them unless you are entitled to and it is necessary.

## What the server does with it

- It computes the answer: a validation report, a description of a workflow, a simulated run, or simulated journeys.
- It keeps the arguments and the result in memory only for the duration of that one call. Nothing is written to a database or to a file. The next call starts from nothing; the server cannot show you, or anyone else, the data of an earlier call.
- It runs simulations only. It does not execute the tools, commands, HTTP calls or programs that a document names, does not call an AI model, and opens no network connection on behalf of a document.
- It has no accounts and no sign-in. It sets no cookie and contains no analytics or tracking code.
- The application writes no log of tool arguments or results.

## The embedded views

The views shown in the conversation (workflow graph, run replay, journey view) are self-contained pages. They receive their data from the client that hosts them and make no network request. They are declared to the host with an empty list of permitted network domains, and they disable their own network functions when they start.

## The bundled example

The claims example (six customers, three journeys) is fictional. Its names, claims and amounts were written for the example and its records were produced by a scripted simulation.

## Hosting and other parties

- *To confirm:* the hosting provider that runs the server receives network traffic and may keep technical logs (time, address of the caller, size and status of requests) under its own terms. Provider, region and retention: not yet chosen.
- The AI client you use (for example ChatGPT or Claude) processes your conversation, the tool arguments it sends and the results it receives under its own terms and your settings with it. This notice does not cover that processing.
- GitHub hosts the source code and the issue tracker. What you post in a public issue is public.

## Your choices

Because nothing is stored by the server, there is nothing to export or delete on it. To stop using the plugin, disconnect it in your client's settings. For conversation history, use your client's controls.

## Questions

Open an issue at <https://github.com/yannickhuchard/agentic-workflow-architecture/issues>. Do not include personal or confidential data in an issue. *To confirm:* a private contact address for privacy requests.

## Changes

A release that starts to store data, adds accounts or adds any collection will change this notice before it is deployed.
