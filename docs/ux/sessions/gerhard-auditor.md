# Synthetic session: Gerhard, internal auditor

> This is the report of an AI agent playing a persona and using the journey view through screenshots and clicks, without access to the code or the documentation. It is a simulation, not a session with a person. Protocol: [usability-test-kit.md](../usability-test-kit.md). Tool: [synthetic-session.mjs](../synthetic-session.mjs).

SYNTHETIC PARTICIPANT REPORT: Gerhard, 56, internal auditor

Screenshots only; no repo files read. Final screen: sessions/gerhard/screen.png

---

TASK 1: who needs someone to act today, and why
- ANSWER: "Two. L. Petit and R. Haddad, both on their motor claim, both marked 'Stalled: needs action'. Petit: we asked for documents, nothing came back after two waits of 5 days, the 'Reported' stage has run 10 days against 7 allowed. Haddad: the settlement work failed on day 2 and nothing has moved since. I do not yet know why it failed."
- DONE: yes (the reason for Haddad is shallow at this point)
- ACTIONS: 5
- FIRST MOVE: Read the whole first page, then clicked the yellow "Stalled: needs action" box in L. Petit's row.
- THINKING ALOUD:
  - "Yellow text 'Stalled: needs action', twice. The header also says '2 stalled'. That agrees, good."
  - "The sentence at the bottom tells me 10 days against 7. I want to see what was waited for." (pressed the back arrow button, then clicked the little dotted diamond)
  - "'No documents.uploaded from L. Petit': that is a system word, but I understand it."
  - "Where is the way back? No back button. 'Journeys' at top left, I suppose."
  - "It says 'someone needs to act'. Who? It does not say which department."
- MISREAD OR MISSED: Did not notice that the two renewal customers who left (Okafor lapsed, Haddad cancelled) might also "need someone"; he took the yellow label literally. Never understood why J. Moreau's row was outlined on arrival and L. Petit's later; the slider on the first page meant nothing to him.

TASK 2: what has happened to A. Okafor so far
- ANSWER: "Day 1, 08:00, reported a side impact on a roundabout through the portal. 08:03 we emailed asking for photos, police report and repair quote. 14:03 they uploaded all three. Same afternoon the part was priced and the cover checked against contract POL-51902. At 14:15 it was sent to an adjuster for review. The adjuster approved three days later, day 4, 14:15: 'Costs match the photos.' Payment order PAY-2044 went to the bank at 14:18 and at 14:20 they were emailed that claim CLM-2044 is settled, EUR 7950. After that there is a follow-up I did not get through; I only know from the end picture that it finished on day 9 with 'customer satisfied: not reached'."
- DONE: partly (reached step 18 of 30 when the 20 actions ran out)
- ACTIONS: 20 (Journeys, the claim box, back-to-start button, 17 right-arrow presses)
- FIRST MOVE: Back to the first page, clicked Okafor's box in the "Motor Claim" column.
- THINKING ALOUD:
  - "It opens at the end and everything is on at once. Too much. I want it from the beginning." (pressed the |< button)
  - "Good, one thing at a time, with a time stamp and a sentence. This I can write down."
  - "Several steps tell me nothing a customer would care about: 'journey enters the stage', 'workflow starts', 'workflow announces claim.registered', 'Reported is complete'. Four presses for one moment in time."
  - "'Part priced' appears twice with the identical sentence. A duplicate, or two parts? I cannot tell."
  - "Estimated cost 8200, paid 7950. Why the difference? Nothing explains it here."
  - "Thirty steps. With a customer on the line this is too slow."
- MISREAD OR MISSED: Did not consider the play button (distrusts animation) or dragging the slider. There is no plain summary of the case anywhere to read out. The mood note at bottom right was cut off and overlapped by the "18 / 30" counter ("waited more than two days for an an…").

TASK 3: why the adjuster instead of straight payment
- ANSWER: "No rule covered the case. Fraud score 0.45, estimated cost 8200. A model, acme:classifier-small, then chose 'review' with 84% confidence, minimum accepted 60%. Its stated reason: the repair is costly and the fraud score is neither low nor high, so an adjuster should confirm before payment. Record: event 37 of run c6271395."
- DONE: yes
- ACTIONS: 2
- FIRST MOVE: Clicked the purple diamond he remembered from stepping through ("a model decides"), then the words "look inside" under the long bar.
- THINKING ALOUD:
  - "The sentence says 'no rule covers this case'. I want the record, not the sentence."
  - "'look inside': it is written small and grey, but it says what it does. I click it."
  - "Now this is what I wanted: 'Evidence for this step', with a journal record number. I write that down."
  - "'Rules: none matched'. Which rules? I cannot see them, so I cannot check that none should have matched."
  - "Two lines end in '…'. The model's reason is cut off. In an evidence box that is not acceptable."
- MISREAD OR MISSED: Could not see the rules or thresholds themselves. "Capability tier fast" meant nothing to him. Did not understand "being replayed" at top right.

TASK 4: was R. Haddad's money left reserved
- ANSWER: "No. The bank rejected the transfer on day 2 at 08:18 (RPC error -32010, account closed). At 08:19 'Release funds' undid 'Reserve funds'; the record says '1 of 1 completed step undone'. Source: events 47 and 48 of run 312ba464. But I only have the system's own statement; no amount, no confirmation from whoever holds the reserve."
- DONE: yes
- ACTIONS: 4
- FIRST MOVE: Back to "Journeys", Haddad's claim box, then "Motor Claim Settlement · failed · look inside".
- THINKING ALOUD:
  - "Now I know 'look inside' exists, I go straight there."
  - "Red box 'Pay claimant', and under 'Reserve funds' a box called 'Undo step: Release funds'. That looks like my answer."
  - "The list line is cut off: 'so nothing is left h…'. I click it to read the whole of it. 'Nothing is left half done.'"
  - "The evidence box for this step holds only 'event 47 of run 312ba464'. Thin. For the model decision there were six lines; for money there is one."
- MISREAD OR MISSED: Nothing misread. Missing for him: the amount reserved and released, and that "Reserve funds" now has a dotted outline meaning "undone afterwards", which he only worked out from the key afterwards.

TASK 5: where in a claim we lose the most customers
- ANSWER: "At the very first stage, 'Reported'. Of six, four moved on, one stalled and one left (S. Lindqvist withdrew the claim). At 'Assessed and settled' one more stalled, none left. At 'Followed up' nobody was lost. If 'lose' means only those who actually went, it is one customer and it was at 'Reported'."
- DONE: yes, with a caveat about what "lose" means
- ACTIONS: 2
- FIRST MOVE: Clicked "Motor Claim" in the trail at the top left.
- THINKING ALOUD:
  - "A calendar with one line per customer. Three boxes with counts per stage. Good."
  - "But it says 'Reported: 3 here now, 0 stalled', and the first page said 2 stalled. These do not agree."
  - "Ah, a line at '5 Sept'. The page is standing in the middle of the month. Why? I did not ask for the 5th." (dragged the slider to the right end)
  - "Now 1 stalled and 1 left under Reported, 1 stalled under Assessed. That reconciles with the first page."
  - "Is a stalled customer 'lost'? The screen does not say. I report both."
- MISREAD OR MISSED: Nearly reported the mid-month figures as final. The page opened at a slider position inherited from elsewhere with no warning that the counts are "as at" that date. He did not connect this question to the renewal column (2 left there).

TASK 6: did the handling of Okafor's claim cost us anything later
- ANSWER: "Yes, as far as I can show it. In the renewal, the offer on day 1 reads 'premium EUR 819 (-10%: goodwill after a poor claim experience)', so we gave away ten percent. They still did not pay: deadline passed on day 22, SMS reminder, deadline passed again on day 31, lapse notice by post, mood 'upset (-2)', 'Customer kept: not reached'. So a discount and a lost policy. The link to the claim is that one phrase in the letter and the fact the renewal starts at the same 'unhappy (-0.5)' the claim ended on. Nothing on screen states outright that one caused the other."
- DONE: yes
- ACTIONS: 11 (Journeys, the renewal box, the little square at the start, 8 right-arrow presses)
- FIRST MOVE: Back to the first page; he remembered "The policy lapsed unpaid" in Okafor's row and clicked that box.
- THINKING ALOUD:
  - "The first page already had it: claim 'unhappy', renewal 'lapsed unpaid, upset'. But side by side is not cause."
  - "The mood line here starts below the middle. Carried over from the claim? It does not say."
  - "There: 'goodwill after a poor claim experience'. That is a written link. I note day 1, 08:03, invoice INV-R2210."
  - "What it cost in euros I must work out myself; 819 is after the discount. The lost premium is not shown as a figure anywhere."
- MISREAD OR MISSED: Did not use the three-part switch at top right to go from the claim straight to the renewal for the same customer; went the long way through the first page. No total "cost" figure exists for him to find.

TASK 7: are the two drops in the top line the same kind of information
- ANSWER: "No. The first drop, day 4 when they were told the claim is settled, is '-1 inferred: waited more than two days for an answer'; that is the system's assumption. The second, day 8, is '-1 measured: said so in the survey'; the customer gave 2 out of 5 and wrote 'It took too long to hear back.' One is a guess, one is a statement. I would only rely on the second."
- DONE: yes
- ACTIONS: 4 ("Motor Claim" at top right, slider to the end, diamond under the second dip, diamond under the first dip)
- FIRST MOVE: Clicked "Motor Claim" in the group at the top right, half expecting to land on the calendar page; it stayed on Okafor.
- THINKING ALOUD:
  - "The label says 'Mood: said or inferred'. So there are two kinds. Which is which?"
  - "I want to click the dot on the line itself. Nothing there to click. I try the diamond underneath instead."
  - "Bottom right, small: 'Mood: -1 measured: said so in the survey'. And the other: '-1 inferred'. There it is."
  - "Now I see one dot is filled and one is hollow. Probably that is the difference. The key at the bottom does not say so."
  - "There is also a short slope down at the very start of the line, 'inferred: has had an accident'. Is that a third drop? The task said two."
- MISREAD OR MISSED: The filled/hollow dot distinction is not in the key; he only guessed it after reading the text. The initial slope at the far left confused him (the pill says "neutral (0)" while the note says "-1 inferred"). The inferred note was again cut off by the step counter.

---

WORDS HE USED for the things on screen
- "the first page" / "the table" (the overview of customers by journey); "box" (a cell); "the little mood line"
- "the customer's sheet" or "the chart with the rows" (the single-customer view); "rows" (Mood / Customer / Journey / Workflows / Technology / Exchanged)
- "the long bar" or "the pill" (the bar on the work row); "marks", "diamonds", "the dotted diamond", "the purple diamond"
- "the sentence at the bottom" (the narration); "the small print bottom right" (the detail fields)
- "the flow chart" (inside view); "the list" (story so far); "the evidence box"
- "the calendar page" (per-journey lanes)
- "the trail at the top" (breadcrumb); "the three-part switch" (Policy Purchase / Motor Claim / Policy Renewal)
- "the slider", "the arrow buttons", "the play triangle", "the key" (legend)
- He never said "journey" or "workflow" unprompted; he said "the claim", "the renewal", "the work behind it". "Touchpoint" and "line of visibility" he read aloud and did not use again.

"What was this screen for?"
"It is a case file you can leaf through. For each customer and each matter (purchase, claim, renewal) it shows in order what the customer did, what we told them, what our systems and people did behind that, and how the customer presumably felt. One level down there is a flow chart with a log and a journal reference. It is for reconstructing a case after the fact. It is not a to-do list: it tells me something is stalled, not who must do what."

"Was there a moment you did not know where you were?"
"Three. First, when I opened a customer and it showed the last step with everything drawn at once; I did not know I was looking at 'the end'. Second, the calendar page stood at 5 September with half the bars missing and counts that contradicted the first page, until I saw the slider was in the middle. Third, on the first page a row was outlined and the bottom said 'Customer 1 of 6', later 'Customer 3 of 6'; I never understood what was being stepped through there. Also there is no 'back'; I used 'Journeys' every time and started again."

"If you could change one thing, what?"
"Give me the whole case as a dated list I can read top to bottom and copy, each line with its record number. That is the 'story so far' list from the flow chart page, but for the whole customer sheet and without cut-off lines. Thirty arrow presses for one claim is not workable on the telephone, and anything ending in '…' inside an evidence box is not evidence." (Second, if allowed: never open a page in the middle of time without saying so.)

Play button / step buttons / going inside / moving sideways
- Play button: never used. He saw it, the most prominent and only coloured control, and avoided it ("I do not want it to run away from me").
- Step buttons: yes. Used the on-screen back-one arrow once (task 1) and the back-to-start button once (task 2); otherwise the keyboard right arrow (25 presses in total). Dragged the slider twice, only from task 5 on, after seeing the page was "in the middle".
- Going inside a workflow: discovered on his own in task 3, because the label literally says "look inside". He did not find it in tasks 1 and 2 because he had no reason to; the label is small and grey, and nothing on the bar itself suggests it opens. Once found, he used it directly in task 4.
- Moving sideways to the same customer's other journeys: not really discovered. In task 6, the task that needed it, he went back to the first page and picked the renewal box. In task 7 he clicked "Motor Claim" in the top-right switch and was surprised it kept him on Okafor; he would not have predicted that. The unlabelled < > arrows beside the customer's name he never touched: "previous and next what? Customer? Step? It does not say."

Other honest observations
- What worked for him: time-stamped plain sentences; "said or inferred" / "measured" vs "inferred" wording; journal record numbers; the verbatim customer letters; counts on the first page that reconcile with the detail.
- What did not: text truncated with "…" in exactly the places an auditor reads (customer description, story lines, model reason, evidence fields); mood note overlapped by the step counter at bottom right; several consecutive steps carrying the same timestamp and no new fact; "Part priced" shown twice with identical wording; 8200 estimated vs 7950 paid unexplained on the customer sheet (the "settlement amount: 7950" line exists only inside the flow chart list, itself truncated); "Rules: none matched" without showing the rules; evidence for the funds release is a bare event number; system identifiers shown raw ("documents.uploaded", "renewal.paid", "claim.registered", "RPC error -32010", "JSON-RPC"); the key at the bottom explains the marks but not the filled/hollow mood dots; "Stalled: needs action" never says whose action.
- The Technology and Exchanged rows (about half the sheet's height) he read once and never used for any answer.
