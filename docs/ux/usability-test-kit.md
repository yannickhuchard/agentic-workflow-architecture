# Journey view: usability test kit

Everything needed to run the validation planned in [the research](journey-visualisation-research.md), section 9. **These sessions have not been run.** Until they have, every claim that the view works for people is a hypothesis; the scripted walkthrough only shows that answers are reachable.

## What you need

| | |
|---|---|
| People | Five per role is enough to find most problems. Start with whoever you can get: the first two tasks need no special background |
| Time | 30 minutes each |
| Setup | `tools/visualization/journey.html` open in a browser on the sample record, at the Journeys height. Screen and voice recorded, with consent |
| You | One person to run the session, ideally a second to take notes. Neither built the view |

## Before the first task

Say this, and nothing more about the view:

> This shows what happened to six customers of an insurer over a year. I am going to ask you to find some things out. I am testing the screen, not you: if something is hard to find, that is what I need to know. Please say what you are thinking as you go. I will not help unless you are completely stuck.

Do not demonstrate anything. Do not name the heights, the journey switch or the play button.

## Tasks

Give one at a time, in this order. Read the task aloud and hand it over on a card. Stop a task after five minutes.

| # | Role it matters most to | Task card | Counts as done when they say |
|---|---|---|---|
| 1 | Operations lead | "Some of these customers need someone to do something today. Who, and why?" | L. Petit: no documents for ten days. R. Haddad: the payment failed |
| 2 | Case handler | "A. Okafor is on the phone about their claim. Tell me what has happened to them so far." | In order: reported, documents sent the same day, a three-day wait for an adjuster, paid, rated it 2 out of 5, was called back |
| 3 | Workflow designer | "Why did A. Okafor's claim go to an adjuster instead of being paid straight away?" | No rule covered it; a model chose review, and its reason |
| 4 | Auditor | "When R. Haddad's payment failed, was their money left reserved? How do you know?" | No: the reserve was released. They point to the record |
| 5 | Journey owner | "At which point in a claim do we lose the most customers?" | The first stage, Reported: one stalled, one withdrew |
| 6 | Journey owner | "Did the way we handled A. Okafor's claim cost us anything later?" | The policy was not renewed |
| 7 | Anyone | "On A. Okafor's claim, the line at the top goes down twice. Are those two drops the same kind of information?" | No: one is something we assumed (the wait), one is something they told us (the survey) |

Task 7 tests the one thing the design must not get wrong: that a reader can tell a measured mood from an inferred one.

## What to write down, per task

| | |
|---|---|
| Done without help? | yes / with a hint / no |
| Time to the answer | |
| First thing they clicked | |
| Where they looked for the answer first, if not where it is | |
| Words they used for things on screen | Their words, not ours. If nobody says "atlas" or "blueprint", those are our words |
| Anything they misread | Especially: gap labels ("3 days later"), hollow and filled marks, the mood line |
| Did they use play, step, or neither? | |
| Did they discover going down into a run / sideways to another journey by themselves? | |

## After the last task

Three questions, in these words:

1. "What was this screen for?"
2. "Was there a moment you did not know where you were?"
3. "If you could change one thing, what?"

## Reading the results

A task passes when four of five people in the role it matters most to complete it without help. For each task that does not pass, the notes on where people looked first say what to change.

| Result | Likely meaning | What to try |
|---|---|---|
| People answer task 1 from the calendar but never find the atlas rows | The atlas is not where they start | Open on the calendar of the journey with stalled customers |
| Nobody goes into a run in task 3 | The workflow bar does not look like a way in | A visible "look inside" control on the bar, not only a label under it |
| Task 6 fails | The journey switch is not noticed, or not understood as "same customer" | Show the customer's other journeys beside their name |
| Task 7 fails | Filled and hollow dots are not enough | Put the basis in words on the line itself |
| People press play and wait | Good for the story, bad for a question | Make jumping to a mark more obvious than playing |

Write the findings into the research document as section 12, with what was changed as a result.
