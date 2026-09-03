# Architecture

This document explains how JobFill is put together and, more usefully, *why* — the
constraints that produced each decision. If you are adding an adapter or fixing a
mis-filled field, the [Message flow](#message-flow) and [Adapters](#adapters)
sections are the ones you need.

## The three layers

JobFill is split so that the hard part is testable without a browser.

```
src/core/       Pure JavaScript. No DOM, no chrome.* APIs.
                Field taxonomy, text normalisation, the scoring matcher,
                value formatting, snippet ranking.
                -> Imported by the service worker, the popup, the options
                   page, and the test suite.

src/content/    DOM only. No scoring logic, no storage access.
                Walks a page into plain FieldDescriptor objects, and writes
                values back into elements.
                -> Injected into the active tab on demand.

src/storage/    Persistence. chrome.storage.local for the profile, IndexedDB
                for document blobs.

src/ui/         The popup and the options page.
src/adapters/   Per-ATS data: URL patterns, selector hints, widget flags.
src/background/ The service worker, which orchestrates everything.
```

The rule that keeps this honest: **`src/core` must never reference `document`,
`window`, or `chrome`.** Everything it needs arrives as arguments. That is what
makes the matcher — which is where the genuinely tricky logic lives — coverable by
fast unit tests instead of brittle browser automation.

## Why the content script is "dumb"

The obvious design puts the matching engine in the content script: collect fields
and decide what to write, all on the page. We deliberately do not do that, for
three reasons.

1. **ES modules do not work in injected scripts.** `chrome.scripting.executeScript`
   injects classic scripts; a top-level `import` throws. Working around it means
   either a bundler (which the project has deliberately avoided, so that "clone and
   Load unpacked" is the whole install) or `web_accessible_resources` plus dynamic
   `import()`, which exposes extension internals to every page you visit.
2. **Less code on the page is less attack surface.** The content script is the only
   part of JobFill that shares a process with untrusted web content. Keeping your
   profile data and the rule tables out of it is worth a message hop.
3. **It falls out of the layering anyway.** Collecting and writing DOM nodes is a
   genuinely different job from deciding *what* to write.

So `src/content/*.js` are plain, non-module scripts injected as an ordered array.
They communicate through a single `globalThis.JobFill` namespace — the same pattern
a multi-file `content_scripts` manifest entry uses. Everything else in the codebase
is a real ES module, because the service worker (`"type": "module"`), the popup, the
options page, and Vitest all support them natively.

## Why `activeTab` and no `host_permissions`

Filling is always user-initiated: a toolbar click or a keyboard shortcut. Both of
those are exactly the gestures Chrome treats as granting `activeTab`, which gives
temporary access to the current tab and nothing else.

The payoff is that Chrome's install prompt does **not** say *"Read and change all
your data on all websites"*. That warning would be unavoidable with an auto-detect
design, and it would be an honest warning — an extension that watches every page can
read every page. Choosing manual triggering buys a permission model that matches
what the extension actually does.

## Message flow

All orchestration lives in the service worker, so the popup path and the hotkey path
share one implementation rather than drifting apart.

```
                   ┌──────────────┐
   click icon ───► │    popup     │
                   └──────┬───────┘
                          │ SCAN
                          ▼
 Alt+Shift+F ────► ┌──────────────┐   inject content scripts (activeTab)
                   │   service    │ ────────────────────────────────────┐
                   │    worker    │                                     ▼
                   └──────┬───────┘                            ┌─────────────────┐
                          │  ◄── FieldDescriptor[] ─────────── │ content scripts │
                          │                                    │  (active tab)   │
              load profile from storage                        └─────────────────┘
              pick adapter by URL                                       ▲
              run src/core/matcher                                      │
                          │                                             │
                          └──────────── FillPlan ───────────────────────┘
```

1. The popup opens and sends `SCAN`.
2. The worker injects the content scripts into the active tab and asks for a
   `COLLECT`. It gets back an array of `FieldDescriptor` objects — plain data
   describing each field's labels, attributes, and options, with no element
   references.
3. The worker loads the profile, picks an adapter from the tab's URL, and runs the
   matcher. The result is a **FillPlan**: a list of `{ fieldId, key, value, reason,
   confidence }`.
4. The popup renders that plan as a preview. The user clicks Fill, and `APPLY` sends
   the plan back down. The hotkey path does steps 2–4 in one shot and shows an
   in-page toast instead of a preview.
5. The content script writes each value, recording the previous value in an **undo
   journal** so the whole fill can be reverted.

`FieldDescriptor` and `FillPlan` are ordinary JSON. That is what lets the matcher be
tested against hand-written descriptors and saved HTML fixtures with no browser
involved.

## Adapters

An adapter is mostly *data*, not code:

- a URL pattern identifying the ATS,
- `selectors`: attribute patterns mapped to canonical field keys, for fields the
  generic engine gets wrong. Matched against the control's `name`, `id` and vendor
  attribute *and the same attributes on its wrapping elements* — component
  frameworks put the generic id on the control and the meaningful one on the div
  around it,
- `questions`: label patterns mapped to the same keys, for systems that name every
  field with an opaque record id (Lever's `cards[<uuid>][field7]`, Zoho Recruit's
  `rec-form_<digits>`). There the rendered question is the only thing identifying a
  field, and matching it per-site keeps that looseness out of the global rules,
- flags describing widget quirks (for example, "this site's dropdowns are buttons
  that open a listbox, not `<select>` elements").

Keeping adapters declarative means they can live in `src/core`-adjacent module land,
be unit-tested, and be shipped to the content script as plain JSON hints. It also
means adding support for a new job board usually does not require writing any DOM
code — which is the point, because ATS vendors redesign often and the maintenance
burden has to stay low.

## The privacy guarantees, as code

Three mechanisms, in increasing order of how hard they are to defeat:

1. `test/no-network.test.js` greps `src/` for network APIs and fails the suite.
   Catches accidents.
2. The manifest has no `host_permissions`, so even a compromised content script
   cannot be silently reinjected on other sites.
3. `connect-src 'none'` in the extension CSP means the *browser* refuses outbound
   connections from extension pages, regardless of what the code tries.

If you are reviewing this extension before trusting it with your data, item 3 is the
one that does not depend on us being careful.
