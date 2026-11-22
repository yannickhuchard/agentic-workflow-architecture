# Synthetic session: Camille, customer experience lead

> This is the report of an AI agent playing a persona and using the journey view through screenshots and clicks, without access to the code or the documentation. It is a simulation, not a session with a person. Protocol: [usability-test-kit.md](../usability-test-kit.md). Tool: [synthetic-session.mjs](../synthetic-session.mjs).

SYNTHETIC PARTICIPANT REPORT: Camille (CX lead, insurer)

All seven tasks were attempted and none was abandoned. Total: 31 actions.

## TASK 1: "Who needs someone to do something today, and why?"
- ANSWER: "Two people, both on their motor claim. L. Petit: the claim has sat in 'Reported' for 10 days when it's given 7, and nothing has moved. R. Haddad: the settlement failed, so the claim is stuck in 'Assessed and settled'. Both are unhappy and Haddad is the more upset (−1.5 against −1)."
- DONE: yes
- ACTIONS: 3 (Petit's amber box, "Journeys", Haddad's amber box)
- FIRST MOVE: "The two amber 'Stalled: needs action' boxes in the middle column. They jump out of the grid before I read anything else."
- THINKING ALOUD:
  - "Six rows, three columns. This is basically my journey wall, with a mood squiggle in each box."
  - "The card at the top says '2 stalled' in amber and I can see both of them. Good."
  - "I clicked Petit's and the sentence at the bottom told me straight away: 10 days, allowed 7, someone needs to act."
  - "It doesn't say who should act or what they should do. 'Someone needs to act' isn't an owner."
  - "Odd: Petit's claim is stuck, but the renewal box next to it says Completed. I shrugged and moved on."
- MISREAD OR MISSED:
  - She never asked why Petit's claim stalled. The dashed amber "nothing arrives in time" markers meant nothing to her.
  - She took "needs action" to mean "today" without checking any date.
  - She did not look at the "left", "lapsed" or "cancelled" customers as possibly needing action.

## TASK 2: "Tell me what has happened to A. Okafor so far."
- ANSWER: "They reported a side impact on a roundabout on day 1. The claim was assessed and they were told on day 4 that it was settled and EUR 7,950 was paid. They were already unhappy by then because they'd waited more than two days for an answer. On day 8 they gave us 2 out of 5 in the survey: 'It took too long to hear back.' On day 9 someone called back, apologised and offered a courtesy car next time. Claim closed and paid, but 'customer satisfied' was not reached. They end slightly unhappy."
- DONE: yes. She skipped the first stage (the evidence request 6 hours in) and could not say what happened there.
- ACTIONS: 11 (Journeys, Okafor's claim box, play, step forward, drag slider, back ×3, drag slider, forward ×2)
- FIRST MOVE: "Back to the grid, then Okafor's box in the claim column."
- THINKING ALOUD:
  - "Whoa, this is a lot. Dots, squares, wires going down to 'Payments (JSON-RPC)'. I'm ignoring the bottom half."
  - "The top line is the mood and the three grey panels are my stages. That part I get."
  - "I pressed the big purple play button, hoping it would tell me the story. It went back to the start and showed me one step."
  - "Stepping one at a time is 30 steps. No. I'll drag the slider to where the mood dips."
  - "I overshot and had to nudge back three times. I wanted to just click the dip on the mood line."
  - "The sentence at the bottom is the real content. The diagram is mostly a map to find the right sentence."
- MISREAD OR MISSED:
  - The slider positions don't line up with the picture where there is an "N days later" gap, so she overshot.
  - The mood dots did not appear to be clickable.
  - In the right-hand detail, "Mood −1 inferred: waited more than two days for an an…" was cut off, and the step counter overlapped it.
  - She never read the TECHNOLOGY or EXCHANGED rows.

## TASK 3: "Why did Okafor's claim go to an adjuster instead of being paid straight away?"
- ANSWER: "No rule covered the case: fraud score 0.45, estimated cost 8,200. So a model decided the 'settlement route' was review, 84% confident, and it then waited for a person, the adjuster."
- DONE: yes. She is repeating the sentence; she could not tell you which rule would have covered it or whether 0.45 is high.
- ACTIONS: 2 (purple diamond, one step forward)
- FIRST MOVE: "The purple diamond in the middle bar. The key at the bottom says 'a model decides', and a decision is what I'm after."
- THINKING ALOUD:
  - "The key at the bottom really helped here."
  - "'No rule covers this case': fine, I'll take that as given."
  - "84% confident. OK. Sounds confident enough."
  - "The next step says 'Adjuster review waits for a person'. That's the adjuster."
- MISREAD OR MISSED:
  - She accepted 0.45 and 84% without asking where they came from or what the thresholds are.
  - She did not connect this decision to the 3-day wait that made the customer unhappy, although the two sit side by side.

## TASK 4: "When Haddad's payment failed, was their money left reserved? How do you know?"
- ANSWER: "No. The bank rejected the transfer because the account was closed (Haddad changed bank during the year). Just before the failure there is a step called 'Release funds', and the text says it 'undoes Reserve funds, so nothing is left half done.' So the reservation was undone."
- DONE: yes
- ACTIONS: 4 (Journeys, Haddad's claim box, red square, one step back)
- FIRST MOVE: "The red square at the end of the red-outlined bar."
- THINKING ALOUD:
  - "The red bar says 'failed', and the red square must be the failure."
  - "'RPC error -32010: account closed'. I'll ignore the code; 'account closed' is all I need."
  - "It says nothing about reserved money. There's a strange dashed red circle just before it, so I stepped back one."
  - "'Release funds undoes Reserve funds, so nothing is left half done.' That's my answer, in plain words."
- MISREAD OR MISSED:
  - The dashed red circle is not in the key at the bottom. She found it by stepping back, not by recognising it.
  - She never saw a "Reserve funds" step itself, only the mention of it in the sentence.
  - She believes the sentence; she has no other evidence the money is free.

## TASK 5: "At which point in a claim do we lose the most customers?"
- ANSWER: "Right at the start, in 'Reported'. One customer left there (S. Lindqvist withdrew the claim) and another is stuck there (L. Petit). After that, one is stuck in 'Assessed and settled' and nobody is lost in 'Followed up'. It's only six people, so 'the most' is one."
- DONE: yes
- ACTIONS: 2 ("Motor Claim" in the trail at the top, drag slider to the end)
- FIRST MOVE: "'Motor Claim' in the trail at the top. I wanted the whole claim, not one person."
- THINKING ALOUD:
  - "This is a different view: one lane per customer on a calendar, with the stages as cards on top. I like this one best."
  - "Reported: 1 left. So that's the answer."
  - "Hang on, the right half of the chart is empty and there's a '6 Sept' line. Is this the whole picture?"
  - "I dragged the slider to the end and the numbers on the cards changed. I nearly read out mid-month numbers."
  - "By 'lose' I'd really mean churn, and the two people who dropped us are in the renewal column, not here."
- MISREAD OR MISSED:
  - The view opened part-way through (20 of 30). Nothing on the stage cards said "as of 6 Sept". By luck, "1 left" was the same at both points.
  - She did not notice that Castellano and Okafor are "Completed, a goal missed", which is a quieter kind of loss.

## TASK 6: "Did the way we handled Okafor's claim cost us anything later?"
- ANSWER: "Yes, twice. At renewal we gave 10% off the premium (EUR 819), and the offer says 'goodwill after a poor claim experience'. Then we lost them anyway: the policy lapsed unpaid, mood −2, 'customer kept: not reached'. They also arrived at the renewal already unhappy (−0.5)."
- DONE: yes
- ACTIONS: 6 (Journeys, Okafor's renewal box, small square at the start of the line, forward ×3)
- FIRST MOVE: "Back to the grid. I remembered Okafor's last box said 'The policy lapsed unpaid'."
- THINKING ALOUD:
  - "The grid already told me the ending. Now I want to know whether it's because of the claim."
  - "The mood line starts below the middle. Did they carry the bad mood over? I think so, but it doesn't say."
  - "I stepped from the start. 'Renewal due', something starts, then the offer…"
  - "There it is, in the letter text: −10% goodwill after a poor claim experience. That's the link."
  - "Nothing draws a line from the claim to the renewal. I joined them up in my head."
- MISREAD OR MISSED:
  - The carry-over of the −0.5 mood from claim to renewal is implied only; she assumed it.
  - She did not look at the reminders or why payment never came (the 21-day and 9-day gaps).
  - The link between the two journeys sits in one sentence that she could easily have skipped by jumping to the end.

## TASK 7: "The line near the top goes down twice. Are those two drops the same kind of information?"
- ANSWER: "No. I'd assumed they were. The first drop, when they're told it's settled, says '−1 inferred: waited more than two days for an answer'. That's the system guessing. The second says '−1 measured: said so in the survey'. That one is the customer actually telling us, 2 out of 5. One is a guess and one is real. And now I see the first dot is hollow and the second is filled in."
- DONE: yes, but only because the question pointed her at it.
- ACTIONS: 3 ("Motor Claim" tab at the top right, drag slider to the first dip, drag to the second)
- FIRST MOVE: "The 'Motor Claim' button at the top right. I was already on Okafor, so I tried it instead of going back to the grid."
- THINKING ALOUD:
  - "That worked and kept me on Okafor, but it put me at the very beginning with an empty chart. The grid boxes put me at the end."
  - "The label at the far left says 'MOOD said or inferred'. I read that an hour ago and it didn't register."
  - "The difference is in small grey text at the bottom right, one word: 'inferred' or 'measured'."
  - "In task 2 I told the story as 'unhappy by day 4' as if that were a fact. It was a guess."
  - "There's actually a third slope right at the start, 'has had an accident', also inferred. So is it two drops or three?"
- MISREAD OR MISSED:
  - Throughout tasks 1 to 6 she treated every mood number, including the −1.5 and −1 on the grid, as measured satisfaction.
  - The hollow/filled dot distinction is not in the key at the bottom.
  - The mood scores on the first screen give no hint that most of them are inferred.

## WORDS SHE USED
- "The grid" or "the wall": the first screen
- "Boxes": the cells in the grid
- "Mood squiggle" / "mood line"
- "Stages": the grey panels (Reported, Assessed and settled, Followed up)
- "The bar" or "pill": the rounded shape in the middle. She never said "workflow".
- "The sentence at the bottom": the narration
- "The slider"
- "The key": the legend
- "The trail at the top": the breadcrumb
- "Lanes": the calendar view
- "Stuck": stalled
- "The plumbing": everything under TECHNOLOGY and EXCHANGED

## "What was this screen for?"
"It's a journey map that's alive. I get the wall view of six customers across buying, claiming and renewing, with how they felt, and I can open one person and replay what happened to them step by step, including the back-office bits I'd normally never see. It's for finding who's stuck and why someone ended up unhappy."

## "Was there a moment you did not know where you were?"
- "When I first opened one customer. The grid was calm, then suddenly it was a circuit diagram. It took me a while to decide that only the top three rows were for me."
- "When I pressed play and everything vanished back to day 1. I thought I'd broken it."
- "On the lanes view, where I didn't realise I was looking at 6 September and not the end."
- "The 'Motor Claim' button at the top right dropped me at the start, while the grid boxes drop me at the end. Same place, different moment."

## "If you could change one thing, what?"
"Let me click the mood line itself, on the dips, and show me right there on the line whether it's something the customer said or something you guessed. Dotted for guessed, solid for said, something I can see without reading grey small print. I made half my statements today off guessed numbers without knowing."

Her second wish: when opening a customer, hide the plumbing rows until she asks for them.

## Play button, step buttons, going inside, moving sideways
- **Play button:** pressed once, in task 2. It jumped to the start and, in this test tool, did not visibly advance between looks. She abandoned it and never returned to it.
- **Step buttons:** used often, but only as a one-or-two-step nudge after dragging the slider or clicking a symbol. She never stepped through a whole journey; 30 steps felt too many.
- **Going inside a workflow:** no. She saw "look inside" under every bar seven or more times and never clicked it. The sentence at the bottom always gave her enough, and "inside" sounded like more plumbing.
- **Moving sideways to the same customer's other journeys:** only at the very end. For tasks 2, 4 and 6 she went back to the grid each time. She tried the top-right journey buttons once, in task 7, and it worked. She never touched the two small arrows either side of the customer's name and did not know what they would do.
- **Other things never used:** "Open a record" and the "1x" button.
