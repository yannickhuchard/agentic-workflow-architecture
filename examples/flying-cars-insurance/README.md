# Flying Cars Insurance Product Design Workflow

This example demonstrates how to design a flying cars (eVTOL) insurance product using the **Agentic Workflow Architecture (AWA)**. 

Flying cars present complex, high-risk, and unmapped insurance challenges. To design a viable insurance product, this workflow models a multi-agent collaboration with a human-in-the-loop sign-off.

## Workflow Structure

```mermaid
graph TD
    A[Research & Market Analysis<br/><i>Actor: Market Analyst (AI)</i>] -->|Research complete| B[Design Coverage & Guarantees<br/><i>Actor: Product Designer (AI)</i>]
    B -->|Coverages designed| C[Establish Underwriting Rules<br/><i>Actor: Risk Underwriter (AI)</i>]
    C -->|Rules established| D[Draft Offering Proposal<br/><i>Actor: Commercial Officer (AI)</i>]
    D -->|Proposal drafted| E[Generate IPID Document<br/><i>Actor: Commercial Officer (AI)</i>]
    E -->|IPID generated| F[Final Underwriter Sign-Off<br/><i>Actor: Chief Underwriter (Human)</i>]
```

### Stages & Actor Roles

1. **Research & Market Analysis (`ai_agent`)**: Gathers and evaluates safety logs, battery hazard data (thermal runaway issues), and FAA/EASA airworthiness rules.
   * *Verification Policy*: AI-as-Judge verifies that the findings are specific to eVTOL (not standard cars) and cover key battery risks.
2. **Design Coverage & Guarantees (`ai_agent`)**: Formulates bespoke coverages like Hull Protection, Aviation Liability, Cyber Risks (software dependencies), and Vertiport Premises Liability.
   * *Verification Policy*: AI-as-Judge verifies that Hull, Cyber, Third-Party, and Passenger liabilities are all defined.
3. **Establish Underwriting Rules (`ai_agent`)**: Establishes risk policies, pilot training minimums, geographic bounds (geofencing), and battery telemetry health tracking.
   * *Verification Policy*: AI-as-Judge verifies minimum pilot certification and flight hour requirements.
4. **Draft Offering Proposal (`ai_agent`)**: Drafts a commercial proposal package for a showcase client (`SkyTaxi UAM Corp`) with an estimated premium calculation.
5. **Generate IPID Document (`ai_agent`)**: Automatically compiles a consumer-friendly Insurance Product Information Document (IPID) detailing coverage, exclusions, and commitments.
6. **Final Underwriter Sign-Off (`human`)**: A human Chief Underwriter reviews the generated proposal and IPID, granting binding signatures.

## Running the Example

You can execute this workflow using the provided test runner script.

### Prerequisites

1. Install dependencies:
   ```bash
   cd sdk/typescript
   npm install
   ```

2. Compile the SDK:
   ```bash
   npm run build
   ```

3. Set up your Gemini API key (optional, otherwise runs in simulation mode):
   ```bash
   export GEMINI_API_KEY=your_key_here
   ```

### Execution

Run the TypeScript script:
```bash
npx tsx examples/flying-cars-insurance/run-flying-cars.ts
```

If a real `GEMINI_API_KEY` is present, the workflow will make real calls to `gemini-3-flash-preview` to perform research, write product coverages, assess risk parameters, format proposals, generate the IPID, and output the complete product payload. The script will intercept the human stage, fetch the task, and sign it off programmatically using `TaskService`.

If no key is present, it runs in **Simulation Mode** using AWA's built-in simulation execution.
