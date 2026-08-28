/**
 * Renders one schema field as an editable control.
 *
 * Every input in the options page comes from here, so the schema's `type` is
 * the only thing that decides how a field looks. Adding a field to schema.js
 * needs no change in this file unless it introduces a genuinely new type.
 *
 * Each renderer returns a complete labelled row and reports changes through a
 * single `onChange(path, value)` callback — the caller owns persistence.
 */

import { derive, isDerived } from "../../core/derive.js";
import { formatBytes } from "../../storage/files-db.js";

/** Shorthand element builder. */
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/** Map a schema type to the HTML input type that gives the best keyboard. */
const INPUT_TYPES = {
  email: "email",
  tel: "tel",
  url: "url",
  date: "date",
  month: "month",
  number: "number",
};

/**
 * Build the label row: the human label on the left, the canonical path on the
 * right in mono.
 *
 * Showing the path is a deliberate choice rather than developer clutter. It is
 * the same identifier the user meets again in an exported profile and when
 * teaching JobFill an unrecognised field, so seeing it here is what makes those
 * later screens legible.
 */
function labelRow(field, inputId) {
  return el("div", { className: "field__labelrow" }, [
    el("label", { className: "field__label", htmlFor: inputId, textContent: field.label }),
    el("span", { className: "jf-mono field__path", textContent: field.path, title: `Canonical path: ${field.path}` }),
  ]);
}

/** Optional helper text under a control. */
function helpFor(field) {
  return field.help ? el("p", { className: "field__help", textContent: field.help }) : null;
}

// ---------------------------------------------------------------------------
// Type renderers. Each returns the control element only; the wrapper is shared.
// ---------------------------------------------------------------------------

function renderTextual(field, value, inputId, emit) {
  const control = el(field.type === "textarea" ? "textarea" : "input", {
    id: inputId,
    className: field.type === "textarea" ? "jf-textarea" : "jf-input",
    value: value ?? "",
    placeholder: field.placeholder ?? "",
  });

  if (field.type !== "textarea") {
    control.type = INPUT_TYPES[field.type] ?? "text";
    if (field.autocomplete) {
      // Turned off rather than passed through: the browser's own autofill
      // popping up over JobFill's editor is confusing, and the token's real
      // job is matching form fields, not this page.
      control.autocomplete = "off";
    }
  }

  // A datalist gives suggestions without forcing them, which is right for
  // fields like state where a form may want an abbreviation we do not list.
  if (field.options && field.type !== "select") {
    const listId = `${inputId}-list`;
    control.setAttribute("list", listId);
    control.after(
      el("datalist", { id: listId }, field.options.map((o) => el("option", { value: o })))
    );
  }

  control.addEventListener("input", () => emit(control.value));
  return control;
}

function renderSelect(field, value, inputId, emit) {
  const control = el("select", { id: inputId, className: "jf-select" }, [
    // An explicit empty option matters: without it a select would silently
    // commit the user to its first value just by existing.
    el("option", { value: "", textContent: "— not set —" }),
    ...field.options.map((option) => el("option", { value: option, textContent: option })),
  ]);
  control.value = value ?? "";
  control.addEventListener("change", () => emit(control.value));
  return control;
}

function renderMultiselect(field, value, inputId, emit) {
  const selected = new Set(Array.isArray(value) ? value : []);
  const group = el("div", { className: "field__checks", id: inputId, role: "group" });

  for (const option of field.options) {
    const box = el("input", { type: "checkbox", className: "field__check", checked: selected.has(option) });
    box.addEventListener("change", () => {
      if (box.checked) selected.add(option);
      else selected.delete(option);
      emit([...selected]);
    });
    group.append(el("label", { className: "field__checkrow" }, [box, el("span", { textContent: option })]));
  }
  return group;
}

function renderBoolean(field, value, inputId, emit) {
  const box = el("input", { type: "checkbox", id: inputId, className: "field__check", checked: Boolean(value) });
  box.addEventListener("change", () => emit(box.checked));
  return el("label", { className: "field__checkrow" }, [box, el("span", { textContent: field.label })]);
}

function renderTags(field, value, inputId, emit) {
  const list = Array.isArray(value) ? value : [];
  const control = el("input", {
    type: "text",
    id: inputId,
    className: "jf-input",
    value: list.join(", "),
    placeholder: field.placeholder ?? "JavaScript, Python, SQL",
  });

  control.addEventListener("input", () => {
    // Split on commas only. Splitting on spaces too would mangle multi-word
    // skills like "machine learning".
    emit(control.value.split(",").map((t) => t.trim()).filter(Boolean));
  });
  return control;
}

/**
 * A document slot: shows what is stored, or a picker if nothing is.
 *
 * `onFile` and `onRemove` talk to IndexedDB, which is why files are the one
 * type whose callbacks differ from the plain value emitter.
 */
function renderFile(field, metadata, inputId, { onFile, onRemove }) {
  const picker = el("input", {
    type: "file",
    id: inputId,
    className: "field__file",
    accept: ".pdf,.doc,.docx,.txt,.rtf,.odt,.png,.jpg,.jpeg",
  });
  picker.addEventListener("change", () => {
    if (picker.files?.[0]) onFile(picker.files[0]);
    picker.value = ""; // allow re-picking the same file after an error
  });

  if (!metadata) {
    return el("div", { className: "field__filebox" }, [
      picker,
      el("p", { className: "field__help", textContent: "Stored in this extension only. Never uploaded." }),
    ]);
  }

  const remove = el("button", { type: "button", className: "jf-button jf-button--quiet jf-button--danger", textContent: "Remove" });
  remove.addEventListener("click", onRemove);

  return el("div", { className: "field__filebox field__filebox--filled" }, [
    el("div", { className: "field__filemeta" }, [
      el("strong", { textContent: metadata.name }),
      el("span", {
        className: "jf-mono",
        textContent: `${formatBytes(metadata.size)} · saved ${new Date(metadata.savedAt).toLocaleDateString()}`,
      }),
    ]),
    el("div", { className: "field__fileactions" }, [
      el("label", { className: "jf-button", textContent: "Replace" }, [picker]),
      remove,
    ]),
  ]);
}

// ---------------------------------------------------------------------------

/**
 * Render a complete field row.
 *
 * @param {object} options
 * @param {object} options.field    Schema definition, carrying `path`.
 * @param {*} options.value         Stored value for this field.
 * @param {object} options.profile  Whole profile, needed to preview derivations.
 * @param {(value:*) => void} options.onChange
 * @param {(file:File) => void} [options.onFile]    Files only.
 * @param {() => void} [options.onRemove]           Files only.
 * @returns {HTMLElement}
 */
export function renderField({ field, value, profile, onChange, onFile, onRemove }) {
  const inputId = `f-${field.path.replace(/\./g, "-")}`;
  const row = el("div", { className: `field field--${field.type}` });

  if (field.type === "boolean") {
    // Checkboxes label themselves, so the shared label row would duplicate it.
    row.append(renderBoolean(field, value, inputId, onChange));
    row.append(el("span", { className: "jf-mono field__path field__path--inline", textContent: field.path }));
    if (helpFor(field)) row.append(helpFor(field));
    return row;
  }

  row.append(labelRow(field, inputId));

  let control;
  switch (field.type) {
    case "select": control = renderSelect(field, value, inputId, onChange); break;
    case "multiselect": control = renderMultiselect(field, value, inputId, onChange); break;
    case "tags": control = renderTags(field, value, inputId, onChange); break;
    case "file": control = renderFile(field, value, inputId, { onFile, onRemove }); break;
    default: control = renderTextual(field, value, inputId, onChange);
  }
  row.append(control);

  // For a derived field left blank, show what JobFill will use instead. This is
  // the whole affordance that makes "leave it blank" a safe choice.
  if (isDerived(field.path) && !String(value ?? "").trim()) {
    const computed = derive(field.path, profile);
    if (computed) {
      control.placeholder = computed;
      row.append(el("p", { className: "field__help field__help--derived" }, [
        el("span", { textContent: "Will use " }),
        el("strong", { textContent: computed }),
        el("span", { textContent: " unless you type something here." }),
      ]));
    }
  }

  const help = helpFor(field);
  if (help) row.append(help);
  return row;
}

export { el };
