# UX research: a dashboard over journeys and agentic workflows

Status: desk research and analysis of recorded data, November 2026. **No users were interviewed or observed.** The readers below are the proto-personas of the journey research (`journey-visualisation-research.md`, section 3), with what the simulated sessions of that research taught about them (its section 12). Those sessions were simulations, not sessions with people. This document comes before the design; section 9 says how to test what follows from it.

## 1. The question

AWA records what happens to each customer (journeys, specification section 19) and how each piece of work was done (run journals, section 9). The journey view shows one customer and one run very well. It does not answer questions about *many*: how many finish, where they stop, how long the work waits, what it costs, whether last month was better.

Specification section 21 now fixes the measures. The question here is what to put in front of a person, in what order, so that a number leads to an action and to its evidence, and so that the page is not a wall of gauges.

## 2. Method and its limits

| Done | Not done |
|---|---|
| Computed all 55 measures of section 21 on the example portfolio (`examples/claims-journey`: 3 journeys, 18 journey instances, 25 runs, 5 workflows) and read what each can and cannot say | Interviews, observation, surveys |
| Mapped each reader's questions to measures, and looked for questions with no measure and measures with no question | Usability tests of any design |
| Compared four bodies of practice that already measure this kind of thing (section 4) | Analytics on how a dashboard is used |
| Re-read the findings of the simulated sessions on the journey view for what applies to numbers | Tests at volume: 18 journeys say nothing about 18 000 |

## 3. Who reads, and what they ask

| Who | Comes with | Measures that answer | Leaves with |
|---|---|---|---|
| **Operations lead** | Who is stuck right now, and whose is it? | Attention list: stalled journeys, stage, owner, since when, reason | A name to call, per stuck customer |
| **Journey owner** | Where do we lose customers? Is it getting better? | Per stage: entered, conversion, time, outlasted its time, abandoned here. Completion, abandonment, goal attainment over time | The stage that loses most, and an example to show |
| **Workflow designer / AI engineer** | Which workflow fails or reworks? Which step? Which tool? Did the model decide, or the table? | Success, right first time, retries, dead letters; per activity failure rate and duration; tool failure; decisions by method and default rate; contract and verification pass rates | One step or tool to fix, and the runs that show it |
| **Sponsor** (owns the budget for the automation) | What does it cost, how much runs without a person, how long do customers wait? | Cost per journey and per run, tokens, done without a person, lead time against work time | Three numbers and their direction |
| **Customer experience** | How do customers feel at the end, and do we know or guess? | Mood at the end and its spread, change of mood, share that was measured | A statement they can defend, with its basis |
| **Auditor / risk** | Can I trust these numbers? | The rule of each measure, what it was computed over, and the records behind it | Each number traced to journeys and journal records |

The case handler of the journey research does not appear: a person serving one customer needs that customer's story, which the journey view gives. A dashboard is not their tool, and it should hand them over to it rather than imitate it.

Two things follow, as they did for the journey view.

**The dashboard is an entrance, not a destination.** Every reader above leaves with something *specific*: a customer, a stage, a step, a run. A number that cannot be opened into the journeys behind it is a dead end, and with 18 journeys it is also an anecdote.

**Readers arrive with different first questions.** Operations wants the list of who is stuck before any chart. The sponsor wants three numbers. If the page opens on one reader's view, the others must find theirs in one step.

## 4. What existing practice offers

| Practice | What it measures | What carries over | What does not |
|---|---|---|---|
| **Customer experience**: funnels, satisfaction (CSAT), recommendation (NPS), effort (CES) | Conversion between steps; a survey answer per customer | The funnel per stage is the natural picture of a journey definition. Satisfaction is what `sentiment` records when it is measured | A single score for "the experience". AWA's mood is mostly *inferred by rule* (19.9); a mean of inferred values presented as satisfaction would be a fabrication |
| **Lean and process mining**: lead time, touch time, flow efficiency, first-pass yield, rework | Where the time goes and how often work is redone | Lead time against work time is the most telling picture in the example: work is minutes, waiting is days. First-pass yield maps exactly to runs with no failed attempt, retry or compensation | Process discovery. AWA already has the model; nothing needs to be mined |
| **Service operations**: backlog, ageing, breach of service level | What is open, how old, how much is late | "Outlasted its time" per stage is a breach rate. Ageing is the right order for the attention list | Agent utilisation and occupancy: the actors are mostly software |
| **Site reliability and model operations**: rate, errors, duration; tokens, cost, tool error rate, human hand-off rate, evaluation pass rate | Health of a service; cost and quality of model calls | Errors by code, tool failures, cost and tokens, contract and verification pass rates are the health of an agentic workflow. The OpenMetrics exposure (21.6) lets an existing monitoring system carry the alerting | Percentile latency in milliseconds: at the scale of a claim, the wait for a person or a customer dwarfs it |

On the form of a dashboard, established guidance is consistent (Few, *Information Dashboard Design*; Tufte on data-ink): one screen that can be taken in at a glance for monitoring; comparisons rather than bare numbers; no dials, no decoration; the exception before the average. And one warning from measurement in general (Goodhart): a measure that becomes a target is gamed. Completion rate rises if journeys are defined to end early; "right first time" rises if retries are not recorded. A page that shows the rule and the count beside each number makes that harder to do quietly.

## 5. Findings from the data

Computed on the example portfolio with `awa measures --file examples/claims-journey/journeys.json`.

1. **Almost all of the time is waiting.** Flow efficiency over all runs is 0.1%: the median run works for 6 minutes and lasts 2 days. The waits are for the customer (median 24 h, and 18% of awaited events never came) and for a person (median 24 h; 3 days for the adjuster). A dashboard that shows activity durations first would show the one thing that does not matter.
2. **The mood is mostly a guess, and the mean hides the story.** 2 of 29 changes of mood were measured (7%). The renewal journey ends at a mean of −0.08, which reads as "neutral"; the six endings are −2, −1.5, −1, +0.5, +1.5, +2. The spread is the finding. The sessions on the journey view found that all five simulated participants took inferred mood as fact until told otherwise.
3. **Small numbers everywhere.** "50% completion" of the claim journey is 3 of 6. Every rate in the example is over fewer than 30. A percentage without its count would mislead, and a trend line through weeks with zero or one journey would be noise.
4. **A run can succeed while the customer is lost.** The renewal workflow has an 83% success rate (5 of 6 runs completed); a third of renewal customers were lost, and one of them by a run that *completed*: it ran its "lapse policy" branch to the end. Run status is about the machinery. The outcome is the journey's goal. The two must sit side by side and never be merged into one "health".
5. **Journeys in progress bend the rates.** Completion rate is over journeys started, so recent periods always look worse: their journeys have not had time to finish. Two of the six claims are still open.
6. **Stalls had no owner.** The sessions found "someone needs to act" named nobody. Stages can now name an `owner`. When this was written the example named none; it now names one for three of its eight stages. Most stages in most organisations will have none at first, so the page must say "no owner named" rather than leave a blank that reads as a rendering fault.
7. **Cost is real but tiny in the example** (EUR 0.18 for 25 runs). Shown as "EUR 0.00" it is useless; shown with too many digits it looks precise. Cost per journey with a sensible number of significant figures is the unit that travels.
8. **Some questions have no measure.** What a lapse cost in premium. Whether the customer who complained was the one whose claim was slow (that is a path, shown in the journey view's atlas). Why a number moved. These are stated on the page as not answered rather than approximated.

## 6. Requirements

| # | Requirement | From |
|---|---|---|
| D1 | The page opens on what needs someone now: each stuck journey with customer, stage, how long, reason, and owner or "no owner named" | 3 (operations), 5.6 |
| D2 | Every number opens the journeys or runs it was computed over, and from there the journey view at that customer | 3, 5.3 |
| D3 | Every rate shows its count. Below a threshold (ten) the count is as prominent as the percentage, and the percentage is not coloured good or bad | 5.3 |
| D4 | A measure with nothing behind it reads "no value", never 0 | 21.1 |
| D5 | Journey outcome and run status are shown separately and named differently ("customers who reached the goal", "runs that completed") | 5.4 |
| D6 | Mood is shown as a spread, with the share that was measured stated beside it; an entirely inferred mood is labelled as inferred in the same visual language as the journey view (dashed) | 5.2 |
| D7 | Time is shown as lead time split into work and waiting, with who was waited for | 5.1 |
| D8 | Per journey, the stages in order with entered, moved on, left here, stuck here, median time and breach of the stage's time | 3 (journey owner) |
| D9 | Per workflow, the steps and tools ranked by failure, and decisions by who decided (table, model, default) | 3 (engineer) |
| D10 | Three numbers for the sponsor, reachable without scrolling: cost per journey, done without a person, lead time | 3 (sponsor) |
| D11 | The period can be changed; recent periods state how many of their journeys are still in progress | 5.5 |
| D12 | The rule of each measure can be read in place | 3 (auditor), 4 |
| D13 | The page works from a file, from a running host, and inside a chat assistant's panel, at widths from a phone to a wide screen, in light and dark, without network access | brief |
| D14 | The words are the readers': "stuck" for stalled, "left" for abandoned, "right first time" for first-pass yield, "done without a person" for automation rate | journey sessions 12.4 |
| D15 | No single score of health, no dials, no decorative chart | 4 |

## 7. Design principles

### 7.1 Order: exception, outcome, cause, cost

The page reads top to bottom as four questions, each a band:

1. **Who needs someone now?** The attention list. Empty is a state worth showing ("nobody is stuck").
2. **Do customers get what they came for?** One row per journey: started, reached the goal, left, stuck, still in progress, as parts of one bar so that they add up; beside it the time to complete. Opening a journey shows its stages as a funnel with where people left and where they wait.
3. **Does the work go right?** One row per workflow: completed, right first time, lead time as work against waiting. Opening a workflow shows its steps, tools, errors and decisions.
4. **What does it cost, and who does it?** Cost per journey, tokens, done without a person.

Mood sits in band 2, with the outcome it belongs to. Change over time sits behind each number rather than as a wall of line charts: with small counts, bars of counts per week are honest where a line of rates is not.

### 7.2 Honesty of numbers

- The count is part of the number: "50% · 3 of 6".
- Colour for good and bad only where the specification says which way is better **and** the count is at least ten. Otherwise ink.
- "No value" in words.
- Inferred mood dashed, measured solid, as in the journey view.
- Parts of a whole are drawn as parts of one bar; nothing that does not add up is stacked.

### 7.3 From a number to the evidence

Selecting any number lists what it was computed over (customers or runs) in a side panel, with the rule of the measure above the list. Each line opens the journey view at that customer. The dashboard never re-tells a customer's story.

### 7.4 Visual language

The page continues the journey view: the same dark and light themes, type, and marks for stalled, failed and inferred. Charts are few and plain: a segmented bar for outcomes, a funnel of bars for stages, a two-part bar for work against waiting, a dot strip for mood, small bars per week. One hue carries data; a second marks what needs attention.

## 8. Open questions

- At volume, the attention list needs grouping by owner and stage, and the evidence panel needs paging. Not designed.
- Whether a comparison with the previous period helps or misleads at small counts. The design shows per-week counts and leaves the judgement to the reader.
- Targets (a service level per stage exists as `max_duration`; nothing else in AWA states a target). Without targets there is no "red" except lateness.
- Whether the sponsor's three numbers are the right three.
- Alerting is left to the metrics system that scrapes the OpenMetrics endpoint.

## 9. Validation plan

The same as for the journey view (`usability-test-kit.md`): five to six people, one per reader of section 3, on their own data if possible. Tasks: name who needs action today and who should act; name the stage of the claim journey that loses most customers and say how sure you are; say whether renewal is "going well" (the trap of finding 5.4); say how customers feel after a claim and how that is known; find the step that fails most and open a run that shows it; say what a claim costs to handle. Success is the right answer *with the right caveat*: a participant who reports "50% completion" without "of six" has been misled by the page.
