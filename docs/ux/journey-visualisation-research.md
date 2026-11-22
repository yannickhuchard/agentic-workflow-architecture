# UX research: showing customer journeys and the agentic workflows behind them

Status: desk research and heuristic analysis, November 2026. **No users were interviewed or observed.** Every persona and need below is an assumption drawn from the AWA specification, the example data and established practice in neighbouring fields. Section 9 says how to test them. The design that follows this document is the first thing to put in front of real people, not the result of having done so.

## 1. The question

AWA now has two layers. A **workflow** describes how one piece of work is done (specification sections 5 to 17). A **journey** describes the life of a customer or an order across several workflows, over days or months (section 19). The two are joined by one identifier, `run_id`.

How should a person see a journey, see the workflows that served it, and move between the two without losing the thread of what caused what?

## 2. Method and its limits

| Done | Not done |
|---|---|
| Read the journey and journal records of six simulated customers (`examples/claims-journey`, 501 events) and asked what each record can and cannot tell a reader | Interviews, observation, surveys |
| Compared four established ways of drawing this kind of material (section 4) | Usability tests of any design |
| Reviewed the existing AWA views (`replay.html`, `live.html`, `DESIGN.MD`) for what carries over | Analytics on how the existing views are used |
| Derived requirements and checked each against the data the SDK actually produces | Accessibility testing with assistive technology |

The simulated data is realistic in shape and small in volume. Six journeys say nothing about what the view must do with six thousand; section 8 lists that as an open question.

## 3. Who looks, and what they ask

These are **proto-personas**: plausible roles, not researched ones.

| Who | They arrive asking | They need to leave with |
|---|---|---|
| **Journey owner** (customer experience, product) | Where do customers get stuck or leave? Is the journey getting better? | The stage that loses the most people, and one example they can show others |
| **Operations lead** | Who is stuck right now, and is it ours to fix? | A list of stalled journeys, each with its reason and the person or system that holds it |
| **Case handler** (support, back office) | This customer called. What has happened to them so far, in order? | The story of one customer in plain language, and what happens next |
| **Workflow designer / AI engineer** | Why did this run take that path? What did the agent decide and on what basis? | The step, the attempt, the reasoning and the tool call, in a form they can act on |
| **Auditor / risk** | Can I trust this account? Where is the evidence for each statement? | Every sentence of the story linked to the record it came from |

Two things follow.

**The same record must serve a sentence and a trace.** The case handler wants "the bank rejected the payment, so the reserved money was released". The engineer wants the JSON-RPC error and the compensation event. They are the same two journal entries. The design must show the first and reach the second in one step, never by leaving the view.

**People arrive at different heights.** The journey owner starts from all journeys and goes down to one. The case handler starts from one customer. The engineer may start from a failed run and need to go *up*, to see whose journey it damaged. Navigation has to work in both directions.

## 4. What existing practice offers

| Practice | What it shows well | What it misses here |
|---|---|---|
| **Customer journey map**: stages as columns, the customer's actions, touchpoints and feelings as rows | The customer's point of view; stages as chapters | It is a drawing of the *intended* journey. It has no instances, no time, and nothing behind the touchpoints |
| **Service blueprint**: the journey map plus a *line of visibility*, with what the organisation does behind the scenes drawn below it | That every visible moment has backstage work, and which | Also a design-time drawing. The backstage is boxes, not runs |
| **Process mining views**: variants and flows computed from event logs | Real instances, real volumes, where the time goes | Flat. One layer of activities; no customer story, no reasons |
| **Distributed trace waterfall**: spans nested by cause, on a time axis | Causality and duration inside one request | Engineer-only. Unreadable across days of waiting |

The service blueprint's **line of visibility** is the most useful idea of the four, because AWA already has it in its data. Above the line: **business events**, the things the customer does or is told (`claim.submitted`, `documents.uploaded`, `survey.answered`). Below the line: **runs**. On the line: the **journey**, which is nothing but the record of how events from above caused work below and how the ends of that work moved the customer on.

The proposal is therefore a **living service blueprint**: the blueprint's layout, filled with recorded instances instead of intentions, and playable in time.

## 5. Findings from the data

Reading six journeys as a newcomer would, these are the things a view must not get wrong.

**F1. Most of a journey is waiting.** J. Moreau's journey lasts three days; the three workflows are busy for under half an hour of it. A time axis drawn to scale shows three specks. A view needs two clocks: *calendar time* to compare customers and find the slow ones, and *story time*, in which each thing that happened gets equal room and the gaps between them are stated ("1 day 3 hours later") instead of drawn.

**F2. The interesting moments are where the layers touch.** An event arrives and a waiting run wakes. A run ends and the stage completes. A stage is entered and a run starts. Almost every journey event is one of these crossings. If the layers are shown on separate screens, exactly these moments are invisible.

**F3. Causes are recorded but not adjacent.** `journey.run_started` carries `caused_by_event`; `event.received` in a run's journal carries the `event_id` of the business event. The chain "customer uploaded documents, so the intake run woke, so it finished, so the stage completed, so settlement started" is five records in two files. A reader should see it as one chain.

**F4. Not happening is an event.** L. Petit never sends documents. Nothing arrives for five days; then a deadline passes, a reminder goes out, and five days later the claim is closed. The story is made of things that did not happen. Deadlines have to be drawn as visibly as arrivals, and a timeout path has to look different from an ordinary path.

**F5. Endings differ in kind, not degree.** Completed, stalled, abandoned and failed are four different sentences, not four colours of one. A stalled journey is unfinished business for the organisation; an abandoned one is the customer's decision; a failed run inside a stalled journey is a defect with a compensation trail. Each needs its own words.

**F6. A goal can be missed by a journey that completed.** A. Okafor's journey completed: paid, surveyed, called back. The goal "customer satisfied" was not reached. Completion is about the process; goals are about the outcome. The view must show both and never merge them into one tick.

**F7. The AI's part is small in time and large in consequence.** One model decision, four seconds, sent A. Okafor's claim to an adjuster, and that cost three days. An account that gives each step room in proportion to its duration hides this. Story time (F1) lets a decision have the weight of its effect.

**F8. The record was not in story order.** In the first version of the host, a business event was written to the journey *after* the consequences it triggered. Nobody had read the record as a narrative before. This was corrected in the SDK (specification 19.5 now requires causal order), and a run left waiting for a customer who had withdrawn is now cancelled (5.8). Designing the story found two defects that tests had not.

## 6. Requirements

| # | The view must | From |
|---|---|---|
| R1 | Offer three heights: all journeys, one journey, one run. Moving between them is a zoom into the thing that was pointed at, not a change of page | Section 3, F2 |
| R2 | Keep the line of visibility on screen at the journey height: customer above, journey on the line, workflows below | Section 4, F2 |
| R3 | Offer calendar time for comparing journeys and story time for following one | F1, F7 |
| R4 | Draw every cause as a visible link from the thing that happened to what it set off, and draw nothing as moving that was not caused | F3 |
| R5 | Give waits, deadlines and timeouts their own marks | F4 |
| R6 | Say each ending in words, with its own form | F5 |
| R7 | Show goals apart from completion | F6 |
| R8 | State every moment as one plain sentence, and link the sentence to the record behind it | Section 3 |
| R9 | Be playable: a reader can sit back and be told the story, or step through it, or jump | Brief |
| R10 | Be reachable from below: from a run, show whose journey it belongs to | Section 3 |
| R11 | Never rely on colour or motion alone | Accessibility |

## 7. Design principles

### 7.1 Structure: one object, three heights

| Height | Question | Layout | Time |
|---|---|---|---|
| **All journeys** | Where do customers get stuck? | One lane per customer; stage summary above | Calendar time |
| **One journey** | What happened to this customer? | Living blueprint: customer lane, journey line, workflow lane | Story time |
| **One run** | Why did the work go this way? | The workflow graph, with the step in focus explained beside it | Story time |

The link between heights is always a thing on screen: a customer's lane opens their journey; a run's bar in the journey opens that run. Going back up returns to the same moment, with the thing just visited still marked.

### 7.2 Storytelling

A story has a subject, chapters, beats, causes and an ending. The data has all five.

| Story | AWA |
|---|---|
| Subject | The journey's subject: one customer |
| Chapter | A stage |
| Beat | One journey event, or inside a run one condensed journal step |
| "Because" | `caused_by_event`, `run_id`, the edge a token took |
| Pause | A wait, stated in words: "1 day 3 hours later" |
| Ending | Completed, stalled, abandoned; goals reached or not |

Each beat has a **caption**: one sentence in the past tense, generated from the record, naming who did what. The caption is the primary account; the diagram illustrates it. This inverts the usual relation, where a diagram is primary and a log is beside it. It is what makes the view usable by a case handler, and it gives screen-reader users the whole story (R11).

### 7.3 Motion

Motion is used for one purpose: to show that one thing caused another. Rules:

1. **Only consequences move.** A link draws itself from cause to effect, then the effect appears. Nothing drifts, bounces or pulses for decoration. The one standing animation is the mark for "waiting", because waiting is a state the reader must notice.
2. **Direction has meaning.** Left to right is time. Downward is an event reaching the work; upward is work reporting back. In a workflow, a path fills from its source to its target.
3. **One cascade at a time.** When one beat has several consequences they play in causal order with a short stagger, never together.
4. **Transitions between heights are zooms.** The thing pointed at grows into the next view from where it was; going back, the view shrinks to that thing. The reader never has to find their place again.
5. **The reader sets the pace.** Play, pause, step, jump to any beat. Playing stops at an ending.
6. **Reduced motion is honoured.** With the system setting on, links and states appear without animation. Nothing is conveyed by motion that is not also conveyed by the caption and by a static mark.

Indicative timings, to be tuned in testing: a link 400 to 500 ms; a state change 200 ms; a zoom 500 ms; autoplay about 1.8 s per beat.

### 7.4 Visual language

Taken from `DESIGN.MD` so that this view and the existing replay read as one product: dark canvas, state colours (running violet, waiting amber, done green, failed red, not reached grey). Added: shape carries the same information as colour (R11).

| Thing | Mark |
|---|---|
| Business event (customer or outside world) | Diamond, on the customer lane |
| Journey fact (stage entered or completed, goal) | Circle, on the journey line |
| Run | Bar on the workflow lane, as long as its beats |
| Wait | Dashed outline, and a stated gap |
| Deadline passed | Hollow diamond with a clock hand |
| Ending | A filled terminal mark, with the ending in words |

## 8. Open questions

1. **Volume.** Six lanes fit on a screen. What does "all journeys" look like for six thousand: sampled lanes, a density strip, a funnel with examples? Unknown until someone uses the view on real volumes.
2. **Live journeys.** This design replays what has happened. A journey still under way has a "now" and an unknown future; the same layout should serve it, but that is untested.
3. **Whose words?** Captions are generated from event names and activity names. A deployment whose activities are named `step_7` will get poor sentences. Whether authors will accept writing for readers is a question about people, not the design.
4. **How much of the agent's reasoning does a case handler want?** The assumption here is none by default and all of it one step away.
5. **Customer feeling.** A journey map usually carries an emotion line. The data has one signal of it (a survey answer). The design shows that answer where it occurs and does not draw a line it has no data for.

## 9. Validation plan

Five people per proto-persona is a reasonable first round; the first two rows below can be run with any five colleagues.

| Task | Asked of | Success |
|---|---|---|
| "Which customers need someone to act today, and why?" | Operations lead | Names both stalled journeys and their causes within two minutes, without help |
| "Tell me what happened to A. Okafor." | Case handler | Retells the journey in the right order, including the three-day wait for the adjuster and the low rating |
| "Why did A. Okafor's claim go to an adjuster?" | Engineer | Reaches the model decision and reads its rationale |
| "Was R. Haddad's money left reserved?" | Auditor | Finds the compensation step and its record |
| "Which stage loses the most customers?" | Journey owner | Answers from the stage summary and opens one example |

Watch for: whether people notice they can go *into* a run; whether they understand the gap labels; whether autoplay is used or immediately paused; where they look for the "why".

## 10. Second round: several journeys, and what a journey map is expected to show

The first round covered one journey. A customer lives through several, and a journey map as practitioners draw it carries rows the first design did not have: how the customer feels, where they meet the organisation, what technology carries that meeting, and what changes hands. This round adds both.

### 10.1 Moving between journeys

There are two ways to be lost among several journeys, and the design answers each with one control.

| Question | Movement | Control |
|---|---|---|
| "What journeys are there, and how do people move from one to the next?" | Up, to a view above any one journey | A fourth height, the **atlas**: each journey as a card with its stages and outcomes, the number of customers who go on from one to the next, and under them one row per customer with a cell for each journey they have been on |
| "What happened to this same customer before, and after?" | Sideways, keeping the customer | A **journey switch**, always in the same corner. On one customer's journey it moves to that customer's journey of another kind; on the calendar view it moves to the other journey's calendar |
| "Is this customer typical?" | Sideways, keeping the journey | Previous and next customer, beside the name |

The rule is that every move keeps one thing fixed and says which: up and down keep the thing pointed at, the journey switch keeps the customer, the customer arrows keep the journey. A reader is never moved on two axes at once.

The atlas makes one cell per customer and journey, because the question that only several journeys can answer is a row-wise one: A. Okafor's claim was paid in full, and the journey completed; the cost of the three-day wait appears in a different journey, five months later, as a policy that lapsed. No view of one journey shows that.

### 10.2 The rows of the blueprint

| Row | What it shows | Where the data comes from | Decision |
|---|---|---|---|
| **Mood** | One line across the journey | `journey.sentiment_changed` (specification 19.9) | A filled dot where the customer said how they felt, a hollow dot where a rule inferred it. The view never shows an inferred mood as a fact; the caption gives the reason for every change |
| **Touchpoints** | What the customer does and is told, in order | `journey.touchpoint` (19.8) | Filled marks are the customer acting, hollow marks the customer being told. This row replaces the hand-built "is told" marks of the first round |
| **Technology** | Which system carried each contact, including calls to partners' systems | `technology` of the touchpoint; the tool call's link | One row per system, a dot where it was used. A column read downwards answers "what was involved in this moment"; a row read across answers "when do we depend on this system" |
| **Exchanged** | What changed hands, as the business names it: contract, attestation, invoice, receipt, certificate, quote, form, evidence, notice, order, survey | `artefacts` of the touchpoint | One row per kind, a document mark where one was exchanged: filled when received, outlined when sent out. The particular document (its reference) is in the caption |

**F9. Mood is the row most likely to mislead.** A drawn line looks measured. In this data only one kind of point is: the survey answer. The rest are the authors' assumptions (an accident is bad news, a long wait is felt, being paid is a relief). The design therefore marks the basis at every point and in every caption, and the specification requires any view to do so. Whether readers notice the difference between a filled and a hollow dot is the first thing to test.

**F10. Technology and exchange are matrices, not labels.** With thirty moments on a screen there is no room for a label at each. Rows with marks stay readable at any density and let the eye run both ways.

### 10.3 Simulation

**The six customers.** The view was built on a simulation of six customers, each written as a persona with a temperament that shapes their path, through three journeys over a year: buying a policy, claiming on it, renewing it. 18 journeys, 1,140 recorded events. `examples/claims-journey/make-journeys.mjs`.

| Customer | Persona | Purchase | Claim | Renewal |
|---|---|---|---|---|
| J. Moreau | Organised commuter; answers the same day | covered in a day | paid in a day, rates 5 | renews in two days |
| A. Okafor | Contractor who needs the car for work | covered in two hours | waits three days for an adjuster, rates 2 | offered a goodwill discount; lets the policy lapse |
| L. Petit | Retired, not at ease online | takes four days to sign | never uploads documents; stalled | pays after the last reminder |
| S. Lindqvist | Compares everything first | pays three days late | withdraws; the warranty covered it | renews next day |
| R. Haddad | Changed bank; does not chase | covered in a day | payment rejected by the bank; stalled | calls to cancel |
| M. Castellano | Decides slowly, ignores surveys | accepts on day 6 of 7 | paid; never answers the survey | renews after ten days |

**The people who read the view.** Each proto-persona of section 3 was then walked through the built view by a script that uses only what is on screen (`examples/claims-journey/persona-walkthrough.mjs`). It reports whether the answer can be reached and in how many actions.

| Who | Question | Result | Answer found on screen |
|---|---|---|---|
| Operations lead | Which customers need someone to act today, and why? | reached, in 4 actions | L. Petit in Motor Claim: The journey is stalled: “Reported” has lasted 10 days, longer than the 7 days it is given. Someone needs to act. | R. Haddad in Motor Claim: The journey is stalled in “Assessed and settled”: the Motor Claim Settlement workflow failed. Someone needs to act. |
| Case handler | Tell me what happened to A. Okafor with the claim, in order. | reached, in 31 actions | 30 sentences; the wait for the adjuster is sentence 15, the rating of 2 is sentence 25 |
| Workflow designer | Why did A. Okafor's claim go to an adjuster? | reached, in 3 actions | The repair is costly and the fraud score is neither low nor high, so an adjuster should confirm before payment. (confidence 84%) |
| Auditor | Was R. Haddad's money left reserved when the payment failed? | reached, in 3 actions | “Release funds” undoes “Reserve funds”, so nothing is left half done. (journal record: event 47 of the run) |
| Journey owner | Which stage of the claim journey loses the most customers? | reached, in 2 actions | “Reported”: 2 of 6 stalled or left there. Example opened: The journey is stalled: “Reported” has lasted 10 days, longer than the 7 days it is given. Someone needs to act. |
| Journey owner | Did the poor claim experience cost us A. Okafor as a customer? | reached, in 2 actions | Claim ended with mood unhappy (−0.5); one step sideways to the renewal: The journey ends here. The policy lapsed unpaid. (mood upset (−2)) |

This shows that every answer is reachable, and how far away it is. It does not show that a person would find it: a script knows where to click. The case handler's 31 actions are 30 presses of "next", which is the story being read, not a search.

The walkthrough found a defect the unit tests had not: an event announced by a workflow was taken in by the host only after everything that followed from that workflow, so that R. Haddad's stalled claim ended, on screen, with an unrelated announcement. The host now takes in what a run announces as soon as the run settles (specification 19.5).

### 10.4 Added requirements

| # | The view must | From |
|---|---|---|
| R12 | Offer a height above any one journey, showing the journeys, the movement between them and each customer's path across them | 10.1 |
| R13 | Offer a move sideways that keeps the customer and changes the journey, and one that keeps the journey and changes the customer | 10.1 |
| R14 | Show mood, touchpoints, technology and what changed hands against the same beats as the journey and its workflows | 10.2 |
| R15 | Mark every mood value as said by the customer or inferred, wherever it appears | F9 |

### 10.5 Still open

- The atlas holds six rows. At real volumes its rows must become a distribution (how many customers took each path across the journeys) with examples one step away. Not designed.
- Journeys here follow one another. Two journeys of the same customer running at once (a claim open while the renewal falls due, as happens to L. Petit and R. Haddad) are shown separately; the view does not yet show that they overlap.
- Channel is in the caption, not in a row. If readers ask "how much of this journey is on the phone", it needs one.

## 11. What was built

`tools/visualization/journey.html`: one file, no build step, no network. Four heights (atlas, one journey on calendar time, one customer's journey as a blueprint, one run), the journey switch and customer arrows, a caption for every moment, play, step and scrub, links that carry the place. Covers R1 to R15. It reads `journey-story.js`, written by `examples/claims-journey/make-story.mjs` from any journey record the SDK produces.

Since the second round it also opens any record, from a file, an address, or live from a server whose journeys are still moving; a reader at the latest moment stays at the latest moment as the record grows. Workflows without a hand-made layout are laid out by rule. `tools/visualization/journey.check.mjs` checks all of this in a browser, and runs in CI.

Not built: everything under 8 and 10.5, in particular an atlas for more than a handful of customers and journeys.

## 12. Testing with people

Not done. [`usability-test-kit.md`](usability-test-kit.md) holds the session script, the seven task cards, the observation sheet and how to read the results. The findings belong here.
