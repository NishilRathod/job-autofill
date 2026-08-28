# Contributing

The two most useful contributions are adapters for job boards JobFill doesn't
handle well, and bug reports about fields that filled wrong. Both are described
below.

Before anything else: **never put real personal data in this repository or in an
issue.** `*.local.json` is gitignored for exactly this reason.

## Getting set up

```bash
git clone https://github.com/NishilRathod/job-autofill.git
cd job-autofill
npm install
npm test
```

Then load the folder unpacked at `chrome://extensions`. There is no build step,
so an edit plus a reload of the extension card is the whole loop. For UI work,
`npm run dev` serves the popup and options pages in an ordinary browser tab with
the `chrome.*` APIs shimmed, which is faster than reloading unpacked.

## Reporting a field that filled wrong

The most useful report has three things:

1. The job board (a link to a live posting is ideal).
2. What was filled, and what it should have been.
3. The field's **label** and its **`name` attribute**, from DevTools.

Those last two are what the matcher scores against, so they're usually enough to
write a failing test from without anyone needing your details.

## Adding an adapter

An adapter is a URL pattern plus a map of attribute patterns to canonical field
paths. It lives in [`src/adapters/ats.js`](src/adapters/ats.js) and needs no DOM
code:

```js
{
  name: "Acme ATS",
  match: /jobs\.acme\.com/i,
  selectors: {
    // pattern (case-insensitive regex) -> canonical path from the schema
    "applicant_given_name": "identity.firstName",
    "\\bwork_email\\b": "identity.email",
  },
},
```

Patterns are tested against the field's `name`, `id` and vendor attribute
(`data-automation-id`, `data-testid`, `data-qa`) joined together.

**Only add entries for fields the generic engine gets wrong.** A bloated adapter
is one that breaks on the vendor's next redesign. If a field is already filled
correctly by the heuristics, leave it alone.

### The thing to be careful about

An adapter hint scores 90, which outranks every heuristic — **including the
vetoes** that stop JobFill putting your address into an emergency contact field.
An over-broad pattern therefore doesn't just mis-fill one field, it disables the
safety net.

So: prefer `\bemail\b` to `email`, and check the near-misses. `email` also
matches `confirmEmail`; `country` also matches `countryRegion`, which on Workday
is the state field. There are tests for both of those in
[`test/adapters.test.js`](test/adapters.test.js) — add one for your site in the
same shape.

Every path you reference is checked against the schema automatically, because a
typo there fails silently: the hint wins the match, the value lookup finds
nothing, and the field is quietly skipped.

## Adding or fixing a matching rule

Rules live in [`src/core/rules.js`](src/core/rules.js), and most of each rule is
*derived from the schema* — a field labelled "First name" with key `firstName`
already tells the matcher what to look for. You only add what the schema can't
express:

- `aliases` — wordings a form uses that the label doesn't cover
- `veto` — phrases that must rule the field **out**, however well it scores
- `context` — section headings that make the field more likely

Vetoes matter more than anything else in that file. An application form is full
of near-misses, and filling one is worse than filling nothing, because the value
is plausible enough to survive a glance before the form is submitted.

Add a case to [`test/matcher.test.js`](test/matcher.test.js) for any rule you
change. If the fix involves markup shapes the existing fixtures don't cover, add
a fixture under `test/fixtures/` — **reconstructed, not copied from a real
posting**, and reproducing the structural problem rather than the page.

## Adding a field to the profile

Edit [`src/core/schema.js`](src/core/schema.js) and nothing else. It's the single
source of truth: the options editor generates itself from it, the matcher takes
its key list from it, and `docs/FIELD-REFERENCE.md` is generated from it. Run
`npm run docs` afterwards, or a test will remind you.

## Tests

`npm test` must pass. Beyond that:

- Test the behaviour, not the implementation. "Does not put your email in a
  confirmation box" survives a refactor; "calls scoreRule twice" doesn't.
- **Check your test can fail.** A guard test that passes vacuously is worse than
  no test, because it's read as coverage. Break the thing deliberately, watch
  the test go red, then put it back.
- Comment *why* a case matters when it isn't obvious, especially for the
  safety-critical ones.

`docs/TESTING.md` lists what the automated tests can't reach — file attachment,
custom dropdowns, real layout — and the manual checklist that covers it. Run that
checklist for changes to the content scripts or either UI.

## Code style

Match what's there. Some specifics that are load-bearing rather than taste:

- `src/core/**` must never touch `document`, `window` or `chrome`. That boundary
  is what keeps the matching engine testable without a browser.
- `src/content/**` are **classic scripts**, not ES modules — `executeScript`
  injects classic scripts and a top-level `import` throws. They share
  `globalThis.JobFill`.
- Never add a network call. See the privacy table in the README; three separate
  mechanisms exist to stop it, and the right response to needing one is that the
  feature doesn't belong in this extension.
