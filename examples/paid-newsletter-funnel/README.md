# Paid Newsletter Sales Funnel — AWA Example

A **fully automated, end-to-end sales funnel** for paid newsletter registration, powered by Gemini-based AI agents with **native verification** at every step.

## Overview

This workflow demonstrates how AWA orchestrates 6 specialized AI agents to take a prospect from initial interest to paid subscriber — with **zero human intervention** and **provable quality guarantees** on every output.

```
┌─────────────────┐     ┌───────────────────┐     ┌─────────────────────┐
│  Qualify Lead    │────▶│ Welcome Email     │────▶│ Trial Content       │
│  (AI + Verify)  │     │ (AI + Verify)     │     │ (AI + Verify)       │
└─────────────────┘     └───────────────────┘     └─────────────────────┘
                                                           │
┌─────────────────┐     ┌───────────────────┐              │
│  Onboarding     │◀────│ Process Payment   │◀─────────────┘
│  Sequence       │     │ (AI + Verify)     │     ┌─────────────────────┐
│  (AI + Verify)  │     └───────────────────┘◀────│ Landing Page        │
└─────────────────┘                               │ (AI + Verify)       │
                                                  └─────────────────────┘
```

## Funnel Steps

| Step | Activity | AI Agent Role | Verification Criteria |
|------|----------|---------------|----------------------|
| 1 | **Qualify Lead** | Lead Qualification Agent (temp: 0.3) | Structured output, score justification, valid segment |
| 2 | **Generate Welcome Email** | Email Copywriter Agent (temp: 0.7) | Personalization, CTA, CAN-SPAM compliance, tone |
| 3 | **Trial Content Preview** | Content Strategy Agent (temp: 0.8) | Interest alignment, teaser effectiveness, quality |
| 4 | **Landing Page** | Landing Page Builder Agent (temp: 0.5) | HTML validity, pricing section, conversion elements |
| 5 | **Process Payment** | Payment Processing Agent (temp: 0.2) | Subscription record, receipt completeness, no raw card data |
| 6 | **Onboarding Sequence** | Email Copywriter Agent (temp: 0.7) | Three emails, progressive timing, content progression |

## Verification in Action

Every activity has an `ai_judge` verification policy. After each AI agent executes:

1. **Gemini evaluates** the output against declared acceptance criteria
2. If criteria fail → **corrective feedback** is injected into the prompt
3. The agent **re-executes** with the feedback (up to `max_retries`)
4. A **tamper-proof VerificationRecord** (SHA-256 hashed) is produced

**Example: Payment step verification ensures PCI-DSS compliance** — the judge checks that no raw credit card numbers appear in the output, preventing data leaks even if the AI agent hallucinates card data.

## Running the Workflow

### Prerequisites

```bash
# Set Gemini API key
export GEMINI_API_KEY=your_api_key_here

# Navigate to SDK
cd sdk/typescript
```

### Option 1: CLI (JSON Workflow)

```bash
# Run the pre-built workflow JSON
npx awa run ../../examples/paid-newsletter-funnel/workflow.awa.json --verbose --key $GEMINI_API_KEY
```

### Option 2: TypeScript Builder

```bash
# Run the builder script to generate and inspect the workflow
npx tsx ../../examples/paid-newsletter-funnel/build_workflow.ts
```

### Providing Prospect Data

Pass prospect data as initial context when starting the workflow:

```typescript
import { WorkflowEngine } from './src/runtime/workflow_engine';

const engine = new WorkflowEngine(workflow, {
    geminiApiKey: process.env.GEMINI_API_KEY,
    roles: roles,
    verbose: true,
});

await engine.start({
    prospect_name: 'Alice Johnson',
    prospect_email: 'alice@example.com',
    interests: ['AI strategy', 'machine learning', 'product management'],
    referral_source: 'LinkedIn organic',
});

// Run all steps
while (engine.getStatus() === 'running') {
    await engine.runStep();
}
```

## Verification Configuration

Each activity's verification policy is tuned for its specific needs:

| Activity | Mode | Retries | Threshold | Judge Temp |
|----------|------|---------|-----------|------------|
| Qualify Lead | `ai_judge` | 3 | 90% | 0.1 |
| Welcome Email | `ai_judge` | 3 | 90% | 0.1 |
| Trial Content | `ai_judge` | 2 | 90% | 0.1 |
| Landing Page | `ai_judge` | 3 | 90% | 0.1 |
| Payment | `ai_judge` | 2 | 90% | 0.1 |
| Onboarding | `ai_judge` | 2 | 90% | 0.1 |

> Low judge temperature (0.1) ensures **deterministic, consistent** verification verdicts.

## Compliance Controls

| Control | Step | Enforcement |
|---------|------|-------------|
| GDPR Email Consent | Lead Qualification | Mandatory |
| CAN-SPAM Compliance | Welcome Email, Onboarding | Mandatory |
| Accessibility (WCAG 2.1 AA) | Landing Page | Advisory |
| PCI-DSS (No Raw Card Data) | Payment Processing | Mandatory |

## Files

| File | Description |
|------|-------------|
| `workflow.awa.json` | Complete workflow definition (JSON) |
| `build_workflow.ts` | TypeScript builder version (fluent API) |
| `README.md` | This documentation |

## Key AWA Features Demonstrated

- ✅ **Native Activity Verification** — AI-as-judge with retry-until-pass
- ✅ **Specialized AI Roles** — 5 distinct roles with tailored temperatures and prompts
- ✅ **Compliance Controls** — GDPR, CAN-SPAM, PCI-DSS, WCAG enforcement
- ✅ **Access Rights** — Stripe API access declaration on payment step
- ✅ **Skills & Tool Requirements** — Cognitive capabilities + external API dependencies
- ✅ **Shared Context** — Funnel state tracking across all steps
- ✅ **Corrective Feedback Loop** — Failed outputs are retried with judge feedback
- ✅ **Tamper-Proof Records** — SHA-256 hashed verification records for auditability
