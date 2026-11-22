# Synthetic session: Priya, workflow engineer

> This is the report of an AI agent playing a persona and using the journey view through screenshots and clicks, without access to the code or the documentation. It is a simulation, not a session with a person. Protocol: [usability-test-kit.md](../usability-test-kit.md). Tool: [synthetic-session.mjs](../synthetic-session.mjs).

SYNTHETIC PARTICIPANT REPORT: Priya (33, builds agent workflows, trace-viewer habits)

Procedural note: on three occasions I chained two clicks and only opened the second screenshot (the first screen had a layout I had already seen). Everything else was look-then-act.

---

TASK 1: who needs someone to act today, and why
- ANSWER: "Two: L. Petit and R. Haddad, both on their motor claim, both tagged 'Stalled: needs action'. Petit has sat in 'Reported' for 10 days against 7 allowed, because the documents were never uploaded; two deadlines passed with nothing from them, and the profile says they don't like portals, so someone should phone or write. Haddad's settlement run failed, and I didn't yet know why at this point."
- DONE: yes (the cause of Haddad's failure only came in task 4)
- ACTIONS: 5 (3 clicks on the grid/diagram, 2 on the next-customer arrow, 1 slider drag; the first click counted once)
- FIRST MOVE: "The orange 'Stalled: needs action' text in the grid, the only thing in that colour. Clicked Petit's."
- THINKING ALOUD:
  - "Orange '2 stalled' in the header, two orange cells. Fine, that's my list."
  - "The bottom sentence says 'Someone needs to act'. Who? Do what? No owner, no ticket."
  - "Clicked the dashed yellow diamond: 'no documents.uploaded from L. Petit'. OK, that's an event name, I trust that more."
  - "Wait, clicking it made everything to the right vanish. Oh, it rewound time. I just wanted to inspect it."
  - "Arrow next to the name goes to the next customer, good. But it dropped me at step 1 with an empty diagram, whereas clicking from the grid dropped me at the end. Had to drag the slider."
- MISREAD OR MISSED: Did not consider the two renewal cells ("policy lapsed unpaid", "customer cancelled") as needing action; they are white text, so I read them as finished. Never worked out what "today" is: the grid has no date. Noticed later that Haddad has a stalled claim and a cancelled renewal in the same row, and I couldn't tell which is "now".

TASK 2: what has happened to A. Okafor so far
- ANSWER: "You reported a side impact on day 1 through the portal and sent your documents about 6 hours later. The claim went to an adjuster for review and sat there 3 days. It was approved ('Costs match the photos'), EUR 7950 was paid on day 4, payment order PAY-2044, claim CLM-2044, and you were emailed. Four days later you answered our survey 2 out of 5, 'It took too long to hear back', and we called you back. The claim is closed: paid, but we marked you as not satisfied."
- DONE: yes
- ACTIONS: 9 (3 clicks, 4 right-arrow presses, 1 slider drag, 1 left-arrow)
- FIRST MOVE: "Back to 'Journeys' in the breadcrumb, then Okafor's cell in the Motor Claim column."
- THINKING ALOUD:
  - "Whoa, dense. Thirty-odd dots and no text on them. I have to click each one to find out what it is."
  - "Purple diamond is 'a model decides', I'll start there."
  - "Arrow keys step through it. Good, that's faster than hunting dots."
  - "30 steps to tell a caller a story is too many. I want a text list of the events on this screen, like the one that turned up later inside the workflow."
  - "Finally ids: PAY-2044, CLM-2044."
- MISREAD OR MISSED: The "Mood" detail at the bottom right runs under the "18 / 30" counter and is cut off ("waited more than two days for an an…"). Did not open the first or third green bars. Never read the Technology / Exchanged rows as anything but decoration until an id appeared in the bottom text.

TASK 3: why adjuster instead of straight payment
- ANSWER: "No rule matched. Fraud score 0.45, estimated cost 8200, so a classifier model (acme:classifier-small) picked the route 'review' at 84% confidence, minimum accepted 60%. Its reason: repair is costly and the fraud score is neither low nor high, so an adjuster should confirm. Journal event 37 of run c6271395."
- DONE: yes
- ACTIONS: 3 (click "look inside", slider drag, click a line in the list)
- FIRST MOVE: "'look inside' under the Motor Claim Settlement bar. I already had the one-sentence version from task 2 but wanted the record behind it."
- THINKING ALOUD:
  - "This is what I wanted from the start: a flow diagram, an event list and an 'Evidence' panel with an event number and run id."
  - "It opened at the end. I tried to click the diamond in the diagram; it isn't clickable. Only the list lines are."
  - "The list shows five lines, and I can't see the rest without scrubbing."
  - "'Rules: none matched'. Which rules? What thresholds? I can't see how close it was."
  - "'Allowed options: the options the workflow lists'. That's a sentence, not the list. And two fields end in '…' with no way to expand."
- MISREAD OR MISSED: "The story so far" also shows lines after the selected one, so the title is wrong. No link from "event 37" to the raw record, and I looked for one.

TASK 4: R. Haddad's failed payment, was money left reserved
- ANSWER: "No. The bank rejected the transfer, RPC error -32010 account closed (they changed bank). Then the undo step 'Release funds' ran and reversed 'Reserve funds'; the run says '1 of 1 completed step undone'. Events 47 and 48 of run 312ba464. But I'm taking the sentence's word for it: there is no amount, no reservation id and no response from the release call."
- DONE: yes
- ACTIONS: 4 (Journeys, Haddad's claim cell, "look inside", click the release line)
- FIRST MOVE: "Journeys, Haddad's orange cell, then straight to 'look inside' on the red bar."
- THINKING ALOUD:
  - "Red box on 'Pay claimant', red line down to 'Undo step: Release funds'. I get it visually at once."
  - "'so nothing is left half done' is a claim. Show me the call."
  - "Evidence panel for the undo is one line: an event number. For the model decision it had six fields. Uneven."
  - "This also completes task 1: someone needs new bank details from Haddad."
- MISREAD OR MISSED: Nothing misread. Missed nothing I know of, but could not verify the release independently.

TASK 5: where in a claim do we lose the most customers
- ANSWER: "The first stage, 'Reported'. Of six, one left there (Lindqvist withdrew) and one is stuck there (Petit). 'Assessed and settled' has one stuck (Haddad) and nobody left; 'Followed up' loses nobody. Strictly 'lost' is one customer, and it's in Reported."
- DONE: yes
- ACTIONS: 2 (click "Motor Claim" in the breadcrumb, drag slider to the end)
- FIRST MOVE: "'Motor Claim' in the breadcrumb, hoping for a per-stage view."
- THINKING ALOUD:
  - "A calendar with one lane per customer and three stage boxes with here now / moved on / stalled / left. That's the funnel."
  - "But it says 3 here now, 0 left, which is wrong. Oh, it's parked on 5 Sept in the middle. The counts are as of the slider position. That nearly gave me the wrong answer."
  - "Dragged to the end: Reported 1 stalled, 1 left."
  - "With six customers this is an anecdote, not a funnel."
- MISREAD OR MISSED: Nearly read mid-timeline counts as final. Nothing on the stage boxes says "as of 5 Sept".

TASK 6: did the handling of Okafor's claim cost us anything later
- ANSWER: "Looks like it. At renewal Okafor never paid: two 'nothing arrives' deadlines for renewal.paid, mood went to -2, and the policy lapsed unpaid, 'Customer kept: not reached'. The renewal opens with mood already at -0.5, which is where the claim ended. So I'd say we lost the customer, but the screen never says the lapse was because of the claim. That link is my inference."
- DONE: partly
- ACTIONS: 6 (click Okafor's lane, click "Policy Renewal" tab, 1 right-arrow, 2 slider drags, 1 click on the first square)
- FIRST MOVE: "I remembered 'The policy lapsed unpaid' in Okafor's row on the first screen, so: Okafor's lane, then the 'Policy Renewal' tab at top right."
- THINKING ALOUD:
  - "The tab kept me on Okafor. Good, that's what I hoped."
  - "Empty diagram again at step 1. Drag to the end, again."
  - "The mood starts below zero. Why? I clicked the first square: 'policy is 30 days from its end'. No word on where -0.5 comes from."
  - "No arrow, no 'carried over from Motor Claim', no cost figure. 'Cost us' in money: I can't answer, there is no premium anywhere."
- MISREAD OR MISSED: Could not find any stated connection between the claim and the lapse, nor any monetary value. Did not open "look inside" on the renewal bar.

TASK 7: the mood line drops twice, same kind of information?
- ANSWER: "No. The first drop, when they're told it's settled, says '-1 inferred: waited more than two days for an answer': the system guessed it from the delay. The second, at the survey, says '-1 measured: said so in the survey': the customer actually said it. The dot looks hollow for the guessed one and filled for the measured one, I think, but nothing in the legend tells me that."
- DONE: yes
- ACTIONS: 3 (Motor Claim tab, slider to end, click the diamond under the first drop; the second drop I had already read in task 2)
- FIRST MOVE: "Motor Claim tab, then dragged to the end to see the whole line."
- THINKING ALOUD:
  - "'MOOD said or inferred' on the left label, so there are two kinds. Which is which?"
  - "The mood dots themselves aren't clickable. I have to click the diamond underneath and read the 'Mood' field bottom right."
  - "There's also a little drop at the very start ('-1 inferred: has had an accident'). So is it twice or three times?"
  - "And the key field is the one that's cut off by the step counter."
- MISREAD OR MISSED: Unsure whether hollow vs filled dot really encodes inferred vs measured; it is a guess. The legend row has no entry for it.

---

WORDS SHE USED
- "the grid" / "cells" (first screen); "sparkline" for the little mood line in each cell
- "the trace" or "swimlane diagram" (one customer's journey); "dots", "nodes", "diamonds"
- "the green bar" / "the red bar" / "the run" (workflows); "look inside" = "drill into the run"
- "the flow diagram" and "the event list" (inside a workflow); "evidence panel"
- "the slider" / "scrubber", "step counter"; "the caption" for the big sentence at the bottom; "the detail box" for the fields bottom right
- "the calendar" / "the funnel boxes" (Motor Claim overview)
- "next-customer arrows"; "the tabs" (Policy Purchase / Motor Claim / Policy Renewal top right)
- "timeout" for "nothing arrives in time"; "human-in-the-loop step" for "waits for a person"; "compensation" for "undo step"
- She never said "journey", "touchpoint" or "line of visibility" on her own.

"WHAT WAS THIS SCREEN FOR?"
"A replay viewer. It takes recorded runs of an insurer's workflows and stitches them into what each customer went through, so you can go from 'this customer is unhappy' down to the specific run and event that did it. It's good for explaining a case to someone. It's not a monitoring tool: no ids to search, no raw payloads, no 'now'."

"WAS THERE A MOMENT YOU DID NOT KNOW WHERE YOU WERE?"
"Three. One: every time I switched customer or tab I landed on an almost empty diagram at step 1, while coming from the grid lands at the end. For a second each time I thought the data was missing. Two: the Motor Claim calendar opened parked at 5 Sept with half the lanes empty and counts that looked final but weren't. Three: clicking a dot to inspect it rewinds the whole picture to that moment; the first time, I thought I'd broken something."

"IF YOU COULD CHANGE ONE THING, WHAT?"
"Put the event list and the evidence panel on the customer view too, not only inside a workflow, and make evidence real: event id, run id, the raw record, untruncated, copyable. And stop the click-to-inspect from rewinding time; let me select a step without everything after it disappearing. If I'm only allowed one: the event list with raw records on every level."

PLAY / STEP BUTTONS AND NAVIGATION DISCOVERY
- Play button: never used. It is the most prominent control on the screen and she ignored it in all seven tasks: "I don't want to watch it, I want to jump." The speed button was also never touched.
- Step buttons on screen: never clicked. She stepped with the keyboard arrows (5 presses in total) and mostly dragged the slider or clicked dots and list lines directly.
- Going inside a workflow: discovered on her own, but not until task 3. In tasks 1 and 2 she saw the words "look inside" and didn't click; she only did when asked "why". Once inside, she said it was the view she had wanted all along.
- Moving sideways to the same customer's other journeys: discovered on her own in task 6 through the three tabs at top right, which kept her on Okafor. She found the previous/next-customer arrows by the name earlier, in task 1. She did not notice the "6 go on" arrows between the columns on the first screen and could not say what they mean.
- Escape: never pressed.

OTHER THINGS A DESIGNER SHOULD KNOW
- Truncation with no way to expand appears in at least five places: customer description in the header, grid cell labels ("The customer withdrew the…", "The customer cancelled th…"), the caption on the first screen, evidence fields, and event-list lines.
- The bottom-right detail box overlaps the step counter when it has four fields.
- Evidence depth is uneven: six fields for the model decision, one line for everything else she opened.
- Inside a workflow, diagram boxes are not clickable; on the customer view, the mood dots are not clickable. Both are things she tried first.
- Entry position is inconsistent: end of timeline from the grid, start of timeline from the customer arrows and tabs, middle of timeline from the breadcrumb to the calendar.
