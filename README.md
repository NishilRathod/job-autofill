<div align="center">

<img src="icons/icon-128.png" width="96" alt="JobFill icon">

# JobFill

**Fill job application forms from a profile that never leaves your computer.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4F46E5)
![No network requests](https://img.shields.io/badge/network%20requests-zero-34D399)

</div>

---

Every job application asks for the same 40–80 things: your name, your address, your
links, whether you need visa sponsorship, where you went to school, where you worked
and when, and a resume upload. Password managers handle about six of those fields.
Browser autofill guesses badly the moment a site uses a custom dropdown.

JobFill stores that information **once**, on your machine, and fills it into any
application form when you ask it to.

> **Status: in active development.** Phase 0 of 7 (scaffold) is complete. See
> [Roadmap](#roadmap) for what works today.

## Privacy, concretely

This is the whole point of the project, so it is worth being precise rather than
just claiming "we respect your privacy":

| Guarantee | How it is enforced |
| --- | --- |
| Your data is never uploaded, anywhere | The extension contains no `fetch`, `XMLHttpRequest`, `sendBeacon`, or `WebSocket` calls. A test in `test/no-network.test.js` fails the build if one is ever added. |
| Not even to Google | Storage uses `chrome.storage.local`, never `chrome.storage.sync`. Sync would replicate your profile through your Google account. |
| No "read all your data on all websites" warning | There are **no** `host_permissions` in the manifest. Filling is always user-initiated, so `activeTab` grants page access only at the moment you click Fill or press the shortcut. |
| Extension pages cannot phone home | The manifest sets `connect-src 'none'` in the extension's Content Security Policy, so the browser itself blocks outbound connections. |
| No accounts, no telemetry, no analytics | There is no server. There is nothing to sign into. |

Your resume and cover letter are stored as blobs in the extension's own local
IndexedDB. They are read only to attach to a file input on a page you opened.

## Install

JobFill is not on the Chrome Web Store. Loading it unpacked takes about a minute
and means you can read every line of what you are running.

1. Download this repository — either `git clone https://github.com/NishilRathod/job-autofill.git`
   or **Code → Download ZIP** and unzip it.
2. Open `chrome://extensions` in Chrome (or Edge/Brave — they use the same format).
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and select the folder you just downloaded.
5. Pin JobFill to your toolbar, then click it and choose **Set up your profile**.

There is no build step. You do not need Node or npm to *use* JobFill — those are
only needed to run the test suite while developing.

## Using it

- **Click the toolbar icon** on an application page. JobFill scans the form and shows
  you exactly what it intends to write, field by field, before it writes anything.
  Click **Fill** to apply it.
- **Press `Alt+Shift+F`** to skip the preview and fill immediately.
- **Press `Alt+Shift+Z`**, or click Undo in the toast, to restore the form to how it was.

JobFill never clicks Submit, and never fills anything unless you ask it to.

## Roadmap

| Phase | Status |
| --- | --- |
| 0 · Repo scaffold, manifest, icons | ✅ Done |
| 1 · Field schema and local storage layer | ⏳ Next |
| 2 · Options page profile editor | ⏳ |
| 3 · Field matching engine + tests | ⏳ |
| 4 · Content script: collect, fill, undo | ⏳ |
| 5 · Popup preview and learn mode | ⏳ |
| 6 · Adapters for Greenhouse, Lever, Ashby, Workday, and friends | ⏳ |
| 7 · Documentation and polish | ⏳ |

## Development

```bash
npm install     # dev dependencies only: vitest + jsdom
npm test        # run the suite
npm run icons   # regenerate icons/ from tools/make-icons.mjs
```

After changing any source file, hit the reload button on the JobFill card in
`chrome://extensions` to pick it up.

Architecture notes live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and the
full list of fields JobFill understands will live in `docs/FIELD-REFERENCE.md`.

## Contributing

Adapters for new applicant tracking systems are the most useful contribution, and
the easiest — most are a URL pattern plus a map of CSS selectors to field names.
Bug reports that include the job board and the field that filled wrong are also
very welcome.

Please never paste real personal data into an issue.

## License

MIT — see [LICENSE](LICENSE).
