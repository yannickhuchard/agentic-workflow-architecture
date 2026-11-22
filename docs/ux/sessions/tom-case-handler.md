# Synthetic session: Tom, case handler

> This is the report of an AI agent playing a persona and using the journey view through screenshots and clicks, without access to the code or the documentation. It is a simulation, not a session with a person. Protocol: [usability-test-kit.md](../usability-test-kit.md). Tool: [synthetic-session.mjs](../synthetic-session.mjs).

SYNTHETIC PARTICIPANT REPORT: Tom (27, contact-centre case handler)

Two caveats about the session itself, not about Tom:
- One click in task 2 was my own slip (the tool's button numbers shifted and I hit "back one step" instead of play). I counted it as an action.
- Play may not work through this tool. When I pressed it, the screen moved one step and was on the same step at the next look. I could not tell whether that is the product or the snapshot tool, so treat Tom's "play didn't seem to do much" as unverified.

---

TASK 1: "Who needs someone to do something today, and why?"
- ANSWER: "Two of them, both on their motor claim. L. Petit: we asked for documents, nothing came back, and it's sat in 'Reported' for 10 days when it's only given 7. R. Haddad: the payout failed because the bank rejected the transfer, account closed (they changed bank), so the claim is stuck and they're upset."
- DONE: yes
- ACTIONS: 6
- FIRST MOVE: "The yellow 'Stalled: needs action' on L. Petit's row; I clicked that box."
- THINKING ALOUD:
  - "Yellow 'Stalled: needs action', there are two of those. That'll be it."
  - "Big diagram... I'll just read the sentence at the bottom. 'Reported has lasted 10 days, longer than the 7 it is given. Someone needs to act.' OK, but why?"
  - "I'll press the back arrow at the bottom. 'The deadline passes: no documents.uploaded from L. Petit.' So he never sent his papers. He doesn't like online; someone should ring him."
  - "Back to 'Journeys' at the top, same thing for Haddad."
  - "One step back: 'Bank rejected the transfer: RPC error -32010: account closed'. I get the 'account closed' bit; the rest is IT-speak."
- MISREAD OR MISSED:
  - He never noticed the "2 stalled" count in the Motor Claim box at the top; he went by the yellow text in the rows.
  - "Someone needs to act" does not say who or what, so he had to step backwards to find the reason.
  - "documents.uploaded" and "RPC error -32010" read as system codes to him.
  - He did not consider whether the lapsed or cancelled renewals (Okafor, Haddad) also need someone today.

TASK 2: "A. Okafor is on the phone about their claim. What has happened so far?"
- ANSWER: "You reported a side impact on a roundabout on day 1 at 8:00, both left doors and the sill. We emailed asking for photos, the police report and a repair quote, and you uploaded all three about six hours later. Your claim was registered and went to assessment: we priced the parts, checked your cover, and it was sent for an adjuster to review. That sat for three days, then the adjuster approved it: 'Costs match the photos.' After that... I know from the end screen it was paid and closed, and that you weren't happy, but I didn't get to read the last part properly."
- DONE: partly (read steps 1 to 16 of 30 in order, ran out of actions; the ending came only from the labels "Claimant paid reached / Customer satisfied not reached / Completed")
- ACTIONS: 20 (limit hit)
- FIRST MOVE: "Back to Journeys, then Okafor's box under Motor Claim."
- THINKING ALOUD:
  - "It opens at the end with everything drawn at once. I need it from the beginning, so the 'back to start' button."
  - "Now next, next, next... one sentence each. Good, I can read these out on the phone."
  - "'The journey enters the stage Reported', 'The workflow announces claim.registered to other systems': I wouldn't say those to a customer. Half of these clicks are padding."
  - "'1 / 30'. Thirty clicks? I'll try the big purple play... it moved one and that was it."
  - "'Part priced' came up twice with the same sentence. Did I double-click?"
  - "Sixteen in and I've only just got to the adjuster approving it."
- MISREAD OR MISSED:
  - No single "story so far" paragraph for one customer's claim; he wanted that and could not find it.
  - He did not think to drag the slider or click the shapes on the diagram.
  - He ignored the Technology and Exchanged rows entirely.
  - The two identical "repair catalogue is called" steps made him think he had mis-clicked.

TASK 3: "Why did Okafor's claim go to an adjuster instead of being paid straight away?"
- ANSWER: "It says no rule covered the case: fraud score 0.45 and an estimated cost of 8,200, so 'a model' decided it should go to review, 84% confident. So the computer sent it to a person because it was a big-ish amount with a middling fraud score. I couldn't tell you what the actual limit is."
- DONE: yes (reason found; the threshold itself is not shown)
- ACTIONS: 2
- FIRST MOVE: "Two steps back to the purple diamond I'd just gone past."
- THINKING ALOUD:
  - "I just read this one: 'No rule covers this case'."
  - "'A model decides': is that a person, or the computer? The computer, I think."
  - "'Settlement route: review'. So the choices were pay or review."
  - "I'd never say 'fraud score' to the customer on the phone."
- MISREAD OR MISSED:
  - He is unsure what "a model" is.
  - He saw "look inside" under the bar and did not click it ("I don't know what that opens").
  - He cannot say which of the two numbers triggered the review.

TASK 4: "When Haddad's payment failed, was their money left reserved? How do you know?"
- ANSWER: "No. There's a step called 'Release funds' and the sentence says 'Release funds undoes Reserve funds, so nothing is left half done.' So it was put back. I never actually saw the 'reserve' step or the payment attempt on the picture, so I'm taking that sentence's word for it."
- DONE: yes (with low confidence in the evidence)
- ACTIONS: 6
- FIRST MOVE: "Journeys, then Haddad's yellow box, then the back arrow from the 'failed' step."
- THINKING ALOUD:
  - "One back: bank rejected the transfer. One more: 'Release funds undoes Reserve funds'. That's the answer."
  - "Hang on, the release is before the 'fails' step. Shouldn't it fail first, then release?"
  - "Where's the reserve? I'll go back more... part priced, cover checked. No reserve, no payment step."
  - "The Payments row on the left has nothing on it at all. Odd, for a payment that failed."
- MISREAD OR MISSED:
  - The reserve step and the payment attempt are not visible at this level; they are presumably behind "look inside", which he never opened.
  - The order (release shown before "workflow fails") confused him.
  - The red dashed circle for "Release funds" is not in the key at the bottom.

TASK 5: "At which point in a claim do we lose the most customers?"
- ANSWER: "Right at the start, in 'Reported'. Of six, four moved on, one stalled and one left: S. Lindqvist withdrew. Next stage, 'Assessed and settled', one more is stuck (Haddad) but nobody left. If you mean actually gone, it's one person, at Reported. If stuck counts, it's still Reported, two of six."
- DONE: yes
- ACTIONS: 3
- FIRST MOVE: "Journeys, then I clicked the big 'Motor Claim' box at the top, because the text said 'select a journey to see everyone in it'."
- THINKING ALOUD:
  - "It's empty. Everything says 0. Have I broken it?"
  - "Oh, it's at '1 / 30', the 1st of September. The other screens opened at the end; this one opens at the start."
  - "Dragged the dot to the right. Now there are bars for everyone and the boxes have numbers."
  - "'Left' 1 under Reported. Does 'stalled' count as lost? I'll say both."
- MISREAD OR MISSED:
  - The empty opening state frightened him for a moment.
  - "Left" versus "stalled" versus "lose" is ambiguous to him.
  - On the first screen he had seen "2 left" under Policy Renewal and nearly answered "renewal" before re-reading "in a claim".

TASK 6: "Did the way we handled Okafor's claim cost us anything later?"
- ANSWER: "I think so. Their renewal ended 'The policy lapsed unpaid', 'Customer kept: not reached', mood upset −2. They went into the renewal already unhappy at −0.5, which is where the claim left them, after 'it took too long to hear back'. So we probably lost the customer over the slow claim. But nothing on the screen says 'because of the claim'; I'm joining the dots myself."
- DONE: partly (right conclusion, inferred; no explicit link found)
- ACTIONS: 5
- FIRST MOVE: "Journeys, look along Okafor's row to the last column, click 'The policy lapsed unpaid'."
- THINKING ALOUD:
  - "On the first screen the row reads left to right: pleased, unhappy, upset. That's the story already."
  - "Opened the renewal: 'The journey ends here. The policy lapsed unpaid.'"
  - "Went to the start: mood already says 'unhappy (−0.5)' before anything's happened. That's carried over from the claim, isn't it?"
  - "'Nothing arrives in time' twice. They just ignored our reminders."
  - "'Cost us': is there a money figure? I can't see one."
- MISREAD OR MISSED:
  - No stated cause linking claim to renewal.
  - No cost in money.
  - The workflow bar says "Policy Renewal · completed" in green while the policy lapsed, which he found contradictory.
  - He did not notice the "6 → go on" arrows between the boxes on the first screen as meaning anything.

TASK 7: "The line near the top goes down twice on Okafor's claim. Same kind of information?"
- ANSWER: "No. The first drop is when they're told the claim is settled, and it says '−1 inferred: waited more than two days for an answer'. That's us guessing. The second is when they answered the survey, 2 out of 5, 'It took too long to hear back', and it says '−1 measured: said so in the survey'. So one's assumed and one's what they actually told us. The dot is hollow on the first and filled on the second, which I only noticed afterwards."
- DONE: yes
- ACTIONS: 5
- FIRST MOVE: "I was on Okafor's renewal, so I tried the 'Motor Claim' button top right, and it kept me on Okafor."
- THINKING ALOUD:
  - "It's gone back to step 1 and the line isn't drawn. Last time I opened this claim it was at the end."
  - "Drag the dot to the end, there's the line with two dips."
  - "I tried to point at the dip itself; nothing to click. So I dragged the slider until the highlight sat under it."
  - "The 'Mood' note is tiny, bottom right, and on the first one the step counter '18 / 30' sits on top of the last word."
  - "'Said or inferred' under MOOD on the left: now I understand what that meant."
- MISREAD OR MISSED:
  - The "inferred" note is partly covered by the step counter (the word after "for an" is clipped).
  - Hollow versus filled dot is not explained in the key.
  - The line also rises in between and he never found out why.

---

WORDS HE USED
- "the grid" / "the boxes" for the first screen's cells; "the row" for a customer
- "the little line" / "the mood line"
- "the diagram" / "the map" for the single-customer screen
- "the long green bar" for a workflow; "the dots", "the diamonds"
- "the sentence at the bottom" for the narration: his main source of truth
- "the slider", "the arrows", "the big purple play button"
- "the tabs top right"; "the trail at the top" for the breadcrumb
- "the calendar" / "the bars" for the Motor Claim everyone-view
- "stuck" for stalled; "the computer decided" for "a model decides"
- He never said "journey", "workflow", "touchpoint" or "stage" unprompted.

"WHAT WAS THIS SCREEN FOR?"
"It's a replay of what happened to each customer, a bit like the case notes in the CRM but drawn as a diagram you step through one event at a time. The first page tells you who ended up happy or not and who's stuck. I think it's really meant for someone working out where the process goes wrong, more than for me on a call."

"WAS THERE A MOMENT YOU DID NOT KNOW WHERE YOU WERE?"
"Yes, twice. When I clicked the Motor Claim box and everything said 0 and the page was blank, I thought I'd broken it. And when I used the tab top right, Okafor's claim opened at step 1 with nothing drawn, when earlier the same claim had opened at the end. The same screen starts in different places depending on how you get there. I also never worked out what the little < > arrows next to the customer's name do, so I left them alone."

"IF YOU COULD CHANGE ONE THING, WHAT?"
"Give me the customer's whole story as a short list I can read top to bottom, just the things that happened to the customer, without 'enters the stage' and 'announces to other systems'. Thirty clicks to read one claim is too many when someone's on the phone."

PLAY, STEP BUTTONS, GOING INSIDE, MOVING SIDEWAYS
- Step buttons: yes, heavily. Back, next and "back to start" were his main tool from task 1.
- Play: pressed once, in task 2 out of frustration at 30 steps. It appeared to advance one step and stop, and he did not try again (see caveat at top).
- Slider: only discovered in task 5, when forced by the blank screen; he used it again in task 7.
- Going inside a workflow: no. He read "look inside" under the bars several times and never clicked it. That is probably why he never saw the reserve or payment steps in task 4 or the decision detail in task 3.
- Moving sideways to the same customer's other journeys: only at task 7, via the top-right tabs, and it worked. Before that he went back to the first screen every time (five round trips). He never used the < > arrows beside the name.
- He never clicked a shape on the diagram and did not realise they were clickable.
