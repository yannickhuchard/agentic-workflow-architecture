# The dossier of a journey

One document of a journey and the work behind it, for a professional or for a client: the customers' stories in their own voice, the journey at a glance, the work of agents, people and systems, the analysis, the recommendations, and the record underneath. It comes in three formats from the same content:

| Format | What it is | Made by |
|---|---|---|
| HTML | One self-contained page: a chapter rail, motion that plays from a visible resting state, a table behind every chart, the recommendations map. Fonts come from Google Fonts, with system fallbacks; everything else is inside the file | `awa-dossier-html.js` |
| PDF | The A4 pages of the design (night and paper pages, running heads, folios), fourteen for a record like the electricity example's and more for a longer one, printed by Chromium as a tagged PDF with bookmarks | `awa-dossier-print.js`, then Chromium |
| DOCX | A Word document with real Heading 1 to 3 styles, the customers' voices in a style of their own, charts as images with alt text beside their data tables, repeated table header rows, page headers and numbers | `awa-dossier-docx.js` |

The content itself is computed by `tools/visualization/awa-dossier.js` from a portfolio export (`awa journey export`) and the journey view's options. It reads the measures from `awa-kpis.js` and the recommendations from `awa-recommendations.js`, so the dossier, the journey view and `awa measures` cannot disagree. The writers live beside the views in `tools/visualization`, so the SDK package carries them in `dist/views`.

## Make one

```bash
cd sdk/typescript && npm run build && cd ../..

# with the SDK
awa dossier --file examples/electricity-onboarding/journeys.json \
  --options examples/electricity-onboarding/views/story-options.json \
  --format html,pdf,docx --out dossier

# a client edition, for one customer, under the brand of the options
awa dossier --file examples/life-insurance-savings/journeys.json \
  --options examples/life-insurance-savings/views/story-options.json \
  --edition client --customer ENR-26001 --format html,pdf,docx --out lea

# from the repository, with the same options
node tools/dossier/dossier.mjs --record <journeys.json> --options <story-options.json> --format html,pdf,docx --out <path>
```

The HTML edition needs nothing else. The PDF needs Playwright with Chromium (`npm install playwright && npx playwright install chromium`); the DOCX draws its charts with Chromium when Playwright is there, and holds the data tables alone when it is not. The evidence report beside the record (`evidence/evidence-report.json`) is read for the appendix when it is there; `--evidence <file>` names another.

In the journey view, **Export dossier** opens the export dialog: it makes the HTML edition in the browser, offered as a link, and gives the command for the PDF and the DOCX. The MCP server's `make_dossier` tool returns the HTML edition of a portfolio given inline.

`node tools/dossier/make-dossiers.mjs` writes the dossiers committed with the examples:

| Example | Edition | Files |
|---|---|---|
| Electricity onboarding | professional | `examples/electricity-onboarding/dossier/new-customer-onboarding.professional.{html,pdf,docx}` |
| Life insurance savings | client, for Léa Muller, under the Valoria Life brand | `examples/life-insurance-savings/dossier/lea-muller.client.{html,pdf,docx}` |
| Life insurance savings | professional | `examples/life-insurance-savings/dossier/workplace-pension-savings.professional.{html,pdf,docx}` |

## A layout that fits the record

The print layout is measured before it is placed. A first rendering carries a ruler: every text whose size the layout depends on (a moment of a blueprint, a row of a table, a chart's label, a stage's name in its column); Chromium measures them, and the second rendering places the pages with those sizes (`printLayout` in `awa-dossier-node.js`). So a longer record (a year, nine stages, seven workflows, 43 runs in the life insurance example) keeps every text in its place:

| Where | What adapts |
|---|---|
| Lists (a customer's moments, the runs in numbers, a workflow's steps) | As many as fit, then a line "and N more" in the space kept for it |
| Charts | A stage name too wide for its column breaks with a hyphen or is shortened, on one or two lines; the tables beside the charts and the stage times in the appendix carry the names whole. A label that would meet another moves to the other side of its mark; marks keep clear of the corner labels |
| Steps of the workflows | Cards when they fit above who does what and the controls; a flowing list of named tags when there are many workflows |
| Analysis | Its blocks, A to H, keep the places of the design and move down, or to a third page, when the blocks before them are taller; a page's title names what is on it |
| Tables (recommendations, the EU AI Act appendix) | Run on to a continuation page with their header row repeated |
| The whole book | The running heads and folios follow the pages; the table of contents and the cross-references ("the stage times are on page 17") give the page each chapter starts on; nothing enters the bands of the running head and the folio |

The committed dossiers have 15 pages (electricity, professional), 7 (Léa's client edition) and 17 (life insurance, professional).

## The editions

| | Professional | Client |
|---|---|---|
| Customers | every customer, two told in their own voice | one customer, the one the edition is for; the others are lines without names |
| Figures | every measure, with its count | the customer's own times and stages only |
| Internal cost, model tokens | yes | no |
| The agents' internals: contracts, guardrails, refusals | yes | no |
| Recommendations | all, ranked | those that concern the customer, said without other customers' numbers |
| Compliance appendix | the EU AI Act provisions and what the evidence report holds | a short notice: the record exists and the customer may ask to see it |

## The customers' own words

Each persona's story is told in the first person by templates, from the record alone, so it is the same every time and needs no model. A touchpoint's name becomes a sentence ("Applies on the web form" becomes "I applied on the web form"), what was done out of the customer's sight is told as "What I did not see, the record shows", and a long silence is said as such ("Then nothing for fourteen days."). Every sentence carries the journal records it rests on: `J·28` is journey record 28 of that customer, `0093·74` is event 74 of run 00000093. No sentence states a feeling the record does not state: a mood inferred by a rule of the journey is shown as data beside the story, never put in the customer's mouth. A client edition names no other customer.

The narrator picks the most different journeys: one that went the whole way, and one that is stuck or failed. A journey's options can say more, under `dossier`:

| Option | Meaning |
|---|---|
| `subject` | `["household", "households"]`: what a customer is called |
| `lead` | The cover's sentence; `{Count}` is the number of customers in words |
| `personas` | `["APP-24002", "APP-24008"]`: whose stories are told |
| `say` | `{ "plan-recommended": "I had a recommendation: the {plan} plan, about {estimated_annual_cost_eur} euros a year" }`: a customer's words for a touchpoint, with values from the journey instance's data |
| `facts` | `[{ "label": "Plan", "value": "{plan}" }]`: the facts beside a persona's name |
| `promise` | `"P21D"`, or `false`: the time the journey promises, drawn on the cover (by default the service level of the workflow that starts the journey) |

## The workflow that makes it

`dossier.awa.json` is the dossier as an AWA workflow, as the design's board "How AWA makes the dossier" draws it: collect the record, compute the measures, then in parallel the narrator agent, the recommendation rules and the replays, then compose with the brand under an accessibility check (an output guardrail that sends a failing composition back), a person reviews and approves (not the one who asked for it, by the deployment's separation of duties), and export. The narrator works under an outcome contract with three postconditions: every sentence cites a journal record (`uncited_sentences == 0`), no feeling the record does not state (`unsupported_feelings == 0`), no other customer named in a client edition (`other_customers_named == 0`); a story that fails is refused and written again, and the second refusal goes to a person.

The narrator's model is configuration: its role asks for the tier `narrator`, and the deployment's tier map says which model serves it (for example from the variable `DOSSIER_NARRATOR_MODEL`). The workflow names no model. `dossier.simulation.json` scripts a run in simulation, in which the narrator's first story is refused for a sentence without a reference:

```bash
awa run tools/dossier/dossier.awa.json --simulate --outputs tools/dossier/dossier.simulation.json
```

`sdk/typescript/tests/dossier.test.ts` plays it end to end. The dossier's own run is journalled, so an evidence report can say who made a dossier, from which record, and who approved it.

## Checks

```bash
cd tools/dossier && npm install && cd ../..      # axe-core, pinned, for the accessibility rules
node tools/dossier/dossier.check.mjs              # add --rebuild to write the dossiers again and compare the bytes
node tools/dossier/dossier.check.mjs --layout     # the print layout alone, in a few seconds
```

The check lays out each print edition again as `make-dossiers.mjs` does and reads every page in Chromium: each line of text and each chart label is a box, and it fails when two texts intersect (an element marked `data-layer` is layered on purpose), when a text lies on a chart's mark, when an element with a fixed size or hidden overflow holds more than its size, when a chart label leaves its chart, and when text leaves the page or enters the bands of the running head and the folio. It also opens each HTML edition in Chromium at 1440 and 400 px and runs axe-core (WCAG 2.2 A and AA rules) from `node_modules`, never from a network; it measures the contrast of every text against what is behind it, follows the keyboard from the skip link, opens a chart's table from the keyboard, checks that nothing animates under `prefers-reduced-motion` or with the Motion switch off, and that nothing scrolls sideways at 400 px. It reads each PDF (page count, tags, language, title shown, bookmarks, figures with alternative text, table header cells) and each DOCX (heading styles, the voice style, alt text on every chart, header rows, language, title, page numbers), and has LibreOffice render the DOCX when it is installed. `sdk/typescript/tests/dossier.test.ts` checks the content: every chapter is there, every figure equals what `awa-kpis.js` computes, every sentence of a story has a reference that exists in the record, and a client edition leaves out what it should.

## Accessibility statement

The HTML edition aims at WCAG 2.2 level AA, and the checks above find no failure in the committed dossiers: landmarks (banner, navigation, main), a skip link, one `h1` and headings in order, `lang`, a text alternative and a table for every chart, keyboard access to everything with a visible focus ring, text contrast of 4.5:1 or more in the AWA theme and in the Valoria Life theme (in the AWA print layout the lowest pair, the waiting colour on paper, reads at 5.19:1), no sideways scroll at 400 px, and no motion under `prefers-reduced-motion` or with the Motion switch off. The DOCX has heading styles, alt text on every image, repeated header rows, its language and title, and a reading order that follows the text.

The PDF is tagged by Chromium (`page.pdf` with `tagged: true` and `outline: true`). What that output meets of PDF/UA-1 (ISO 14289-1):

- Met: the document is marked as tagged (`MarkInfo /Marked true`) with a structure tree; headings are `H1` to `H4` in order; tables have `Table`, `TR`, `TH` and `TD`; every chart is a `Figure` with alternative text (`Alt`); the language is set (`/Lang (en)`); the title is set and shown in place of the file name (`DisplayDocTitle`); bookmarks come from the headings (and are written again with each heading's own words, since Chromium drops the space where a heading wraps); the text is real text, in reading order; the fonts are embedded.
- Not met, or not proven: Chromium puts content hidden from assistive technology (running heads, folios, monograms, decorative lines) in `NonStruct` elements instead of marking it as artifacts, which PDF/UA-1 asks for; it writes no PDF/UA identification in the XMP metadata; table header cells carry no explicit `Scope`. No PDF/UA validator such as veraPDF was available where these files were made, so PDF/UA-1 conformance was not validated; the check says so when it runs without one.

## What is the same every time, and what is not

The HTML and the DOCX are the same bytes for the same record, options and edition: nothing in them depends on the clock, the archive's dates are fixed and the document's dates are the record's `as_of`. The PDF's dates and its document identifier are fixed after Chromium writes it, so the same Chromium with the same fonts writes the same bytes; another version of Chromium, or other fonts (Space Grotesk and Newsreader come from Google Fonts, Inter and JetBrains Mono from the system when installed), give another layout of the same content. The print layout is measured in the Chromium that prints it, so with other fonts its page breaks and its "and N more" lines can fall elsewhere, and still no text meets another. The DOCX's chart images are drawn by Chromium too, with the same caveat.
