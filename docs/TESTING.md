# Testing

`npm test` covers everything that can be covered without a browser: the field
schema, the storage layer, the matching engine, value coercion, and the fill
logic driven through jsdom. That is most of the project, and it is where the
bugs that matter live.

What it cannot cover is listed below. These are browser behaviours, not JobFill
logic — jsdom either does not implement them or implements them differently
enough that a passing test would prove nothing.

## What automated tests do not reach

| Behaviour | Why it needs a real browser |
| --- | --- |
| Attaching a file via `DataTransfer` | jsdom has no `DataTransfer` at all, and its `input.files` setter discards anything that is not a genuine `FileList`. The tests shim both, so they verify that the correct `File` is built from the stored bytes and that `accept` is honoured — not that Chrome accepts the assignment. |
| Custom dropdowns (Workday, react-select) | Opening one depends on real layout, focus and animation timing. jsdom has no layout. |
| `chrome.storage.local` and IndexedDB | Exercised through an in-memory fake and skipped respectively. |
| `activeTab` injection | There is no permission model to exercise outside Chrome. |
| Visual rendering | Both extension pages follow the OS light/dark theme, which needs eyes. |

## Manual checklist

Run this after any change to the content scripts, the service worker, or either
UI. It takes about ten minutes.

### Setup

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → select the
   repository folder.
2. Confirm the card shows **no errors and no warnings**.
3. Confirm the install prompt did **not** ask to "read and change all your data
   on all websites". If it did, a `host_permissions` entry has crept into the
   manifest and `test/no-network.test.js` should have caught it.

### Options page

4. Enter a full profile. Reload the page and confirm everything persisted.
5. Upload a resume PDF. Confirm the name, size and date appear, and that they
   survive a reload.
6. Check the coverage percentage moves as you fill fields, and that the
   **Voluntary self-identification** section still reads `0/7` when untouched.
7. **Export profile**, then **Delete everything**, then import the file back.
   Everything except documents should return.
8. Try importing an unrelated `.json` file. It must be refused with a readable
   message, and the existing profile must survive.

### Filling, per adapter

Do this on one live posting from each of Greenhouse (`job-boards.greenhouse.io`),
Lever (`jobs.lever.co`), Ashby (`jobs.ashbyhq.com`) and Workday
(`*.myworkdayjobs.com`).

9. Open the popup. The preview should list each field with the value it intends
   to write. Read it — this is the check the whole design rests on.
10. Click **Fill**. Confirm each value landed in the right field, and that the
    resume attached.
11. **Type into a filled field, then submit-check without submitting.** If a
    field looks filled but the site's validation says it is empty, the
    framework-state problem has regressed — see `setNativeValue` in
    `src/content/fill.js`.
12. Click **Undo**. The form must return to how it was, including the file input.
13. Reload, then press `Alt+Shift+F`. It should fill with no preview and show
    the in-page toast, with a working Undo.
14. Confirm no EEO/demographic field was filled. Turn the setting on, refill,
    and confirm they now are.

> Do not submit these applications.

### Privacy

15. Open DevTools → **Network** on the options page and on the service worker
    (`chrome://extensions` → **service worker**). Fill a form end to end.
    There must be zero requests.

## Reporting a matching bug

The most useful bug report names the job board, the field that filled wrong, and
what it should have been. If you can, include the field's label and its `name`
attribute from DevTools — those two are what the matcher scores against, and
they are usually enough to write a failing test from.

Please do not paste real personal data into an issue.
