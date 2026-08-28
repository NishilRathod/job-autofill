/**
 * Options page shell: loads state, paints the section rail, and swaps panels.
 *
 * The rail switches panels rather than scroll-spying one long form. A hundred
 * fields in a single scroll reads as a chore; a dozen on screen reads as
 * finishable. The coverage meters exist for the same reason — they turn "how
 * much is left" from a guess into a number.
 */

import { SECTIONS, SECTION_BY_ID } from "../../core/schema.js";
import { getStore } from "../../storage/store.js";
import { emptyProfile } from "../../core/defaults.js";
import { listDocuments, putDocument, deleteDocument } from "../../storage/files-db.js";
import { renderField, el } from "./fields.js";
import { renderSnippetsPanel, renderSettingsPanel, renderBackupPanel } from "./panels.js";

const store = getStore();
const railNode = document.getElementById("rail");
const panelNode = document.getElementById("panel");
const statusNode = document.getElementById("save-status");

/** Panels that are not schema sections. */
const UTILITY_PANELS = [
  { id: "_snippets", label: "Snippets" },
  { id: "_settings", label: "Settings" },
  { id: "_backup", label: "Backup & reset" },
];

/** In-memory mirror of stored state; the store remains the source of truth. */
let state = { profile: {}, settings: {}, snippets: [], documents: {} };
let activeId = SECTIONS[0].id;

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

let statusTimer;
/** Briefly confirm a write. Silence is the normal state, not "Saved" forever. */
function notify(message = "Saved") {
  statusNode.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusNode.textContent = ""), 1600);
}

/**
 * Debounced per-path writes.
 *
 * Typing a name fires an input event per character. Without debouncing that is
 * a storage write per keystroke, and — worse — a rail repaint per keystroke.
 * Keyed by path so edits to different fields never cancel each other.
 */
const pending = new Map();
function saveValue(path, value) {
  // Update the mirror immediately so coverage and derived previews stay live.
  applyToMirror(path, value);
  paintRail();

  clearTimeout(pending.get(path));
  pending.set(
    path,
    setTimeout(async () => {
      pending.delete(path);
      await store.setValue(path, value);
      notify();
    }, 350)
  );
}

/** Write into the in-memory profile without touching storage. */
function applyToMirror(path, value) {
  const [sectionId, a, b] = path.split(".");
  if (b === undefined) state.profile[sectionId][a] = value;
  else state.profile[sectionId][Number(a)][b] = value;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Whether a stored value holds anything at all. */
const hasValue = (value) =>
  Array.isArray(value) ? value.length > 0 : value !== "" && value !== null && value !== false && value !== undefined;

/**
 * The blank profile, kept for comparison. Some fields ship with a seeded value
 * — every demographic starts at "prefer not to say", and the signature date at
 * "Today's date" — and counting those as progress would credit the user for
 * work they have not done.
 */
const TEMPLATE = emptyProfile();

/** A field counts towards coverage only if the user supplied the value. */
function isUserSupplied(sectionId, key, value) {
  if (!hasValue(value)) return false;
  const seeded = TEMPLATE[sectionId] && (Array.isArray(TEMPLATE[sectionId]) ? TEMPLATE[sectionId][0] : TEMPLATE[sectionId])?.[key];
  if (seeded === undefined) return true;
  // Compare structurally so a seeded array default (raceEthnicity) matches too.
  return JSON.stringify(value) !== JSON.stringify(seeded);
}

/**
 * Filled and total counts for a section.
 *
 * Repeating sections count across every entry, so adding a blank employment
 * row visibly lowers coverage — which is honest: there is now more to fill.
 */
function coverageFor(section) {
  const entries = section.repeating ? state.profile[section.id] ?? [] : [state.profile[section.id] ?? {}];
  let filled = 0;
  for (const entry of entries) {
    for (const field of section.fields) {
      if (isUserSupplied(section.id, field.key, entry?.[field.key])) filled += 1;
    }
  }
  return { filled, total: section.fields.length * Math.max(entries.length, 1) };
}

/**
 * Headline coverage across the profile.
 *
 * Demographics is excluded: it ships pre-seeded with "prefer not to say", so
 * counting it would credit the user for seven fields they never touched and
 * make the number meaningless.
 */
function overallCoverage() {
  let filled = 0;
  let total = 0;
  for (const section of SECTIONS) {
    if (section.sensitive) continue;
    const c = coverageFor(section);
    filled += c.filled;
    total += c.total;
  }
  return total ? Math.round((filled / total) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

function railItem({ id, label, coverage }) {
  const item = el("button", {
    type: "button",
    className: "rail__item",
    textContent: label,
  });
  item.setAttribute("aria-current", String(id === activeId));
  item.addEventListener("click", () => show(id));

  if (coverage) {
    const complete = coverage.filled === coverage.total;
    item.append(
      el("span", {
        className: `rail__count${complete ? " rail__count--complete" : ""}`,
        textContent: `${coverage.filled}/${coverage.total}`,
      }),
      el("span", { className: "rail__meter" }, [
        el("i", { style: `width:${coverage.total ? (coverage.filled / coverage.total) * 100 : 0}%` }),
      ])
    );
  }
  return item;
}

function paintRail() {
  const pct = overallCoverage();
  railNode.replaceChildren(
    el("div", { className: "rail__summary" }, [
      el("div", { className: "rail__pct", textContent: `${pct}%` }),
      el("span", { className: "jf-mono rail__label", textContent: "profile coverage" }),
    ]),
    ...SECTIONS.map((section) =>
      railItem({ id: section.id, label: section.label, coverage: coverageFor(section) })
    ),
    el("div", { className: "rail__divider" }),
    ...UTILITY_PANELS.map((p) => railItem(p))
  );
}

// ---------------------------------------------------------------------------
// Section panels
// ---------------------------------------------------------------------------

/** Render the fields of one entry (or of a non-repeating section). */
function renderFieldGrid(section, entry, index) {
  const grid = el("div", { className: "fields" });

  for (const field of section.fields) {
    const path = index === null ? `${section.id}.${field.key}` : `${section.id}.${index}.${field.key}`;
    const definition = { ...field, path };

    grid.append(
      renderField({
        field: definition,
        value: entry?.[field.key],
        profile: state.profile,
        onChange: (value) => saveValue(path, value),

        // Documents bypass the profile entirely — the blob goes to IndexedDB
        // and only its metadata is mirrored into the profile for display.
        onFile: async (file) => {
          try {
            const metadata = await putDocument(path, file);
            state.documents[path] = metadata;
            await store.setValue(path, metadata);
            state.profile[section.id][field.key] = metadata;
            notify("Saved");
            show(section.id);
          } catch (error) {
            notify(error.message);
          }
        },
        onRemove: async () => {
          await deleteDocument(path);
          delete state.documents[path];
          await store.setValue(path, null);
          state.profile[section.id][field.key] = null;
          notify("Removed");
          show(section.id);
        },
      })
    );
  }
  return grid;
}

function renderSectionPanel(section) {
  const fragment = document.createDocumentFragment();

  fragment.append(
    el("div", { className: "panel__head" }, [
      el("span", { className: "jf-mono panel__eyebrow", textContent: section.id }),
      el("h1", { className: "panel__title", textContent: section.label }),
      section.description ? el("p", { className: "panel__desc", textContent: section.description }) : null,
      section.sensitive
        ? el("p", { className: "panel__note" }, [
            el("span", {
              textContent:
                state.settings.fillDemographics
                  ? "Filling these is currently ON. JobFill will answer these questions for you."
                  : "Filling these is OFF. Nothing here is written to any form until you turn it on in Settings.",
            }),
          ])
        : null,
    ])
  );

  if (!section.repeating) {
    fragment.append(el("div", { className: "card" }, [renderFieldGrid(section, state.profile[section.id], null)]));
    return fragment;
  }

  // --- Repeating section: one card per entry.
  const entries = state.profile[section.id] ?? [];
  entries.forEach((entry, index) => {
    const remove = el("button", {
      type: "button",
      className: "jf-button jf-button--quiet jf-button--danger",
      textContent: "Remove",
    });
    remove.addEventListener("click", async () => {
      const next = [...state.profile[section.id]];
      next.splice(index, 1);
      // Always leave one entry so the panel never renders empty.
      state.profile[section.id] = next.length ? next : [structuredClone(entries[0])].map(blankEntry(section));
      await store.saveProfile(state.profile);
      notify("Removed");
      show(section.id);
    });

    fragment.append(
      el("div", { className: "card" }, [
        el("div", { className: "card__head" }, [
          el("h2", { className: "card__title" }, [
            el("span", { textContent: `${section.itemLabel} ` }),
            el("span", { className: "entry__index", textContent: String(index + 1) }),
          ]),
          entries.length > 1 ? remove : el("span"),
        ]),
        renderFieldGrid(section, entry, index),
      ])
    );
  });

  const add = el("button", {
    type: "button",
    className: "jf-button panel__add",
    textContent: `Add another ${section.itemLabel.toLowerCase()}`,
    disabled: entries.length >= section.maxItems,
  });
  add.addEventListener("click", async () => {
    state.profile[section.id] = [...entries, blankEntry(section)()];
    await store.saveProfile(state.profile);
    show(section.id);
  });
  fragment.append(add);

  return fragment;
}

/** A blank entry matching a repeating section's shape. */
const blankEntry = (section) => () =>
  Object.fromEntries(
    section.fields.map((f) => [f.key, f.type === "boolean" ? false : f.type === "tags" || f.type === "multiselect" ? [] : ""])
  );

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function show(id) {
  activeId = id;
  paintRail();

  let content;
  if (id === "_snippets") {
    content = renderSnippetsPanel({
      snippets: state.snippets,
      onSave: async (snippets) => {
        state.snippets = snippets;
        await store.saveSnippets(snippets);
        notify();
      },
    });
  } else if (id === "_settings") {
    content = renderSettingsPanel({
      settings: state.settings,
      onChange: async (patch) => {
        state.settings = await store.saveSettings(patch);
        notify();
        // The demographics panel's banner reflects this setting, so repaint if
        // the gate just moved.
        if ("fillDemographics" in patch) paintRail();
      },
    });
  } else if (id === "_backup") {
    content = renderBackupPanel({ store, notify, onReload: boot });
  } else {
    content = renderSectionPanel(SECTION_BY_ID.get(id));
  }

  panelNode.replaceChildren(content);
  // Move focus to the panel so keyboard users land on the new content rather
  // than staying in the rail.
  panelNode.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

// ---------------------------------------------------------------------------

async function boot() {
  const stored = await store.read();
  state = {
    profile: stored.profile,
    settings: stored.settings,
    snippets: stored.snippets,
    // Read from IndexedDB rather than trusting the profile's mirrored copy, so
    // a document deleted out from under us does not show as still attached.
    documents: await listDocuments().catch(() => ({})),
  };

  // Reconcile: the profile holds document metadata for display, but IndexedDB
  // is authoritative about what is actually stored.
  for (const field of SECTION_BY_ID.get("documents").fields) {
    if (field.type !== "file") continue;
    state.profile.documents[field.key] = state.documents[`documents.${field.key}`] ?? null;
  }

  show(activeId);
}

boot();
