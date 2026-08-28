/**
 * The three panels that are not schema sections: snippets, settings, and
 * backup.
 *
 * Kept out of options.js because they share nothing with the field editor
 * beyond the store — each is a small, self-contained screen.
 */

import { el } from "./fields.js";
import { clearDocuments } from "../../storage/files-db.js";

/** Panel header: eyebrow, title, description. */
function head(eyebrow, title, description) {
  return el("div", { className: "panel__head" }, [
    el("span", { className: "jf-mono panel__eyebrow", textContent: eyebrow }),
    el("h1", { className: "panel__title", textContent: title }),
    description ? el("p", { className: "panel__desc", textContent: description }) : null,
  ]);
}

/**
 * A destructive button that needs two clicks.
 *
 * Preferred over window.confirm(): a native dialog in an extension page is
 * jarring, and the second click keeps the consequence attached to the control
 * it belongs to. Reverts after a few seconds so it cannot be armed by accident.
 */
function armedButton(label, armedLabel, onConfirm) {
  const button = el("button", { type: "button", className: "jf-button jf-button--danger", textContent: label });
  let armed = false;
  let timer;

  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = armedLabel;
      timer = setTimeout(() => {
        armed = false;
        button.textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = label;
    await onConfirm();
  });

  return button;
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/**
 * Reusable answers to open-ended questions.
 *
 * JobFill suggests these for textareas rather than pasting them automatically.
 * A wrong essay answer on a submitted application is worse than an empty box,
 * and unlike a mistyped postcode it is not obvious at a glance.
 */
export function renderSnippetsPanel({ snippets, onSave }) {
  const panel = document.createDocumentFragment();
  panel.append(
    head(
      "snippets",
      "Snippets",
      'Saved answers for questions like "Why do you want to work here?". JobFill offers ' +
        "the closest match when it finds a long-answer box — it never fills one on its own."
    )
  );

  const list = el("div", { className: "card" });
  const draft = structuredClone(snippets);

  /** Persist and repaint. Snippets are few and edits are chunky, so a full
      re-render is simpler than surgical DOM updates and costs nothing. */
  const commit = () => onSave(draft.filter((s) => s.title.trim() || s.body.trim()));

  function paint() {
    list.replaceChildren();

    if (!draft.length) {
      list.append(
        el("div", { className: "empty" }, [
          el("p", { textContent: "No snippets yet." }),
          el("p", {
            className: "field__help",
            textContent: 'Good first ones: why this company, greatest strength, why you are leaving your current role.',
          }),
        ])
      );
    }

    draft.forEach((snippet, index) => {
      const title = el("input", {
        type: "text",
        className: "jf-input",
        value: snippet.title,
        placeholder: "What this answers, e.g. Why this company",
      });
      title.addEventListener("input", () => {
        draft[index].title = title.value;
        commit();
      });

      const body = el("textarea", {
        className: "jf-textarea",
        value: snippet.body,
        placeholder: "The answer itself.",
      });
      body.addEventListener("input", () => {
        draft[index].body = body.value;
        commit();
      });

      const remove = el("button", {
        type: "button",
        className: "jf-button jf-button--quiet jf-button--danger",
        textContent: "Delete",
        title: "Delete this snippet",
      });
      remove.addEventListener("click", () => {
        draft.splice(index, 1);
        commit();
        paint();
      });

      list.append(
        el("div", { className: "snippet" }, [
          el("div", { className: "snippet__head" }, [title, remove]),
          body,
          el("p", {
            className: "field__help",
            textContent: `${body.value.trim().split(/\s+/).filter(Boolean).length} words`,
          }),
        ])
      );
    });
  }

  paint();
  panel.append(list);

  const add = el("button", {
    type: "button",
    className: "jf-button jf-button--primary panel__add",
    textContent: "Add a snippet",
  });
  add.addEventListener("click", () => {
    draft.push({ id: crypto.randomUUID(), title: "", body: "" });
    paint();
  });
  panel.append(add);

  return panel;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** One toggle row. */
function toggle({ key, label, help, checked, onChange, gated }) {
  const box = el("input", { type: "checkbox", className: "field__check", checked, id: `set-${key}` });
  box.addEventListener("change", () => onChange(box.checked));

  return el("div", { className: `setting${gated ? " setting--gated" : ""}` }, [
    el("div", { className: "setting__control" }, [box]),
    el("label", { className: "setting__label", htmlFor: `set-${key}`, textContent: label }),
    el("p", { className: "setting__help", textContent: help }),
  ]);
}

export function renderSettingsPanel({ settings, onChange }) {
  const panel = document.createDocumentFragment();
  panel.append(head("settings", "Settings", "How JobFill behaves when it fills a form."));

  const card = el("div", { className: "card" }, [
    toggle({
      key: "showPreview",
      label: "Show a preview before filling",
      help: "Opening the popup lists every value it intends to write, so you approve it first. The Alt+Shift+F shortcut always skips this.",
      checked: settings.showPreview,
      onChange: (v) => onChange({ showPreview: v }),
    }),
    toggle({
      key: "overwriteExisting",
      label: "Overwrite values already in the form",
      help: "Off by default. A part-finished application is where clobbering hurts most.",
      checked: settings.overwriteExisting,
      onChange: (v) => onChange({ overwriteExisting: v }),
    }),
    toggle({
      key: "highlightFilled",
      label: "Outline the fields JobFill wrote",
      help: "A brief highlight so you can see what changed before you submit.",
      checked: settings.highlightFilled,
      onChange: (v) => onChange({ highlightFilled: v }),
    }),
    toggle({
      key: "attachDocuments",
      label: "Attach stored documents to uploads",
      help: "Attaches your resume and cover letter to file inputs on the page.",
      checked: settings.attachDocuments,
      onChange: (v) => onChange({ attachDocuments: v }),
    }),
  ]);

  // The demographics gate. Visually separated because it is the one setting
  // whose consequence is disclosing protected-class information.
  card.append(
    toggle({
      key: "fillDemographics",
      gated: true,
      label: "Fill voluntary self-identification questions",
      help:
        "Off by design. Turn this on only if you want JobFill to answer gender, race, veteran and " +
        "disability questions for you. Every answer defaults to declining, so check the Voluntary " +
        "self-identification section before enabling this.",
      checked: settings.fillDemographics,
      onChange: (v) => onChange({ fillDemographics: v }),
    })
  );

  // Confidence threshold. A slider rather than a number box because the value
  // is a judgement call, not a figure anyone knows in advance.
  const slider = el("input", {
    type: "range",
    min: "30",
    max: "95",
    step: "5",
    value: String(settings.confidenceThreshold),
    id: "set-confidence",
  });
  const readout = el("span", { className: "jf-mono", textContent: String(settings.confidenceThreshold) });
  slider.addEventListener("input", () => {
    readout.textContent = slider.value;
    onChange({ confidenceThreshold: Number(slider.value) });
  });

  card.append(
    el("div", { className: "setting" }, [
      el("div", { className: "setting__control" }, [readout]),
      el("label", { className: "setting__label", htmlFor: "set-confidence", textContent: "Match confidence needed to fill a field" }),
      el("p", {
        className: "setting__help",
        textContent:
          "Lower fills more fields and gets more of them wrong. 55 is the default: strong enough to " +
          "require a real name or label match, loose enough to handle badly built forms.",
      }),
      slider,
    ])
  );

  panel.append(card);
  return panel;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function renderBackupPanel({ store, onReload, notify }) {
  const panel = document.createDocumentFragment();
  panel.append(
    head(
      "backup",
      "Backup & reset",
      "Save a copy of your profile, move it to another computer, or wipe it."
    )
  );

  // --- Export
  const exportButton = el("button", { type: "button", className: "jf-button jf-button--primary", textContent: "Export profile" });
  exportButton.addEventListener("click", async () => {
    const state = await store.exportState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `jobfill-profile-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    // Revoking immediately can cancel the download in some builds; a tick is
    // enough for the browser to have taken the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Exported");
  });

  // --- Import
  const importInput = el("input", { type: "file", accept: ".json,application/json", className: "jf-sr", id: "import-file" });
  const importButton = el("button", { type: "button", className: "jf-button", textContent: "Import profile" });
  importButton.addEventListener("click", () => importInput.click());

  const importError = el("p", { className: "field__help" });
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      await store.importState(JSON.parse(await file.text()));
      importError.textContent = "";
      notify("Imported");
      onReload();
    } catch (error) {
      // Say what went wrong and what to do, rather than "import failed".
      importError.textContent =
        error instanceof SyntaxError
          ? "That file is not valid JSON. Pick the .json file JobFill exported."
          : error.message;
    }
    importInput.value = "";
  });

  panel.append(
    el("div", { className: "card" }, [
      el("div", { className: "card__head" }, [
        el("h2", { className: "card__title", textContent: "Move your profile" }),
      ]),
      el("p", { className: "field__help" }, [
        el("span", {
          textContent:
            "The exported file contains your details in plain text. It stays on your computer — " +
            "keep it somewhere private, and do not commit it to a repository.",
        }),
      ]),
      el("div", { className: "row", style: "margin-top:12px" }, [exportButton, importButton, importInput]),
      importError,
      el("p", { className: "field__help", style: "margin-top:10px" }, [
        el("span", { textContent: "Documents are not included — resumes are large and live in a separate local database. Re-attach them after importing." }),
      ]),
    ])
  );

  // --- Reset
  panel.append(
    el("div", { className: "card" }, [
      el("div", { className: "card__head" }, [
        el("h2", { className: "card__title", textContent: "Delete everything" }),
      ]),
      el("p", { className: "field__help", textContent: "Removes your profile, snippets, learned field mappings and stored documents from this computer. This cannot be undone." }),
      el("div", { className: "row", style: "margin-top:12px" }, [
        armedButton("Delete everything", "Click again to delete", async () => {
          await store.clearAll();
          await clearDocuments();
          notify("Deleted");
          onReload();
        }),
      ]),
    ])
  );

  return panel;
}
