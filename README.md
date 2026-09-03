<div align="center">

<img src="icons/icon-128.png" width="88" alt="">

# JobFill

**Fill job application forms from a profile that never leaves your computer.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4F46E5)
![No build step](https://img.shields.io/badge/build%20step-none-64748B)
![Network requests](https://img.shields.io/badge/network%20requests-zero-0F9D6E)

</div>

---

Every job application asks for the same forty to eighty things: your name, your
address, your links, whether you need visa sponsorship, where you studied, where
you worked and when, and a resume upload. Password managers handle about six of
those fields. Browser autofill guesses badly the moment a site uses a custom
dropdown — which is most of the sites that matter.

JobFill stores all of it **once, on your machine**, and fills it into any
application form when you ask it to.

```
┌─ JobFill ────────────── greenhouse.io ─┐
│                                        │
│  12 fields              Greenhouse     │
│  ┌──────────────────────────────────┐  │
│  │ ☑  First Name            Ada     │  │
│  │ ☑  Email       ada@example.com   │  │
│  │ ☑  LinkedIn    linkedin.com/…    │  │
│  │ ☑  Authorized to work?    Yes    │  │
│  │ ☑  Require sponsorship?    No    │  │
│  └──────────────────────────────────┘  │
│  LEFT ALONE                         3  │
│  ┌──────────────────────────────────┐  │
│  │    Gender    self-ID filling off │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [        Fill 12 fields         ]     │
│   alt+shift+F fills without preview    │
└────────────────────────────────────────┘
```

It shows you every value **before** it writes anything, and one click puts the
form back exactly as it was.

## Privacy, concretely

This is the whole point of the project, so it's worth being precise rather than
just claiming to respect your privacy:

| Guarantee | How it's enforced |
| --- | --- |
| Your data is never uploaded, anywhere | The extension contains no `fetch`, `XMLHttpRequest`, `sendBeacon`, or `WebSocket`. `test/no-network.test.js` fails the build if one is ever added — it parses out comments and strings first, so it can't be fooled either way. |
| Not even to Google | Storage uses `chrome.storage.local`, never `chrome.storage.sync`. Sync would replicate your profile through your Google account. Also enforced by test. |
| No "read all your data on all websites" warning | There are **no** `host_permissions`. Filling is always user-initiated, so `activeTab` grants page access only for the gesture that invoked it. |
| Extension pages cannot phone home | The manifest sets `connect-src 'none'`, so the *browser* refuses outbound connections regardless of what the code tries. |
| No accounts, no telemetry, no analytics | There is no server. There is nothing to sign in to. |

Your resume and cover letter live in this extension's own local IndexedDB. They
are read only to attach to a file input on a page you opened.

**JobFill never clicks Submit.** It fills; you review and send.

## Install

JobFill is not on the Chrome Web Store. Loading it unpacked takes a minute and
means you can read every line of what you're running.

1. `git clone https://github.com/NishilRathod/job-autofill.git`
   — or **Code → Download ZIP** and unzip it.
2. Open `chrome://extensions` (Edge and Brave work too — same format).
3. Turn on **Developer mode**, top right.
4. **Load unpacked** → select the folder.
5. The profile editor opens automatically. Fill in what applies to you.

There is no build step. You don't need Node or npm to *use* JobFill — those are
only for running the tests.

## Using it

| | |
| --- | --- |
| **Click the toolbar icon** | Scans the form and previews every value before writing. Untick anything you don't want. Click a row to jump to that field on the page. |
| **`Alt+Shift+F`** | Fills immediately, no preview. Shows a toast with an Undo button. |
| **`Alt+Shift+Z`** | Undoes the last fill. |

When JobFill meets a field it doesn't recognise, the popup offers a dropdown to
tell it what that field is. The lesson is remembered **for that site only**, so a
correction on one job board can't misfire on another.

## What it knows

105 fields across 15 sections — identity, address, links, work eligibility,
availability, employment history, education, skills, languages, certifications,
references, screening questions, signature, self-identification, and documents.
The full list is in [`docs/FIELD-REFERENCE.md`](docs/FIELD-REFERENCE.md),
generated from the schema so it can't go stale.

Two categories get special handling:

- **Self-identification** (gender, race, veteran and disability status) is stored
  but **never filled unless you turn it on**. Every answer defaults to declining
  to answer. Work authorisation and sponsorship are *not* in this category — they
  are ordinary screening questions and fill by default.
- **Criminal-history questions are never answered.** Their wording varies by
  jurisdiction in ways that change the correct answer, and a confidently wrong
  auto-answer on a submitted application is far worse than a blank box.

## Supported job boards

The matching engine works on any form. These sites additionally get hand-tuned
adapters for the fields the heuristics get wrong:

Workday · Greenhouse · Lever · Zoho Recruit · Ashby · Workable ·
SmartRecruiters · iCIMS · Taleo · BambooHR · Rippling · Pinpoint · Teamtailor

## Development

```bash
npm install     # dev only: vitest + jsdom
npm test        # 705 tests
npm run dev     # preview the extension's pages in a normal browser tab
npm run docs    # regenerate docs/FIELD-REFERENCE.md from the schema
npm run icons   # regenerate icons/ from tools/make-icons.mjs
```

Reload the JobFill card on `chrome://extensions` to pick up source changes.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit, and why
  the content script is deliberately dumb
- [`docs/TESTING.md`](docs/TESTING.md) — what the automated tests can't reach,
  and the manual checklist that covers it
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — adding an adapter or a matching rule

## Contributing

Adapters for new applicant tracking systems are the most useful contribution and
the easiest — most are a URL pattern plus a map of field names.

Bug reports that name the job board and the field that filled wrong are just as
welcome. Please never paste real personal data into an issue.

## License

MIT — see [LICENSE](LICENSE).
