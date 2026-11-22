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

## 10. What the design delivers

An interactive design, built on the recorded data of the six example customers, covering R1 to R11 at the three heights. It is a design, not yet a shipped view: the next engineering step, if the design survives contact with users, is `tools/visualization/journey.html` beside the existing replay.
