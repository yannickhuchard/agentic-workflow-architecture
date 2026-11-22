# Synthetic session: Inès, operations lead

> This is the report of an AI agent playing a persona and using the journey view through screenshots and clicks, without access to the code or the documentation. It is a simulation, not a session with a person. Protocol: [usability-test-kit.md](../usability-test-kit.md). Tool: [synthetic-session.mjs](../synthetic-session.mjs).

SYNTHETIC PARTICIPANT SESSION: Inès (ops lead, motor claims). All 7 tasks attempted in order; none abandoned. Screenshots only, no repo files read. Final screenshot: sessions/ines/screen.png

TASK 1: who needs action today, and why
- ANSWER: "Two: L. Petit and R. Haddad, both on their motor claims. Petit's claim has sat at 'Reported' for 10 days when it's allowed 7; we asked for documents and nothing came back, and this is someone who doesn't do portals, so somebody should ring or write. Haddad's payment bounced: the settlement failed and it's just sitting there, customer upset."
- DONE: yes
- ACTIONS: 4 (Petit's amber box, an amber marker on Petit's page, back to "Journeys", Haddad's amber box)
- FIRST MOVE: "The two amber 'Stalled: needs action' boxes in the middle column. Only amber on the page, so I went there."
- THINKING ALOUD:
  - "Amber, 'needs action'. Good, that's my list. Two of them."
  - "Clicked Petit. Lots of dots and lines... I'm just reading the big sentence at the bottom."
  - "'Reported has lasted 10 days, longer than the 7 it is given.' Fine, but why? Clicked the little amber dashed thing: 'no documents.uploaded from L. Petit'. That reads like computer-speak but I get it."
  - "Haddad: 'the Motor Claim Settlement workflow failed. Someone needs to act.' Who is 'someone'? It doesn't say who or what to do."
  - "Okafor's policy lapsed and Haddad cancelled, in red, but nobody is telling me to act on those, so I'm leaving them out."
- MISREAD OR MISSED: Did not learn on this task WHY Haddad's settlement failed (the stalled message only says "workflow failed"; the bank reason only turned up in task 4). Never read the intro paragraph top-left. Briefly puzzled that Petit's claim is stalled yet the Petit renewal box says "Completed". "Needs action" never says which action or by whom.

TASK 2: Okafor on the phone, what has happened so far
- ANSWER: "You reported a side impact on a roundabout on day 1, through the portal, and sent your documents the same day. Then you heard nothing for three days. On day 4 we emailed to say it was settled and EUR 7,950 was paid. About four days later you filled in our survey, 2 out of 5, 'it took too long to hear back'. Claim is closed and paid; you're not happy with us." (She could not say what went on during the three silent days until task 3.)
- DONE: partly
- ACTIONS: 7 (Journeys, Okafor's claim box, a diamond, one step forward, slider dragged to end, another diamond, the first diamond)
- FIRST MOVE: "Back to the first page and clicked Okafor's box in the Motor Claim column."
- THINKING ALOUD:
  - "This is a wiring diagram. Three grey blocks: Reported, Assessed and settled, Followed up. OK, that I can follow."
  - "Top right: 'Claimant paid reached', 'Customer satisfied not reached'. That's the headline. Good."
  - "I tried to click the dip in the top line itself. Nothing. Clicked the diamond underneath instead."
  - "Ah, the sentence at the bottom changes. That's the story. But half the picture just vanished to the right, where's the rest gone?"
  - "Tried the little forward arrow once: 'The Motor Claim Settlement workflow finishes.' 30 steps of that? No. I'll pick the diamonds."
  - "Had to drag the bar at the bottom back to the end to get the later part back."
- MISREAD OR MISSED: The dots on the top (mood) line are not clickable; she tried. Did not understand at first that clicking anything rewinds the picture and hides everything after it. Ignored the Technology and Exchanged rows completely ("not for me"). Did not use "look inside". No single summary of the claim that she could read aloud to a caller; she assembled it from four clicks.

TASK 3: why adjuster rather than paid straight away
- ANSWER: "No rule covered it. Fraud score 0.45 and an estimated cost of 8,200, so the system (a 'model') decided to send it for review, 84% confident. Then it waited for a person, the adjuster."
- DONE: yes
- ACTIONS: 3 (slider to end, purple diamond, one step forward with the arrow key)
- FIRST MOVE: "The purple diamond in the middle bar. The key at the bottom says purple means 'a model decides'."
- THINKING ALOUD:
  - "Screen was nearly empty again from last time, dragged the bar to the end first. Annoying."
  - "Purple diamond: 'No rule covers this case... so a model decides Settlement route: review, 84% confident.'"
  - "'Review': is that the adjuster? Stepped on one: 'Adjuster review waits for a person.' Yes."
  - "I'd want to know which threshold it missed. 'No rule covers this' doesn't tell me if it's the 0.45 or the 8,200."
- MISREAD OR MISSED: Cannot tell which of the two numbers caused it or what the limits are. "A model" means nothing specific to her; she read it as "the system".

TASK 4: Haddad's failed payment, was money left reserved
- ANSWER: "No. The bank rejected the transfer because the account was closed, and the screen says 'Release funds undoes Reserve funds, so nothing is left half done.' So the reserve was released. I know because the screen says so in that sentence; I can't see an actual amount or a confirmation."
- DONE: yes
- ACTIONS: 4 (Journeys, Haddad's claim box, the red square, the dashed red circle next to it)
- FIRST MOVE: "The red square at the end of the red-outlined bar."
- THINKING ALOUD:
  - "Red square: 'Bank rejected the transfer: RPC error -32010: account closed.' The error code is noise, 'account closed' is what I need. Matches 'changed bank during the year'."
  - "That doesn't answer the reserve question. There's a funny dashed red circle just before it."
  - "'Release funds undoes Reserve funds, so nothing is left half done.' That's my answer."
  - "Odd that the release sits before the failure on the line. I'd expect fail first, then undo."
- MISREAD OR MISSED: The dashed red circle is not in the key at the bottom, so she clicked it on a guess. Order of "release" before "failed" confused her slightly. She is taking the sentence on trust: no amount, no receipt. "RPC error -32010" is jargon.

TASK 5: where in a claim do we lose the most customers
- ANSWER: "At the very first step, 'Reported'. Of six, one walked away (withdrew) and one is stuck there; only four moved on. Then one more is stuck at 'Assessed and settled'. Nobody drops out after that, though only 1 in 6 ended up satisfied."
- DONE: partly (she is confident, but had to decide for herself what "lose" means; she counted "left" plus "stalled")
- ACTIONS: 2 ("Motor Claim" in the trail at the top, slider dragged to the end)
- FIRST MOVE: "Clicked 'Motor Claim' at the top because I wanted all the claims at once, not one person."
- THINKING ALOUD:
  - "New page: a calendar with a bar per customer. This one I like, it looks like a plan."
  - "The boxes on top: Reported, Assessed and settled, Followed up, with 'here now / moved on / stalled / left'. That's my funnel."
  - "But the numbers say '2 here now'... there's a vertical line at 6 Sept. It's showing a date in the middle. Dragged to the end and the numbers changed."
  - "Reported: 1 stalled, 1 left. That's the worst box."
  - "Is 'stalled' lost? Not yet. Strictly only one 'left'. I'll say Reported either way."
- MISREAD OR MISSED: Nearly read the mid-month numbers as final; the counts depend on where the bottom slider is and nothing warns you. With six customers the answer is one person per box, so "most" is thin. Did not consider the renewal page (2 left there), because the question said "in a claim".

TASK 6: did Okafor's claim handling cost us later
- ANSWER: "I think so. Okafor came out of the claim unhappy, 'took too long', and then at renewal ignored the offer and two reminders and the policy lapsed unpaid. We lost the customer. But the screen doesn't actually say one caused the other; I'm putting two and two together, and I can't see a figure for what it cost."
- DONE: partly
- ACTIONS: 5 (Okafor's bar on the calendar, "Policy Renewal" button top right, slider to end, a diamond where the line dips, the circle at the start)
- FIRST MOVE: "I remembered the red 'policy lapsed unpaid' next to Okafor on the first page, so I went for the 'Policy Renewal' button top right."
- THINKING ALOUD:
  - "The button top right kept me on Okafor and switched to the renewal. Good, didn't expect that."
  - "But it opened empty, one little square, 'The policy is 30 days from its end'. Dragged to the end again."
  - "'The policy lapsed unpaid', 'Customer kept not reached', mood upset -2. That's a lost customer."
  - "Mood already says unhappy -0.5 at the very start of the renewal. Is that left over from the claim? Nothing says so."
  - "Clicked around for a 'because of the claim' sentence. Got 'had to be chased' and 'The journey enters the stage Offered'. No link."
- MISREAD OR MISSED: Could not find any explicit connection between the claim and the lapse; the carried-over −0.5 is the only hint and is unexplained. "Cost us" in money is nowhere. She never noticed the "6 → go on" arrows between the columns on the first page as meaning anything.

TASK 7: the two drops in the top line on Okafor's claim
- ANSWER: "No, not the same. The first drop is the system guessing: it says 'inferred: waited more than two days for an answer'. The second is what the customer actually told us: 'measured: said so in the survey', 2 out of 5. One is an assumption, one is real."
- DONE: yes (only because the question made her read the small grey print bottom right)
- ACTIONS: 5 ("Motor Claim" button top right, slider to end, diamond under first drop, slider to end again, diamond under second drop)
- FIRST MOVE: "Tried to click the drop on the line itself. Nothing happens. Clicked the diamond below it."
- THINKING ALOUD:
  - "Empty again after switching. Drag to the end. Every time."
  - "First drop, bottom right in small print: 'Mood −1 inferred: waited more than two days'. The end of that line is hidden under the '18 / 30' counter."
  - "Wanted the second drop but it had disappeared because I clicked the first. Drag to the end again."
  - "Second: '−1 measured: said so in the survey'. So one's a guess and one's a fact."
  - "On the left it says 'MOOD said or inferred'. I'd read that three times and it hadn't registered."
- MISREAD OR MISSED: Did not notice that the dot at the second drop is solid and the others are hollow; if that is the signal, it is invisible to her and it is not in the key. The mood detail text is clipped by the step counter. On the first page she took the mood lines and scores as fact; she would not have known some are guesses without this task.

ONCE

- WORDS SHE USED: "the first page" / "the grid" (Journeys overview); "boxes" (cells); "amber ones" (stalled); "the wiring diagram" (one customer's journey view); "the grey blocks" (stages); "the long bars" / "pills" (workflows); "diamonds" (touchpoints); "the top line" / "the happiness line" (mood); "the sentence at the bottom" (narration); "the bar at the bottom" / "the slider" (scrubber); "the calendar" (journey-level lanes view); "the buttons top right" (journey switcher); "the system" (model); "small print" (detail panel bottom right). She never said "journey", "workflow", "touchpoint" or "line of visibility".

- WHAT WAS THIS SCREEN FOR: "It's a case history. For each of six customers it replays what happened when they bought, claimed and renewed, step by step, and how they felt. It's for working out afterwards why something went wrong. It is not a work queue: it tells me two claims are stuck but not who should do what."

- A MOMENT SHE DID NOT KNOW WHERE SHE WAS: "Yes, several, all the same thing. Every time I clicked something on a customer's page, everything to the right of it vanished, and when I switched between claim and renewal it opened on a nearly blank page with one dot. I thought I'd broken it or the data wasn't there. And on the calendar, the numbers in the top boxes were for some date in the middle of the month and I nearly quoted them."

- ONE CHANGE: "Open on the finished picture and leave it there when I click. Clicking a thing should tell me about that thing, not rewind the film. (Second choice: put who must do what next to 'needs action'.)"

- PLAY / STEP / GOING INSIDE / SIDEWAYS:
  - Play button: never used. Did not register it as something she needed.
  - Step buttons: used twice only (one click on the forward arrow in task 2, one ArrowRight in task 3). Useful the second time (confirmed "adjuster"), but 30 steps felt too slow so she jumped by clicking shapes and dragging the slider (6 slider drags in total, mostly to undo the rewind).
  - Going inside a workflow: NOT discovered. She saw the words "look inside" under the bars in every screenshot and never clicked them; she read them as a caption, and the bottom sentence was enough for tasks 3 and 4.
  - Sideways to the same customer's other journeys: discovered on her own, late, in task 6, via the three buttons top right (Policy Purchase / Motor Claim / Policy Renewal), and reused in task 7. The two arrow buttons either side of the customer name were never clicked; she did not know whether they meant next customer or next step, and went back to the first page each time to change customer.
