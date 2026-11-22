# Synthetic session: Aline, case handler (re-test after the changes)

> This is the report of an AI agent playing a persona and using the revised journey view through screenshots and clicks, without access to the code or the documentation. It is a simulation, not a session with a person. Five of the seven tasks were given. Protocol: [usability-test-kit.md](../usability-test-kit.md). Tool: [synthetic-session.mjs](../synthetic-session.mjs).

SYNTHETIC PARTICIPANT REPORT: Aline (case handler, contact centre)

All five tasks were answered. 17 actions in total, none of them a key press.

TASK 1: "A. Okafor is on the phone about their claim. Tell me what has happened to them so far."
- ANSWER: "Mr/Ms Okafor, I can see you reported the claim on day 1 at 8:00, a side impact on a roundabout, both left doors and the sill. Three minutes later we asked you for photos, the police report and a repair quote. You uploaded 3 documents six hours later. It then went to an adjuster for review, and that took three days. On day 4 it was approved, 'costs match the photos', and EUR 7950 was paid to your account. We sent you a survey; four days later you gave us 2 out of 5, 'it took too long to hear back'. The next day a colleague called you, apologised for the delay and offered a courtesy car next time. The claim is closed and paid, but we have you down as not satisfied."
- DONE: yes
- ACTIONS: 4 clicks (Okafor's box under Motor Claim; "Read as a list"; the "back to start" button; "Read as a list" again)
- FIRST MOVE: "I found A. Okafor in the names down the left and clicked the box in the Motor Claim column on that row, the one saying 'Completed, unhappy'."
- THINKING ALOUD:
  - "Three columns, six names. OK, it's a grid. Okafor, Motor Claim, that box."
  - "Oh. That's a lot of dots and lines. I am not reading that on a call."
  - "'Read as a list' is the button I want."
  - "The list opened at the bottom, Day 4 to Day 9. Where's the start? I have to tell the story from the beginning."
  - "I pressed the little 'back to the start' button at the bottom and opened the list again; then it started at Day 1."
  - "'No rule covers this case (fraud score 0.45…), so a model decides Settlement route: review, 84% confident'. I'd skip that on the phone; I don't know what I'm allowed to say about it."
- MISREAD OR MISSED:
  - The list opened at the end of the story, not the top. In the real thing I would have scrolled the list up; this test tool gave me no scroll, so I used the back-to-start button as a workaround.
  - She never understood the diagram itself (the rows "journey / line of visibility", "workflows", "technology", "exchanged") and didn't need it.
  - She did not notice the list has two tabs, "The customer's side" and "Everything"; "Everything" is cut off to "Everyth".

TASK 2: "When R. Haddad's payment failed, was their money left reserved? How do you know?"
- ANSWER: "No, nothing was left reserved. In Haddad's claim list, day 2 at 08:19, it says '"Release funds" undoes "Reserve funds", so nothing is left half done', and right under it the settlement failed because the bank rejected the transfer: account closed. So the reservation was released, and the claim is now stuck waiting for someone to act."
- DONE: yes
- ACTIONS: 4 clicks ("Journeys"; Haddad's Policy Renewal box, which was the wrong place; the "Motor Claim" tab top right; "Read as a list")
- FIRST MOVE: "I went back to 'Journeys' at the top left to get the grid of names again."
- THINKING ALOUD:
  - "A customer's payment failing is a direct debit for me, so a premium. And it says Haddad 'changed bank during the year'. I'll look at Renewal."
  - "Renewal just says the customer cancelled the policy. No payment here. But 'Arrived upset from Motor Claim', so it's the claim payout that failed."
  - "The Motor Claim tab at the top right kept me on Haddad. Good."
  - "Red box, 'Motor Claim Settlement · failed'. Open the list, I trust the list."
  - "There it is in a sentence: 'Release funds undoes Reserve funds'. That's wording I'd never use, but I get it."
- MISREAD OR MISSED:
  - She assumed "payment" meant the customer's premium and went to Renewal first.
  - The line that answers the question comes before the "workflow fails" line at the same time stamp, which read backwards to her: undo first, then the failure.
  - She did not notice the red dashed circle on the diagram ("an earlier step is undone" in the key) and never used "Look inside".
  - "RPC error -32010" meant nothing to her; "account closed" did.

TASK 3: "At which point in a claim do we lose the most customers?"
- ANSWER: "Right at the start, in 'Reported'. Of six, four moved on, one is stalled and one left; that was Lindqvist, who withdrew the claim. In 'Assessed and settled' one more is stalled but nobody left, and in 'Followed up' nobody drops out. If by 'lose' you mean walked away, it's Reported: 1 left. If you count stuck ones too, still Reported: 2."
- DONE: yes, with her own doubt about what "lose" means
- ACTIONS: 1 click ("Motor Claim" in the trail at the top left)
- FIRST MOVE: "I clicked 'Motor Claim' in the trail at the top, next to Haddad's name, hoping to get all the customers for claims."
- THINKING ALOUD:
  - "Now it's bars by date, one per customer. This one I can read."
  - "Three boxes at the top: Reported, Assessed and settled, Followed up, each with 'here now / moved on / stalled / left'. 'Left' is the one I want."
  - "Reported: 1 left. The others: 0 left."
  - "Is a stalled customer lost? Petit and Haddad are stalled since early September. For me they're not lost, they're waiting on us."
  - "'given 7 days', 'given 10 days': I think that's the time allowed? Not sure."
- MISREAD OR MISSED:
  - Unsure whether "stalled" counts as lost.
  - Did not understand "given 7 days", or "Counts as of 20 Sept, the end of the record".
  - She did not connect that customers lost later, at renewal, could also be "lost because of the claim"; she answered inside the claim only.

TASK 4: "Did the way we handled A. Okafor's claim cost us anything later?"
- ANSWER: "Yes. At renewal we gave Okafor 10% off, the letter says 'EUR 819 (-10%: goodwill after a poor claim experience)', and they still didn't pay. We chased after 21 days, and after another 9 days the policy lapsed unpaid. So it cost us a discount and then the customer. They came into the renewal already 'unhappy from Motor Claim'."
- DONE: yes
- ACTIONS: 3 clicks ("Policy Renewal" tab top right; Okafor's lane; "Read as a list")
- FIRST MOVE: "I clicked 'Policy Renewal' top right, because I remembered from the first grid that Okafor's renewal box said something bad."
- THINKING ALOUD:
  - "Okafor's bar is the long one, ending 'The policy lapsed unpaid · upset (−2)'."
  - "Clicked the bar. Top strip says 'Arrived unhappy (−0.5) from Motor Claim' and 'Customer kept not reached'. That's the link."
  - "Opened the list to be sure: the goodwill discount is written into the first letter. That's proof I can quote."
  - "It doesn't actually say 'they left because of the claim'. I'm putting two and two together."
- MISREAD OR MISSED:
  - Nothing important. The cause-and-effect is her inference; the screen states the discount reason but not why they didn't pay.
  - There is a cut-off label "Busy co…" next to "Read as a list" that she could not read.
  - The workflow box says "Policy Renewal · completed" while the policy lapsed, which she found odd ("completed?").

TASK 5: "On A. Okafor's claim, there is a line near the top that goes down twice. Are those two drops the same kind of information?"
- ANSWER: "No. That's the mood line. The first drop is dashed with a hollow dot: that's us assuming, 'inferred: waited more than two days for an answer', when they were told the claim was settled. The second drop is a solid thick line with a filled dot: that's the customer actually telling us, 'the customer said so: said so in the survey', 2 out of 5. So one is a guess by a rule, the other is what they said."
- DONE: yes
- ACTIONS: 3 clicks ("Motor Claim" tab top right; the first dip's dot; the diamond under the second dip), plus one attempt on the second dip's dot itself, which could not be selected while it was greyed out
- FIRST MOVE: "Back to Okafor's claim with the 'Motor Claim' tab, then I looked at the 'MOOD' label on the left: 'solid: said · dashed: inferred'."
- THINKING ALOUD:
  - "The label on the left already tells me: solid is said, dashed is inferred. And the key at the bottom has a filled circle 'mood the customer stated' and a hollow one 'mood inferred by a rule'."
  - "I'll click the first dip to be sure. The bottom now says 'Mood −1 inferred: waited more than two days for an answer'."
  - "Everything to the right went grey. I wanted the second dip but its dot was greyed and I couldn't pick it."
  - "Clicked the white diamond under it instead: 'Answers the survey', 'Mood −1 the customer said so'. Fine."
  - "There's a third small move up at the end, dashed again. I'd guess that's the call back."
- MISREAD OR MISSED:
  - She could not select the greyed-out second mood dot directly and had to guess that the diamond below it was the same moment.
  - When the first dip was selected, its label "Is told the claim is settled" covered the "3 days later" label, leaving "3 days late".
  - Otherwise understood.

TASK 7: not applicable in this round

WORDS SHE USED for the things on screen
- "The grid" or "the names and boxes" for the first screen; "box" for a cell.
- "The tabs top right" for Policy Purchase / Motor Claim / Policy Renewal.
- "The trail" for Journeys / Motor Claim / A. Okafor at the top left.
- "The bars" or "the calendar" for the one-lane-per-customer view.
- "The diagram" or "the wiring" for the single-customer view.
- "The mood line"; "dots" and "diamonds".
- "The list" for "Read as a list"; this was her real working tool.
- "The sentence at the bottom" for the caption strip.
- "The player buttons" for the bottom-left controls.
- "The strip of labels" for the pills (Arrived / Mood / Claimant paid reached…).
- She never said "journey", "touchpoint", "workflow" or "line of visibility".

"Was there a moment you did not know where you were?"
- "The first time the diagram opened. I knew whose claim it was from the name, but I had no idea where to start reading. The 'Technology' and 'Exchanged' rows are not mine."
- "When the list opened at the end of the story instead of Day 1."
- "Briefly in Haddad's renewal: I expected a failed payment and found a cancellation, and had to work out from 'Arrived upset from Motor Claim' that I was in the wrong chapter."
- "The trail at the top always told me which customer and which of the three I was in. That helped."

"If you could change one thing, what?"
- "Open the list by default for one customer, starting at Day 1, and put the drawing behind a button, not the other way round. The list is what I read out on the phone."
- "Second: say on the grid which box a failed payment is in. 'Stalled: needs action' doesn't tell me it was a bank rejection."

Controls used and never touched
- Used: the boxes in the grid; "Journeys" and "Motor Claim" in the trail; the Motor Claim and Policy Renewal tabs top right; "Read as a list" (four times); the back-to-start button (once); a customer lane in the bar view; one mood dot and one diamond in the diagram.
- Never touched: "Open a record" (sounds like opening a file, not for her); "previous customer / next customer"; "Look inside ›" on the workflow boxes; the "Everything" tab in the list; "Close"; the play button; the step arrows; "1x"; the slider; the keyboard; the pills in the top strip; the stage boxes at the top of the bar view; anything under Technology or Exchanged.

Did anything disappear or look broken?
- The list panel was gone after each following action, so she reopened it every time. This may be an effect of the test tool taking a fresh snapshot per action, not of the screen itself; I could not tell which.
- The list opened scrolled to the highlighted (last) moment, hiding Day 1 above the top edge.
- The "Everything" tab in the list header is clipped to "Everyth" / "Everytl".
- The pill row at the top runs off the right edge: "Stalled: needs a…" on Haddad's claim and "Co…" on Okafor's claim are cut, and "Busy co…" on Okafor's renewal is truncated.
- A selected-moment label overlaps the "3 days later" label.
- After selecting an earlier moment, the later part of the diagram goes grey and its mood dot cannot be picked. The key does say "later moments are dimmed", but to her it looked disabled.
- "Policy Renewal · completed" on a policy that lapsed, and "under way" on all the workflow boxes when she was at the start, read oddly to her.
